'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const coordinator = require('../skills/cloud-parallel/scripts/coordinator.cjs');
const cloud = require('../cloud/runtime.cjs');
const cloudInstaller = require('../scripts/install-cloud.cjs');
const localRuntime = require('../parallel/runtime.cjs');

function git(root, args) {
    const result = spawnSync('git', ['--no-pager', '-C', root, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    return result.stdout.trim();
}

function fixture(t, adjust = () => {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cloud-stories-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }));
    const root = path.join(directory, 'project');
    fs.mkdirSync(root);
    const features = { features: [
        { id: 'F001', name: 'Alpha feature', priority: 1, status: 'not-started', dependencies: [], acceptance_criteria: ['Alpha works'] },
        { id: 'F002', name: 'Beta feature', priority: 2, status: 'not-started', dependencies: [], acceptance_criteria: ['Beta works'] }
    ] };
    const backlog = { version: 1, stories: [
        { id: 'F001-S01', feature_id: 'F001', title: 'Build alpha', status: 'todo', depends_on: [], acceptance_criteria: ['Alpha works'], covers_feature_criteria: [1] },
        { id: 'F002-S01', feature_id: 'F002', title: 'Build beta', status: 'todo', depends_on: [], acceptance_criteria: ['Beta works'], covers_feature_criteria: [1] }
    ] };
    const config = {
        version: 1, repository: 'octo/project', base_branch: 'main', feature_ids: ['F001', 'F002'],
        approved_designs: ['F001', 'F002'], instructions_reviewed: true, branch_protection_confirmed: true,
        max_workers: 2, max_minutes: 120, max_attempts: 2, require_ci: true, merge_method: 'squash',
        verification: [{ name: 'Regression', kind: 'test', command: process.execPath, args: ['tests/regression.cjs'], timeout_seconds: 30 }],
        ownership: {
            'F001-S01': { allowed_paths: ['src/alpha.cjs'], resources: [] },
            'F002-S01': { allowed_paths: ['src/beta.cjs'], resources: [] }
        }
    };
    const data = { features, backlog, config, files: {} };
    adjust(data);
    const files = {
        'docs/FEATURES.json': JSON.stringify(features, null, 2) + '\n',
        'docs/backlog/backlog.json': JSON.stringify(backlog, null, 2) + '\n',
        'docs/PROGRESS.md': '# Progress\n\nExisting history.\n',
        'docs/PLAN.md': '# Plan\n',
        'docs/ARCHITECTURE.md': '# Architecture\n',
        'src/alpha.cjs': 'module.exports = 0;\n',
        'src/beta.cjs': 'module.exports = 0;\n',
        'tests/regression.cjs': "const assert = require('node:assert/strict');\nassert.ok([0, 1].includes(require('../src/alpha.cjs')));\nassert.ok([0, 1].includes(require('../src/beta.cjs')));\n",
        ...data.files
    };
    for (const [name, content] of Object.entries(files)) {
        const filename = path.join(root, name);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, content);
    }
    const configPath = path.join(directory, 'cloud-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    git(root, ['init', '--quiet', '-b', 'main']);
    git(root, ['config', 'user.name', 'Harness Test']);
    git(root, ['config', 'user.email', 'harness-test@example.invalid']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    git(root, ['config', 'core.autocrlf', 'false']);
    git(root, ['add', '.']);
    git(root, ['commit', '--quiet', '-m', 'test: initialize fixture']);
    return { directory, root, configPath, features, backlog, config, base: git(root, ['rev-parse', 'HEAD']) };
}

function fakeGitHub(data) {
    const state = { base: data.base, sessions: {}, prs: {}, parents: {}, calls: [], prompts: [], ci: [{ name: 'CI', bucket: 'pass' }], mode: 'normal', next: 1 };
    function gh(root, args, input) {
        state.calls.push([...args]);
        if (args[0] === '--version') return 'gh version 2.90.0';
        if (args[0] === 'agent-task' && args[1] === 'view' && args[2] === '--help') return '--json';
        if (args[0] === 'pr' && args[1] === 'merge' && args[2] === '--help') return '--match-head-commit';
        if (args[0] === 'api' && args[1].includes('/git/commits/')) {
            const sha = args[1].split('/').pop();
            return JSON.stringify({ parents: [{ sha: state.parents[sha] }] });
        }
        if (args[0] === 'api') return state.base;
        if (args[0] === 'agent-task' && args[1] === 'create') {
            state.prompts.push(input);
            if (state.mode === 'error') throw new Error('Simulated network interruption');
            if (state.mode === 'queued') return 'job 12345678-0000-0000-0000-000000000001 queued. View progress: https://github.com/copilot/agents';
            const index = state.next++, number = 100 + index;
            const session = `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
            const story = /^Story: (\S+)/m.exec(input)[1];
            state.sessions[session] = { id: session, state: 'in_progress', repository: 'octo/project', pullRequestNumber: number, pullRequestUrl: `https://github.com/octo/project/pull/${number}` };
            state.prs[number] = { number, url: `https://github.com/octo/project/pull/${number}`, state: 'OPEN', isDraft: false,
                baseRefName: 'main', baseRefOid: state.base, headRefOid: state.base, mergeable: 'MERGEABLE', mergeCommit: null, autoMergeRequest: null, story };
            return `https://github.com/octo/project/pull/${number}/agent-sessions/${session}`;
        }
        if (args[0] === 'agent-task' && args[1] === 'view') return JSON.stringify(state.sessions[args[2]]);
        if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify(state.prs[Number(args[2])]);
        if (args[0] === 'pr' && args[1] === 'checks') return JSON.stringify(state.ci);
        if (args[0] === 'pr' && args[1] === 'merge') {
            if (state.mode === 'merge-error') throw new Error('Simulated merge interruption');
            if (state.mode === 'queue') return '';
            const pr = state.prs[Number(args[2])];
            const server = path.join(data.directory, `server-${pr.number}`);
            git(root, ['worktree', 'add', '--quiet', '--detach', server, pr.baseRefOid]);
            git(server, ['merge', '--squash', pr.headRefOid]);
            git(server, ['commit', '--quiet', '-m', 'test: merge story']);
            const sha = git(server, ['rev-parse', 'HEAD']);
            state.parents[sha] = state.mode === 'wrong-parent' ? 'f'.repeat(40) : pr.baseRefOid;
            state.base = sha;
            pr.state = 'MERGED';
            pr.mergeCommit = { oid: sha };
            return '';
        }
        throw new Error(`Unexpected GitHub command: ${args.join(' ')}`);
    }
    return { state, gh };
}

function reviewWorktree(data, name, file, base = data.base) {
    const workspace = path.join(data.directory, name);
    git(data.root, ['worktree', 'add', '--quiet', '--detach', workspace, base]);
    fs.writeFileSync(path.join(workspace, file), 'module.exports = 1;\n');
    git(workspace, ['add', '--', file]);
    git(workspace, ['commit', '--quiet', '-m', 'test: implement story']);
    return { workspace, sha: git(workspace, ['rev-parse', 'HEAD']) };
}

function pass(candidate, overrides = {}) {
    return {
        run_id: candidate.run_id, feature_id: candidate.feature_id, story_id: candidate.story_id,
        candidate_sha: candidate.candidate_sha, evaluator_id: candidate.evaluator_id, verdict: 'PASS',
        criteria: candidate.acceptance_criteria.map(criterion => ({ criterion, passed: true, evidence: 'Inspected the exact commit and ran regression checks.' })),
        issues: [], ...overrides
    };
}

test('dispatches independent stories across features up to the approved cloud capacity', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    const planned = coordinator.plan(data.root, data.configPath);
    assert.deepEqual(planned.ready, ['F001-S01', 'F002-S01']);
    assert.throws(() => coordinator.begin(data.root, data.configPath, false, remote.gh), /--approve/);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const result = coordinator.dispatch(data.root, null, true, remote.gh);
    assert.deepEqual(result.started.map(item => item.story_id), ['F001-S01', 'F002-S01']);
    assert.equal(coordinator.status(data.root).available_slots, 0);
    assert.equal(remote.state.prompts.length, 2);
    assert.ok(remote.state.prompts.every(text => text.startsWith('Solution Harness cloud story assignment v1\n')));
    assert.match(remote.state.prompts[0], /Allowed paths: \["src\/alpha\.cjs"\]/);
    assert.equal(remote.state.calls.filter(args => args[0] === 'agent-task' && args[1] === 'create').length, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data.root, 'docs', 'FEATURES.json'))).features[0].status, 'not-started');
});

test('serializes stories that share a resource even when their paths are disjoint', t => {
    const data = fixture(t, value => {
        value.config.ownership['F001-S01'].resources = ['shared-db'];
        value.config.ownership['F002-S01'].resources = ['shared-db'];
        value.config.max_workers = 3;
    });
    const remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    assert.deepEqual(coordinator.dispatch(data.root, null, true, remote.gh).started.map(item => item.story_id), ['F001-S01']);
    assert.deepEqual(coordinator.status(data.root).ready, []);
    assert.throws(() => coordinator.dispatch(data.root, 'F002-S01', true, remote.gh), /not ready|conflicts/);
});

test('keeps ambiguous task creation fenced until an operator reconciles it', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    remote.state.mode = 'error';
    assert.throws(() => coordinator.dispatch(data.root, 'F001-S01', true, remote.gh), /network interruption/);
    assert.equal(coordinator.status(data.root).jobs[0].status, 'uncertain');
    assert.throws(() => coordinator.dispatch(data.root, 'F001-S01', true, remote.gh), /not ready|capacity/);
    assert.throws(() => coordinator.control(data.root, 'abandon', 'F001-S01', false, remote.gh), /--approve/);
    coordinator.control(data.root, 'abandon', 'F001-S01', true, remote.gh);
    remote.state.mode = 'queued';
    const result = coordinator.dispatch(data.root, 'F001-S01', true, remote.gh);
    assert.equal(result.started[0].status, 'awaiting-reference');
    assert.equal(result.started[0].job_id, '12345678-0000-0000-0000-000000000001');
    assert.equal(coordinator.status(data.root).jobs[0].attempt, 2);
});

test('reviews exact cloud PRs locally, merges serially, and publishes only after full-feature review', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const started = coordinator.dispatch(data.root, null, true, remote.gh).started;
    const alpha = reviewWorktree(data, 'review-alpha', 'src/alpha.cjs');
    const beta = reviewWorktree(data, 'review-beta', 'src/beta.cjs');
    for (const [item, review] of [[started[0], alpha], [started[1], beta]]) {
        remote.state.sessions[item.session_id].state = 'completed';
        remote.state.prs[item.pr].headRefOid = review.sha;
    }
    coordinator.refresh(data.root, remote.gh);
    assert.deepEqual(coordinator.status(data.root).jobs.map(job => job.status), ['ready', 'ready']);
    assert.throws(() => coordinator.prepare(data.root, 'F001-S01', null, data.root, 'checker', true, remote.gh), /separate review worktree/);
    const first = coordinator.prepare(data.root, 'F001-S01', null, alpha.workspace, 'checker-alpha', true, remote.gh);
    assert.throws(() => coordinator.merge(data.root, true, remote.gh), /passing story review/);
    assert.throws(() => coordinator.review(data.root, pass(first, { candidate_sha: '0'.repeat(40) }), remote.gh), /SHA or evaluator/);
    assert.throws(() => coordinator.review(data.root, pass(first, { criteria: [] }), remote.gh), /every acceptance criterion/);
    assert.throws(() => coordinator.review(data.root, pass(first, { criteria: [{ criterion: 'Alpha works', passed: true, evidence: ' ' }] }), remote.gh), /Missing exact-criterion evidence/);
    assert.throws(() => coordinator.review(data.root, pass(first, { issues: ['Unresolved failure'] }), remote.gh), /PASS cannot/);
    coordinator.review(data.root, pass(first), remote.gh);
    assert.throws(() => coordinator.merge(data.root, false, remote.gh), /--approve/);
    remote.state.ci = [{ name: 'CI', bucket: 'fail' }];
    assert.throws(() => coordinator.merge(data.root, true, remote.gh), /checks/);
    remote.state.ci = [{ name: 'CI', bucket: 'pass' }];
    remote.state.prs[started[0].pr].headRefOid = 'f'.repeat(40);
    assert.throws(() => coordinator.merge(data.root, true, remote.gh), /exact candidate SHA|changed/);
    remote.state.prs[started[0].pr].headRefOid = alpha.sha;
    const mergedFirst = coordinator.merge(data.root, true, remote.gh);
    assert.equal(mergedFirst.status, 'merged');
    const mergeCall = remote.state.calls.find(args => args[0] === 'pr' && args[1] === 'merge' && args[2] !== '--help');
    assert.equal(mergeCall[mergeCall.indexOf('--match-head-commit') + 1], alpha.sha);
    assert.equal(mergeCall.includes('--admin'), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data.root, 'docs', 'FEATURES.json'))).features[0].status, 'not-started');

    remote.state.prs[started[1].pr].baseRefOid = remote.state.base;
    assert.throws(() => coordinator.prepare(data.root, 'F002-S01', null, beta.workspace, 'checker-beta', true, remote.gh), /current base/);
    git(beta.workspace, ['merge', '--no-ff', '--no-edit', remote.state.base]);
    remote.state.prs[started[1].pr].headRefOid = git(beta.workspace, ['rev-parse', 'HEAD']);
    const second = coordinator.prepare(data.root, 'F002-S01', null, beta.workspace, 'checker-beta', true, remote.gh);
    coordinator.review(data.root, pass(second), remote.gh);
    assert.equal(coordinator.merge(data.root, true, remote.gh).status, 'merged');

    const finalWorkspace = path.join(data.directory, 'review-final');
    git(data.root, ['worktree', 'add', '--quiet', '--detach', finalWorkspace, remote.state.base]);
    const firstFeature = coordinator.prepare(data.root, null, 'F001', finalWorkspace, 'checker-final-alpha', true, remote.gh);
    assert.equal(firstFeature.story_id, null);
    coordinator.review(data.root, pass(firstFeature), remote.gh);
    coordinator.acceptFinal(data.root, true, remote.gh);
    assert.throws(() => coordinator.publish(data.root, true, remote.gh), /Fast-forward|Every feature/);
    const secondFeature = coordinator.prepare(data.root, null, 'F002', finalWorkspace, 'checker-final-beta', true, remote.gh);
    coordinator.review(data.root, pass(secondFeature), remote.gh);
    coordinator.acceptFinal(data.root, true, remote.gh);
    assert.throws(() => coordinator.publish(data.root, true, remote.gh), /Fast-forward/);
    git(data.root, ['merge', '--ff-only', remote.state.base]);
    const published = coordinator.publish(data.root, true, remote.gh);
    assert.equal(published.status, 'published-locally');
    const registry = JSON.parse(fs.readFileSync(path.join(data.root, 'docs', 'FEATURES.json')));
    const backlog = JSON.parse(fs.readFileSync(path.join(data.root, 'docs', 'backlog', 'backlog.json')));
    assert.deepEqual(registry.features.map(feature => feature.status), ['complete', 'complete']);
    assert.deepEqual(backlog.stories.map(story => story.status), ['done', 'done']);
    assert.match(backlog.stories[0].evidence, /Cloud PR #101/);
    assert.match(fs.readFileSync(path.join(data.root, 'docs', 'PROGRESS.md'), 'utf8'), /Local feature reviews/);
});

test('rejects wrong cloud identities and protected or unowned PR changes', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const item = coordinator.dispatch(data.root, 'F001-S01', true, remote.gh).started[0];
    remote.state.sessions[item.session_id].repository = 'other/project';
    assert.throws(() => coordinator.refresh(data.root, remote.gh), /different repository/);
    remote.state.sessions[item.session_id].repository = 'octo/project';
    remote.state.sessions[item.session_id].state = 'completed';
    const workspace = path.join(data.directory, 'unowned');
    git(data.root, ['worktree', 'add', '--quiet', '--detach', workspace, data.base]);
    fs.writeFileSync(path.join(workspace, 'docs', 'PROGRESS.md'), '# Unauthorized\n');
    git(workspace, ['add', '--', 'docs/PROGRESS.md']);
    git(workspace, ['commit', '--quiet', '-m', 'test: alter protected file']);
    remote.state.prs[item.pr].headRefOid = git(workspace, ['rev-parse', 'HEAD']);
    assert.throws(() => coordinator.prepare(data.root, 'F001-S01', null, workspace, 'checker', true, remote.gh), /unowned or protected/);
    assert.equal(coordinator.status(data.root).candidate, null);
});

test('requires an explicit cloud-story opt-in without changing ordinary cloud-loop sessions', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-story-hook-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }));
    const harness = path.join(directory, '.github', 'harness');
    fs.mkdirSync(harness, { recursive: true });
    const configFile = path.join(harness, 'config.json');
    const payload = { session_id: 'story-session', initial_prompt: 'Solution Harness cloud story assignment v1\nDo not persist this prompt.' };
    fs.writeFileSync(configFile, JSON.stringify({ cloud_parallel_enabled: false }));
    assert.throws(() => cloud.handleHook(directory, 'sessionStart', payload), /explicit cloud_parallel_enabled approval/);
    assert.equal(cloud.readState(directory), null);
    fs.writeFileSync(configFile, JSON.stringify({ cloud_parallel_enabled: true }));
    assert.match(cloud.handleHook(directory, 'sessionStart', payload).additionalContext, /local coordinator/);
    assert.equal(cloud.readState(directory).mode, 'cloud-story');
    assert.doesNotMatch(JSON.stringify(cloud.readState(directory)), /Do not persist this prompt/);
    assert.throws(() => cloud.begin(directory, 'F001'), /cannot start cloud-loop/);
    assert.deepEqual(cloud.handleHook(directory, 'agentStop', {}), {});
});

test('keeps the local cloud coordinator out of the hosted cloud bundle', () => {
    const bundle = cloudInstaller.buildBundle();
    assert.equal(bundle.has('.github/skills/cloud-parallel/SKILL.md'), false);
    assert.equal(bundle.has('.github/skills/cloud-parallel/scripts/coordinator.cjs'), false);
    assert.equal([...bundle.keys()].filter(file => file.endsWith('/SKILL.md')).length, 19);
    const skill = fs.readFileSync(path.join(__dirname, '../skills/cloud-parallel/SKILL.md'), 'utf8');
    assert.match(skill, /^---\r?\nname: cloud-parallel\r?\ndescription: "[^"\r\n]+"/);
    assert.match(skill, /--match-head-commit/);
    assert.match(skill, /independent/i);
});


test('recovers interrupted merges only after an explicit queue and auto-merge check', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const item = coordinator.dispatch(data.root, 'F001-S01', true, remote.gh).started[0];
    const candidateWorktree = reviewWorktree(data, 'review-recovery', 'src/alpha.cjs');
    remote.state.sessions[item.session_id].state = 'completed';
    remote.state.prs[item.pr].headRefOid = candidateWorktree.sha;
    const candidate = coordinator.prepare(data.root, 'F001-S01', null, candidateWorktree.workspace, 'checker', true, remote.gh);
    coordinator.review(data.root, pass(candidate), remote.gh);
    coordinator.control(data.root, 'pause', null, true, remote.gh);
    assert.throws(() => coordinator.merge(data.root, true, remote.gh), /unpaused/);
    coordinator.control(data.root, 'resume', null, true, remote.gh);
    remote.state.mode = 'merge-error';
    assert.throws(() => coordinator.merge(data.root, true, remote.gh), /merge interruption/);
    assert.equal(coordinator.status(data.root).jobs[0].status, 'merge-uncertain');
    remote.state.prs[item.pr].autoMergeRequest = { enabledAt: '2026-01-01T00:00:00Z' };
    assert.throws(() => coordinator.control(data.root, 'recover-merge', null, true, remote.gh), /no auto-merge/);
    remote.state.prs[item.pr].autoMergeRequest = null;
    assert.throws(() => coordinator.control(data.root, 'recover-merge', null, false, remote.gh), /--approve/);
    coordinator.control(data.root, 'recover-merge', null, true, remote.gh);
    assert.equal(coordinator.status(data.root).candidate.phase, 'review');
    remote.state.mode = 'normal';
    assert.equal(coordinator.merge(data.root, true, remote.gh).status, 'merged');
});

test('never accepts a PR merged on an unreviewed base', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const item = coordinator.dispatch(data.root, 'F001-S01', true, remote.gh).started[0];
    const workspace = reviewWorktree(data, 'review-race', 'src/alpha.cjs');
    remote.state.sessions[item.session_id].state = 'completed';
    remote.state.prs[item.pr].headRefOid = workspace.sha;
    const candidate = coordinator.prepare(data.root, 'F001-S01', null, workspace.workspace, 'checker', true, remote.gh);
    coordinator.review(data.root, pass(candidate), remote.gh);
    remote.state.mode = 'wrong-parent';
    assert.throws(() => coordinator.merge(data.root, true, remote.gh), /unreviewed base/);
    assert.equal(coordinator.status(data.root).jobs[0].status, 'merged-unverified');
    assert.equal(JSON.parse(fs.readFileSync(path.join(data.root, 'docs', 'FEATURES.json'))).features[0].status, 'not-started');
    coordinator.control(data.root, 'abort-review', null, true, remote.gh);
    assert.equal(coordinator.control(data.root, 'cancel', null, true, remote.gh).status, 'cancelled');
});

test('allows pausing and reconciling remote work after approved inputs drift', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const item = coordinator.dispatch(data.root, 'F001-S01', true, remote.gh).started[0];
    data.config.max_workers = 1;
    fs.writeFileSync(data.configPath, JSON.stringify(data.config));
    assert.throws(() => coordinator.status(data.root), /inputs changed/);
    assert.equal(coordinator.control(data.root, 'pause', null, true, remote.gh).paused, true);
    assert.throws(() => coordinator.control(data.root, 'resume', null, true, remote.gh), /inputs changed/);
    remote.state.sessions[item.session_id].state = 'cancelled';
    assert.equal(coordinator.refresh(data.root, remote.gh).jobs[0].status, 'blocked');
    remote.state.prs[item.pr].state = 'CLOSED';
    coordinator.control(data.root, 'abandon', 'F001-S01', true, remote.gh);
    assert.equal(coordinator.control(data.root, 'cancel', null, true, remote.gh).status, 'cancelled');
});

test('recognizes the hosted prompt environment without storing the prompt', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-story-env-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }));
    const harness = path.join(directory, '.github', 'harness');
    fs.mkdirSync(harness, { recursive: true });
    fs.writeFileSync(path.join(harness, 'config.json'), JSON.stringify({ cloud_parallel_enabled: true }));
    const previous = process.env.COPILOT_AGENT_PROMPT;
    try {
        process.env.COPILOT_AGENT_PROMPT = 'Solution Harness cloud story assignment v1\nprivate prompt text';
        cloud.handleHook(directory, 'sessionStart', { session_id: 'environment-session' });
        assert.equal(cloud.readState(directory).mode, 'cloud-story');
        assert.doesNotMatch(JSON.stringify(cloud.readState(directory)), /private prompt text/);
    } finally {
        if (previous === undefined) delete process.env.COPILOT_AGENT_PROMPT;
        else process.env.COPILOT_AGENT_PROMPT = previous;
    }
});


test('enforces the run budget between individual cloud dispatches', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
        const slow = (root, args, input) => {
            const output = remote.gh(root, args, input);
            if (args[0] === 'agent-task' && args[1] === 'create') now += 121 * 60000;
            return output;
        };
        assert.throws(() => coordinator.dispatch(data.root, null, true, slow), /budget exhausted/);
        assert.equal(remote.state.calls.filter(args => args[0] === 'agent-task' && args[1] === 'create').length, 1);
        assert.equal(coordinator.status(data.root).jobs.length, 1);
    } finally {
        Date.now = originalNow;
    }
});

test('requires a verified session before attaching a queued task to a story', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    remote.state.mode = 'queued';
    coordinator.dispatch(data.root, 'F001-S01', true, remote.gh);
    const id = '00000000-0000-0000-0000-000000000099';
    remote.state.sessions[id] = { id, state: 'completed', repository: 'other/project', pullRequestNumber: 199, pullRequestUrl: 'https://github.com/octo/project/pull/199' };
    assert.throws(() => coordinator.attach(data.root, 'F001-S01', id, false, remote.gh), /--approve/);
    assert.throws(() => coordinator.attach(data.root, 'F001-S01', id, true, remote.gh), /different repository/);
    remote.state.sessions[id].repository = 'octo/project';
    const result = coordinator.attach(data.root, 'F001-S01', id, true, remote.gh);
    assert.equal(result.pr, 199);
    assert.equal(result.status, 'ready');
});

test('refuses dispatch setup when an installed legacy cloud hook was not migrated', t => {
    const data = fixture(t, value => {
        value.files['.github/hooks/solution-harness.json'] = '{}\n';
        value.files['.github/harness/config.json'] = '{"cloud_parallel_enabled":false}\n';
        value.files['.github/harness/runtime.cjs'] = 'old runtime\n';
        value.files['.github/instructions/solution-harness-cloud.instructions.md'] = 'old instructions\n';
    });
    const remote = fakeGitHub(data);
    assert.throws(() => coordinator.begin(data.root, data.configPath, true, remote.gh), /Migrate the installed cloud runtime/);
    assert.equal(remote.state.calls.length, 0);
});


test('dispatches multiple independent stories belonging to the same feature', t => {
    const data = fixture(t, value => {
        value.features.features[0].acceptance_criteria.push('Beta works');
        value.backlog.stories[1].id = 'F001-S02';
        value.backlog.stories[1].feature_id = 'F001';
        value.backlog.stories[1].covers_feature_criteria = [2];
        value.config.feature_ids = ['F001'];
        value.config.approved_designs = ['F001'];
        value.config.ownership['F001-S02'] = value.config.ownership['F002-S01'];
        delete value.config.ownership['F002-S01'];
    });
    const remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    assert.deepEqual(coordinator.dispatch(data.root, null, true, remote.gh).started.map(item => item.story_id), ['F001-S01', 'F001-S02']);
});

test('releases dependent stories only after the prerequisite PR is merged', t => {
    const data = fixture(t, value => { value.backlog.stories[1].depends_on = ['F001-S01']; });
    const remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const first = coordinator.dispatch(data.root, null, true, remote.gh).started;
    assert.deepEqual(first.map(item => item.story_id), ['F001-S01']);
    const workspace = reviewWorktree(data, 'review-dependency', 'src/alpha.cjs');
    remote.state.sessions[first[0].session_id].state = 'completed';
    remote.state.prs[first[0].pr].headRefOid = workspace.sha;
    const candidate = coordinator.prepare(data.root, 'F001-S01', null, workspace.workspace, 'checker', true, remote.gh);
    coordinator.review(data.root, pass(candidate), remote.gh);
    assert.deepEqual(coordinator.status(data.root).ready, []);
    coordinator.merge(data.root, true, remote.gh);
    assert.deepEqual(coordinator.dispatch(data.root, null, true, remote.gh).started.map(item => item.story_id), ['F002-S01']);
});

test('rejects missing tests, unapproved protections, and worker counts above the limit', t => {
    const data = fixture(t);
    for (const [field, value, pattern] of [
        ['max_workers', 4, /max_workers/],
        ['branch_protection_confirmed', false, /branch protections/],
        ['verification', [], /real test command/]
    ]) {
        const changed = { ...data.config, [field]: value };
        fs.writeFileSync(data.configPath, JSON.stringify(changed));
        assert.throws(() => coordinator.parseConfig(data.root, data.configPath), pattern);
    }
});


function pluginHook(root, event, payload = {}) {
    const hook = require('../hooks/hooks.json').hooks[event][0];
    const command = process.platform === 'win32' ? hook.windows || hook.command : hook.command;
    assert.ok(command.startsWith('node -e "') && command.endsWith('"'));
    const result = spawnSync(process.execPath, ['-e', command.slice(9, -1)], {
        cwd: root, input: JSON.stringify(payload), encoding: 'utf8', timeout: 15000,
        env: { ...process.env, PLUGIN_ROOT: path.resolve(__dirname, '..') }
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

test('routes cloud coordinator and local evaluator hooks without leaking tool payloads', t => {
    const data = fixture(t), remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    assert.match(pluginHook(data.root, 'SessionStart').hookSpecificOutput.additionalContext, /CLOUD PARALLEL COORDINATOR/);
    assert.equal(pluginHook(data.root, 'Stop').hookSpecificOutput.decision, 'block');
    const payload = { tool_name: 'run_in_terminal', tool_input: { command: 'private-input-marker' }, tool_response: 'private-output-marker' };
    assert.deepEqual(pluginHook(data.root, 'PostToolUse', payload), {});
    assert.equal(fs.existsSync(path.join(data.root, 'docs', 'trajectory.jsonl')), false);
    assert.equal(git(data.root, ['status', '--porcelain']), '');
    const log = fs.readFileSync(path.join(coordinator.locations(data.root).directory, 'events.jsonl'), 'utf8');
    assert.doesNotMatch(log, /private-input-marker|private-output-marker/);
    assert.match(log, /run_in_terminal/);

    const item = coordinator.dispatch(data.root, 'F001-S01', true, remote.gh).started[0];
    const candidate = reviewWorktree(data, 'review-hook', 'src/alpha.cjs');
    remote.state.sessions[item.session_id].state = 'completed';
    remote.state.prs[item.pr].headRefOid = candidate.sha;
    coordinator.prepare(data.root, 'F001-S01', null, candidate.workspace, 'checker', true, remote.gh);
    assert.match(pluginHook(candidate.workspace, 'SessionStart').hookSpecificOutput.additionalContext, /CLOUD PARALLEL EVALUATOR/);
    assert.equal(pluginHook(candidate.workspace, 'PreToolUse', { tool_name: 'create_file', tool_input: { filePath: 'src/alpha.cjs' } }).hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(pluginHook(candidate.workspace, 'PreToolUse', { tool_name: 'run_in_terminal', tool_input: { command: 'git commit -am changed' } }).hookSpecificOutput.permissionDecision, 'deny');
    assert.deepEqual(pluginHook(candidate.workspace, 'PreToolUse', { tool_name: 'run_in_terminal', tool_input: { command: 'node --test' } }), {});
    assert.deepEqual(pluginHook(candidate.workspace, 'Stop'), {});
    coordinator.control(data.root, 'pause', null, true, remote.gh);
    assert.deepEqual(pluginHook(data.root, 'Stop'), {});
});

test('preserves ordinary plugin hook behavior when no cloud run is active', t => {
    const data = fixture(t);
    assert.match(pluginHook(data.root, 'SessionStart').hookSpecificOutput.additionalContext, /PROJECT STATUS/);
    assert.deepEqual(pluginHook(data.root, 'PostToolUse', { tool_name: 'run_in_terminal', tool_input: { command: 'echo example' }, tool_response: 'ok' }), {});
    assert.equal(fs.existsSync(path.join(data.root, 'docs', 'trajectory.jsonl')), true);
});

test('does not allow local and cloud parallel coordinators to share a repository', t => {
    const cloudProject = fixture(t), remote = fakeGitHub(cloudProject);
    const localState = path.join(localRuntime.locations(cloudProject.root).directory, 'active.json');
    fs.mkdirSync(path.dirname(localState), { recursive: true });
    fs.writeFileSync(localState, '{}');
    assert.throws(() => coordinator.begin(cloudProject.root, cloudProject.configPath, true, remote.gh), /local parallel run is active/);

    const localProject = fixture(t);
    const cloudState = coordinator.locations(localProject.root).active;
    fs.mkdirSync(path.dirname(cloudState), { recursive: true });
    fs.writeFileSync(cloudState, '{}');
    assert.throws(() => localRuntime.begin(localProject.root, 'F001', true), /cloud parallel run is active/);
});


test('blocks final feature review until feature prerequisites are complete', t => {
    const data = fixture(t, value => {
        value.features.features[1].dependencies = ['F001'];
        value.backlog.stories[1].status = 'done';
        value.backlog.stories[1].evidence = 'Previously verified.';
    });
    const remote = fakeGitHub(data);
    const plan = coordinator.plan(data.root, data.configPath);
    assert.deepEqual(plan.ready, ['F001-S01']);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const workspace = path.join(data.directory, 'review-prerequisite');
    git(data.root, ['worktree', 'add', '--quiet', '--detach', workspace, data.base]);
    assert.throws(() => coordinator.prepare(data.root, null, 'F002', workspace, 'checker', true, remote.gh), /prerequisites/);
    assert.equal(coordinator.status(data.root).candidate, null);
});

test('detects approved design drift without discarding the user change', t => {
    const data = fixture(t, value => {
        value.features.features[0].design_doc = 'docs/designs/alpha.md';
        value.files['docs/designs/alpha.md'] = '# Approved design\n';
    });
    const remote = fakeGitHub(data);
    coordinator.begin(data.root, data.configPath, true, remote.gh);
    const design = path.join(data.root, 'docs', 'designs', 'alpha.md');
    fs.writeFileSync(design, '# User revised design\n');
    assert.throws(() => coordinator.status(data.root), /inputs changed/);
    assert.equal(coordinator.control(data.root, 'pause', null, true, remote.gh).paused, true);
    assert.equal(coordinator.control(data.root, 'cancel', null, true, remote.gh).status, 'cancelled');
    assert.equal(fs.readFileSync(design, 'utf8'), '# User revised design\n');
});
