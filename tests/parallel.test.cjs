'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const model = require('../parallel/model.cjs');
const runtime = require('../parallel/runtime.cjs');
const defaults = require('../parallel/config.json');
const hooks = require('../parallel/hooks.cjs');
const localInstaller = require('../scripts/install-parallel.cjs');
const cloudInstaller = require('../scripts/install-cloud.cjs');

function inputs() {
    const features = {
        features: [{
            id: 'F001', name: 'Example feature', priority: 1, status: 'not-started',
            dependencies: [], acceptance_criteria: ['Alpha works', 'Beta works', 'All existing tests continue to pass.']
        }, {
            id: 'F002', name: 'Prerequisite', priority: 2, status: 'complete',
            dependencies: [], acceptance_criteria: ['Prerequisite works']
        }]
    };
    const backlog = { epics: [{ id: 'EP01', features: [{
        id: 'F001', status: 'not-started', stories: [
            { id: 'F001-S01', title: 'Alpha', status: 'todo', depends_on: [], acceptance_criteria: ['Alpha works'], covers_feature_criteria: [1] },
            { id: 'F001-S02', title: 'Beta', status: 'todo', depends_on: [], acceptance_criteria: ['Beta works'], covers_feature_criteria: [2] }
        ]
    }] }] };
    const config = {
        ...structuredClone(defaults), mode: 'parallel-stories', workspace_isolation_confirmed: true,
        instructions_migration_confirmed: true,
        feature_ids: ['F001'], approved_designs: ['F001'],
        verification: [{
            name: 'Regression tests', kind: 'test', command: process.execPath,
            args: ['--test', 'tests/check.test.cjs'], timeout_seconds: 30
        }],
        ownership: {
            'F001-S01': { allowed_paths: ['src/alpha.cjs'], resources: [] },
            'F001-S02': { allowed_paths: ['src/beta.cjs'], resources: [] }
        }
    };
    return { features, backlog, config, stories: backlog.epics[0].features[0].stories };
}

function fixture(t, adjust = () => {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-parallel-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }));
    const root = path.join(directory, 'project');
    fs.mkdirSync(root);
    const data = inputs();
    adjust(data);
    const files = {
        'docs/FEATURES.json': JSON.stringify(data.features, null, 2) + '\n',
        'docs/backlog/backlog.json': JSON.stringify(data.backlog, null, 2) + '\n',
        'docs/PROGRESS.md': '# Progress\n\nExisting history.\n',
        '.github/harness/parallel-config.json': JSON.stringify(data.config, null, 2) + '\n',
        'src/alpha.cjs': 'module.exports = 0;\n',
        'src/beta.cjs': 'module.exports = 0;\n',
        'tests/check.test.cjs': "const assert = require('node:assert/strict');\nassert.ok(require('../src/alpha.cjs') >= 0);\nassert.ok(require('../src/beta.cjs') >= 0);\nassert.ok(require('../src/alpha.cjs') + require('../src/beta.cjs') <= 2);\n",
        ...data.files
    };
    for (const [file, contents] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), contents);
    }
    runtime.git(root, ['init', '--quiet', '-b', 'main']);
    runtime.git(root, ['config', 'user.name', 'Harness Test']);
    runtime.git(root, ['config', 'user.email', 'harness-test@example.invalid']);
    runtime.git(root, ['config', 'commit.gpgsign', 'false']);
    runtime.git(root, ['config', 'core.autocrlf', 'false']);
    runtime.git(root, ['add', '.']);
    runtime.git(root, ['commit', '--quiet', '-m', 'test: initialize fixture']);
    return { root, ...data };
}

function build(root, storyId, agent, value = 1) {
    const assignment = runtime.claim(root, storyId, agent);
    const file = storyId === 'F001-S01' ? 'src/alpha.cjs' : 'src/beta.cjs';
    fs.writeFileSync(path.join(assignment.worktree, file), `module.exports = ${value};\n`);
    runtime.workerReport(assignment.worktree);
    runtime.capture(root, storyId);
    return assignment;
}

function pass(assignment, overrides = {}) {
    return {
        run_id: assignment.run_id, feature_id: assignment.feature_id, story_id: assignment.story_id,
        candidate_sha: assignment.candidate_sha, evaluator_id: assignment.agent_id, verdict: 'PASS',
        criteria: assignment.acceptance_criteria.map(criterion => ({ criterion, passed: true, evidence: 'Inspected source and executed regression tests on this commit.' })),
        issues: [], ...overrides
    };
}

function integrate(root, storyId, evaluator = 'checker') {
    const review = runtime.prepareReview(root, storyId, evaluator, true);
    runtime.reviewReport(review.worktree, pass(review));
    runtime.accept(root, true);
    return review;
}

function editState(root, update) {
    const run = runtime.readRun(root);
    update(run);
    fs.writeFileSync(path.join(runtime.locations(root).directory, 'runs', run.id, 'state.json'), JSON.stringify(run));
}

test('model validates nested and versioned flat stories without altering their definitions', () => {
    const { features, backlog, stories } = inputs();
    const before = JSON.stringify({ features, backlog });
    const nested = model.parseModel(features, backlog);
    const flat = model.parseModel(features, { version: 1, stories: stories.map(story => ({ ...story, feature_id: 'F001' })) });
    assert.deepEqual([...nested.graph], [...flat.graph]);
    assert.equal(JSON.stringify({ features, backlog }), before);
    assert.deepEqual(model.readyStories(nested, 'F001').map(story => story.id), ['F001-S01', 'F001-S02']);
});

test('model rejects cycles, unknown prerequisites, uncovered criteria and unevidenced done stories', () => {
    for (const [mutate, expected] of [
        [data => { data.stories[0].depends_on = ['F001-S02']; data.stories[1].depends_on = ['F001-S01']; }, /cycle/],
        [data => { data.stories[0].depends_on = ['F999']; }, /Unknown prerequisite/],
        [data => { data.stories[1].covers_feature_criteria = [1]; }, /criterion 2/],
        [data => { data.stories[0].status = 'done'; }, /needs evidence/],
        [data => { data.backlog.version = 2; }, /Unsupported/]
    ]) {
        const data = inputs();
        mutate(data);
        assert.throws(() => model.parseModel(data.features, data.backlog), expected);
    }
});

test('model inherits architecture and feature prerequisites before releasing stories', () => {
    const data = inputs();
    data.features.features[1].status = 'not-started';
    data.features.architecture_delivery_gates = [{ prerequisite: 'F002', applies_to: ['F001'] }];
    const parsed = model.parseModel(data.features, data.backlog);
    assert.deepEqual(model.readyStories(parsed, 'F001'), []);
    assert.deepEqual(parsed.graph.get('F001-S01'), ['F002']);
    const result = model.plan({ model: parsed, config: data.config }, 'F001')[0];
    assert.deepEqual(result.blocked[0].unmet, ['F002']);
});

test('planning batches preserve dependencies, ownership exclusions and resource capacity', () => {
    const data = inputs();
    const project = { model: model.parseModel(data.features, data.backlog), config: data.config };
    assert.deepEqual(model.plan(project, 'F001')[0].batches, [['F001-S01', 'F001-S02']]);
    data.config.ownership['F001-S01'].resources.push('shared-database');
    data.config.ownership['F001-S02'].resources.push('shared-database');
    assert.deepEqual(model.plan(project, 'F001')[0].batches, [['F001-S01'], ['F001-S02']]);
    assert.equal(model.allowed('docs/FEATURES.json', ['**']), false);
    assert.equal(model.allowed('.github/harness/parallel-config.json', ['**']), false);
    assert.throws(() => model.allowed('../outside.txt', ['**']), /inside/);
    assert.equal(model.conflicts({ allowed_paths: ['src/**'], resources: [] }, { allowed_paths: ['src/a.cjs'], resources: [] }), true);
});

test('configuration accepts repeated command arguments but rejects unsupported modes and budgets', () => {
    const { config } = inputs();
    config.verification[0].args = ['--require', 'one.cjs', '--require', 'two.cjs'];
    assert.equal(model.parseConfig(config), config);
    assert.throws(() => model.parseConfig({ ...config, mode: 'parallel-features' }), /Only sequential/);
    assert.throws(() => model.parseConfig({ ...config, max_workers: 4 }), /max_workers/);
});

test('begin refuses dirty source, sequential defaults and missing approval without stashing', t => {
    const { root } = fixture(t);
    assert.throws(() => runtime.begin(root, 'F001'), /approve/);
    fs.writeFileSync(path.join(root, 'local.txt'), 'preserve me');
    assert.throws(() => runtime.begin(root, 'F001', true), /dirty/);
    assert.equal(fs.readFileSync(path.join(root, 'local.txt'), 'utf8'), 'preserve me');
    fs.unlinkSync(path.join(root, 'local.txt'));
    const file = path.join(root, '.github/harness/parallel-config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.mode = 'sequential';
    fs.writeFileSync(file, JSON.stringify(config));
    runtime.git(root, ['add', '.']);
    runtime.git(root, ['commit', '--quiet', '-m', 'test: use sequential mode']);
    assert.throws(() => runtime.begin(root, 'F001', true), /opt-in/);
});

test('parallel worktrees integrate exact reviewed commits and publish only after final feature review', t => {
    const { root } = fixture(t);
    const originalFeatures = fs.readFileSync(path.join(root, 'docs/FEATURES.json'), 'utf8');
    const started = runtime.begin(root, 'F001', true);
    const first = build(root, 'F001-S01', 'maker-alpha');
    const second = build(root, 'F001-S02', 'maker-beta');
    assert.notEqual(first.worktree, second.worktree);
    assert.equal(fs.readFileSync(path.join(second.worktree, 'src/alpha.cjs'), 'utf8'), 'module.exports = 0;\n');
    assert.equal(runtime.git(root, ['status', '--porcelain']), '');
    assert.throws(() => runtime.prepareReview(root, null, 'checker', true), /All stories/);
    integrate(root, 'F001-S01');
    integrate(root, 'F001-S02');
    assert.equal(fs.readFileSync(path.join(root, 'docs/FEATURES.json'), 'utf8'), originalFeatures);
    const final = runtime.prepareReview(root, null, 'final-checker', true);
    assert.throws(() => runtime.accept(root, true), /JSON/);
    runtime.reviewReport(final.worktree, pass(final));
    const result = runtime.accept(root, true);
    assert.equal(result.feature_complete, true);
    assert.equal(runtime.git(root, ['rev-parse', 'HEAD']), final.candidate_sha);
    const project = model.loadProject(root);
    assert.equal(project.model.features.get('F001').status, 'complete');
    assert.equal(project.model.stories.get('F001-S01').status, 'done');
    assert.match(project.model.stories.get('F001-S01').evidence, /[a-f0-9]{40}/);
    assert.equal(runtime.status(root, started.run_id).status, 'complete');
    assert.match(fs.readFileSync(path.join(root, 'docs/PROGRESS.md'), 'utf8'), /^# Progress\n\nExisting history\./);
    assert.equal(runtime.git(root, ['status', '--porcelain']), '');
    runtime.cleanup(root, started.run_id, true);
    assert.equal(fs.existsSync(first.worktree), false);
});

test('claims enforce ownership, resources, worker capacity and integrated prerequisites', t => {
    const { root } = fixture(t, data => {
        data.config.max_workers = 1;
        data.stories[1].depends_on = ['F001-S01'];
    });
    runtime.begin(root, 'F001', true);
    assert.throws(() => runtime.claim(root, 'F001-S02', 'second'), /prerequisites/);
    build(root, 'F001-S01', 'first');
    assert.throws(() => runtime.claim(root, 'F001-S02', 'second'), /capacity/);
    integrate(root, 'F001-S01');
    assert.equal(runtime.claim(root, 'F001-S02', 'second').story_id, 'F001-S02');
});

test('workers cannot capture protected files or staged changes hidden by restored working files', t => {
    const { root } = fixture(t, data => { data.config.ownership['F001-S01'].allowed_paths = ['**']; });
    runtime.begin(root, 'F001', true);
    const assignment = runtime.claim(root, 'F001-S01', 'maker');
    const file = path.join(assignment.worktree, 'docs/PROGRESS.md');
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original + 'Unexpected status update.\n');
    assert.throws(() => runtime.workerReport(assignment.worktree), /ownership/);
    runtime.git(assignment.worktree, ['add', '--', 'docs/PROGRESS.md']);
    fs.writeFileSync(file, original);
    assert.throws(() => runtime.workerReport(assignment.worktree), /ownership/);
    assert.throws(() => runtime.claim(assignment.worktree, 'F001-S02', 'other'), /cannot run coordinator/);
});

test('candidate reviews reject self-evaluation, wrong SHA, missing evidence and modified source', t => {
    const { root } = fixture(t);
    runtime.begin(root, 'F001', true);
    build(root, 'F001-S01', 'maker');
    assert.throws(() => runtime.prepareReview(root, 'F001-S01', 'maker', true), /independent/);
    assert.throws(() => runtime.prepareReview(root, 'F001-S01', undefined, true), /label/);
    const review = runtime.prepareReview(root, 'F001-S01', 'checker', true);
    assert.throws(() => runtime.reviewReport(review.worktree, pass(review, { candidate_sha: '0'.repeat(40) })), /SHA/);
    assert.throws(() => runtime.reviewReport(review.worktree, pass(review, { criteria: [] })), /every acceptance/);
    runtime.reviewReport(review.worktree, pass(review));
    fs.writeFileSync(path.join(review.worktree, 'src/alpha.cjs'), 'module.exports = 2;\n');
    assert.throws(() => runtime.accept(root, true), /dirty/);
});

test('combined regressions block integration even when workers passed separately', t => {
    const { root } = fixture(t);
    runtime.begin(root, 'F001', true);
    build(root, 'F001-S01', 'first', 2);
    build(root, 'F001-S02', 'second', 2);
    integrate(root, 'F001-S01');
    assert.throws(() => runtime.prepareReview(root, 'F001-S02', 'checker', true), /Verification failed/);
    assert.equal(runtime.status(root).candidate.phase, 'blocked');
    assert.equal(runtime.readRun(root).jobs['F001-S02'].status, 'built');
    const preserved = runtime.abortCandidate(root, true);
    assert.equal(fs.existsSync(preserved.preserved_worktree), true);
});

test('expired leases require explicit release and fence old attempts', t => {
    const { root } = fixture(t);
    runtime.begin(root, 'F001', true);
    const old = runtime.claim(root, 'F001-S01', 'maker');
    editState(root, run => { run.jobs['F001-S01'].expires_at = '2000-01-01T00:00:00Z'; });
    assert.equal(runtime.status(root).workers[0].expired, true);
    assert.throws(() => runtime.workerReport(old.worktree), /expired/);
    assert.throws(() => runtime.heartbeat(root, 'F001-S01'), /Expired/);
    assert.throws(() => runtime.release(root, 'F001-S01'), /stopped/);
    runtime.release(root, 'F001-S01', true);
    const next = runtime.claim(root, 'F001-S01', 'replacement');
    assert.equal(next.attempt, 2);
    assert.throws(() => runtime.context(old.worktree), /Stale/);
    assert.throws(() => runtime.prepareReview(root, 'F001-S01', 'maker', true), /independent/);
});

test('live coordinator locks cannot be stolen and approved inputs cannot drift', t => {
    const { root } = fixture(t);
    runtime.begin(root, 'F001', true);
    const lock = runtime.locations(root).lock;
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
    assert.throws(() => runtime.claim(root, 'F001-S01', 'maker'), /lock is held/);
    assert.throws(() => runtime.recoverLock(root, true), /still running/);
    fs.unlinkSync(path.join(lock, 'owner.json'));
    fs.rmdirSync(lock);
    fs.appendFileSync(path.join(root, 'docs/FEATURES.json'), '\n');
    const file = path.join(root, '.github/harness/parallel-config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.max_workers = 2;
    fs.writeFileSync(file, JSON.stringify(config));
    assert.throws(() => runtime.claim(root, 'F001-S01', 'maker'), /inputs changed/);
    assert.equal(runtime.status(root).stale_inputs, true);
});

test('promotion recovery is replay-safe after Git advances but state publication is interrupted', t => {
    const { root } = fixture(t);
    runtime.begin(root, 'F001', true);
    build(root, 'F001-S01', 'maker');
    const review = runtime.prepareReview(root, 'F001-S01', 'checker', true);
    const report = pass(review);
    runtime.reviewReport(review.worktree, report);
    editState(root, run => { run.candidate.phase = 'promoting'; run.candidate.review = report; });
    runtime.git(runtime.readRun(root).integration, ['merge', '--ff-only', review.candidate_sha]);
    runtime.recover(root, true);
    assert.equal(runtime.readRun(root).jobs['F001-S01'].status, 'integrated');
    assert.equal(runtime.readRun(root).candidate, null);
});

test('surgical status updates preserve formatting and unrelated definitions', () => {
    const input = '{ "features": [ { "id": "F001", "nested": { "status": "keep" }, "status" : "not-started", "name": "} \\" status" }, { "id": "F002", "status": "existing" } ] }\r\n';
    const result = runtime.replaceStatuses(input, new Map([['F001', 'complete']]));
    assert.equal(result, input.replace('"status" : "not-started"', '"status" : "complete"'));
    assert.throws(() => runtime.replaceStatuses(input, new Map([['F003', 'complete']])), /every expected/);
});

test('CLI reports invalid commands without running Git mutations', () => {
    for (const command of ['invalid', 'toString']) {
        const result = spawnSync(process.execPath, [path.join(__dirname, '../parallel/runtime.cjs'), command], { encoding: 'utf8' });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Unknown command/);
    }
});

test('planner reports opt-in and design blockers without changing feature definitions', () => {
    const data = inputs();
    const config = model.parseConfig(structuredClone(defaults));
    const output = model.plan({ model: model.parseModel(data.features, data.backlog), config }, 'F001')[0];
    assert.equal(output.dispatch_enabled, false);
    assert.equal(output.blocked.length, 2);
    assert.ok(output.execution_blockers.includes('instructions-not-migrated'));
    assert.ok(output.execution_blockers.includes('design-not-approved'));
    data.features.features[0].status = 'blocked';
    const blocked = model.plan({ model: model.parseModel(data.features, data.backlog), config: data.config }, 'F001')[0];
    assert.equal(blocked.blocked[0].feature_state, 'blocked');
    assert.equal(blocked.dispatch_enabled, false);
});

test('worker conflicts serialize shared resources even when file ownership is disjoint', t => {
    const { root } = fixture(t, data => {
        data.config.ownership['F001-S01'].resources = ['shared-port'];
        data.config.ownership['F001-S02'].resources = ['shared-port'];
    });
    runtime.begin(root, 'F001', true);
    runtime.claim(root, 'F001-S01', 'first');
    assert.throws(() => runtime.claim(root, 'F001-S02', 'second'), /resource conflict/);
    assert.deepEqual(runtime.status(root).ready, []);
});

test('failed baseline verification stays blocked and cannot dispatch', t => {
    const { root } = fixture(t, data => {
        data.config.verification[0].args = ['-e', 'process.exit(9)'];
    });
    assert.throws(() => runtime.begin(root, 'F001', true), /Verification failed.*exit 9/);
    assert.equal(runtime.status(root).status, 'blocked');
    assert.throws(() => runtime.claim(root, 'F001-S01', 'maker'), /not active/);
    assert.equal(runtime.readRun(root).worktrees.length, 0);
    runtime.checkpoint(root, 'cancel', true);
});

test('verification that edits source cannot produce a green receipt', t => {
    const { root } = fixture(t, data => {
        data.config.verification[0].args = ['-e', "require('node:fs').appendFileSync('src/alpha.cjs', '\\n')"];
    });
    assert.throws(() => runtime.begin(root, 'F001', true), /changed source/);
    assert.equal(runtime.status(root).status, 'blocked');
    assert.equal(runtime.git(root, ['status', '--porcelain']).includes('src/alpha.cjs'), true);
});

test('idempotent setup provisions fresh worktrees and ignored local data blocks cleanup', t => {
    const { root } = fixture(t, data => {
        data.files = { '.gitignore': '.test-dependency\n' };
        data.config.verification.unshift({
            name: 'Restore fixture dependency', kind: 'setup', command: process.execPath,
            args: ['-e', "require('node:fs').writeFileSync('.test-dependency', 'local fixture')"], timeout_seconds: 30
        });
        data.config.verification.push({
            name: 'Dependency presence', kind: 'test', command: process.execPath,
            args: ['-e', "require('node:assert/strict').ok(require('node:fs').existsSync('.test-dependency'))"], timeout_seconds: 30
        });
    });
    const run = runtime.begin(root, 'F001', true);
    const worker = build(root, 'F001-S01', 'maker');
    integrate(root, 'F001-S01');
    runtime.checkpoint(root, 'cancel', true);
    assert.throws(() => runtime.cleanup(root, run.run_id, true), /Ignored files/);
    assert.equal(fs.readFileSync(path.join(worker.worktree, '.test-dependency'), 'utf8'), 'local fixture');
});

test('run budgets are shared, reservations precede candidate mutation, and attempts are capped', t => {
    const { root } = fixture(t, data => { data.config.max_commits = 1; data.config.max_attempts = 1; });
    runtime.begin(root, 'F001', true);
    build(root, 'F001-S01', 'maker');
    const count = runtime.readRun(root).worktrees.length;
    assert.throws(() => runtime.prepareReview(root, 'F001-S01', 'checker', true), /Commit budget/);
    assert.equal(runtime.readRun(root).worktrees.length, count);
    runtime.abortCandidate(root, true);
    runtime.release(root, 'F001-S01', true);
    assert.throws(() => runtime.claim(root, 'F001-S01', 'replacement'), /Commit budget/);
    editState(root, run => { run.commits = 0; });
    assert.throws(() => runtime.claim(root, 'F001-S01', 'replacement'), /attempt budget/);
    editState(root, run => { run.started_at = '2000-01-01T00:00:00Z'; });
    assert.throws(() => runtime.claim(root, 'F001-S02', 'other'), /time budget/);
});

test('blocked worker reports checkpoint without allowing capture and pause preserves the run', t => {
    const { root } = fixture(t);
    runtime.begin(root, 'F001', true);
    const worker = runtime.claim(root, 'F001-S01', 'maker');
    runtime.workerBlock(worker.worktree, 'environment');
    assert.deepEqual(hooks.handle(worker.worktree, 'Stop'), {});
    assert.throws(() => runtime.capture(root, 'F001-S01'), /blocked.*report/);
    runtime.checkpoint(root, 'pause');
    assert.deepEqual(hooks.handle(root, 'Stop'), {});
    assert.throws(() => runtime.claim(root, 'F001-S02', 'other'), /not active/);
    runtime.checkpoint(root, 'resume');
    assert.equal(runtime.status(root).status, 'active');
});

test('target branch movement refuses new work and preserves the user commit', t => {
    const { root } = fixture(t);
    runtime.begin(root, 'F001', true);
    fs.writeFileSync(path.join(root, 'src/beta.cjs'), 'module.exports = 1;\n');
    runtime.git(root, ['add', '.']);
    runtime.git(root, ['commit', '--quiet', '-m', 'test: preserve user change']);
    const head = runtime.git(root, ['rev-parse', 'HEAD']);
    assert.throws(() => runtime.claim(root, 'F001-S01', 'maker'), /Target branch moved/);
    runtime.checkpoint(root, 'cancel', true);
    assert.equal(runtime.git(root, ['rev-parse', 'HEAD']), head);
});

test('actual merge conflicts are preserved and abort never edits the accepted integration branch', t => {
    const { root } = fixture(t, data => { data.config.ownership['F001-S02'].allowed_paths.push('src/alpha.cjs'); });
    runtime.begin(root, 'F001', true);
    const first = build(root, 'F001-S01', 'maker');
    const review = runtime.prepareReview(root, 'F001-S01', 'checker', true);
    fs.writeFileSync(path.join(review.worktree, 'src/alpha.cjs'), 'module.exports = 2;\n');
    runtime.git(review.worktree, ['add', '.']);
    runtime.git(review.worktree, ['commit', '--quiet', '-m', 'test: emulate stale candidate edit']);
    assert.throws(() => runtime.accept(root, true), /candidate changed/);
    runtime.abortCandidate(root, true);
    const run = runtime.readRun(root);
    fs.writeFileSync(path.join(run.integration, 'src/alpha.cjs'), 'module.exports = 2;\n');
    runtime.git(run.integration, ['add', '.']);
    runtime.git(run.integration, ['commit', '--quiet', '-m', 'test: emulate conflicting integration change']);
    const head = runtime.git(run.integration, ['rev-parse', 'HEAD']);
    assert.throws(() => runtime.prepareReview(root, 'F001-S01', 'fresh-checker', true), /Integration history moved/);
    editState(root, state => { state.integration_sha = head; });
    assert.throws(() => runtime.prepareReview(root, 'F001-S01', 'fresh-checker', true), /Git merge failed/);
    const failed = runtime.status(root).candidate.worktree;
    assert.match(runtime.git(failed, ['status', '--porcelain']), /UU/);
    runtime.abortCandidate(root, true);
    assert.equal(runtime.git(run.integration, ['rev-parse', 'HEAD']), head);
    assert.equal(fs.existsSync(first.worktree), true);
});

test('final promotion recovers both before and after the target branch advances', async t => {
    for (const advanceTarget of [false, true]) {
        await t.test(`target advanced: ${advanceTarget}`, subtest => {
            const { root } = fixture(subtest, data => {
                data.features.features[0].acceptance_criteria = ['Alpha works'];
                data.stories.splice(1);
                delete data.config.ownership['F001-S02'];
            });
            const started = runtime.begin(root, 'F001', true);
            build(root, 'F001-S01', 'maker');
            integrate(root, 'F001-S01');
            const final = runtime.prepareReview(root, null, 'feature-checker', true);
            const report = pass(final);
            runtime.reviewReport(final.worktree, report);
            editState(root, run => { run.candidate.phase = 'promoting'; run.candidate.review = report; });
            runtime.git(runtime.readRun(root).integration, ['merge', '--ff-only', final.candidate_sha]);
            if (advanceTarget) runtime.git(root, ['merge', '--ff-only', final.candidate_sha]);
            runtime.recover(root, true);
            const completed = runtime.readRun(root, started.run_id);
            assert.equal(completed.status, 'complete');
            assert.equal(completed.feature_evaluation.candidate_sha, final.candidate_sha);
            assert.equal(completed.final_verification.sha, final.candidate_sha);
            assert.equal(runtime.git(root, ['rev-parse', 'HEAD']), final.candidate_sha);
            assert.equal(runtime.status(root, started.run_id).stale_inputs, false);
        });
    }
});

test('installer preflights conflicts, preserves customized instructions/config and stays cloud-separated', t => {
    const { root } = fixture(t);
    const files = localInstaller.buildBundle();
    const installerScript = path.join(__dirname, '../scripts/install-parallel.cjs');
    const preview = spawnSync(process.execPath, [installerScript, '--dry-run', root], { encoding: 'utf8' });
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).dry_run, true);
    const config = fs.readFileSync(path.join(root, '.github/harness/parallel-config.json'));
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Custom project instructions.\n');
    const dry = cloudInstaller.installBundle(root, files, { dryRun: true, preserveExisting: localInstaller.seedFiles });
    assert.ok(dry.added.includes('.github/harness/parallel/runtime.cjs'));
    assert.equal(fs.existsSync(path.join(root, '.github/harness/parallel/runtime.cjs')), false);
    const runtimeFile = path.join(root, '.github/harness/parallel/runtime.cjs');
    fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
    fs.writeFileSync(runtimeFile, 'custom runtime');
    assert.throws(() => cloudInstaller.installBundle(root, files, { preserveExisting: localInstaller.seedFiles }), /conflicts/);
    assert.equal(fs.existsSync(path.join(root, '.github/harness/parallel/model.cjs')), false);
    fs.unlinkSync(runtimeFile);
    const installed = spawnSync(process.execPath, [installerScript, root], { encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(JSON.parse(installed.stdout).dry_run, false);
    assert.equal(cloudInstaller.installBundle(root, files, { preserveExisting: localInstaller.seedFiles }).added.length, 0);
    assert.deepEqual(fs.readFileSync(path.join(root, '.github/harness/parallel-config.json')), config);
    assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), 'Custom project instructions.\n');
    const cloud = cloudInstaller.buildBundle();
    assert.equal(cloud.has('.github/skills/plan-execution/SKILL.md'), false);
    assert.equal(cloud.has('.github/skills/parallel-loop/SKILL.md'), false);
    assert.equal([...cloud.keys()].filter(file => file.endsWith('/SKILL.md')).length, 19);
});

test('installer and edit guards reject linked parent directories without following them', t => {
    const { root } = fixture(t);
    const outside = path.join(path.dirname(root), 'outside');
    const destination = path.join(path.dirname(root), 'destination');
    fs.mkdirSync(outside);
    fs.mkdirSync(destination);
    fs.symlinkSync(outside, path.join(destination, '.github'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => cloudInstaller.installBundle(destination, localInstaller.buildBundle()), /symlink/i);
    assert.deepEqual(fs.readdirSync(outside), []);
    runtime.begin(root, 'F001', true);
    const worker = runtime.claim(root, 'F001-S01', 'maker');
    fs.symlinkSync(outside, path.join(worker.worktree, 'src', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => hooks.handle(worker.worktree, 'PreToolUse', {
        tool_name: 'create_file', tool_input: { filePath: path.join(worker.worktree, 'src', 'linked', 'escape.cjs') }
    }), /Symlinks/);
    assert.deepEqual(fs.readdirSync(outside), []);
});

function runHook(root, event, payload = {}) {
    const definition = require('../hooks/hooks.json').hooks[event][0];
    const command = process.platform === 'win32' ? definition.windows || definition.command : definition.command;
    assert.ok(command.startsWith('node -e "') && command.endsWith('"'));
    const result = spawnSync(process.execPath, ['-e', command.slice(9, -1)], {
        cwd: root, input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

test('effective inline hooks route ESM worker assignments, fence edits and omit raw payloads', t => {
    const { root } = fixture(t, data => { data.files = { 'package.json': '{"type":"module"}\n' }; });
    cloudInstaller.installBundle(root, localInstaller.buildBundle(), { preserveExisting: localInstaller.seedFiles });
    runtime.git(root, ['add', '.']);
    runtime.git(root, ['commit', '--quiet', '-m', 'test: install local runtime']);
    const old = new Date('2000-01-01T00:00:00Z');
    fs.utimesSync(path.join(root, 'docs/PROGRESS.md'), old, old);
    assert.equal(runHook(root, 'Stop').hookSpecificOutput.decision, 'block');
    assert.match(runHook(root, 'SessionStart').hookSpecificOutput.additionalContext, /PROJECT STATUS/);
    runtime.begin(root, 'F001', true);
    const worker = runtime.claim(root, 'F001-S01', 'maker');
    assert.match(runHook(worker.worktree, 'SessionStart').hookSpecificOutput.additionalContext, /LOCAL PARALLEL ASSIGNMENT/);
    assert.equal(runHook(worker.worktree, 'Stop').hookSpecificOutput.decision, 'block');
    assert.deepEqual(runHook(worker.worktree, 'PreToolUse', {
        tool_name: 'replace_string_in_file', tool_input: { filePath: path.join(worker.worktree, 'src/alpha.cjs') }
    }), {});
    const denied = runHook(worker.worktree, 'PreToolUse', {
        tool_name: 'apply_patch',
        tool_input: { patch: `*** Begin Patch\n*** Update File: ${path.join(worker.worktree, 'docs/FEATURES.json')}\n*** End Patch` }
    });
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(runHook(worker.worktree, 'PreToolUse', {
        tool_name: 'run_in_terminal', tool_input: { command: 'git commit -am changed' }
    }).hookSpecificOutput.permissionDecision, 'deny');
    const payload = { tool_name: 'run_in_terminal', tool_input: { command: 'sensitive-payload-marker' }, tool_response: 'sensitive-result-marker' };
    assert.deepEqual(runHook(worker.worktree, 'PostToolUse', payload), {});
    const log = fs.readFileSync(path.join(runtime.git(worker.worktree, ['rev-parse', '--absolute-git-dir']), 'harness-events.jsonl'), 'utf8');
    assert.equal(log.includes('sensitive-'), false);
    assert.equal(fs.existsSync(path.join(worker.worktree, 'docs/trajectory.jsonl')), false);
    runtime.workerReport(worker.worktree);
    assert.deepEqual(runHook(worker.worktree, 'Stop'), {});
    const escape = spawnSync(process.execPath, [path.join(root, '.github/harness/parallel/runtime.cjs'), 'claim', '--root', root, '--story', 'F001-S02', '--agent', 'escape'], { cwd: worker.worktree, encoding: 'utf8' });
    assert.equal(escape.status, 1);
    assert.match(escape.stderr, /including with --root/);
    runtime.checkpoint(root, 'cancel', true);
    assert.deepEqual(runHook(root, 'PostToolUse', {
        tool_name: 'run_in_terminal', tool_input: { command: 'node .github\\harness\\parallel\\runtime.cjs cancel --approve' }, tool_response: 'sensitive-result-marker'
    }), {});
    assert.equal(fs.existsSync(path.join(root, 'docs/trajectory.jsonl')), false);
});

test('customization metadata and command surfaces agree with the installed runtime', () => {
    const plugin = require('../plugin.json');
    assert.equal(plugin.version, require('../marketplace.json').plugins[0].version);
    for (const name of ['plan-execution', 'parallel-loop']) {
        const skill = fs.readFileSync(path.join(__dirname, '../skills', name, 'SKILL.md'), 'utf8');
        assert.match(skill, new RegExp(`^---\\r?\\nname: ${name}\\r?\\ndescription: "[^"\\r\\n]+"\\r?\\n`));
        assert.ok(skill.length < 15000);
    }
    const schema = require('../parallel/backlog.schema.json');
    assert.equal(schema.properties.version.const, 1);
    assert.equal(defaults.mode, 'sequential');
    assert.equal(defaults.instructions_migration_confirmed, false);
});

test('three worker slots admit three independent stories and refuse the fourth', t => {
    const { root } = fixture(t, data => {
        data.features.features[0].acceptance_criteria = ['Alpha works', 'Beta works', 'Gamma works', 'Delta works'];
        for (const [number, title] of [[3, 'Gamma'], [4, 'Delta']]) {
            const id = `F001-S0${number}`;
            data.stories.push({ id, title, status: 'todo', depends_on: [], acceptance_criteria: [`${title} works`], covers_feature_criteria: [number] });
            data.config.ownership[id] = { allowed_paths: [`src/${title.toLowerCase()}.cjs`], resources: [] };
        }
    });
    runtime.begin(root, 'F001', true);
    for (let number = 1; number <= 3; number++) runtime.claim(root, `F001-S0${number}`, `maker-${number}`);
    assert.equal(runtime.status(root).workers.length, 3);
    assert.throws(() => runtime.claim(root, 'F001-S04', 'maker-4'), /capacity/);
    runtime.release(root, 'F001-S02', true);
    assert.equal(runtime.claim(root, 'F001-S04', 'maker-4').story_id, 'F001-S04');
});

test('simultaneous coordinator processes cannot claim the same story twice', async t => {
    const { root } = fixture(t);
    runtime.begin(root, 'F001', true);
    function claimProcess(agent) {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [
                path.join(__dirname, '../parallel/runtime.cjs'), 'claim',
                '--root', root, '--story', 'F001-S01', '--agent', agent
            ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            child.stdout.resume();
            child.stderr.on('data', chunk => { stderr += chunk; });
            child.once('error', reject);
            child.once('close', code => resolve({ code, stderr }));
        });
    }
    const results = await Promise.all([claimProcess('first'), claimProcess('second')]);
    assert.deepEqual(results.map(result => result.code).sort(), [0, 1]);
    assert.match(results.find(result => result.code === 1).stderr, /lock is held|already claimed/);
    const run = runtime.readRun(root);
    assert.equal(Object.keys(run.jobs).length, 1);
    assert.equal(run.jobs['F001-S01'].attempt, 1);
    assert.equal(run.worktrees.length, 2);
});

test('verification timeout and output limits fail explicitly without retaining raw output', t => {
    for (const args of [
        ['-e', 'setTimeout(() => {}, 10000)'],
        ['-e', "process.stdout.write('private-output-marker'.repeat(100000))"]
    ]) {
        const { root } = fixture(t, data => {
            data.config.verification[0].args = args;
            data.config.verification[0].timeout_seconds = 1;
        });

        assert.throws(() => runtime.begin(root, 'F001', true), /Verification failed/);
        const run = runtime.readRun(root);
        assert.equal(run.status, 'blocked');
        assert.equal(JSON.stringify(run).includes('private-output-marker'), false);
    }
});

test('ownership retains leading whitespace in Git paths instead of accepting an unowned lookalike', t => {
    const { root } = fixture(t, data => {
        data.files = { ' src/alpha.cjs': 'module.exports = 0;\n' };
    });
    runtime.begin(root, 'F001', true);
    const worker = runtime.claim(root, 'F001-S01', 'maker');
    fs.writeFileSync(path.join(worker.worktree, ' src/alpha.cjs'), 'module.exports = 1;\n');
    runtime.git(worker.worktree, ['add', '--', ' src/alpha.cjs']);
    assert.throws(() => runtime.workerReport(worker.worktree), /outside assigned ownership:  src/);
});
