'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const runtime = require('./runtime.cjs');
const core = require('../skills/cloud-parallel/scripts/coordinator.cjs');
const shared = require('../parallel/runtime.cjs');
const { toolPaths } = require('../parallel/hooks.cjs');
const { requireValue, readJson, allowed, noLinks } = require('../parallel/model.cjs');

function handle(cwd, event, payload = {}, cached = null) {
    if (!cached) {
        const probe = shared.git(cwd, ['rev-parse', '--show-toplevel'], true);
        if (probe.status !== 0) return null;
        const root = fs.realpathSync(probe.stdout.trim());
        cached = { root, loc: core.locations(root), run: null };
    }
    const { root, loc } = cached;
    const filename = runtime.assignmentPath(root);
    const assignment = shared.absent(filename) ? null : readJson(filename);
    if (assignment) requireValue(assignment.version === 1 && /^[a-f0-9-]{36}$/i.test(assignment.run_id || '')
        && ['builder', 'evaluator'].includes(assignment.role) && assignment.workspace === root, 'Invalid hybrid assignment metadata');
    if (!assignment && shared.absent(loc.active)) return null;
    const run = assignment ? readJson(path.join(loc.directory, 'runs', `${assignment.run_id}.json`)) : cached.run || core.active(loc);
    if (assignment) requireValue(run.id === assignment.run_id, 'Hybrid assignment run identity changed');
    if (run.mode !== 'hybrid') {
        requireValue(!assignment, 'Hybrid assignment points to a different execution mode');
        return null;
    }
    const role = assignment?.role || (root === run.root ? 'coordinator' : null);
    if (!role) return null;
    const closed = ['published', 'cancelled'].includes(run.status);
    if (event === 'SessionStart') {
        const detail = closed ? 'This assignment is closed. Stop and open a fresh workspace; do not fall back to sequential work here.'
            : role === 'coordinator' ? `Run ${run.id}; use /hybrid-loop. No sprint watcher. Pause before handing off.`
                : JSON.stringify(runtime.context(root));
        return { hookSpecificOutput: { hookEventName: event, additionalContext: `MANUAL JIRA HYBRID ${role.toUpperCase()}: ${detail}` } };
    }
    if (event === 'PostToolUse') {
        const tool = String(payload.tool_name || payload.toolName || 'unknown');
        requireValue(/^[\w./-]{1,120}$/.test(tool), 'Invalid tool identifier');
        const receipt = path.join(loc.directory, 'events.jsonl');
        noLinks(receipt);
        fs.appendFileSync(receipt, JSON.stringify({ at: new Date().toISOString(), event, tool, run_id: run.id, mode: 'hybrid' }) + '\n', { mode: 0o600 });
        return {};
    }
    if (event === 'Stop') {
        if (closed) return {};
        if (role === 'coordinator') {
            requireValue(run.paused || !['active', 'starting', 'publishing'].includes(run.status), 'Pause the hybrid run before handing off; use recover-publish for interrupted metadata publication');
        } else if (role === 'builder' && run.jobs[assignment.story_id]?.status === 'running') {
            runtime.assigned(root);
            const report = readJson(runtime.reportPath(root));
            requireValue(report.nonce === assignment.nonce && report.attempt === assignment.attempt
                && ['READY', 'BLOCKED'].includes(report.verdict), 'Write the current private worker report before stopping');
            if (report.verdict === 'READY') requireValue(report.fingerprint === shared.fingerprint(root), 'Source changed after the worker report');
            else requireValue(['environment', 'tests-failing', 'out-of-scope', 'design-question'].includes(report.reason), 'Use a documented private blocker reason');
        } else if (role === 'evaluator' && run.candidate?.nonce === assignment.nonce) {
            const context = runtime.context(root), report = readJson(context.report_path);
            requireValue(report.assignment_nonce === context.assignment_nonce, 'Evaluator report belongs to a stale assignment');
            shared.validateReview(report, { id: run.id, feature_id: context.feature_id }, run.candidate, context.acceptance_criteria);
            shared.clean(root);
        }
        return {};
    }
    if (event !== 'PreToolUse') return {};
    const tool = String(payload.tool_name || payload.toolName || '');
    const input = payload.tool_input || payload.toolInput || {};
    const editing = /(?:create.?file|create.?directory|edit|replace|patch|rename|delete.?file)/i.test(tool);
    const terminal = /(?:terminal|powershell|execute|run.?command|run.?code|notebook)/i.test(tool);
    if (editing || terminal) requireValue(!closed, 'Closed assignments cannot modify or execute in an old worker workspace');
    if (assignment && (editing || terminal)) {
        if (role === 'builder') {
            const job = run.jobs[assignment.story_id];
            requireValue(job?.workspace === root && job.nonce === assignment.nonce && job.attempt === assignment.attempt
                && job.agent_id === assignment.agent_id && job.status === 'running' && Date.parse(job.expires_at) > Date.now(), 'Stale or expired local worker assignment');
        } else {
            requireValue(run.candidate?.workspace === root && run.candidate.nonce === assignment.nonce
                && run.candidate.evaluator_id === assignment.agent_id && run.candidate.phase === 'review', 'Stale local evaluator assignment');
        }
    }
    if (editing) {
        requireValue(role !== 'coordinator', 'Source writes belong only to assigned developers; shared publication belongs to the runtime');
        const targets = toolPaths(input);
        requireValue(targets.length > 0, 'Use a path-explicit edit tool');
        for (const target of targets) {
            const absolute = path.resolve(root, target.startsWith('file:') ? fileURLToPath(target) : target);
            noLinks(absolute);
            if (absolute === runtime.reportPath(root, role)) continue;
            requireValue(role === 'builder' && allowed(path.relative(root, absolute).replace(/\\/g, '/'),
                run.jobs[assignment.story_id].scope.allowed_paths), 'Write is outside owned source or the private report');
        }
    }
    if (terminal) {
        const command = typeof input === 'string' ? input : input.command || input.commandLine || input.code || '';
        requireValue(typeof command === 'string', 'Unknown terminal command shape');
        requireValue(!['rm -rf /', 'drop table', 'drop database', 'format c', 'del /f /s /q', 'rmdir /s /q c:'].some(item => command.toLowerCase().includes(item)), 'Dangerous command blocked');
        if (assignment) {
            requireValue(!/\bgit(?:\.exe)?\b/i.test(command) || !/\b(commit|merge|rebase|checkout|switch|worktree|reset|clean|stash|push|fetch|pull|add|update-ref|cherry-pick|am|config|branch|tag|remote|submodule)\b/i.test(command), 'Git mutations belong to the coordinator');
            requireValue(!/\bruntime\.cjs["']?\s+(begin|dispatch|capture|publish-local|prepare-review|prepare-final|prepare-delivery|merge|finish|sync|accept-evidence|accept-final|update-pr|abandon|cancel|resume|pause|recover)/i.test(command), 'Workers and evaluators cannot invoke coordinator operations');
            requireValue(!/\b(?:ssh|scp|terraform|kubectl|az\s+deployment|docker\s+(?:compose|stack))\b/i.test(command), 'Live infrastructure operations require a separate approved environment workflow');
        }
    }
    return {};
}

module.exports = { handle };
