'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
    loadProject, plan, readyStories, requireValue, readJson, hash, allowed, conflicts, noLinks
} = require('./model.cjs');

const ACTIVE = new Set(['creating', 'running', 'capturing', 'built']);

function git(root, args, optional = false) {
    const result = spawnSync('git', ['--no-pager', '-C', root, ...args], {
        encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024
    });
    if (!optional && (result.error || result.status !== 0)) throw new Error(`Git ${args[0]} failed; inspect the recorded worktree (exit ${result.status})`);
    return optional ? result : args.includes('-z') ? result.stdout : result.stdout.trim();
}

function repository(root) {
    const real = fs.realpathSync(root);
    requireValue(git(real, ['rev-parse', '--show-toplevel']).replace(/\\/g, '/').toLowerCase() === real.replace(/\\/g, '/').toLowerCase(), 'Run from the root of the intended worktree');
    return real;
}

function locations(root) {
    const common = fs.realpathSync(path.resolve(root, git(root, ['rev-parse', '--git-common-dir'])));
    const directory = path.join(common, 'solution-harness', 'parallel');
    return { common, directory, active: path.join(directory, 'active.json'), lock: path.join(directory, 'coordinator.lock') };
}

function absent(file) {
    try { fs.lstatSync(file); return false; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

function atomicJson(file, value) {
    noLinks(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
}

function assignmentPath(root) {
    return path.join(git(root, ['rev-parse', '--absolute-git-dir']), 'harness-assignment.json');
}

function readAssignment(root) {
    const file = assignmentPath(root);
    if (absent(file)) return null;
    const marker = readJson(file);
    requireValue(marker.version === 1 && ['builder', 'evaluator'].includes(marker.role), 'Unsupported assignment version or role');
    return marker;
}

function coordinator(root, operation) {
    root = repository(root);
    requireValue(!readAssignment(root), 'Worker/evaluator workspaces cannot run coordinator commands');
    const loc = locations(root);
    noLinks(loc.directory);
    fs.mkdirSync(loc.directory, { recursive: true });
    try { fs.mkdirSync(loc.lock); }
    catch (error) {
        if (error.code === 'EEXIST') throw new Error('Coordinator lock is held; do not steal it. Use recover-lock only after its owner has stopped.');
        throw error;
    }
    const owner = path.join(loc.lock, 'owner.json');
    try {
        atomicJson(owner, { pid: process.pid, nonce: crypto.randomUUID(), at: new Date().toISOString() });
        return operation(root, loc);
    } finally {
        if (!absent(owner)) fs.unlinkSync(owner);
        fs.rmdirSync(loc.lock);
    }
}

function startGuard(root, operation) {
    const directory = path.join(locations(repository(root)).common, 'solution-harness');
    noLinks(directory);
    fs.mkdirSync(directory, { recursive: true });
    const lock = path.join(directory, 'start.lock');
    try { fs.mkdirSync(lock); }
    catch (error) {
        if (error.code === 'EEXIST') throw new Error('Another execution mode is starting; retry after it finishes');
        throw error;
    }
    const owner = path.join(lock, 'owner.json');
    try {
        atomicJson(owner, { pid: process.pid });
        return operation();
    } finally {
        if (!absent(owner)) fs.unlinkSync(owner);
        fs.rmdirSync(lock);
    }
}

function recoverStartGuard(root, approve) {
    const lock = path.join(locations(repository(root)).common, 'solution-harness', 'start.lock');
    requireValue(approve && !absent(lock), 'No abandoned execution-start lock to recover');
    const owner = path.join(lock, 'owner.json'), value = readJson(owner);
    requireValue(Number.isInteger(value.pid) && value.pid > 0, 'Invalid execution-start owner');
    let alive = true;
    try { process.kill(value.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    requireValue(!alive, 'Execution-start owner is still alive; do not steal its lock');
    fs.unlinkSync(owner);
    fs.rmdirSync(lock);
    return { recovered: true };
}

function readRun(root, id) {
    const loc = locations(root);
    id = id || readJson(loc.active).run_id;
    requireValue(/^run-[a-z0-9-]+$/.test(id), 'Invalid run ID');
    const run = readJson(path.join(loc.directory, 'runs', id, 'state.json'));
    requireValue(run.version === 1 && run.id === id, 'Unsupported or mismatched run state');
    return run;
}

function save(run) {
    atomicJson(path.join(locations(run.root).directory, 'runs', run.id, 'state.json'), run);
}

function event(run, action, details = {}) {
    run.events.push({ at: new Date().toISOString(), action, ...details });
    save(run);
}

function current(root) {
    const run = readRun(root);
    requireValue(run.root === root, 'Use the original coordinator worktree');
    const project = loadProject(root);
    requireValue(JSON.stringify(project.inputs) === JSON.stringify(run.inputs), 'Approved config or planning inputs changed; cancel and replan');
    requireValue(git(root, ['branch', '--show-current']) === run.target_branch && git(root, ['rev-parse', 'HEAD']) === run.base_sha, 'Target branch moved; cancel and replan without overwriting it');
    clean(root);
    if (run.integration) {
        requireValue(git(run.integration, ['rev-parse', 'HEAD']) === run.integration_sha, 'Integration history moved outside the coordinator; inspect it before continuing');
    }
    return { run, ...project };
}

function budget(run, config) {
    requireValue(Date.now() - Date.parse(run.started_at) < config.max_minutes * 60000, 'Run time budget exhausted; checkpoint or cancel');
}

function reserveCommit(run, config) {
    budget(run, config);
    requireValue(run.commits < config.max_commits, 'Commit budget exhausted');
    run.commits += 1;
    save(run);
}

function clean(root) {
    requireValue(git(root, ['status', '--porcelain', '--untracked-files=all']) === '', 'Worktree is dirty; preserve changes and resolve before continuing');
}

function changed(root) {
    const tracked = git(root, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']).split('\0').filter(Boolean);
    const staged = git(root, ['diff', '--cached', '--name-only', '--no-renames', '-z']).split('\0').filter(Boolean);
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    return [...new Set([...tracked, ...staged, ...untracked])];
}

function scopeCheck(root, scope) {
    const files = changed(root);
    for (const file of files) {
        requireValue(allowed(file, scope.allowed_paths), `Change outside assigned ownership: ${file}`);
        noLinks(path.join(root, file));
    }
    return files;
}

function fingerprint(root) {
    const content = [
        git(root, ['rev-parse', 'HEAD']),
        git(root, ['diff', '--binary', '--no-ext-diff', 'HEAD']),
        git(root, ['diff', '--cached', '--binary', '--no-ext-diff'])
    ];
    for (const file of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
        noLinks(path.join(root, file));
        content.push(file, hash(fs.readFileSync(path.join(root, file))));
    }
    return hash(JSON.stringify(content));
}

function checks(root, run, config) {
    requireValue(config.verification.length && config.verification.some(check => check.kind === 'test'), 'Configure at least one real test command');
    const before = fingerprint(root);
    const receipts = [];
    for (const check of config.verification) {
        budget(run, config);
        const remaining = config.max_minutes * 60000 - (Date.now() - Date.parse(run.started_at));
        const environment = { ...process.env };
        // A nested Node test runner otherwise skips execution with a successful exit.
        delete environment.NODE_TEST_CONTEXT;
        const result = spawnSync(check.command, check.args, {
            cwd: root, encoding: 'utf8', shell: false, windowsHide: true,
            env: environment,
            timeout: Math.max(1, Math.min(remaining, check.timeout_seconds * 1000)), maxBuffer: 1024 * 1024
        });
        receipts.push({ name: check.name, kind: check.kind, passed: !result.error && result.status === 0, exit_code: result.status });
        requireValue(!result.error && result.status === 0, `Verification failed: ${check.name} (${result.error?.code || `exit ${result.status}`}); run the configured check in the recorded worktree for details`);
    }
    requireValue(fingerprint(root) === before, 'Verification changed source files; receipts are invalid');
    return { sha: git(root, ['rev-parse', 'HEAD']), fingerprint: before, checks: receipts, at: new Date().toISOString() };
}

function commit(root, message) {
    git(root, ['commit', '--quiet', '--allow-empty', '-m', commitMessage(message)]);
    return git(root, ['rev-parse', 'HEAD']);
}

function commitMessage(subject) {
    return `${subject}\n\n\u{1f91d} - Generated by Copilot\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`;
}

function addWorktree(run, name, reference, branch) {
    const destination = path.join(run.worktree_directory, name);
    noLinks(destination);
    requireValue(absent(destination), 'Worktree destination already exists');
    const args = ['worktree', 'add', '--quiet'];
    if (branch) args.push('-b', branch);
    else args.push('--detach');
    run.worktrees.push(destination);
    save(run);
    git(run.root, [...args, destination, reference]);
    return destination;
}

function writeAssignment(run, worktree, role, id, agentId, attempt) {
    atomicJson(assignmentPath(worktree), {
        version: 1, run_id: run.id, role, story_id: id, agent_id: agentId, attempt,
        worktree, coordinator: run.root
    });
}

function begin(root, featureId, approve = false) {
    return startGuard(root, () => coordinator(root, (cwd, loc) => {
        requireValue(approve, 'begin requires --approve');
        requireValue(absent(loc.active), 'A run already exists; resume, finish, or cancel it first');
        requireValue(absent(path.join(loc.common, 'solution-harness', 'cloud-parallel', 'active.json')), 'A cloud parallel run is active; pause and finish it before starting local parallel work');
        clean(cwd);
        const project = loadProject(cwd);
        const { config, model } = project;
        requireValue(config.mode === 'parallel-stories', 'Parallel execution is opt-in; sequential mode is unchanged');
        requireValue(config.workspace_isolation_confirmed === true, 'Confirm workers will use separately opened workspaces, not a shared edit-tool root');
        requireValue(config.instructions_migration_confirmed === true, 'Review and migrate project instructions for assigned-story workers before opting in');
        requireValue(config.feature_ids.includes(featureId) && config.approved_designs.includes(featureId), 'Feature scope and design must be explicitly approved');
        const feature = model.features.get(featureId);
        requireValue(feature && ['not-started', 'in-progress', 'needs-rework'].includes(feature.status), 'Feature is not eligible');
        const todo = feature.stories.filter(id => model.stories.get(id).status !== 'done');
        requireValue(todo.length, 'Feature has no pending stories');
        for (const id of todo) requireValue(config.ownership[id], `Declare ownership and resources for ${id}`);
        requireValue(readyStories(model, featureId).length, 'No story is ready; feature, story, or architecture prerequisites are unmet');
        const id = `run-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
        const base = git(cwd, ['rev-parse', 'HEAD']);
        const branch = git(cwd, ['branch', '--show-current']);
        requireValue(branch, 'Coordinator must be on a named branch');
        const run = {
            version: 1, id, root: cwd, feature_id: featureId, status: 'starting',
            started_at: new Date().toISOString(), inputs: project.inputs,
            base_sha: base, target_branch: branch, integration_branch: `harness-${id}-integration`, integration_sha: base,
            worktree_directory: path.join(path.dirname(cwd), `.harness-worktrees-${path.basename(cwd)}`, id),
            worktrees: [], jobs: {}, builders: [], candidate: null, commits: 0, events: []
        };
        save(run);
        atomicJson(loc.active, { run_id: id });
        try {
            run.baseline = checks(cwd, run, config);
            run.integration = addWorktree(run, 'integration', base, run.integration_branch);
            run.status = 'active';
            event(run, 'began', { feature_id: featureId, base_sha: base });
        } catch (error) {
            run.status = 'blocked';
            event(run, 'begin-blocked', { reason: error.message });
            throw error;
        }
        return status(cwd);
    }));
}

function jobReady(run, config, model, storyId) {
    requireValue(run.status === 'active', 'Run is not active');
    budget(run, config);
    requireValue(run.commits < config.max_commits, 'Commit budget exhausted');
    const integrated = new Set(Object.values(run.jobs).filter(job => job.status === 'integrated').map(job => job.id));
    const busy = Object.values(run.jobs).filter(job => ACTIVE.has(job.status));
    requireValue(busy.length < config.max_workers, 'Worker capacity is full');
    requireValue(!run.jobs[storyId] || run.jobs[storyId].status === 'released', 'Story is already claimed, blocked, or integrated');
    requireValue(readyStories(model, run.feature_id, integrated).some(story => story.id === storyId), 'Story prerequisites are not integrated or accepted');
    const scope = config.ownership[storyId];
    requireValue(scope, 'Missing ownership contract');
    for (const job of busy) requireValue(!conflicts(scope, config.ownership[job.id]), `Ownership or resource conflict with ${job.id}`);
    return scope;
}

function claim(root, storyId, agentId) {
    return coordinator(root, cwd => {
        const { run, config, model } = current(cwd);
        requireValue(typeof agentId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(agentId), 'Provide a stable worker session label');
        requireValue(!Object.values(run.jobs).some(job => ACTIVE.has(job.status) && job.agent_id === agentId), 'Worker label already has an active assignment');
        const scope = jobReady(run, config, model, storyId);
        const attempt = (run.jobs[storyId]?.attempt || 0) + 1;
        requireValue(attempt <= config.max_attempts, 'Story attempt budget exhausted');
        clean(run.integration);
        requireValue(git(run.integration, ['branch', '--show-current']) === run.integration_branch, 'Integration branch changed');
        const base = git(run.integration, ['rev-parse', 'HEAD']);
        const job = {
            id: storyId, agent_id: agentId, attempt, status: 'creating',
            branch: `harness-${run.id}-${storyId.toLowerCase()}-${attempt}`,
            base_sha: base, scope, expires_at: new Date(Date.now() + config.lease_minutes * 60000).toISOString()
        };
        run.jobs[storyId] = job;
        if (!run.builders.includes(agentId)) run.builders.push(agentId);
        save(run);
        try {
            job.worktree = addWorktree(run, `${storyId}-${attempt}`, base, job.branch);
            writeAssignment(run, job.worktree, 'builder', storyId, agentId, attempt);
            job.status = 'running';
            event(run, 'claimed', { story_id: storyId, attempt, agent_id: agentId });
            return context(job.worktree);
        } catch (error) {
            job.status = 'blocked';
            event(run, 'claim-blocked', { story_id: storyId, reason: error.message });
            throw error;
        }
    });
}

function assigned(root) {
    root = repository(root);
    const marker = readAssignment(root);
    requireValue(marker && marker.worktree === root, 'This workspace has no matching harness assignment');
    const run = readRun(root, marker.run_id);
    requireValue(!['cancelled', 'complete'].includes(run.status), 'Assignment belongs to a closed run');
    const project = loadProject(run.root);
    requireValue(JSON.stringify(project.inputs) === JSON.stringify(run.inputs), 'Run inputs changed');
    if (marker.role === 'builder') {
        const job = run.jobs[marker.story_id];
        requireValue(job && job.attempt === marker.attempt && job.agent_id === marker.agent_id && job.worktree === root, 'Stale worker attempt');
        requireValue(job.status === 'running' && Date.parse(job.expires_at) > Date.now(), 'Worker lease is expired or no longer running');
        requireValue(git(root, ['branch', '--show-current']) === job.branch && git(root, ['rev-parse', 'HEAD']) === job.base_sha, 'Worker branch or base changed');
        return { run, marker, job, ...project };
    }
    const candidate = run.candidate;
    requireValue(candidate && candidate.worktree === root && candidate.evaluator_id === marker.agent_id, 'Stale evaluator assignment');
    requireValue(candidate.phase === 'review' && candidate.sha === git(root, ['rev-parse', 'HEAD']), 'Candidate changed or is not ready for review');
    return { run, marker, candidate, ...project };
}

function context(root) {
    const data = assigned(root);
    const { run, marker, model, config } = data;
    const story = marker.story_id ? model.stories.get(marker.story_id) : null;
    return {
        run_id: run.id, role: marker.role, agent_id: marker.agent_id, attempt: marker.attempt,
        feature_id: run.feature_id, story_id: marker.story_id, worktree: marker.worktree,
        candidate_sha: data.candidate?.sha || null, base_sha: data.job?.base_sha || data.candidate.base_sha,
        acceptance_criteria: story?.acceptance_criteria || model.features.get(run.feature_id).acceptance_criteria,
        ownership: data.job?.scope || { allowed_paths: [], resources: [] },
        verification: config.verification,
        report_path: path.join(git(root, ['rev-parse', '--absolute-git-dir']), marker.role === 'builder' ? 'builder-report.json' : 'review-report.json'),
        instructions: marker.role === 'builder'
            ? 'Edit only owned files in this worktree. Do not commit, merge, deploy, or update shared status. Run worker-report when finished.'
            : 'Review this exact candidate independently. Do not modify source or shared status. Submit an exact-criteria report with review-report.'
    };
}

function workerReport(root) {
    const { run, marker, job, config } = assigned(root);
    requireValue(marker.role === 'builder', 'Only a builder submits a worker report');
    scopeCheck(root, job.scope);
    const verification = checks(root, run, config);
    assigned(root);
    const report = { verdict: 'READY', story_id: job.id, attempt: job.attempt, agent_id: job.agent_id, fingerprint: fingerprint(root), verification };
    atomicJson(path.join(git(root, ['rev-parse', '--absolute-git-dir']), 'builder-report.json'), report);
    return { reported: job.id, source: report.fingerprint };
}

function workerBlock(root, reason) {
    const { marker, job } = assigned(root);
    requireValue(marker.role === 'builder', 'Only a builder submits a blocker');
    requireValue(['out-of-scope', 'tests-failing', 'design-question', 'environment'].includes(reason), 'Use a documented blocker reason, without secrets or raw tool output');
    atomicJson(path.join(git(root, ['rev-parse', '--absolute-git-dir']), 'builder-report.json'), {
        verdict: 'BLOCKED', story_id: job.id, attempt: job.attempt, agent_id: job.agent_id, reason
    });
    return { blocked: job.id, reason };
}

function capture(root, storyId) {
    return coordinator(root, cwd => {
        const { run, config } = current(cwd);
        requireValue(run.status === 'active', 'Run is not active');
        const job = run.jobs[storyId];
        requireValue(job?.status === 'running', 'Story is not running');
        assigned(job.worktree);
        const report = readJson(path.join(git(job.worktree, ['rev-parse', '--absolute-git-dir']), 'builder-report.json'));
        requireValue(report.verdict === 'READY' && report.agent_id === job.agent_id && report.attempt === job.attempt && report.fingerprint === fingerprint(job.worktree), 'Missing, blocked, or stale worker report');
        const files = scopeCheck(job.worktree, job.scope);
        checks(job.worktree, run, config);
        reserveCommit(run, config);
        job.status = 'capturing';
        save(run);
        if (files.length) git(job.worktree, ['add', '--', ...files]);
        job.sha = commit(job.worktree, `feat(${run.feature_id}): implement ${storyId}`);
        const committed = git(job.worktree, ['diff', '--name-only', '--no-renames', '-z', job.base_sha, job.sha]).split('\0').filter(Boolean);
        requireValue(committed.every(file => allowed(file, job.scope.allowed_paths)), 'Commit hooks changed files outside ownership; preserve this attempt and investigate');
        clean(job.worktree);
        job.status = 'built';
        job.verification = report.verification;
        event(run, 'captured', { story_id: storyId, sha: job.sha });
        return { story_id: storyId, sha: job.sha };
    });
}

function replaceStatuses(text, updates, evidence = new Map()) {
    const objects = [], stack = [];
    let quote = false, escaped = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quote = false;
        } else if (char === '"') quote = true;
        else if (char === '{') stack.push(i);
        else if (char === '}') {
            const start = stack.pop();
            const value = JSON.parse(text.slice(start, i + 1));
            if (updates.has(value.id)) objects.push({ start, end: i + 1, value });
        }
    }
    // Keep definitions and existing whitespace intact instead of reserializing the catalog.
    const replacements = [], statusIds = new Set(), evidenceIds = new Set();
    for (const object of objects) {
        let depth = 0;
        const fragment = text.slice(object.start, object.end);
        const token = /"(?:\\.|[^"\\])*"|[{}[\]]/g;
        for (const match of fragment.matchAll(token)) {
            if (match[0] === '{' || match[0] === '[') depth += 1;
            else if (match[0] === '}' || match[0] === ']') depth -= 1;
            else if (depth === 1) {
                const key = JSON.parse(match[0]);
                if (key !== 'status' && !(key === 'evidence' && evidence.has(object.value.id))) continue;
                const tail = fragment.slice(match.index + match[0].length);
                if (!/^\s*:/.test(tail)) continue;
                const value = /^(\s*:\s*)("(?:\\.|[^"\\])*"|null)/.exec(tail);
                requireValue(value, `Invalid ${key} field`);
                const start = object.start + match.index + match[0].length + value[1].length;
                replacements.push({ start, end: start + value[2].length, value: JSON.stringify((key === 'status' ? updates : evidence).get(object.value.id)) });
                (key === 'status' ? statusIds : evidenceIds).add(object.value.id);
            }
        }
        if (evidence.has(object.value.id) && !evidenceIds.has(object.value.id)) {
            const ending = /\s*\}$/.exec(fragment);
            const indentation = /\r?\n([ \t]*)"/.exec(fragment);
            const separator = indentation ? `,${fragment.includes('\r\n') ? '\r\n' : '\n'}${indentation[1]}` : ', ';
            const start = object.start + ending.index;
            replacements.push({ start, end: start, value: `${separator}"evidence": ${JSON.stringify(evidence.get(object.value.id))}` });
            evidenceIds.add(object.value.id);
        }
    }
    requireValue(statusIds.size === updates.size && evidenceIds.size === evidence.size, 'Status update did not identify every expected object');
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        text = text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end);
    }
    JSON.parse(text);
    return text;
}

function prepareReview(root, storyId, evaluatorId, approve = false) {
    return coordinator(root, cwd => {
        const { run, config, model } = current(cwd);
        requireValue(approve && run.status === 'active', 'Review preparation requires an active run and --approve');
        requireValue(!run.candidate, 'Integrate or abort the current candidate before preparing another');
        requireValue(typeof evaluatorId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(evaluatorId), 'Provide a stable evaluator session label');
        requireValue(!run.builders.includes(evaluatorId), 'Evaluator must be independent of all builders');
        const final = !storyId;
        const job = final ? null : run.jobs[storyId];
        if (final) {
            requireValue(model.features.get(run.feature_id).stories.every(id => model.stories.get(id).status === 'done' || run.jobs[id]?.status === 'integrated'), 'All stories must be integrated before feature evaluation');
        } else {
            requireValue(job?.status === 'built' && git(job.worktree, ['rev-parse', 'HEAD']) === job.sha, 'Built candidate is missing or changed');
            clean(job.worktree);
        }
        clean(run.integration);
        requireValue(git(run.integration, ['branch', '--show-current']) === run.integration_branch, 'Integration branch changed');
        const base = git(run.integration, ['rev-parse', 'HEAD']);
        const candidate = {
            story_id: storyId || null, evaluator_id: evaluatorId, base_sha: base, phase: 'preparing',
            attempt: job?.attempt || 1, kind: final ? 'feature' : 'story'
        };
        run.candidate = candidate;
        save(run);
        try {
            reserveCommit(run, config);
            candidate.worktree = addWorktree(run, `review-${storyId || 'feature'}-${crypto.randomBytes(3).toString('hex')}`, base);
            if (final) {
                const featuresFile = path.join(candidate.worktree, 'docs/FEATURES.json');
                fs.writeFileSync(featuresFile, replaceStatuses(fs.readFileSync(featuresFile, 'utf8'), new Map([[run.feature_id, 'complete']])));
                const backlogFile = path.join(candidate.worktree, 'docs/backlog/backlog.json');
                const updates = new Map(Object.values(run.jobs).map(item => [item.id, 'done']));
                const evidence = new Map(Object.values(run.jobs).map(item => [
                    item.id, `Run ${run.id}; integrated ${item.integrated_sha}; independent evaluator ${item.evaluation.evaluator_id}; PASS with configured verification.`
                ]));
                const sourceBacklog = readJson(backlogFile);
                if (sourceBacklog.epics) updates.set(run.feature_id, 'complete');
                fs.writeFileSync(backlogFile, replaceStatuses(fs.readFileSync(backlogFile, 'utf8'), updates, evidence));
                fs.appendFileSync(path.join(candidate.worktree, 'docs/PROGRESS.md'),
                    `\n## Parallel feature delivery - ${new Date().toISOString().slice(0, 10)}\n\n* Feature: ${run.feature_id}; run: ${run.id}.\n* Stories integrated: ${Object.keys(run.jobs).join(', ')}.\n* This completion commit requires independent feature review and passing verification before promotion.\n`);
                git(candidate.worktree, ['add', '--', 'docs/FEATURES.json', 'docs/backlog/backlog.json', 'docs/PROGRESS.md']);
                candidate.sha = commit(candidate.worktree, `feat(${run.feature_id}): record verified story delivery`);
            } else {
                git(candidate.worktree, ['merge', '--no-ff', '--no-edit', '-m', commitMessage(`feat(${run.feature_id}): integrate ${storyId}`), job.sha]);
                candidate.sha = git(candidate.worktree, ['rev-parse', 'HEAD']);
            }
            candidate.verification = checks(candidate.worktree, run, config);
            candidate.phase = 'review';
            save(run);
            writeAssignment(run, candidate.worktree, 'evaluator', storyId || null, evaluatorId, candidate.attempt);
            event(run, 'review-prepared', { story_id: storyId || null, sha: candidate.sha });
            return context(candidate.worktree);
        } catch (error) {
            candidate.phase = 'blocked';
            event(run, 'candidate-blocked', { reason: error.message });
            throw error;
        }
    });
}

function validateReview(report, run, candidate, criteria) {
    requireValue(report?.run_id === run.id && report.feature_id === run.feature_id && report.story_id === candidate.story_id, 'Review identifies the wrong work item');
    requireValue(report.candidate_sha === candidate.sha && report.evaluator_id === candidate.evaluator_id, 'Review SHA or evaluator does not match');
    requireValue(['PASS', 'FAIL'].includes(report.verdict) && Array.isArray(report.criteria) && Array.isArray(report.issues), 'Invalid review verdict shape');
    requireValue(report.criteria.length === criteria.length, 'Review must cover every acceptance criterion');
    const indexed = new Map(report.criteria.map(item => [item.criterion, item]));
    requireValue(indexed.size === criteria.length, 'Duplicate criterion evidence');
    for (const criterion of criteria) {
        const item = indexed.get(criterion);
        requireValue(item && typeof item.passed === 'boolean' && typeof item.evidence === 'string' && item.evidence.trim() && item.evidence.length <= 4000, 'Missing exact-criterion evidence');
    }
    if (report.verdict === 'PASS') requireValue(report.criteria.every(item => item.passed) && report.issues.length === 0, 'A PASS cannot contain failures or unresolved issues');
}

function reviewReport(root, report) {
    const { run, marker, candidate, model } = assigned(root);
    requireValue(marker.role === 'evaluator', 'Only the assigned evaluator reports a verdict');
    clean(root);
    const criteria = candidate.story_id ? model.stories.get(candidate.story_id).acceptance_criteria : model.features.get(run.feature_id).acceptance_criteria;
    validateReview(report, run, candidate, criteria);
    atomicJson(path.join(git(root, ['rev-parse', '--absolute-git-dir']), 'review-report.json'), report);
    return { recorded: report.verdict, candidate_sha: candidate.sha };
}

function finalizePromotion(run) {
    const candidate = run.candidate;
    run.integration_sha = candidate.sha;
    if (candidate.kind === 'feature') {
        requireValue(git(run.root, ['rev-parse', 'HEAD']) === candidate.sha, 'Target branch has not reached the verified completion commit');
        requireValue(git(run.root, ['branch', '--show-current']) === run.target_branch, 'Target branch changed during promotion');
        run.status = 'complete';
        run.released_sha = candidate.sha;
        run.feature_evaluation = candidate.review;
        run.final_verification = candidate.verification;
    } else {
        const job = run.jobs[candidate.story_id];
        job.status = 'integrated';
        job.integrated_sha = candidate.sha;
        job.evaluation = candidate.review;
        job.integration_verification = candidate.verification;
    }
    run.candidate = null;
    event(run, 'promoted', { story_id: candidate.story_id, sha: candidate.sha });
    if (run.status === 'complete') fs.unlinkSync(locations(run.root).active);
}

function accept(root, approve = false) {
    return coordinator(root, cwd => {
        const { run, config, model } = current(cwd);
        const candidate = run.candidate;
        requireValue(approve && run.status === 'active' && candidate?.phase === 'review', 'Acceptance requires a review candidate and --approve');
        requireValue(git(candidate.worktree, ['rev-parse', 'HEAD']) === candidate.sha, 'Evaluated candidate changed');
        clean(candidate.worktree);
        clean(run.integration);
        requireValue(git(run.integration, ['branch', '--show-current']) === run.integration_branch, 'Integration branch changed');
        requireValue(git(run.integration, ['rev-parse', 'HEAD']) === candidate.base_sha, 'Integration base moved; prepare a new candidate and review');
        const report = readJson(path.join(git(candidate.worktree, ['rev-parse', '--absolute-git-dir']), 'review-report.json'));
        validateReview(report, run, candidate, candidate.story_id ? model.stories.get(candidate.story_id).acceptance_criteria : model.features.get(run.feature_id).acceptance_criteria);
        requireValue(report.verdict === 'PASS', 'Evaluator rejected this candidate; preserve it and rework');
        candidate.verification = checks(candidate.worktree, run, config);
        candidate.review = report;
        if (candidate.kind === 'feature') {
            clean(cwd);
            requireValue(git(cwd, ['branch', '--show-current']) === run.target_branch && git(cwd, ['rev-parse', 'HEAD']) === run.base_sha, 'Target branch moved; do not overwrite it');
        }
        candidate.phase = 'promoting';
        save(run);
        git(run.integration, ['merge', '--ff-only', candidate.sha]);
        if (candidate.kind === 'feature') git(cwd, ['merge', '--ff-only', candidate.sha]);
        finalizePromotion(run);
        return { accepted: candidate.story_id || run.feature_id, sha: candidate.sha, feature_complete: run.status === 'complete' };
    });
}

function recover(root, approve = false) {
    return coordinator(root, cwd => {
        requireValue(approve, 'Recovery requires --approve');
        const run = readRun(cwd);
        requireValue(run.root === cwd, 'Use the coordinator root');
        if (run.status === 'complete') {
            clean(cwd);
            requireValue(git(cwd, ['rev-parse', 'HEAD']) === run.released_sha, 'Completed target history changed unexpectedly');
            fs.unlinkSync(locations(cwd).active);
            return { recovered: true, status: run.status };
        }
        const candidate = run.candidate;
        requireValue(candidate?.phase === 'promoting' && candidate.review?.verdict === 'PASS', 'No interrupted promotion to recover');
        clean(run.integration);
        requireValue(git(run.integration, ['branch', '--show-current']) === run.integration_branch, 'Integration branch changed');
        const head = git(run.integration, ['rev-parse', 'HEAD']);
        requireValue(head === candidate.sha || head === candidate.base_sha, 'Integration history changed unexpectedly');
        if (candidate.kind === 'feature' && git(cwd, ['rev-parse', 'HEAD']) === candidate.sha) {
            clean(cwd);
            requireValue(head === candidate.sha, 'Integration and target history disagree');
            finalizePromotion(run);
        } else if (head === candidate.sha && candidate.kind === 'story') finalizePromotion(run);
        else {
            if (head === candidate.sha) {
                clean(cwd);
                requireValue(git(cwd, ['branch', '--show-current']) === run.target_branch && git(cwd, ['rev-parse', 'HEAD']) === run.base_sha, 'Target history changed unexpectedly');
                git(cwd, ['merge', '--ff-only', candidate.sha]);
                finalizePromotion(run);
            } else {
                candidate.phase = 'review';
                event(run, 'promotion-not-applied');
            }
        }
        return { recovered: true, status: run.status };
    });
}

function abortCandidate(root, approve = false) {
    return coordinator(root, cwd => {
        const { run } = current(cwd);
        requireValue(approve && run.candidate && run.candidate.phase !== 'promoting', 'No abortable candidate or missing --approve');
        const candidate = run.candidate;
        if (candidate.worktree) {
            const merging = git(candidate.worktree, ['rev-parse', '--verify', 'MERGE_HEAD'], true);
            if (merging.status === 0) git(candidate.worktree, ['merge', '--abort']);
        }
        run.candidate = null;
        event(run, 'candidate-aborted', { story_id: candidate.story_id });
        return { preserved_worktree: candidate.worktree || null };
    });
}

function release(root, storyId, approve = false) {
    return coordinator(root, cwd => {
        const { run } = current(cwd);
        const job = run.jobs[storyId];
        requireValue(approve, 'Close the worker session first, then pass --approve to attest it stopped');
        requireValue(job && job.status !== 'integrated' && run.candidate?.story_id !== storyId, 'Story cannot be released in this state');
        job.status = 'released';
        event(run, 'worker-released', { story_id: storyId, attempt: job.attempt });
        return { preserved_worktree: job.worktree || null };
    });
}

function heartbeat(root, storyId) {
    return coordinator(root, cwd => {
        const { run, config } = current(cwd);
        budget(run, config);
        const job = run.jobs[storyId];
        requireValue(run.status === 'active' && job?.status === 'running' && Date.parse(job.expires_at) > Date.now(), 'Expired or inactive leases cannot be revived');
        job.expires_at = new Date(Date.now() + config.lease_minutes * 60000).toISOString();
        event(run, 'heartbeat', { story_id: storyId });
        return { expires_at: job.expires_at };
    });
}

function checkpoint(root, action, approve = false) {
    return coordinator(root, cwd => {
        const run = readRun(cwd);
        requireValue(run.root === cwd, 'Use the coordinator root');
        requireValue(!run.candidate || run.candidate.phase !== 'promoting', 'Recover the promotion before checkpointing');
        if (action === 'resume') {
            const { config } = current(cwd);
            budget(run, config);
            requireValue(run.status === 'paused', 'Only a paused run can resume');
            run.status = 'active';
        } else if (action === 'cancel') {
            requireValue(approve, 'Stop worker sessions first; cancel requires --approve');
            run.status = 'cancelled';
        } else {
            requireValue(action === 'pause' && run.status === 'active', 'Only an active run can pause');
            run.status = 'paused';
        }
        event(run, action);
        if (action === 'cancel') fs.unlinkSync(locations(cwd).active);
        return { status: run.status, run_id: run.id };
    });
}

function recoverLock(root, approve = false) {
    root = repository(root);
    requireValue(approve && !readAssignment(root), 'Lock recovery requires coordinator approval');
    const loc = locations(root), ownerFile = path.join(loc.lock, 'owner.json');
    noLinks(ownerFile);
    const owner = readJson(ownerFile);
    requireValue(Number.isInteger(owner.pid) && owner.pid > 0, 'Invalid lock owner; investigate manually');
    try { process.kill(owner.pid, 0); throw new Error('Lock owner is still running'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(ownerFile);
    fs.rmdirSync(loc.lock);
    return { recovered: true };
}

function cleanup(root, id, approve = false) {
    return coordinator(root, cwd => {
        const run = readRun(cwd, id);
        requireValue(approve && run.root === cwd && ['complete', 'cancelled'].includes(run.status), 'Only approved closed runs can be cleaned');
        for (const worktree of run.worktrees) {
            if (absent(worktree)) continue;
            noLinks(worktree);
            requireValue(path.dirname(worktree) === run.worktree_directory && locations(worktree).common === locations(cwd).common, 'Refuse cleanup outside the recorded run');
            clean(worktree);
            requireValue(!git(worktree, ['ls-files', '--others', '--ignored', '--exclude-standard']), 'Ignored files remain; review/remove them explicitly before cleanup');
            git(cwd, ['worktree', 'remove', worktree]);
        }
        event(run, 'cleaned');
        return { cleaned: id, branches_preserved: true };
    });
}

function status(root, id) {
    root = repository(root);
    const run = readRun(root, id);
    const project = loadProject(run.root);
    const stale = run.status !== 'complete' && JSON.stringify(project.inputs) !== JSON.stringify(run.inputs);
    const integrated = new Set(Object.values(run.jobs).filter(job => job.status === 'integrated').map(job => job.id));
    const unavailable = new Set(Object.values(run.jobs).filter(job => job.status !== 'released').map(job => job.id));
    return {
        run_id: run.id, feature_id: run.feature_id, status: run.status, stale_inputs: stale,
        commits: run.commits, started_at: run.started_at,
        integration: run.integration || null,
        worktrees: run.worktrees,
        ready: stale || run.status !== 'active' ? [] : readyStories(project.model, run.feature_id, integrated, unavailable)
            .filter(story => Object.values(run.jobs).filter(job => ACTIVE.has(job.status)).length < project.config.max_workers
                && !Object.values(run.jobs).filter(job => ACTIVE.has(job.status)).some(job => conflicts(project.config.ownership[story.id], job.scope)))
            .map(story => story.id),
        workers: Object.values(run.jobs).map(job => ({
            story_id: job.id, agent_id: job.agent_id, status: job.status, attempt: job.attempt,
            expired: job.status === 'running' && Date.parse(job.expires_at) <= Date.now(),
            worktree: job.worktree || null, branch: job.branch
        })),
        candidate: run.candidate ? { story_id: run.candidate.story_id, sha: run.candidate.sha || null, phase: run.candidate.phase, worktree: run.candidate.worktree || null } : null,
        released_sha: run.released_sha || null
    };
}

function main(argv) {
    requireValue(Number(process.versions.node.split('.')[0]) >= 22 && typeof path.posix.matchesGlob === 'function', 'Node.js 22.20+ or 24+ is required');
    const command = argv.shift(), options = {};
    for (let i = 0; i < argv.length; i++) {
        requireValue(argv[i].startsWith('--'), 'Expected named arguments');
        const key = argv[i].slice(2);
        requireValue(['root', 'feature', 'story', 'agent', 'run', 'reason', 'approve'].includes(key) && options[key] === undefined, 'Unknown or duplicate argument');
        options[key] = key === 'approve' ? true : argv[++i];
        requireValue(options[key] !== undefined, 'Missing argument value');
    }
    const root = path.resolve(options.root || process.cwd());
    const workerCommands = new Set(['context', 'worker-report', 'worker-block', 'review-report', 'status', 'plan']);
    if (!workerCommands.has(command)) {
        const probe = git(process.cwd(), ['rev-parse', '--show-toplevel'], true);
        if (probe.status === 0) requireValue(!readAssignment(probe.stdout.trim()), 'Worker/evaluator workspaces cannot run coordinator commands, including with --root');
    }
    const operations = {
        plan: () => plan(loadProject(root), options.feature),
        begin: () => begin(root, options.feature, options.approve),
        claim: () => claim(root, options.story, options.agent),
        context: () => context(root),
        'worker-report': () => workerReport(root),
        'worker-block': () => workerBlock(root, options.reason),
        capture: () => capture(root, options.story),
        'prepare-review': () => {
            requireValue(options.story, 'prepare-review requires --story; use prepare-final for full-feature review');
            return prepareReview(root, options.story, options.agent, options.approve);
        },
        'prepare-final': () => prepareReview(root, null, options.agent, options.approve),
        'review-report': () => reviewReport(root, JSON.parse(fs.readFileSync(0, 'utf8'))),
        accept: () => accept(root, options.approve),
        recover: () => recover(root, options.approve),
        'abort-candidate': () => abortCandidate(root, options.approve),
        release: () => release(root, options.story, options.approve),
        heartbeat: () => heartbeat(root, options.story),
        pause: () => checkpoint(root, 'pause'),
        resume: () => checkpoint(root, 'resume'),
        cancel: () => checkpoint(root, 'cancel', options.approve),
        cleanup: () => cleanup(root, options.run, options.approve),
        'recover-lock': () => recoverLock(root, options.approve),
        'recover-start': () => recoverStartGuard(root, options.approve),
        status: () => status(root, options.run)
    };
    requireValue(Object.hasOwn(operations, command), 'Unknown command; use plan, begin, claim, context, capture, prepare-review, accept, prepare-final, status, pause, resume, recover, cancel, or cleanup');
    return operations[command]();
}

if (require.main === module) {
    try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + '\n'); }
    catch (error) { process.stderr.write(`Harness parallel: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = {
    begin, claim, context, assigned, workerReport, workerBlock, capture, prepareReview, reviewReport, accept,
    recover, abortCandidate, release, heartbeat, checkpoint, recoverLock, cleanup, status,
    locations, readRun, readAssignment, assignmentPath, git, fingerprint, replaceStatuses, noLinks, validateReview,
    repository, atomicJson, absent, clean, checks, main, startGuard, recoverStartGuard, changed, scopeCheck, commitMessage
};
