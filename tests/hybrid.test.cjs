'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const runtime = require('../hybrid/runtime.cjs');
const planner = require('../hybrid/plan.cjs');
const core = require('../skills/cloud-parallel/scripts/coordinator.cjs');
const shared = require('../parallel/runtime.cjs');
const defaults = require('../hybrid/config.json');
const hooks = require('../hybrid/hooks.cjs');
const cloudInstaller = require('../scripts/install-cloud.cjs');

function fixture(t, adjust = () => {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-manual-hybrid-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }));
    const root = path.join(directory, 'project');
    fs.mkdirSync(root);
    const features = { features: [
        { id: 'F001', name: 'Alpha', status: 'not-started', priority: 1, dependencies: [], acceptance_criteria: ['Alpha works', 'Gamma works'] },
        { id: 'F002', name: 'Beta', status: 'not-started', priority: 2, dependencies: [], acceptance_criteria: ['Beta works'] },
        { id: 'F003', name: 'Validation', status: 'not-started', priority: 3, dependencies: [], acceptance_criteria: ['Combined behavior verified'] }
    ] };
    const backlog = { version: 1, stories: [
        { id: 'F001-S01', feature_id: 'F001', title: 'Alpha', status: 'todo', depends_on: [], acceptance_criteria: ['Alpha works'], covers_feature_criteria: [1] },
        { id: 'F001-S02', feature_id: 'F001', title: 'Unselected gamma', status: 'todo', depends_on: [], acceptance_criteria: ['Gamma works'], covers_feature_criteria: [2] },
        { id: 'F002-S01', feature_id: 'F002', title: 'Beta', status: 'todo', depends_on: [], acceptance_criteria: ['Beta works'], covers_feature_criteria: [1] },
        { id: 'F003-S01', feature_id: 'F003', title: 'Validate', status: 'todo', depends_on: [], acceptance_criteria: ['Combined behavior verified'], covers_feature_criteria: [1] }
    ] };
    const config = {
        ...structuredClone(defaults), repository: 'octo/project', feature_ids: ['F001', 'F002', 'F003'],
        story_ids: ['F001-S01', 'F002-S01', 'F003-S01'], routes: { 'F001-S01': 'cloud', 'F002-S01': 'local', 'F003-S01': 'verification' },
        jira: { url: 'https://example.atlassian.net', board_id: 2, source_id_field: 'customfield_123' },
        approved_designs: ['F001', 'F002', 'F003'], approved_verification: ['F003-S01'],
        instructions_reviewed: true, workspace_isolation_confirmed: true, cloud_context_approved: true,
        branch_protection_confirmed: true,
        ownership: {
            'F001-S01': { allowed_paths: ['src/alpha.cjs'], resources: [] },
            'F002-S01': { allowed_paths: ['src/beta.cjs'], resources: [] },
            'F003-S01': { allowed_paths: [], resources: [] }
        },
        verification: [{ name: 'Actual regressions', kind: 'test', command: process.execPath, args: ['tests/regression.cjs'], timeout_seconds: 60 }]
    };
    const snapshot = {
        version: 1, site: 'https://example.atlassian.net', board_id: 2, sprint: { id: 4, name: 'Selected sprint', state: 'active' },
        issues: backlog.stories.filter(story => config.story_ids.includes(story.id)).map((story, index) => ({
            id: String(index + 1), key: `DEMO-${index + 1}`, url: `https://example.atlassian.net/browse/DEMO-${index + 1}`,
            source_id: story.id, title: story.title, acceptance_criteria: [...story.acceptance_criteria],
            covers_feature_criteria: [...story.covers_feature_criteria], depends_on: [], blocked_by: [],
            status: 'To Do', work_kind: index === 2 ? 'verification' : 'user-story'
        })), digest: 'a'.repeat(64)
    };
    const data = { directory, root, features, backlog, config, snapshot };
    adjust(data);
    for (const [name, content] of Object.entries({
        'docs/FEATURES.json': JSON.stringify(features, null, 2) + '\n',
        'docs/backlog/backlog.json': JSON.stringify(backlog, null, 2) + '\n',
        'docs/PROGRESS.md': '# Existing progress\n',
        'docs/PLAN.md': '# Approved plan\n',
        'docs/ARCHITECTURE.md': '# Architecture\n',
        'src/alpha.cjs': 'module.exports = 0;\n', 'src/beta.cjs': 'module.exports = 0;\n', 'src/gamma.cjs': 'module.exports = 0;\n',
        'tests/regression.cjs': "const assert = require('node:assert/strict'); for(const name of ['alpha','beta','gamma']) assert.ok([0,1].includes(require('../src/'+name+'.cjs')));\n"
    })) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), content);
    }
    const configPath = path.join(directory, 'approved-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config));
    shared.git(root, ['init', '--quiet', '-b', 'main']);
    shared.git(root, ['config', 'user.name', 'Harness Test']);
    shared.git(root, ['config', 'user.email', 'harness-test@example.invalid']);
    shared.git(root, ['config', 'commit.gpgsign', 'false']);
    shared.git(root, ['config', 'core.autocrlf', 'false']);
    shared.git(root, ['add', '.']);
    shared.git(root, ['commit', '--quiet', '-m', 'test: initialize hybrid fixture']);
    data.configPath = configPath;
    data.base = shared.git(root, ['rev-parse', 'HEAD']);
    const state = { base: data.base, prs: {}, sessions: {}, calls: [], pushes: {}, parents: {}, next: 1, mode: 'normal' };
    data.state = state;
    data.jira = {
        async readSprint() { return structuredClone(data.snapshot); },
        async readIssue(config, id) { return structuredClone(data.snapshot.issues.find(issue => issue.id === id)); },
        async syncEvidence() { return { comment_id: '1', comment_created: false, transitioned: false }; }
    };
    data.gh = function (cwd, args, input) {
        state.calls.push([...args]);
        if (args[0] === '--version') return 'gh version 2.90.0';
        if (args[0] === 'agent-task' && args.includes('--help')) return '--json';
        if (args[0] === 'pr' && args.includes('--help')) return '--match-head-commit';
        if (args[0] === 'api') {
            if (args[1].includes('/git/commits/')) return JSON.stringify({ parents: [{ sha: state.parents[args[1].split('/').pop()] }] });
            if (args[1].endsWith('/update-branch')) {
                const pr = state.prs[Number(args[1].split('/')[4])];
                shared.git(pr.workspace, ['merge', '--no-edit', state.base]);
                pr.headRefOid = shared.git(pr.workspace, ['rev-parse', 'HEAD']);
                pr.baseRefOid = state.base;
                return '{}';
            }
            return state.base;
        }
        if (args[0] === 'agent-task' && args[1] === 'create') {
            if (state.mode === 'create-error') throw new Error('Simulated uncertain task creation');
            const index = state.next++, session = `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
            const number = index + 100, story = /^Story: (\S+)/m.exec(input)[1];
            state.sessions[session] = { id: session, repository: 'octo/project', state: 'in_progress',
                pullRequestNumber: number, pullRequestUrl: `https://github.com/octo/project/pull/${number}` };
            state.prs[number] = { number, url: `https://github.com/octo/project/pull/${number}`, state: 'OPEN', isDraft: false,
                baseRefName: 'main', baseRefOid: state.base, headRefOid: state.base, mergeable: 'MERGEABLE', story };
            return `${state.prs[number].url}/agent-sessions/${session}`;
        }
        if (args[0] === 'agent-task' && args[1] === 'view') return JSON.stringify(state.sessions[args[2]]);
        if (args[0] === 'pr' && args[1] === 'create') {
            if (state.mode === 'publish-error') throw new Error('Simulated uncertain PR creation');
            const branch = args[args.indexOf('--head') + 1], number = state.next++ + 100;
            const head = state.pushes[branch];
            state.prs[number] = { number, url: `https://github.com/octo/project/pull/${number}`, state: 'OPEN', isDraft: false,
                baseRefName: 'main', baseRefOid: state.base, headRefOid: head.sha, workspace: head.workspace, mergeable: 'MERGEABLE', autoMergeRequest: null };
            return state.prs[number].url;
        }
        if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify(state.prs[Number(args[2])]);
        if (args[0] === 'pr' && args[1] === 'checks') return JSON.stringify([{ name: 'CI', bucket: 'pass' }]);
        if (args[0] === 'pr' && args[1] === 'merge') {
            const pr = state.prs[Number(args[2])], before = state.base;
            assert.equal(args[args.indexOf('--match-head-commit') + 1], pr.headRefOid);
            const server = path.join(directory, `integration-${pr.number}`);
            shared.git(root, ['worktree', 'add', '--quiet', '--detach', server, state.base]);
            shared.git(server, ['merge', '--squash', pr.headRefOid]);
            shared.git(server, ['commit', '--quiet', '-m', 'test: integrate approved story']);
            state.base = shared.git(server, ['rev-parse', 'HEAD']);
            state.parents[state.base] = before;
            pr.state = 'MERGED';
            pr.mergeCommit = { oid: state.base };
            return '';
        }
        throw new Error(`Unexpected mocked GitHub operation ${args[0]} ${args[1]}`);
    };
    data.options = { gh: data.gh, jira: data.jira,
        push(workspace, branch, sha) { state.pushes[branch] = { workspace, sha }; } };
    return data;
}

function change(data, name, file, sha = data.state.base) {
    const workspace = path.join(data.directory, name);
    shared.git(data.root, ['worktree', 'add', '--quiet', '--detach', workspace, sha]);
    if (file) {
        fs.writeFileSync(path.join(workspace, file), 'module.exports = 1;\n');
        shared.git(workspace, ['add', '--', file]);
        shared.git(workspace, ['commit', '--quiet', '-m', 'test: implement candidate']);
    }
    return { workspace, sha: shared.git(workspace, ['rev-parse', 'HEAD']) };
}

function pass(candidate, overrides = {}) {
    return {
        run_id: candidate.run_id, feature_id: candidate.feature_id, story_id: candidate.story_id,
        candidate_sha: candidate.candidate_sha, evaluator_id: candidate.agent_id,
        assignment_nonce: candidate.assignment_nonce, verdict: 'PASS',
        criteria: candidate.acceptance_criteria.map(criterion => ({ criterion, passed: true, evidence: 'Inspected exact fixture source and executed actual configured regressions.' })),
        issues: [], ...overrides
    };
}

test('manual Jira planning preserves Source IDs and reports readiness without creating branches', t => {
    const data = fixture(t);
    const project = planner.load(data.root, data.configPath);
    const before = shared.git(data.root, ['status', '--porcelain']);
    const preview = planner.reconcile(project, data.snapshot);
    assert.deepEqual(preview.stories.map(story => story.story_id), data.config.story_ids);
    assert.equal(preview.dispatches_workers, false);
    assert.equal(preview.changes_jira, false);
    assert.deepEqual(preview.initial_batches, [data.config.story_ids]);
    const changed = structuredClone(data.snapshot);
    changed.issues[0].acceptance_criteria = ['New unapproved requirement'];
    changed.issues[1].depends_on = ['F999'];
    const blockers = planner.reconcile(project, changed).stories;
    assert.ok(blockers[0].blockers.includes('jira-criteria-differ-reconcile-with-planner'));
    assert.ok(blockers[1].blockers.includes('jira-dependency-not-in-approved-graph:F999'));
    changed.sprint.state = 'future';
    assert.throws(() => planner.reconcile(project, changed), /active sprint/);
    assert.equal(shared.git(data.root, ['status', '--porcelain']), before);
});

test('manual begin requires exact approval and scopes one shared cloud/local/verification run', async t => {
    const data = fixture(t);
    await assert.rejects(runtime.begin(data.root, data.configPath, data.snapshot.digest, false, data.options), /Approve/);
    await assert.rejects(runtime.begin(data.root, data.configPath, 'b'.repeat(64), true, data.options), /changed/);
    await runtime.begin(data.root, data.configPath, data.snapshot.digest, true, data.options);
    const started = await runtime.dispatch(data.root, null, true, data.options);
    assert.deepEqual(started.started.map(job => job.story_id), data.config.story_ids);
    assert.equal(runtime.status(data.root).mode, 'manual-jira-hybrid');
    assert.equal(runtime.status(data.root).jobs.filter(job => job.backend === 'local').length, 1);
    assert.equal(runtime.status(data.root).jobs.some(job => job.story_id === 'F001-S02'), false);
    await assert.rejects(runtime.dispatch(data.root, 'F001-S01', true, data.options), /not ready/);
    assert.throws(() => core.main(['status', '--root', data.root]), /hybrid/);
    assert.throws(() => shared.begin(data.root, 'F001', true), /cloud parallel run is active/);
    data.snapshot.issues[0].status = 'Done';
    await assert.rejects(runtime.dispatch(data.root, null, true, data.options), /workflow status/);
    data.snapshot.issues[0].status = 'To Do';
    data.snapshot.digest = 'b'.repeat(64);
    await assert.rejects(runtime.dispatch(data.root, null, true, data.options), /Jira scope/);
});

test('hybrid ownership and resources serialize work across backend types', async t => {
    const data = fixture(t, ({ config }) => {
        config.ownership['F001-S01'].resources = ['shared-test-store'];
        config.ownership['F002-S01'].resources = ['shared-test-store'];
    });
    await runtime.begin(data.root, data.configPath, data.snapshot.digest, true, data.options);
    const result = await runtime.dispatch(data.root, null, true, data.options);
    assert.deepEqual(result.started.map(job => job.story_id), ['F001-S01', 'F003-S01']);
    await assert.rejects(runtime.dispatch(data.root, 'F002-S01', true, data.options), /conflicts/);
});

test('one global ceiling admits two cloud builders and one local builder but refuses a fourth', async t => {
    const data = fixture(t, ({ config, snapshot, backlog }) => {
        config.story_ids = ['F001-S01', 'F001-S02', 'F002-S01', 'F003-S01'];
        config.routes['F001-S02'] = 'cloud';
        config.routes['F003-S01'] = 'cloud';
        config.ownership['F001-S02'] = { allowed_paths: ['src/gamma.cjs'], resources: [] };
        config.ownership['F003-S01'] = { allowed_paths: ['src/delta.cjs'], resources: [] };
        snapshot.issues.find(issue => issue.source_id === 'F003-S01').work_kind = 'user-story';
        const gamma = backlog.stories.find(story => story.id === 'F001-S02');
        snapshot.issues.push({ ...structuredClone(snapshot.issues[0]), id: '4', key: 'DEMO-4', source_id: gamma.id,
            title: gamma.title, acceptance_criteria: [...gamma.acceptance_criteria], covers_feature_criteria: [2] });
    });
    await runtime.begin(data.root, data.configPath, data.snapshot.digest, true, data.options);
    const result = await runtime.dispatch(data.root, null, true, data.options);
    assert.deepEqual(result.started.map(job => job.story_id), ['F001-S01', 'F001-S02', 'F002-S01']);
    assert.equal(runtime.status(data.root).available_slots, 0);
    assert.equal(data.state.calls.filter(args => args[0] === 'agent-task' && args[1] === 'create').length, 2);
    assert.equal(result.workspaces.length, 1);
    await assert.rejects(runtime.dispatch(data.root, 'F003-S01', true, data.options), /capacity/);
});

test('uncertain hybrid cloud creation is fenced instead of retried', async t => {
    const data = fixture(t);
    await runtime.begin(data.root, data.configPath, data.snapshot.digest, true, data.options);
    data.state.mode = 'create-error';
    await assert.rejects(runtime.dispatch(data.root, 'F001-S01', true, data.options), /uncertain/);
    assert.equal(runtime.status(data.root).jobs[0].status, 'uncertain');
    await assert.rejects(runtime.dispatch(data.root, 'F001-S01', true, data.options), /not ready/);
    assert.equal(data.state.calls.filter(args => args[0] === 'agent-task' && args[1] === 'create').length, 1);
});

test('hybrid local report fences stale edits and hooks keep developers out of shared files', async t => {
    const data = fixture(t);
    await runtime.begin(data.root, data.configPath, data.snapshot.digest, true, data.options);
    const dispatched = await runtime.dispatch(data.root, 'F002-S01', true, data.options);
    const workspace = dispatched.workspaces[0].workspace;
    assert.equal(runtime.context(workspace).story_id, 'F002-S01');
    assert.throws(() => hooks.handle(workspace, 'PreToolUse', { tool_name: 'apply_patch', tool_input: { path: 'docs/FEATURES.json' } }), /outside/);
    assert.throws(() => hooks.handle(workspace, 'PreToolUse', { tool_name: 'powershell', tool_input: { command: 'git push origin main' } }), /coordinator/);
    assert.deepEqual(hooks.handle(workspace, 'PreToolUse', { tool_name: 'apply_patch', tool_input: { path: 'src/beta.cjs' } }), {});
    await assert.rejects(runtime.main(['worker-block', '--root', workspace]), /reason/);
    const unowned = path.join(workspace, 'unowned.cjs');
    fs.writeFileSync(unowned, 'Preserve this unowned fixture change.\n');
    assert.equal(runtime.workerReport(workspace, 'out-of-scope').verdict, 'BLOCKED');
    assert.deepEqual(hooks.handle(workspace, 'Stop'), {});
    fs.unlinkSync(unowned);
    fs.writeFileSync(path.join(workspace, 'src/beta.cjs'), 'module.exports = 1;\n');
    runtime.workerReport(workspace);
    fs.writeFileSync(path.join(workspace, 'src/beta.cjs'), 'module.exports = 0;\n');
    await assert.rejects(runtime.capture(data.root, 'F002-S01', true, data.options), /changed/);
    runtime.workerReport(workspace);
    fs.writeFileSync(path.join(workspace, 'src/beta.cjs'), 'module.exports = 1;\n');
    runtime.workerReport(workspace);
    await runtime.capture(data.root, 'F002-S01', true, data.options);
    assert.equal(runtime.status(data.root).jobs[0].status, 'built');
    assert.throws(() => runtime.workerReport(workspace), /captured/);
    await runtime.publishLocal(data.root, 'F002-S01', true, data.options);
    assert.equal(runtime.status(data.root).jobs[0].status, 'ready');
    assert.equal(shared.git(data.root, ['status', '--porcelain']), '');
    const reviewed = change(data, 'local-review', null, runtime.status(data.root).jobs[0].pr ? Object.values(data.state.prs)[0].headRefOid : data.base);
    await assert.rejects(runtime.prepare(data.root, 'F002-S01', null, reviewed.workspace, dispatched.workspaces[0].agent_id, true, data.options), /independent/);
    const candidate = await runtime.prepare(data.root, 'F002-S01', null, reviewed.workspace, 'checker-local', true, data.options);
    await assert.rejects(runtime.review(data.root, pass(candidate, { assignment_nonce: 'stale' }), data.options), /assignment/);
    await runtime.review(data.root, pass(candidate), data.options);
});

test('hybrid integrates both providers and no-code evidence without completing a partial feature', async t => {
    const data = fixture(t);
    await runtime.begin(data.root, data.configPath, data.snapshot.digest, true, data.options);
    const dispatched = await runtime.dispatch(data.root, null, true, data.options);
    const jobs = runtime.status(data.root).jobs;
    const cloud = jobs.find(job => job.backend === 'cloud');
    const implementation = change(data, 'cloud-alpha', 'src/alpha.cjs');
    Object.assign(data.state.prs[cloud.pr], { headRefOid: implementation.sha, workspace: implementation.workspace });
    data.state.sessions[cloud.session_id].state = 'completed';
    runtime.refresh(data.root, data.options);
    let candidate = await runtime.prepare(data.root, cloud.story_id, null, implementation.workspace, 'checker-cloud', true, data.options);
    await runtime.review(data.root, pass(candidate), data.options);
    await runtime.merge(data.root, true, data.options);
    const localWorkspace = dispatched.workspaces[0].workspace;
    fs.writeFileSync(path.join(localWorkspace, 'src/beta.cjs'), 'module.exports = 1;\n');
    runtime.workerReport(localWorkspace);
    await runtime.capture(data.root, 'F002-S01', true, data.options);
    await runtime.publishLocal(data.root, 'F002-S01', true, data.options);
    const localJob = runtime.status(data.root).jobs.find(job => job.backend === 'local');
    const stale = change(data, 'stale-local-review', null, data.state.prs[localJob.pr].headRefOid);
    await assert.rejects(runtime.prepare(data.root, localJob.story_id, null, stale.workspace, 'checker-beta', true, data.options), /current base/);
    await runtime.updatePr(data.root, localJob.story_id, true, data.options);
    const updated = change(data, 'updated-local-review', null, data.state.prs[localJob.pr].headRefOid);
    candidate = await runtime.prepare(data.root, localJob.story_id, null, updated.workspace, 'checker-beta', true, data.options);
    await runtime.review(data.root, pass(candidate), data.options);
    await runtime.merge(data.root, true, data.options);
    const validation = change(data, 'validation-review', null);
    candidate = await runtime.prepare(data.root, 'F003-S01', null, validation.workspace, 'checker-environment', true, data.options);
    await runtime.review(data.root, pass(candidate), data.options);
    await assert.rejects(runtime.merge(data.root, true, data.options), /fabricated/);
    await runtime.acceptEvidence(data.root, true, data.options);
    assert.equal(runtime.status(data.root).jobs.find(job => job.backend === 'verification').pr, null);
    const delivery = change(data, 'delivery-review', null);
    candidate = await runtime.prepareDelivery(data.root, delivery.workspace, 'checker-delivery', true, data.options);
    await runtime.review(data.root, pass(candidate), data.options);
    await runtime.acceptEvidence(data.root, true, data.options);
    shared.git(data.root, ['merge', '--ff-only', data.state.base]);
    const finished = await runtime.finish(data.root, true, data.options);
    assert.equal(finished.status, 'published-locally');
    const catalog = JSON.parse(fs.readFileSync(path.join(data.root, 'docs/FEATURES.json')));
    assert.equal(catalog.features[0].status, 'in-progress');
    const backlog = JSON.parse(fs.readFileSync(path.join(data.root, 'docs/backlog/backlog.json')));
    assert.equal(backlog.stories.find(story => story.id === 'F001-S01').status, 'done');
    assert.equal(backlog.stories.find(story => story.id === 'F001-S02').status, 'todo');
    assert.ok(backlog.stories.find(story => story.id === 'F003-S01').evidence.includes('verification'));
    await assert.rejects(runtime.sync(data.root, finished.run_id, true, data.options), /disabled/);
    const loc = core.locations(data.root);
    const published = JSON.parse(fs.readFileSync(path.join(loc.directory, 'runs', `${finished.run_id}.json`)));
    const progress = fs.readFileSync(path.join(data.root, 'docs/PROGRESS.md'), 'utf8');
    published.status = 'publishing';
    core.save(loc, published);
    shared.atomicJson(loc.active, { id: published.id });
    assert.throws(() => runtime.recoverPublication(data.root, false, data.options), /recover/);
    assert.equal(runtime.recoverPublication(data.root, true, data.options).status, 'published-locally');
    assert.equal(fs.readFileSync(path.join(data.root, 'docs/PROGRESS.md'), 'utf8'), progress);
    shared.atomicJson(loc.active, { id: published.id });
    assert.equal(runtime.recoverPublication(data.root, true, data.options).status, 'published-locally');
    assert.equal(fs.readFileSync(path.join(data.root, 'docs/PROGRESS.md'), 'utf8'), progress);
    data.config.jira_writeback.enabled = true;
    fs.writeFileSync(data.configPath, JSON.stringify(data.config));
    const creations = data.state.calls.filter(args => args[0] === 'agent-task' && args[1] === 'create').length;
    data.jira.syncEvidence = async () => { throw new Error('Simulated ambiguous Jira write'); };
    await assert.rejects(runtime.sync(data.root, finished.run_id, true, data.options), /ambiguous/);
    const uncertain = JSON.parse(fs.readFileSync(path.join(loc.directory, 'runs', `${finished.run_id}.json`)));
    assert.equal(uncertain.jira_sync['F001-S01'].status, 'uncertain');
    let release, started;
    const entered = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    data.jira.syncEvidence = async () => {
        started();
        await gate;
        return { comment_id: '1', comment_created: false, transitioned: false };
    };
    const pending = runtime.sync(data.root, finished.run_id, true, data.options);
    await entered;
    await assert.rejects(runtime.sync(data.root, finished.run_id, true, data.options), /already in progress/);
    release();
    assert.equal((await pending).jira_evidence.length, 3);
    assert.equal(data.state.calls.filter(args => args[0] === 'agent-task' && args[1] === 'create').length, creations);
});

test('CLI workers use attached isolated processes and a separate evaluator report', async t => {
    const data = fixture(t, ({ config, directory }) => {
        config.story_ids = ['F002-S01'];
        config.feature_ids = ['F002'];
        config.local = { mode: 'copilot-cli', command: process.execPath, args: [path.join(directory, 'fake-copilot.cjs'), '{prompt}'],
            timeout_seconds: 180, permissions_reviewed: true };
    });
    fs.writeFileSync(path.join(data.directory, 'fake-copilot.cjs'), `
const fs = require('node:fs');
const path = require('node:path');
const runtime = require(${JSON.stringify(path.resolve(__dirname, '../hybrid/runtime.cjs'))});
const cwd = process.cwd(), context = runtime.context(cwd);
if(!process.argv[2].includes('# Frontend Design')) throw new Error('Missing bundled UI guidance');
if(context.role === 'builder') {
  fs.writeFileSync(path.join(cwd, 'src/beta.cjs'), 'module.exports = 1;\\n');
  runtime.workerReport(cwd);
} else {
  fs.writeFileSync(context.report_path, JSON.stringify({
    run_id: context.run_id, feature_id: context.feature_id, story_id: context.story_id,
    candidate_sha: context.candidate_sha, evaluator_id: context.agent_id,
    assignment_nonce: context.assignment_nonce, verdict: 'PASS',
    criteria: context.acceptance_criteria.map(criterion => ({criterion,passed:true,evidence:'Observed fixture source and configured checks'})), issues:[]
  }));
}
`);
    await runtime.begin(data.root, data.configPath, data.snapshot.digest, true, data.options);
    const dispatched = await runtime.dispatch(data.root, null, true, data.options);
    assert.equal(runtime.status(data.root).jobs[0].status, 'local-ready');
    assert.notEqual(dispatched.workspaces[0].workspace, data.root);
    await runtime.capture(data.root, 'F002-S01', true, data.options);
    await runtime.publishLocal(data.root, 'F002-S01', true, data.options);
    const review = change(data, 'cli-checker', null, Object.values(data.state.prs)[0].headRefOid);
    await runtime.prepare(data.root, 'F002-S01', null, review.workspace, 'independent-cli-checker', true, data.options);
    const verdict = await runtime.launchReview(data.root, true, data.options);
    assert.equal(verdict.verdict, 'PASS');
    assert.equal(shared.git(data.root, ['status', '--porcelain']), '');
});

test('new manual skills stay out of the hosted single-feature bundle', () => {
    const files = cloudInstaller.buildBundle();
    for (const name of ['jira-plan', 'hybrid-loop', 'jira-sync']) {
        assert.equal(files.has(`.github/skills/${name}/SKILL.md`), false);
    }
    assert.equal([...files.keys()].filter(name => name.endsWith('/SKILL.md')).length, 19);
});
