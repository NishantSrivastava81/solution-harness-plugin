'use strict';

const fs = require('node:fs');
const path = require('node:path');

const events = {
    sessionStart: 'SessionStart', SessionStart: 'SessionStart',
    preToolUse: 'PreToolUse', PreToolUse: 'PreToolUse',
    postToolUse: 'PostToolUse', PostToolUse: 'PostToolUse',
    agentStop: 'Stop', Stop: 'Stop', subagentStop: 'Stop', SubagentStop: 'Stop'
};

function normalizePayload(event, payload) {
    if (!Object.hasOwn(events, event)) throw new Error('Unsupported plugin hook event');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid hook input object');
    const normalized = { ...payload, internal_subagent_stop: ['subagentStop', 'SubagentStop'].includes(event) };
    if (['PreToolUse', 'PostToolUse'].includes(events[event])) {
        const tool = payload.toolName ?? payload.tool_name;
        if (typeof tool !== 'string' || !/^[\w./-]{1,120}$/.test(tool)) throw new Error('Invalid hook input tool name');
        const names = {
            bash: 'run_in_terminal', powershell: 'run_in_terminal', execute: 'run_in_terminal',
            create: 'create_file', write: 'create_file',
            edit: 'edit', str_replace: 'edit', str_replace_editor: 'edit', apply_patch: 'apply_patch'
        };
        normalized.tool_name = names[tool.toLowerCase()] || tool;
        const args = payload.toolArgs ?? payload.tool_input ?? payload.toolInput;
        if (args === undefined) throw new Error('Missing hook input tool arguments');
        normalized.tool_input = args;
        normalized.tool_response = payload.toolResult ?? payload.tool_result ?? payload.tool_response;
    }
    return normalized;
}

function outputFor(event, result) {
    const value = result?.hookSpecificOutput || result;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid internal hook output');
    const output = {};
    if (events[event] === 'PreToolUse' && value.permissionDecision !== undefined) {
        if (!['deny', 'ask', 'allow'].includes(value.permissionDecision)) throw new Error('Invalid internal permission decision');
        output.permissionDecision = value.permissionDecision;
        if (value.permissionDecisionReason) output.permissionDecisionReason = value.permissionDecisionReason;
    } else if (events[event] === 'Stop' && value.decision !== undefined) {
        if (value.decision !== 'block' || typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('Invalid internal stop decision');
        output.decision = 'block';
        output.reason = value.reason;
    }
    if (typeof value.additionalContext === 'string' && value.additionalContext.trim()) output.additionalContext = value.additionalContext;
    return output;
}

function checkCommand(payload, cloud) {
    if (payload.tool_name !== 'run_in_terminal') return {};
    const input = payload.tool_input;
    const command = typeof input === 'string' ? input : input?.command ?? input?.commandLine ?? input?.code;
    if (typeof command !== 'string') throw new Error('Unknown shell tool arguments; cannot apply command policy');
    const unsafe = ['rm -rf /', 'drop table', 'drop database', 'format c', 'del /f /s /q', 'rmdir /s /q c:'];
    if (unsafe.some(value => command.toLowerCase().includes(value))) {
        return { permissionDecision: 'deny', permissionDecisionReason: 'Harness policy: dangerous command blocked' };
    }
    if (cloud && /\bgit(?:\.exe)?\b/i.test(command) && /\b(commit|push|merge|rebase|reset|clean)\b/i.test(command)) {
        return { permissionDecision: 'deny', permissionDecisionReason: 'Cloud story workers do not publish or rewrite Git history' };
    }
    return {};
}

function handle(cwd, event, payload = {}, env = process.env) {
    if (Number(process.versions.node.split('.')[0]) < 22 || typeof path.posix.matchesGlob !== 'function') {
        throw new Error('Plugin hooks require Node.js 22.20+ or 24+ on the host PATH');
    }
    payload = normalizePayload(event, payload);
    const internal = events[event];
    const cloud = typeof env.COPILOT_AGENT_PROMPT === 'string' && Boolean(env.COPILOT_AGENT_PROMPT.trim());
    if (cloud) {
        if (internal === 'SessionStart') {
            const story = /^Solution Harness cloud story assignment v1(?:\r?\n|$)/.test(env.COPILOT_AGENT_PROMPT);
            return { additionalContext: story
                ? 'CLOUD STORY WORKER: follow the approved story brief. Do not run local coordinators, change shared planning/progress, approve, or merge. The local coordinator accepts delivery.'
                : 'CLOUD JOB: follow the explicit cloud task and repository instructions. Local-only coordinator skills do not run here. If using installed cloud-loop, its repository runtime owns workflow records. Do not approve or merge your own work.' };
        }
        return internal === 'PreToolUse' ? checkCommand(payload, true) : {};
    }
    const routes = require('./cloud-parallel-hook.cjs');
    const routed = routes.handle(cwd, internal, payload);
    if (routed !== null) return outputFor(event, routed);
    const shared = require('../parallel/runtime.cjs');
    const probe = shared.git(cwd, ['rev-parse', '--show-toplevel'], true);
    const root = probe.status === 0 ? fs.realpathSync(probe.stdout.trim()) : path.resolve(cwd);
    const installed = path.join(root, '.github', 'harness', 'parallel', 'hooks.cjs');
    if (!shared.absent(installed)) {
        shared.noLinks(installed);
        const local = require(installed).handle(root, internal, payload);
        if (local !== null) return outputFor(event, local);
    }
    if (internal === 'PreToolUse') return checkCommand(payload, false);
    if (payload.internal_subagent_stop) return {};
    if (internal === 'SessionStart') {
        const filename = path.join(root, 'docs', 'FEATURES.json');
        if (shared.absent(filename)) return { additionalContext: 'No project feature catalog found. Run /init-solution or /onboard first.' };
        const catalog = require('../parallel/model.cjs').readJson(filename);
        if (!Array.isArray(catalog.features)) throw new Error('Project feature catalog must contain a features array');
        const complete = catalog.features.filter(feature => feature.status === 'complete').length;
        const existing = catalog.features.filter(feature => feature.status === 'existing').length;
        const next = catalog.features.find(feature => ['needs-rework', 'not-started'].includes(feature.status));
        return { additionalContext: `PROJECT STATUS: ${complete}/${catalog.features.length - existing} features complete (${existing} existing). Next: ${next ? `${next.id} - ${next.name}` : 'ALL DONE'}. Read docs/PROGRESS.md before starting.` };
    }
    if (internal === 'Stop') {
        const progress = path.join(root, 'docs', 'PROGRESS.md');
        if (!shared.absent(progress) && Date.now() - fs.statSync(progress).mtimeMs > 30 * 60000) {
            return { decision: 'block', reason: 'Project progress was not updated this session. Use /log-progress before stopping.' };
        }
    }
    if (internal === 'PostToolUse' && ['create_file', 'edit', 'apply_patch', 'replace_string_in_file', 'run_in_terminal'].includes(payload.tool_name)) {
        const directory = path.join(root, 'docs');
        if (!shared.absent(directory)) {
            const filename = path.join(directory, 'trajectory.jsonl');
            shared.noLinks(filename);
            fs.appendFileSync(filename, JSON.stringify({ ts: new Date().toISOString(), tool: payload.tool_name }) + '\n');
        }
    }
    return {};
}

function main(event, text) {
    let payload;
    try { payload = text.trim() ? JSON.parse(text) : {}; }
    catch { throw new Error('Invalid hook input JSON'); }
    return handle(process.cwd(), event, payload);
}

if (require.main === module) {
    const event = process.argv[2];
    try { process.stdout.write(JSON.stringify(main(event, fs.readFileSync(0, 'utf8')))); }
    catch (error) {
        process.stderr.write(`Copilot plugin hook: ${error.message}\n`);
        const reason = `Harness hook error: ${error.message}`;
        const output = events[event] === 'PreToolUse' ? { permissionDecision: 'deny', permissionDecisionReason: reason }
            : events[event] === 'Stop' ? { decision: 'block', reason } : { additionalContext: reason };
        process.stdout.write(JSON.stringify(output));
        if (!Object.hasOwn(events, event)) process.exitCode = 1;
    }
}

module.exports = { handle, normalizePayload, outputFor, main };
