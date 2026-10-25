const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { buildBundle, installBundle, seedFiles } = require('../scripts/install-cloud.cjs');
const { begin, finish, handleHook, readState, verify } = require('../cloud/runtime.cjs');

function temporaryDirectory(context) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solution-harness-cloud-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

test('installs files and leaves an identical installation unchanged', context => {
    const directory = temporaryDirectory(context);
    const files = new Map([['.github/agents/orchestrator.agent.md', 'cloud profile\n']]);
    assert.deepEqual(installBundle(directory, files), {
        added: ['.github/agents/orchestrator.agent.md'], unchanged: [], preserved: []
    });
    assert.deepEqual(installBundle(directory, files), {
        added: [], unchanged: ['.github/agents/orchestrator.agent.md'], preserved: []
    });
});

test('preflights every conflict before writing any files', context => {
    const directory = temporaryDirectory(context);
    fs.mkdirSync(path.join(directory, '.github'));
    fs.writeFileSync(path.join(directory, '.github/existing.md'), 'project configuration');
    const files = new Map([
        ['.github/new.md', 'new'], ['.github/existing.md', 'replacement']
    ]);
    assert.throws(() => installBundle(directory, files), /conflicts; no files written/);
    assert.equal(fs.existsSync(path.join(directory, '.github/new.md')), false);
    assert.equal(fs.readFileSync(path.join(directory, '.github/existing.md'), 'utf8'), 'project configuration');
});

test('dry run reports missing files without creating directories', context => {
    const directory = temporaryDirectory(context);
    const files = new Map([['.github/agents/builder.agent.md', 'profile']]);
    assert.deepEqual(installBundle(directory, files, { dryRun: true }).added, [...files.keys()]);
    assert.deepEqual(fs.readdirSync(directory), []);
});

test('refuses symlinked parents and files, including dangling symlinks', context => {
    const directory = temporaryDirectory(context);
    const outside = temporaryDirectory(context);
    fs.symlinkSync(outside, path.join(directory, '.github'), 'dir');
    assert.throws(() => installBundle(directory, new Map([['.github/file.md', 'content']])), /symlinked/);
    assert.deepEqual(fs.readdirSync(outside), []);
    fs.unlinkSync(path.join(directory, '.github'));
    fs.symlinkSync(path.join(outside, 'missing'), path.join(directory, 'file.md'));
    assert.throws(() => installBundle(directory, new Map([['file.md', 'content']])), /symlinked/);
});

test('refuses paths escaping the target', context => {
    const directory = temporaryDirectory(context);
    for (const relativePath of ['../outside', '/absolute', 'C:\\absolute', '..\\outside']) {
        assert.throws(() => installBundle(directory, new Map([[relativePath, 'content']])), /Unsafe bundle path/);
    }
});

function cloudProject(context, configOverrides = {}) {
    const root = temporaryDirectory(context);
    assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
    fs.mkdirSync(path.join(root, '.github/harness'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, '.github/harness/.gitignore'), '/runtime/\n');
    fs.writeFileSync(path.join(root, '.github/harness/config.json'), JSON.stringify({
        version: 1, feature_ids: ['F001', 'F002'], max_minutes: 40, max_rework: 1,
        verification: [{ name: 'Tests', kind: 'test', command: process.execPath, args: ['-e', 'process.exit(0)'] }],
        ...configOverrides
    }));
    fs.writeFileSync(path.join(root, 'docs/FEATURES.json'), JSON.stringify({ features: [
        { id: 'F001', status: 'not-started', acceptance_criteria: ['The behavior works'], dependencies: [] },
        { id: 'F002', status: 'not-started', acceptance_criteria: ['Another behavior works'], dependencies: [] }
    ] }));
    for (const filename of ['PLAN', 'ARCHITECTURE', 'PROGRESS']) {
        fs.writeFileSync(path.join(root, `docs/${filename}.md`), `# ${filename}\n`);
    }
    fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = false;\n');
    handleHook(root, 'sessionStart', { sessionId: 'test-session' });
    return root;
}

function buildAndEvaluate(root, overrides = {}) {
    handleHook(root, 'subagentStop', { agentName: 'builder', agentId: 'maker' });
    handleHook(root, 'subagentStop', {
        agentName: 'evaluator', agentId: 'checker', response: JSON.stringify({
            feature_id: 'F001', verdict: 'PASS',
            criteria: [{ criterion: 'The behavior works', passed: true, evidence: 'app.js and tests' }],
            issues: [], ...overrides
        })
    });
}

test('completes only one feature after independent review and current verification', context => {
    const root = cloudProject(context);
    begin(root, 'F001');
    verify(root, 'baseline');
    fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = true;\n');
    buildAndEvaluate(root);
    verify(root, 'final');
    assert.equal(finish(root, 'pass').outcome, 'pass');
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'docs/FEATURES.json'), 'utf8'));
    assert.equal(registry.features[0].status, 'complete');
    assert.equal(registry.features[1].status, 'not-started');
    assert.match(fs.readFileSync(path.join(root, 'docs/PROGRESS.md'), 'utf8'), /Cloud Run/);
    assert.match(fs.readFileSync(path.join(root, 'docs/EVALUATION.md'), 'utf8'), /"verdict": "PASS"/);
    assert.throws(() => begin(root, 'F002'), /one feature/);
});

test('requires configured tests, approved scope, and a green baseline before building', context => {
    const unconfigured = cloudProject(context, { verification: [] });
    assert.throws(() => begin(unconfigured, 'F001'), /explicit verification commands/);
    const root = cloudProject(context);
    assert.throws(() => begin(root, 'F999'), /allowlist/);
    begin(root, 'F001');
    fs.writeFileSync(path.join(root, 'app.js'), 'edited before baseline\n');
    assert.throws(() => verify(root, 'baseline'), /before the builder or any source edits/);
});

test('rejects unmet dependencies and malformed acceptance criteria', context => {
    const root = cloudProject(context);
    const filename = path.join(root, 'docs/FEATURES.json');
    const registry = JSON.parse(fs.readFileSync(filename, 'utf8'));
    registry.features[0].dependencies = ['F002'];
    fs.writeFileSync(filename, JSON.stringify(registry));
    assert.throws(() => begin(root, 'F001'), /unmet dependencies/);
    registry.features[0].dependencies = [];
    registry.features[0].acceptance_criteria = [];
    fs.writeFileSync(filename, JSON.stringify(registry));
    assert.throws(() => begin(root, 'F001'), /acceptance criteria/);
});

test('does not accept self-grading or an evaluator without criterion evidence', context => {
    const root = cloudProject(context);
    begin(root, 'F001');
    verify(root, 'baseline');
    handleHook(root, 'subagentStop', { agentName: 'builder', agentId: 'same-agent' });
    handleHook(root, 'subagentStop', {
        agentName: 'evaluator', agentId: 'same-agent', response: JSON.stringify({
            feature_id: 'F001', verdict: 'PASS', issues: [],
            criteria: [{ criterion: 'The behavior works', passed: true, evidence: 'Passing tests' }]
        })
    });
    assert.equal(readState(root).evaluation.passed, false);
    assert.match(readState(root).evaluation.error, /distinct, nonempty subagent identities/);
    buildAndEvaluate(root, { criteria: [] });
    assert.equal(readState(root).evaluation.passed, false);
    assert.throws(() => verify(root, 'final'), /independent PASS/);
    assert.throws(() => finish(root, 'pass'), /Completion refused/);
});

test('invalidates evaluator and test receipts after a source change', context => {
    const root = cloudProject(context);
    begin(root, 'F001');
    verify(root, 'baseline');
    buildAndEvaluate(root);
    verify(root, 'final');
    fs.writeFileSync(path.join(root, 'new.js'), 'module.exports = "unverified";\n');
    assert.throws(() => finish(root, 'pass'), /stale evidence/);
});

test('refuses completion when test commands fail or the approved config changes', context => {
    const root = cloudProject(context, { verification: [
        { name: 'Tests', kind: 'test', command: process.execPath, args: ['-e', 'process.exit(1)'] }
    ] });
    begin(root, 'F001');
    assert.throws(() => verify(root, 'baseline'), /Verification failed/);
    assert.equal(readState(root).baseline.passed, false);
    const configFile = path.join(root, '.github/harness/config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.verification[0].args = ['-e', 'process.exit(0)'];
    fs.writeFileSync(configFile, JSON.stringify(config));
    assert.throws(() => verify(root, 'baseline'), /configuration changed/);
});

test('enforces time and rework budgets but still permits a blocked checkpoint', context => {
    const root = cloudProject(context, { max_rework: 0 });
    begin(root, 'F001');
    verify(root, 'baseline');
    buildAndEvaluate(root);
    buildAndEvaluate(root);
    assert.throws(() => verify(root, 'final'), /rework budget/);
    assert.equal(finish(root, 'needs-rework', 'Independent verification needs another implementation attempt.').outcome, 'needs-rework');
    const timed = cloudProject(context);
    begin(timed, 'F001');
    const stateFile = path.join(timed, '.github/harness/runtime/session.json');
    const state = readState(timed);
    state.startedAt -= 41 * 60_000;
    fs.writeFileSync(stateFile, JSON.stringify(state));
    assert.throws(() => verify(timed, 'baseline'), /working budget/);
    assert.equal(finish(timed, 'blocked', 'Working budget exhausted.').outcome, 'blocked');
});

test('normalizes cloud hook payloads and never logs tool arguments or secrets', context => {
    const root = cloudProject(context);
    for (const payload of [
        { toolName: 'bash', toolArgs: { command: 'rm -rf /' } },
        { tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
        { toolName: 'bash', toolArgs: JSON.stringify({ command: 'DROP TABLE users' }) }
    ]) {
        assert.equal(handleHook(root, 'preToolUse', payload).permissionDecision, 'deny');
    }
    assert.deepEqual(handleHook(root, 'preToolUse', { toolName: 'bash', toolArgs: { command: 'npm test' } }), {});
    handleHook(root, 'postToolUse', { toolName: 'bash', toolArgs: { command: 'secret-value' }, toolResult: { textResultForLlm: 'secret-value' } });
    const log = fs.readFileSync(path.join(root, '.github/harness/runtime/events.jsonl'), 'utf8');
    assert.doesNotMatch(log, /secret-value|toolArgs|textResultForLlm/);
    assert.equal(JSON.parse(log).tool, 'bash');
});

test('stop guard is scoped to active runs and self-limits forced continuation', context => {
    const root = cloudProject(context);
    assert.deepEqual(handleHook(root, 'agentStop', {}), {});
    begin(root, 'F001');
    assert.equal(handleHook(root, 'agentStop', {}).decision, 'block');
    assert.equal(handleHook(root, 'agentStop', { agentId: 'root-agent' }).decision, 'block');
    assert.equal(handleHook(root, 'agentStop', { agent_id: 'root-agent' }).decision, 'block');
    assert.deepEqual(handleHook(root, 'agentStop', { agentId: 'builder-subagent', parentAgentId: 'root-agent' }), {});
    assert.deepEqual(handleHook(root, 'agentStop', { agent_id: 'builder-subagent', parent_agent_id: 'root-agent' }), {});
    assert.deepEqual(handleHook(root, 'agentStop', { stop_hook_active: true }), {});
    finish(root, 'blocked', 'Required external access is unavailable.');
    assert.deepEqual(handleHook(root, 'agentStop', {}), {});
});

test('fails closed when either independent subagent identity is missing', context => {
    for (const [builderId, evaluatorId] of [[undefined, undefined], ['maker', undefined], [undefined, 'checker']]) {
        const root = cloudProject(context);
        begin(root, 'F001');
        verify(root, 'baseline');
        handleHook(root, 'subagentStop', { agentName: 'builder', agentId: builderId });
        handleHook(root, 'subagentStop', {
            agentName: 'evaluator', agentId: evaluatorId, response: JSON.stringify({
                feature_id: 'F001', verdict: 'PASS', issues: [],
                criteria: [{ criterion: 'The behavior works', passed: true, evidence: 'Passing tests' }]
            })
        });
        assert.equal(readState(root).evaluation.passed, false);
        assert.match(readState(root).evaluation.error, /distinct, nonempty subagent identities/);
        assert.throws(() => verify(root, 'final'), /independent PASS/);
        assert.throws(() => finish(root, 'pass'), /Completion refused/);
    }
});

test('distinguishes the recorded root identity from child stop events', context => {
    const root = cloudProject(context);
    handleHook(root, 'sessionStart', { session_id: 'identified-session', agent_id: 'root-agent' });
    begin(root, 'F001');
    assert.equal(handleHook(root, 'agentStop', { agentId: 'root-agent' }).decision, 'block');
    assert.deepEqual(handleHook(root, 'agentStop', { agent_id: 'child-agent' }), {});
});

test('builds native cloud profiles and a reproducible content-hashed bundle without changing local files', () => {
    const sourceRoot = path.resolve(__dirname, '..');
    const localBuilder = fs.readFileSync(path.join(sourceRoot, 'agents/builder.agent.md'));
    const files = buildBundle();
    assert.deepEqual(buildBundle(), files);
    assert.equal([...files.keys()].filter(filename => filename.endsWith('.agent.md')).length, 3);
    assert.equal([...files.keys()].filter(filename => filename.endsWith('/SKILL.md')).length, 18);
    for (const [filename, content] of files) {
        if (filename.endsWith('.agent.md')) {
            assert.doesNotMatch(content.toString(), /vscode\/|handoffs:|runSubagent|run_in_terminal/);
            assert.match(content.toString(), /target: github-copilot/);
        }
    }
    assert.deepEqual(files.get('.github/skills/testing/SKILL.md'), fs.readFileSync(path.join(sourceRoot, 'skills/testing/SKILL.md')));
    assert.deepEqual(fs.readFileSync(path.join(sourceRoot, 'agents/builder.agent.md')), localBuilder);
    const manifest = JSON.parse(files.get('.github/harness/manifest.json'));
    for (const [filename, hash] of Object.entries(manifest.files)) {
        assert.equal(crypto.createHash('sha256').update(files.get(filename)).digest('hex'), hash);
    }
    const hooks = JSON.parse(files.get('.github/hooks/solution-harness.json'));
    assert.equal(hooks.version, 1);
    assert.deepEqual(Object.keys(hooks.hooks).sort(), ['agentStop', 'postToolUse', 'preToolUse', 'sessionStart', 'subagentStop']);
});

test('preserves project-owned config and setup, including on repeated installs', context => {
    const root = cloudProject(context);
    fs.mkdirSync(path.join(root, '.github/workflows'));
    const workflow = path.join(root, '.github/workflows/copilot-setup-steps.yml');
    fs.writeFileSync(workflow, 'existing: project setup\n');
    const originalConfig = fs.readFileSync(path.join(root, '.github/harness/config.json'));
    const files = buildBundle();
    assert.equal(installBundle(root, files, { preserveExisting: seedFiles }).preserved.length, 2);
    assert.equal(installBundle(root, files, { preserveExisting: seedFiles }).added.length, 0);
    assert.deepEqual(fs.readFileSync(path.join(root, '.github/harness/config.json')), originalConfig);
    assert.equal(fs.readFileSync(workflow, 'utf8'), 'existing: project setup\n');
});

test('runs the installer and cloud lifecycle end to end in an ESM target repository', context => {
    const root = cloudProject(context);
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    const installer = path.resolve(__dirname, '../scripts/install-cloud.cjs');
    const dryRun = spawnSync(process.execPath, [installer, '--dry-run', root], { encoding: 'utf8' });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Would add/);
    assert.equal(fs.existsSync(path.join(root, '.github/agents')), false);
    const installed = spawnSync(process.execPath, [installer, root], { encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    const runtime = path.join(root, '.github/harness/runtime.cjs');
    function invoke(argumentsList, payload) {
        const result = spawnSync(process.execPath, [runtime, ...argumentsList], {
            cwd: root, encoding: 'utf8', input: payload === undefined ? undefined : JSON.stringify(payload)
        });
        assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
        return result.stdout;
    }
    assert.match(invoke(['sessionStart'], { session_id: 'installed-session' }), /additionalContext/);
    invoke(['begin', 'F001']);
    invoke(['verify', 'baseline']);
    fs.writeFileSync(path.join(root, 'app.js'), 'export default true;\n');
    invoke(['subagentStop'], { agent_name: 'builder', agent_id: 'installed-maker' });
    invoke(['subagentStop'], {
        agent_name: 'evaluator', agent_id: 'installed-checker', last_assistant_message: JSON.stringify({
            feature_id: 'F001', verdict: 'PASS', issues: [],
            criteria: [{ criterion: 'The behavior works', passed: true, evidence: 'app.js and passing tests' }]
        })
    });
    invoke(['verify', 'final']);
    assert.equal(JSON.parse(invoke(['finish', 'pass'])).outcome, 'pass');
    assert.equal(JSON.parse(invoke(['agentStop'], {})).decision, undefined);
    const malformed = spawnSync(process.execPath, [runtime, 'preToolUse'], { input: '{', encoding: 'utf8' });
    assert.equal(JSON.parse(malformed.stdout).permissionDecision, 'deny');
    const status = spawnSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
    assert.doesNotMatch(status.stdout, /harness\/runtime\//);
});