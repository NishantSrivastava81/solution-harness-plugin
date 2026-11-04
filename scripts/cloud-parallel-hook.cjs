'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { git } = require('../parallel/runtime.cjs');
const { readJson, noLinks, requireValue } = require('../parallel/model.cjs');
const { locations } = require('../skills/cloud-parallel/scripts/coordinator.cjs');

function context(cwd, includeDormant = false) {
    const probe = git(cwd, ['rev-parse', '--show-toplevel'], true);
    if (probe.status !== 0) return null;
    const root = fs.realpathSync(probe.stdout.trim());
    const loc = locations(root);
    const dormant = { root, loc, run: null, role: null };
    if (!fs.existsSync(loc.active)) return includeDormant ? dormant : null;
    const reference = readJson(loc.active);
    requireValue(typeof reference.id === 'string' && /^[a-f0-9-]{36}$/i.test(reference.id), 'Invalid cloud run reference');
    const run = readJson(path.join(loc.directory, 'runs', `${reference.id}.json`));
    requireValue(run.version === 1 && run.id === reference.id, 'Invalid cloud run state');
    const same = (first, second) => fs.realpathSync(first).toLowerCase() === fs.realpathSync(second).toLowerCase();
    if (run.mode === 'hybrid') return { root, loc, run, role: null };
    if (same(root, run.root)) return { root, loc, run, role: 'coordinator' };
    if (run.candidate?.workspace && same(root, run.candidate.workspace)) return { root, loc, run, role: 'evaluator' };
    return includeDormant ? dormant : null;
}

function deny(event, reason) {
    if (event === 'PreToolUse') return {
        hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason }
    };
    if (event === 'Stop') return { hookSpecificOutput: { hookEventName: event, decision: 'block', reason } };
    return { hookSpecificOutput: { hookEventName: event, additionalContext: `CLOUD PARALLEL: ${reason}` } };
}

function handle(cwd, event, payload = {}) {
    const value = context(cwd, true);
    if (value && (!value.run || value.run.mode === 'hybrid')) {
        const hybrid = require('../hybrid/hooks.cjs').handle(cwd, event, payload, value);
        if (hybrid !== null) return hybrid;
    }
    if (!value?.run || !value.role) return null;
    const { loc, run, role } = value;
    if (event === 'SessionStart') {
        const detail = role === 'coordinator'
            ? `Coordinator run ${run.id}. Use /cloud-parallel and pause before handing off; do not edit shared progress while the run is active.`
            : `Review candidate ${run.candidate.sha} for ${run.candidate.story_id || run.candidate.feature_id}. Return the independent cloud-parallel report; do not edit source or shared status.`;
        return { hookSpecificOutput: { hookEventName: event, additionalContext: `CLOUD PARALLEL ${role.toUpperCase()}: ${detail}` } };
    }
    if (event === 'Stop') {
        if (payload.internal_subagent_stop && role === 'coordinator') return {};
        if (role === 'coordinator' && run.status === 'active' && !run.paused) {
            return deny(event, 'Pause the cloud parallel coordinator before handing off; do not edit shared progress to satisfy the sequential stop hook');
        }
        return {};
    }
    if (event === 'PostToolUse') {
        const tool = String(payload.tool_name || payload.toolName || 'unknown');
        requireValue(/^[\w./-]{1,120}$/.test(tool), 'Invalid tool identifier for receipt');
        const filename = path.join(loc.directory, 'events.jsonl');
        noLinks(filename);
        fs.appendFileSync(filename, JSON.stringify({ at: new Date().toISOString(), event, tool, run_id: run.id }) + '\n', { mode: 0o600 });
        return {};
    }
    if (event !== 'PreToolUse' || role !== 'evaluator') return null;
    const tool = String(payload.tool_name || payload.toolName || '');
    const input = payload.tool_input || payload.toolInput || {};
    if (/(?:create.?file|create.?directory|edit|replace|patch|rename|delete.?file)/i.test(tool)) {
        return deny(event, 'Cloud PR evaluators are read-only; return the report to the coordinator');
    }
    if (/(?:terminal|powershell|execute|run.?command|run.?code|notebook)/i.test(tool)) {
        const command = typeof input === 'string' ? input : input.command || input.commandLine || input.code || '';
        requireValue(typeof command === 'string', 'Unknown terminal command shape');
        requireValue(!/\bgit(?:\.exe)?\b/i.test(command) || !/\b(commit|merge|rebase|checkout|switch|worktree|reset|clean|stash|push|fetch|pull|add|update-ref|cherry-pick|am|config|branch|tag|remote|submodule)\b/i.test(command), 'Git mutations belong to the coordinator');
        const lower = command.toLowerCase();
        requireValue(!['rm -rf /', 'drop table', 'drop database', 'format c', 'del /f /s /q', 'rmdir /s /q c:\\'].some(item => lower.includes(item)), 'Dangerous command blocked');
    }
    return {};
}

function dispatch(event, payload = {}) {
    try {
        const result = handle(process.cwd(), event, payload);
        if (result === null) return false;
        process.stdout.write(JSON.stringify(result));
    } catch (error) {
        process.stdout.write(JSON.stringify(deny(event, error.message)));
    }
    return true;
}

module.exports = { context, handle, dispatch };
