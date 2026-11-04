'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const runtime = require('./runtime.cjs');
const { allowed, loadProject, readJson, requireValue } = require('./model.cjs');

function deny(event, reason) {
    if (event === 'PreToolUse') return {
        hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason }
    };
    if (event === 'Stop') return { hookSpecificOutput: { hookEventName: event, decision: 'block', reason } };
    return { hookSpecificOutput: { hookEventName: event, additionalContext: `PARALLEL HARNESS: ${reason}` } };
}

function toolPaths(input) {
    const result = [];
    function visit(value, key = '') {
        if (typeof value === 'string') {
            if (/^(path|file_?path|file_?name|uri|oldpath|newpath|oldfilepath|newfilepath)$/i.test(key)) result.push(value);
            if (value.includes('*** Begin Patch')) {
                for (const match of value.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)\r?$/gm)) result.push(match[1].trim());
            }
        } else if (Array.isArray(value)) value.forEach(item => visit(item));
        else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => visit(item, name));
    }
    visit(input);
    return result;
}

function terminalCommand(input) {
    if (typeof input === 'string') return input;
    return input?.command || input?.commandLine || input?.code || '';
}

function stopWorker(root, marker, run) {
    if (['complete', 'cancelled'].includes(run.status)) return {};
    if (marker.role === 'builder') {
        const job = run.jobs[marker.story_id];
        if (!job || job.attempt !== marker.attempt || job.status === 'released' || Date.parse(job.expires_at) <= Date.now()) return {};
        if (['built', 'integrated'].includes(job.status)) {
            requireValue(runtime.git(root, ['rev-parse', 'HEAD']) === job.sha && runtime.git(root, ['status', '--porcelain']) === '', 'Captured worker changed; notify the coordinator');
            return {};
        }
        const report = readJson(path.join(runtime.git(root, ['rev-parse', '--absolute-git-dir']), 'builder-report.json'));
        requireValue(report.agent_id === job.agent_id && report.attempt === job.attempt, 'Missing current worker report');
        if (report.verdict === 'BLOCKED') return {};
        requireValue(report.verdict === 'READY' && report.fingerprint === runtime.fingerprint(root), 'Run worker-report again; source changed since the report');
        return {};
    }
    const candidate = run.candidate;
    if (!candidate || candidate.worktree !== root) return {};
    const project = loadProject(run.root);
    const criteria = candidate.story_id ? project.model.stories.get(candidate.story_id).acceptance_criteria : project.model.features.get(run.feature_id).acceptance_criteria;
    const report = readJson(path.join(runtime.git(root, ['rev-parse', '--absolute-git-dir']), 'review-report.json'));
    runtime.validateReview(report, run, candidate, criteria);
    requireValue(runtime.git(root, ['rev-parse', 'HEAD']) === candidate.sha && runtime.git(root, ['status', '--porcelain']) === '', 'Reviewed source changed; report to the coordinator');
    return {};
}

function handle(root, event, payload = {}) {
    const marker = runtime.readAssignment(root);
    const loc = runtime.locations(root);
    if (event === 'PostToolUse' && /parallel[\\/]runtime\.cjs/.test(terminalCommand(payload.tool_input || payload.toolInput || {}))) return {};
    if (!marker && !fs.existsSync(loc.active)) return null;
    const run = runtime.readRun(root, marker?.run_id);
    if (event === 'SessionStart') {
        const context = marker ? runtime.context(root) : runtime.status(root);
        return {
            hookSpecificOutput: {
                hookEventName: event,
                additionalContext: `LOCAL PARALLEL ASSIGNMENT: ${JSON.stringify(context)}. Follow assigned-story mode, not the sequential feature/progress protocol. Worktrees are not a security sandbox.`
            }
        };
    }
    if (event === 'Stop') {
        if (marker) return stopWorker(root, marker, run);
        if (payload.internal_subagent_stop) return {};
        requireValue(run.status !== 'active' && run.status !== 'starting', 'Pause the coordinator with the runtime before handing off; do not edit shared progress to satisfy the sequential stop hook');
        return {};
    }
    if (event === 'PostToolUse') {
        const tool = String(payload.tool_name || payload.toolName || 'unknown');
        requireValue(/^[\w./-]{1,120}$/.test(tool), 'Invalid tool identifier for receipt');
        const file = path.join(runtime.git(root, ['rev-parse', '--absolute-git-dir']), 'harness-events.jsonl');
        runtime.noLinks(file);
        fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, tool, run_id: run.id }) + '\n', { mode: 0o600 });
        return {};
    }
    if (event !== 'PreToolUse') return {};
    const tool = String(payload.tool_name || payload.toolName || '');
    const input = payload.tool_input || payload.toolInput || {};
    const editing = /(?:create.?file|create.?directory|edit|replace|patch|rename|delete.?file)/i.test(tool);
    const terminal = /(?:terminal|powershell|execute|run.?command|run.?code|notebook)/i.test(tool);
    if (terminal) {
        const command = terminalCommand(input);
        requireValue(typeof command === 'string', 'Unknown terminal command shape');
        const lowered = command.toLowerCase();
        requireValue(!['rm -rf /', 'drop table', 'drop database', 'format c', 'del /f /s /q', 'rmdir /s /q c:'].some(item => lowered.includes(item)), 'Dangerous command blocked');
    }
    if (marker && (editing || terminal)) runtime.assigned(root);
    if (editing) {
        requireValue(marker, 'The coordinator does not edit source while a run is open; use an assigned workspace');
        const paths = toolPaths(input);
        requireValue(paths.length, 'Cannot determine all edit targets; use a path-explicit edit tool');
        const reportPath = path.join(runtime.git(root, ['rev-parse', '--absolute-git-dir']), 'review-report.json');
        for (const file of paths) {
            const absolute = path.resolve(root, file.startsWith('file:') ? fileURLToPath(file) : file);
            runtime.noLinks(absolute);
            if (marker.role === 'evaluator' && absolute === reportPath) continue;
            requireValue(marker.role === 'builder', 'Evaluators may only write their private review report');
            const relative = path.relative(root, absolute).replace(/\\/g, '/');
            requireValue(allowed(relative, run.jobs[marker.story_id].scope.allowed_paths), 'Edit target is outside assigned ownership or is protected');
        }
    }
    if (terminal && marker) {
        const command = terminalCommand(input);
        requireValue(typeof command === 'string', 'Unknown terminal command shape');
        requireValue(!/\bgit(?:\.exe)?\b/i.test(command) || !/\b(commit|merge|rebase|checkout|switch|worktree|reset|clean|stash|push|fetch|pull|add|update-ref|cherry-pick|am|config|branch|tag|remote|submodule|reflog|gc|repack|notes|replace)\b/i.test(command), 'Git mutations belong to the coordinator');
        requireValue(!/\b(?:ssh|scp|terraform|kubectl|docker\s+(?:compose|stack)|az\s+deployment)\b/i.test(command), 'Deployment and live infrastructure operations are outside worker scope');
        requireValue(!/\bruntime\.cjs\s+(?:begin|claim|capture|prepare-review|prepare-final|accept|recover|release|heartbeat|pause|resume|cancel|cleanup|recover-lock)\b/i.test(command), 'Workers cannot invoke coordinator operations');
        for (const protectedFile of ['FEATURES.json', 'PROGRESS.md', 'parallel-config.json', 'AGENTS.md', 'copilot-instructions.md']) {
            requireValue(!command.includes(protectedFile) || !/(?:>|set-content|out-file|writefile|appendfile)/i.test(command), 'Do not write shared planning or configuration through a shell');
        }
    }
    return {};
}

function dispatch(event, payload = {}) {
    try {
        const result = handle(process.cwd(), event, payload);
        if (result === null) return false;
        process.stdout.write(JSON.stringify(result));
    } catch (error) {
        process.stderr.write(`Parallel hook: ${error.message}\n`);
        process.stdout.write(JSON.stringify(deny(event, `Parallel assignment error: ${error.message}. Check context/status; do not fall back to sequential work.`)));
    }
    return true;
}

module.exports = { handle, dispatch, toolPaths };
