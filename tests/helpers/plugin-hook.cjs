'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const hooks = require('../../com.github.copilot/hooks/hooks.json').hooks;
const names = { SessionStart: 'sessionStart', PreToolUse: 'preToolUse', PostToolUse: 'postToolUse', Stop: 'agentStop', SubagentStop: 'subagentStop' };

module.exports = function pluginHook(cwd, event, payload = {}) {
    event = names[event] || event;
    assert.equal(hooks[event][0].command, `node "\${PLUGIN_ROOT}/scripts/plugin-hook.cjs" ${event}`);
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'plugin-hook.cjs'), event], {
        cwd, input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000, windowsHide: true,
        env: { ...process.env, PLUGIN_ROOT: root }
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
};
