'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const namespace = path.join(root, 'com.github.copilot');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plugin-contract-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }));
    return directory;
}

function invoke(cwd, event, payload = {}) {
    const native = path.join(namespace, 'hooks', 'hooks.json');
    const config = JSON.parse(fs.readFileSync(fs.existsSync(native) ? native : path.join(root, 'hooks', 'hooks.json')));
    const aliases = { preToolUse: 'PreToolUse', postToolUse: 'PostToolUse', sessionStart: 'SessionStart', agentStop: 'Stop' };
    const hook = (config.hooks[event] || config.hooks[aliases[event]])[0];
    const inline = /^node -e "([\s\S]*)"$/.exec(hook.command);
    const args = inline ? ['-e', inline[1]] : [path.join(root, 'scripts', 'plugin-hook.cjs'), event];
    const result = spawnSync(process.execPath, args, {
        cwd, input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', windowsHide: true,
        env: { ...process.env, PLUGIN_ROOT: root }, timeout: 30000
    });
    assert.equal(result.status, 0, result.stderr);
    return { output: JSON.parse(result.stdout), stderr: result.stderr };
}

test('plugin uses canonical Agent Plugins 1.0 discovery without legacy component path fields', () => {
    const plugin = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json')));
    assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    const allowed = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
    assert.ok(Object.keys(plugin).every(key => allowed.includes(key)));
    assert.match(plugin.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    assert.equal(fs.readdirSync(path.join(namespace, 'agents')).filter(file => file.endsWith('.agent.md')).length, 8);
    const legacyAgents = path.join(root, 'agents');
    assert.ok(!fs.existsSync(legacyAgents) || !fs.readdirSync(legacyAgents).some(file => file.endsWith('.agent.md')));
    assert.equal(fs.existsSync(path.join(root, 'hooks', 'hooks.json')), false);
});

test('marketplace has stable required metadata and the documented publishing location', () => {
    const file = path.join(root, '.github', 'plugin', 'marketplace.json');
    assert.ok(fs.existsSync(file), 'Publish the marketplace under .github/plugin');
    const marketplace = JSON.parse(fs.readFileSync(file));
    assert.equal(marketplace.name, 'solution-harness-marketplace');
    assert.ok(marketplace.owner.name);
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0].name, 'solution-harness');
    assert.equal(marketplace.plugins[0].source, '.');
    assert.equal(marketplace.plugins[0].version, JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'))).version);
    assert.equal(fs.existsSync(path.join(root, 'marketplace.json')), false);
});

test('native and compatible Bash hooks return the documented top-level denial', t => {
    const cwd = fixture(t);
    for (const payload of [
        { toolName: 'bash', toolArgs: { command: 'echo "drop database contract-probe"' } },
        { tool_name: 'Bash', tool_input: { command: 'echo "drop database contract-probe"' } },
        { toolName: 'powershell', toolArgs: { command: 'echo "drop database contract-probe"' } }
    ]) {
        const { output } = invoke(cwd, 'preToolUse', payload);
        assert.equal(output.permissionDecision, 'deny');
        assert.ok(output.permissionDecisionReason);
        assert.equal(output.hookSpecificOutput, undefined);
    }
});

test('namespace hooks use the versioned shared runtime contract and plugin-root-relative scripts', () => {
    const config = JSON.parse(fs.readFileSync(path.join(namespace, 'hooks', 'hooks.json')));
    assert.equal(config.version, 1);
    assert.deepEqual(Object.keys(config.hooks).sort(), ['agentStop', 'postToolUse', 'preToolUse', 'sessionStart', 'subagentStop']);
    for (const [event, entries] of Object.entries(config.hooks)) {
        assert.equal(entries.length, 1);
        assert.equal(entries[0].command, `node "\${PLUGIN_ROOT}/scripts/plugin-hook.cjs" ${event}`);
        assert.ok(entries[0].timeoutSec > 0);
        assert.equal(entries[0].windows, undefined);
    }
});

test('session context and stop blocking use top-level shared outputs', t => {
    const cwd = fixture(t);
    const start = invoke(cwd, 'sessionStart', {});
    assert.match(start.output.additionalContext, /onboard|init-solution/);
    assert.equal(start.output.hookSpecificOutput, undefined);
    fs.mkdirSync(path.join(cwd, 'docs'));
    const file = path.join(cwd, 'docs', 'PROGRESS.md');
    fs.writeFileSync(file, '# Progress\n');
    fs.utimesSync(file, new Date(0), new Date(0));
    const stop = invoke(cwd, 'agentStop', {}).output;
    assert.equal(stop.decision, 'block');
    assert.ok(stop.reason);
    assert.equal(stop.hookSpecificOutput, undefined);
});

test('malformed hook inputs fail explicitly without exposing raw input', t => {
    const cwd = fixture(t);
    const result = invoke(cwd, 'preToolUse', '{private-input-marker');
    assert.equal(result.output.permissionDecision, 'deny');
    assert.match(result.stderr, /hook input|JSON/i);
    assert.doesNotMatch(JSON.stringify(result), /private-input-marker/);
});

test('ordinary post-tool receipts omit input and result content for current tool payloads', t => {
    const cwd = fixture(t);
    fs.mkdirSync(path.join(cwd, 'docs'));
    invoke(cwd, 'postToolUse', {
        toolName: 'create', toolArgs: { path: 'src/example.cjs', content: 'private-input-marker' },
        toolResult: { textResultForLlm: 'private-result-marker' }
    });
    const receipt = fs.readFileSync(path.join(cwd, 'docs', 'trajectory.jsonl'), 'utf8');
    assert.doesNotMatch(receipt, /private-input-marker|private-result-marker/);
    assert.equal(JSON.parse(receipt).tool, 'create_file');
});

test('cloud jobs do not inherit local progress or coordinator gates', t => {
    const cwd = fixture(t);
    fs.mkdirSync(path.join(cwd, 'docs'));
    const progress = path.join(cwd, 'docs', 'PROGRESS.md');
    fs.writeFileSync(progress, '# Existing progress\n');
    fs.utimesSync(progress, new Date(0), new Date(0));
    const { handle } = require('../scripts/plugin-hook.cjs');
    for (const prompt of ['Solution Harness cloud story assignment v1\nApproved story', 'Implement F001 with cloud-loop']) {
        const env = { COPILOT_AGENT_PROMPT: prompt };
        assert.match(handle(cwd, 'sessionStart', {}, env).additionalContext, /CLOUD/);
        assert.deepEqual(handle(cwd, 'agentStop', {}, env), {});
        assert.equal(handle(cwd, 'preToolUse', { toolName: 'bash', toolArgs: { command: 'git push origin main' } }, env).permissionDecision, 'deny');
    }
    assert.equal(fs.readFileSync(progress, 'utf8'), '# Existing progress\n');
});

test('standalone cloud hooks honor native initialPrompt without bypassing story approval', t => {
    const cwd = fixture(t);
    const cloud = require('../cloud/runtime.cjs');
    const directory = path.join(cwd, '.github', 'harness');
    fs.mkdirSync(directory, { recursive: true });
    const config = path.join(directory, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ cloud_parallel_enabled: true }));
    const initialPrompt = 'Solution Harness cloud story assignment v1\nApproved story';
    const result = cloud.handleHook(cwd, 'sessionStart', { sessionId: 'native-cloud-session', initialPrompt });
    assert.equal(cloud.readState(cwd).mode, 'cloud-story');
    assert.match(result.additionalContext, /local coordinator/);
    fs.writeFileSync(config, JSON.stringify({ cloud_parallel_enabled: false }));
    assert.throws(() => cloud.handleHook(cwd, 'sessionStart', { sessionId: 'unapproved-session', initialPrompt }), /explicit cloud_parallel_enabled/);
});

test('new native plugin controls remain protected under explicitly matching ownership scopes', () => {
    const model = require('../parallel/model.cjs');
    for (const [file, patterns] of [
        ['.github/copilot/settings.json', ['.github/**']],
        ['.github/copilot/settings.local.json', ['.github/**']],
        ['.github/plugin/marketplace.json', ['.github/**']],
        ['com.github.copilot/hooks/hooks.json', ['com.github.copilot/**']],
        ['com.github.copilot/agents/builder.agent.md', ['com.github.copilot/**']],
        ['plugin.json', ['plugin.json']]
    ]) assert.equal(model.allowed(file, patterns), false, file);
    assert.equal(model.allowed('.github/workflows/ui.yml', ['.github/workflows/**']), true);
});

test('repository-local Copilot overrides are ignored while shared activation stays tracked', () => {
    const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
        cwd: root, encoding: 'utf8',
        input: '.github/copilot/settings.local.json\n.claude/settings.local.json\n.github/copilot/settings.json\n.github/plugin/marketplace.json\n'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['.github/copilot/settings.local.json', '.claude/settings.local.json']);
});
