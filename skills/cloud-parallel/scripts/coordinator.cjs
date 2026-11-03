'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const model = require('../../../parallel/model.cjs');
const shared = require('../../../parallel/runtime.cjs');
const { frontendGuidance } = require('../../frontend-design/guidance.cjs');
const { requireValue, readJson, hash, noLinks } = model;
const { git, repository, atomicJson, absent, clean, checks, validateReview, replaceStatuses, startGuard } = shared;

const MARKER = 'Solution Harness cloud story assignment v1';
const SESSION = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40,64}$/i;
const CLOUD_ACTIVE = new Set(['creating', 'running', 'waiting', 'awaiting-reference', 'uncertain']);

function github(root, args, input) {
    const result = spawnSync('gh', args, {
        cwd: root, input, encoding: 'utf8', shell: false, windowsHide: true,
        timeout: 120000, maxBuffer: 4 * 1024 * 1024
    });
    if (result.error || result.status !== 0) {
        throw new Error(`GitHub CLI ${args[0]} failed (${result.error?.code || `exit ${result.status}`}); inspect GitHub before retrying`);
    }
    return result.stdout.trim();
}

function parseConfig(root, filename) {
    const config = readJson(filename);
    requireValue(config?.version === 1, 'Cloud parallel config version must be 1');
    requireValue(typeof config.repository === 'string' && /^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(config.repository), 'repository must be a GitHub OWNER/REPO');
    requireValue(typeof config.base_branch === 'string' && config.base_branch && !config.base_branch.startsWith('-')
        && git(root, ['check-ref-format', '--branch', config.base_branch], true).status === 0, 'Invalid base branch');
    model.strings(config.feature_ids, 'Approved features', { empty: false });
    model.strings(config.approved_designs, 'Approved designs');
    requireValue(config.feature_ids.every(id => config.approved_designs.includes(id)), 'Every selected feature needs design approval');
    requireValue(config.instructions_reviewed === true, 'Review project instructions for cloud story assignments');
    requireValue(config.branch_protection_confirmed === true, 'Confirm branch protections or a merge queue prevent stale-base merges');
    requireValue(Number.isInteger(config.max_workers) && config.max_workers >= 1 && config.max_workers <= 3, 'max_workers must be 1-3');
    requireValue(Number.isInteger(config.max_minutes) && config.max_minutes >= 1 && config.max_minutes <= 1440, 'max_minutes must be 1-1440');
    requireValue(Number.isInteger(config.max_attempts) && config.max_attempts >= 1 && config.max_attempts <= 5, 'max_attempts must be 1-5');
    requireValue(typeof config.require_ci === 'boolean', 'Explicitly set require_ci');
    requireValue(['merge', 'squash', 'queue'].includes(config.merge_method), 'merge_method must be merge, squash, or queue');
    model.validateVerification(config.verification);
    requireValue(config.verification.some(check => check.kind === 'test'), 'Configure at least one real test command');
    model.validateOwnership(config.ownership);
    if (config.story_ids !== undefined) model.strings(config.story_ids, 'Approved stories', { empty: false });
    if (config.execution_mode !== undefined) requireValue(config.execution_mode === 'hybrid-stories', 'Unsupported execution mode');
    return config;
}

function load(root, configPath) {
    const config = parseConfig(root, configPath);
    const features = readJson(path.join(root, 'docs', 'FEATURES.json'));
    const backlog = readJson(path.join(root, 'docs', 'backlog', 'backlog.json'));
    const progressFile = path.join(root, 'docs', 'PROGRESS.md');
    noLinks(progressFile);
    const progress = fs.readFileSync(progressFile);
    const planFile = path.join(root, 'docs', 'PLAN.md');
    const architectureFile = path.join(root, 'docs', 'ARCHITECTURE.md');
    noLinks(planFile);
    noLinks(architectureFile);
    const plan = fs.readFileSync(planFile), architecture = fs.readFileSync(architectureFile);
    const project = model.parseModel(features, backlog);
    const designs = {};
    for (const id of config.feature_ids) {
        const feature = project.features.get(id);
        requireValue(feature && ['not-started', 'in-progress', 'needs-rework'].includes(feature.status) && feature.stories.length, `Feature ${id} is not eligible or has no stories`);
        if (feature.design_doc != null) {
            const design = path.join(root, ...model.relativePath(feature.design_doc).split('/'));
            noLinks(design);
            requireValue(fs.statSync(design).isFile(), `Design document for ${id} must be a file`);
            designs[id] = hash(fs.readFileSync(design));
        }
        for (const story of feature.stories.filter(story => !config.story_ids || config.story_ids.includes(story))) {
            if (project.stories.get(story).status !== 'done') requireValue(config.ownership[story], `Missing ownership for ${story}`);
        }
    }
    for (const id of config.approved_designs) requireValue(project.features.has(id), `Unknown approved design ${id}`);
    for (const id of Object.keys(config.ownership)) requireValue(project.stories.has(id), `Unknown ownership story ${id}`);
    for (const id of config.story_ids || []) {
        requireValue(project.stories.has(id) && config.feature_ids.includes(project.stories.get(id).feature_id), `Unknown or out-of-scope story ${id}`);
    }
    return {
        config, model: project, features, backlog,
        inputs: { config: hash(JSON.stringify(config)), features: hash(JSON.stringify(features)), backlog: hash(JSON.stringify(backlog)), progress: hash(progress), plan: hash(plan), architecture: hash(architecture), designs }
    };
}

function locations(root) {
    const common = fs.realpathSync(path.resolve(root, git(root, ['rev-parse', '--git-common-dir'])));
    const directory = path.join(common, 'solution-harness', 'cloud-parallel');
    return { common, directory, active: path.join(directory, 'active.json'), lock: path.join(directory, 'coordinator.lock') };
}

function locked(root, action) {
    root = repository(root);
    const loc = locations(root);
    noLinks(loc.directory);
    fs.mkdirSync(loc.directory, { recursive: true });
    try { fs.mkdirSync(loc.lock); }
    catch (error) {
        if (error.code === 'EEXIST') throw new Error('Cloud coordinator lock is held; recover only after its owner has stopped');
        throw error;
    }
    const owner = path.join(loc.lock, 'owner.json');
    try {
        atomicJson(owner, { pid: process.pid, at: new Date().toISOString() });
        return action(root, loc);
    } finally {
        if (!absent(owner)) fs.unlinkSync(owner);
        fs.rmdirSync(loc.lock);
    }
}

function save(loc, run) {
    atomicJson(path.join(loc.directory, 'runs', `${run.id}.json`), run);
}

function active(loc) {
    requireValue(!absent(loc.active), 'No active cloud parallel run');
    const reference = readJson(loc.active);
    requireValue(typeof reference.id === 'string' && SESSION.test(reference.id), 'Invalid cloud run reference');
    const run = readJson(path.join(loc.directory, 'runs', `${reference.id}.json`));
    requireValue(run.version === 1 && run.id === reference.id, 'Invalid cloud run state');
    return run;
}

function current(root, loc) {
    const run = active(loc);
    requireValue(run.root === root, 'Use the original coordinator worktree');
    const project = load(root, run.config_path);
    requireValue(JSON.stringify(project.inputs) === JSON.stringify(run.inputs), 'Approved configuration or planning inputs changed; stop and replan');
    for (const [id, value] of Object.entries(run.features)) {
        if (value.status === 'verified') project.model.features.get(id).status = 'complete';
    }
    return { run, ...project };
}

function budget(run, config) {
    requireValue(Date.now() - Date.parse(run.started_at) < config.max_minutes * 60000, 'Cloud parallel run budget exhausted');
}

function baseSha(root, config, gh) {
    const value = gh(root, ['api', `repos/${config.repository}/commits/${encodeURIComponent(config.base_branch)}`, '--jq', '.sha']);
    requireValue(SHA.test(value), 'GitHub returned an invalid base SHA');
    return value;
}

function checkInstalledCloud(root) {
    const hook = path.join(root, '.github', 'hooks', 'solution-harness.json');
    if (absent(hook)) return;
    const config = readJson(path.join(root, '.github', 'harness', 'config.json'));
    const runtimePath = path.join(root, '.github', 'harness', 'runtime.cjs');
    const instructionsPath = path.join(root, '.github', 'instructions', 'solution-harness-cloud.instructions.md');
    noLinks(hook);
    noLinks(runtimePath);
    noLinks(instructionsPath);
    const runtime = fs.readFileSync(runtimePath, 'utf8');
    const instructions = fs.readFileSync(instructionsPath, 'utf8');
    requireValue(config.cloud_parallel_enabled === true && runtime.includes(MARKER) && instructions.includes(MARKER),
        'Migrate the installed cloud runtime and instructions, enable cloud_parallel_enabled, and merge them before dispatch');
}

function begin(root, configPath, approve, gh = github, source = null) {
    return startGuard(root, () => locked(root, (cwd, loc) => {
        requireValue(approve, 'begin requires --approve');
        requireValue(absent(loc.active), 'A cloud parallel run already exists');
        requireValue(absent(path.join(loc.common, 'solution-harness', 'parallel', 'active.json')), 'A local parallel run is active; finish it before starting cloud work');
        clean(cwd);
        requireValue(typeof configPath === 'string' && configPath, 'Provide --config');
        configPath = path.resolve(cwd, configPath);
        const project = load(cwd, configPath);
        const { config } = project;
        requireValue((config.execution_mode === 'hybrid-stories') === Boolean(source), 'Use the Jira hybrid runtime to begin a hybrid run');
        if (source) require('../../../hybrid/plan.cjs').assertExecutable(project, source, config);
        requireValue(git(cwd, ['branch', '--show-current']) === config.base_branch, 'Coordinator must be on the configured base branch');
        checkInstalledCloud(cwd);
        const version = gh(cwd, ['--version']);
        const match = /^gh version (\d+)\.(\d+)\./.exec(version);
        requireValue(match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 80)), 'GitHub CLI 2.80+ is required');
        requireValue(gh(cwd, ['agent-task', 'view', '--help']).includes('--json'), 'GitHub CLI agent-task view must support --json');
        requireValue(gh(cwd, ['pr', 'merge', '--help']).includes('--match-head-commit'), 'GitHub CLI must support guarded PR merges');
        const base = baseSha(cwd, config, gh);
        requireValue(git(cwd, ['rev-parse', 'HEAD']) === base, 'Local base branch is not at the current GitHub base SHA');
        const run = {
            version: 1, id: crypto.randomUUID(), root: cwd, config_path: configPath,
            inputs: project.inputs, status: 'starting', started_at: new Date().toISOString(),
            base_sha: base, repository: config.repository, features: {}, jobs: {}, candidate: null, paused: false
        };
        if (source) {
            run.mode = 'hybrid';
            run.source = source;
            run.builder_ids = [];
        }
        save(loc, run);
        atomicJson(loc.active, { id: run.id });
        try {
            run.baseline = checks(cwd, run, config);
            run.status = 'active';
            save(loc, run);
        } catch (error) {
            run.status = 'blocked';
            run.error = error.message;
            save(loc, run);
            throw error;
        }
        return { run_id: run.id, base_sha: base, baseline: run.baseline, feature_ids: config.feature_ids };
    }));
}

function ready(run, project, config) {
    const integrated = new Set(Object.values(run.jobs).filter(job => ['merged', 'verified'].includes(job.status)).map(job => job.id));
    const unavailable = new Set(Object.values(run.jobs).filter(job => job.status !== 'abandoned').map(job => job.id));
    const outstanding = Object.values(run.jobs).filter(job => !['merged', 'verified', 'abandoned'].includes(job.status));
    return config.feature_ids.map(id => project.features.get(id))
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
        .flatMap(feature => model.readyStories(project, feature.id, integrated, unavailable))
        .filter(story => (!config.story_ids || config.story_ids.includes(story.id))
            && config.ownership[story.id] && !outstanding.some(job => model.conflicts(config.ownership[story.id], job.scope)))
        .sort((a, b) => config.story_ids ? config.story_ids.indexOf(a.id) - config.story_ids.indexOf(b.id) : 0);
}

function prompt(run, feature, story, scope) {
    return [MARKER, `Run: ${run.id}`, `Feature: ${feature.id} - ${feature.name || feature.id}`,
        `Story: ${story.id} - ${story.title}`, `Acceptance criteria: ${JSON.stringify(story.acceptance_criteria)}`,
        `Allowed paths: ${JSON.stringify(scope.allowed_paths)}`, `Shared resources: ${JSON.stringify(scope.resources)}`,
        run.source ? `Approved Jira source: ${run.source.issues.find(issue => issue.source_id === story.id)?.url}; revision ${run.source.digest}` : '',
        feature.design_doc ? `Read the approved design document: ${feature.design_doc}` : '',
        'Read docs/PLAN.md, docs/ARCHITECTURE.md, and applicable repository instructions.',
        'Implement only this story and its allowed paths. Add meaningful tests and run relevant checks.',
        'Do not edit shared feature, backlog, progress, evaluation, instructions, hook, or harness files.',
        'Do not approve or merge the PR. Report actual checks and blockers; the local coordinator reviews and integrates it.',
        frontendGuidance()
    ].filter(Boolean).join('\n') + '\n';
}

function prUrl(value, repo) {
    let url;
    try { url = new URL(value); } catch (error) { throw new Error('GitHub returned an invalid PR URL', { cause: error }); }
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/agent-sessions\/([^/]+))?\/?$/.exec(url.pathname);
    requireValue(url.protocol === 'https:' && url.hostname === 'github.com' && match
        && `${match[1]}/${match[2]}`.toLowerCase() === repo.toLowerCase(), 'GitHub returned a PR from a different repository');
    if (match[4]) requireValue(SESSION.test(match[4]), 'GitHub returned an invalid session ID');
    return { pr: Number(match[3]), session_id: match[4] || null };
}

function created(output, repo) {
    if (output.startsWith('https://')) {
        const result = prUrl(output, repo);
        return { ...result, status: result.session_id ? 'running' : 'awaiting-reference' };
    }
    const queued = /^job ([a-z0-9-]+) queued\. View progress: https:\/\/github\.com\/copilot\/agents\/?$/i.exec(output);
    requireValue(queued, 'Unrecognized task creation response; reconcile the remote task before retrying');
    return { job_id: queued[1], status: 'awaiting-reference' };
}

function dispatch(root, storyId, approve, gh = github, handlers = {}) {
    return locked(root, (cwd, loc) => {
        const { run, config, model: project } = current(cwd, loc);
        requireValue(approve && run.status === 'active' && !run.paused, 'dispatch requires an active run and --approve');
        clean(cwd);
        budget(run, config);
        requireValue(baseSha(cwd, config, gh) === run.base_sha, 'GitHub base changed outside this run; stop and replan');
        const started = [];
        while (Object.values(run.jobs).filter(job => CLOUD_ACTIVE.has(job.status)).length < config.max_workers) {
            budget(run, config);
            const options = ready(run, project, config);
            const story = storyId ? options.find(item => item.id === storyId) : options[0];
            if (!story) break;
            const attempt = (run.jobs[story.id]?.attempt || 0) + 1;
            requireValue(attempt <= config.max_attempts, `Attempt budget exhausted for ${story.id}`);
            const feature = project.features.get(story.feature_id);
            const job = { id: story.id, feature_id: story.feature_id, scope: config.ownership[story.id], attempt, status: 'creating' };
            if (run.mode === 'hybrid') job.backend = config.routes[story.id];
            run.jobs[story.id] = job;
            save(loc, run);
            try {
                if (job.backend && job.backend !== 'cloud') {
                    requireValue(typeof handlers[job.backend] === 'function', 'Use the hybrid runtime for local or verification dispatch');
                    Object.assign(job, handlers[job.backend](cwd, run, config, story, job));
                } else {
                    const output = gh(cwd, ['agent-task', 'create', '--repo', config.repository, '--base', config.base_branch, '--from-file', '-'], prompt(run, feature, story, job.scope));
                    Object.assign(job, created(output, config.repository));
                }
                save(loc, run);
                started.push({ story_id: story.id, status: job.status, pr: job.pr || null, session_id: job.session_id || null, job_id: job.job_id || null });
            } catch (error) {
                job.status = 'uncertain';
                job.error = error.message;
                save(loc, run);
                throw error;
            }
            if (storyId) break;
        }
        if (storyId) requireValue(started.length, 'Story is not ready, conflicts with outstanding work, or capacity is full');
        return { started, reason: started.length ? null : 'No ready nonconflicting stories or cloud capacity' };
    });
}

function session(root, config, job, gh) {
    requireValue(SESSION.test(job.session_id || ''), 'A verified session ID is required');
    const value = JSON.parse(gh(root, ['agent-task', 'view', job.session_id, '--repo', config.repository, '--json', 'id,state,repository,pullRequestNumber,pullRequestUrl']));
    requireValue(value.id === job.session_id, 'GitHub returned a different session');
    if (value.repository !== null) requireValue(typeof value.repository === 'string' && value.repository.toLowerCase() === config.repository.toLowerCase(), 'Session belongs to a different repository');
    if (value.pullRequestNumber != null || value.pullRequestUrl != null) {
        const reference = prUrl(value.pullRequestUrl, config.repository);
        requireValue(Number.isInteger(value.pullRequestNumber) && reference.pr === value.pullRequestNumber, 'Session PR identity is inconsistent');
        if (job.pr) requireValue(job.pr === reference.pr, 'Session points to a different PR');
        job.pr = reference.pr;
    }
    if (value.state === 'completed') {
        requireValue(job.pr && value.repository, 'Completed session has no verifiable PR');
        job.status = 'ready';
    } else if (['queued', 'in_progress'].includes(value.state)) {
        job.status = 'running';
    } else if (['idle', 'waiting_for_user'].includes(value.state)) {
        job.status = 'waiting';
    } else if (['failed', 'cancelled', 'timed_out'].includes(value.state)) {
        job.status = 'blocked';
        job.error = `Cloud session ${value.state}`;
    } else {
        throw new Error(`Unrecognized cloud session state: ${value.state}`);
    }
    return value;
}

function attach(root, storyId, sessionId, approve, gh = github) {
    return locked(root, (cwd, loc) => {
        const { run, config } = current(cwd, loc);
        const job = run.jobs[storyId];
        requireValue(approve && !run.candidate && job && ['creating', 'awaiting-reference', 'uncertain', 'blocked', 'ready'].includes(job.status), 'attach requires --approve, no review candidate, and an unresolved or ready story');
        requireValue(SESSION.test(sessionId || ''), 'Provide a GitHub session UUID');
        const candidate = { ...job, session_id: sessionId };
        session(cwd, config, candidate, gh);
        requireValue(candidate.pr, 'Wait for the session PR before attaching it');
        Object.assign(job, candidate);
        delete job.error;
        save(loc, run);
        return { story_id: storyId, status: job.status, pr: job.pr, session_id: job.session_id };
    });
}

function pull(root, config, number, gh) {
    const value = JSON.parse(gh(root, ['pr', 'view', String(number), '--repo', config.repository, '--json', 'number,url,state,isDraft,baseRefName,baseRefOid,headRefOid,mergeable,mergeCommit,autoMergeRequest']));
    requireValue(value.number === number && prUrl(value.url, config.repository).pr === number, 'PR identity changed');
    return value;
}

function mergeResult(root, loc, run, config, job, gh) {
    const value = pull(root, config, job.pr, gh);
    if (value.state === 'MERGED') {
        requireValue(value.mergeCommit && SHA.test(value.mergeCommit.oid || ''), 'Merged PR has no merge commit SHA');
        if (!run.candidate || value.headRefOid !== run.candidate.sha) {
            job.status = 'merged-unverified';
            job.merged_sha = value.mergeCommit.oid;
            job.error = 'PR merged with an unreviewed head; stop for human reconciliation';
            if (run.candidate) run.candidate.phase = 'blocked';
            save(loc, run);
            throw new Error(job.error);
        }
        const commit = JSON.parse(gh(root, ['api', `repos/${config.repository}/git/commits/${value.mergeCommit.oid}`]));
        if (!Array.isArray(commit.parents) || commit.parents[0]?.sha !== run.candidate.base_sha) {
            job.status = 'merged-unverified';
            job.merged_sha = value.mergeCommit.oid;
            job.error = 'PR merged on an unreviewed base; stop for human reconciliation';
            run.candidate.phase = 'blocked';
            save(loc, run);
            throw new Error(job.error);
        }
        job.status = 'merged';
        job.merged_sha = value.mergeCommit.oid;
        run.base_sha = value.mergeCommit.oid;
        job.evaluation = run.candidate.review;
        run.candidate = null;
    } else if (value.state === 'CLOSED') {
        job.status = 'blocked';
        job.error = 'PR closed without merging';
        if (run.candidate) run.candidate.phase = 'blocked';
    } else {
        requireValue(value.state === 'OPEN', `Unknown PR state: ${value.state}`);
    }
    save(loc, run);
    return { story_id: job.id, status: job.status, pr: job.pr, merged_sha: job.merged_sha || null };
}

function refresh(root, gh = github) {
    return locked(root, (cwd, loc) => {
        const run = active(loc);
        requireValue(run.root === cwd, 'Use the original coordinator worktree');
        const config = { repository: run.repository };
        const result = [];
        for (const job of Object.values(run.jobs)) {
            if (['merging', 'merge-uncertain'].includes(job.status)) {
                result.push(mergeResult(cwd, loc, run, config, job, gh));
            } else if (job.session_id && (!job.backend || job.backend === 'cloud') && ['running', 'waiting', 'ready'].includes(job.status)) {
                session(cwd, config, job, gh);
                save(loc, run);
                result.push({ story_id: job.id, status: job.status, pr: job.pr || null });
            }
        }
        return { jobs: result };
    });
}

function worktree(root, workspace, sha) {
    requireValue(typeof workspace === 'string' && workspace, 'Provide a separate review worktree');
    noLinks(workspace);
    const review = repository(workspace);
    requireValue(review.toLowerCase() !== root.toLowerCase(), 'Use a separate review worktree');
    requireValue(locations(review).common.toLowerCase() === locations(root).common.toLowerCase(), 'Review worktree must belong to the coordinator repository');
    clean(review);
    requireValue(git(review, ['rev-parse', 'HEAD']) === sha, 'Review worktree is not at the exact candidate SHA');
    return review;
}

function storySnapshot(root, config, job, workspace, gh) {
    const info = pull(root, config, job.pr, gh);
    requireValue(info.state === 'OPEN' && info.isDraft === false && info.baseRefName === config.base_branch
        && SHA.test(info.baseRefOid || '') && SHA.test(info.headRefOid || '') && info.mergeable === 'MERGEABLE', 'PR is not open, ready, mergeable, or targeted at the approved base');
    requireValue(baseSha(root, config, gh) === info.baseRefOid, 'PR base is stale; update it and prepare a new review');
    const review = worktree(root, workspace, info.headRefOid);
    requireValue(git(review, ['merge-base', '--is-ancestor', info.baseRefOid, info.headRefOid], true).status === 0, 'PR must contain the current base before review');
    const files = git(review, ['diff', '--name-only', '--no-renames', '-z', `${info.baseRefOid}..${info.headRefOid}`]).split('\0').filter(Boolean);
    requireValue(files.length, 'PR contains no story changes');
    for (const file of files) {
        requireValue(model.allowed(file, job.scope.allowed_paths), `PR changes an unowned or protected path: ${file}`);
        noLinks(path.join(review, file));
    }
    return { sha: info.headRefOid, base_sha: info.baseRefOid, workspace: review };
}

function prepare(root, storyId, featureId, workspace, evaluatorId, approve, gh = github) {
    return locked(root, (cwd, loc) => {
        const { run, config, model: project } = current(cwd, loc);
        requireValue(approve && run.status === 'active' && !run.paused && !run.candidate, 'Preparing review requires an unpaused run, --approve, and no existing candidate');
        requireValue(typeof evaluatorId === 'string' && /^[a-z0-9_-]{1,80}$/i.test(evaluatorId), 'Provide a distinct local evaluator label');
        requireValue(!Object.values(run.jobs).some(job => job.session_id === evaluatorId), 'Evaluator must be independent of cloud builders');
        budget(run, config);
        clean(cwd);
        requireValue(baseSha(cwd, config, gh) === run.base_sha, 'GitHub base changed outside this run; stop and replan');
        let snapshot, criteria, id;
        if (storyId) {
            const job = run.jobs[storyId];
            requireValue(job && (job.session_id || ['local', 'verification'].includes(job.backend)), 'Story has no verified execution assignment');
            requireValue(!run.builder_ids?.includes(evaluatorId), 'Evaluator must be independent of every local builder');
            if (!job.backend || job.backend === 'cloud') session(cwd, config, job, gh);
            requireValue(job.status === 'ready', 'Cloud session is not ready for review');
            if (job.backend === 'verification') {
                requireValue(job.base_sha === run.base_sha, 'Verification baseline changed; abandon and rerun validation');
                snapshot = { sha: run.base_sha, base_sha: run.base_sha, workspace: worktree(cwd, workspace, run.base_sha), kind: 'verification' };
            } else {
                snapshot = storySnapshot(cwd, config, job, workspace, gh);
            }
            criteria = project.stories.get(storyId).acceptance_criteria;
            id = job.feature_id;
        } else {
            requireValue(config.feature_ids.includes(featureId), 'Feature is not approved');
            const feature = project.features.get(featureId);
            const integrated = new Set(Object.values(run.jobs).filter(job => ['merged', 'verified'].includes(job.status)).map(job => job.id));
            requireValue(feature.stories.every(id => project.stories.get(id).status === 'done' || integrated.has(id)), 'Merge all feature stories before final review');
            requireValue(project.graph.get(featureId).every(id => model.isSatisfied(project, id, integrated)), 'Feature prerequisites must be complete before final review');
            const sha = baseSha(cwd, config, gh);
            snapshot = { sha, base_sha: sha, workspace: worktree(cwd, workspace, sha) };
            criteria = feature.acceptance_criteria;
            id = featureId;
        }
        const candidate = { story_id: storyId || null, feature_id: id, evaluator_id: evaluatorId, phase: 'preparing', ...snapshot };
        run.candidate = candidate;
        save(loc, run);
        try {
            candidate.verification = checks(candidate.workspace, run, config);
            budget(run, config);
            candidate.phase = 'review';
            save(loc, run);
        } catch (error) {
            candidate.phase = 'blocked';
            candidate.error = error.message;
            save(loc, run);
            throw error;
        }
        return { run_id: run.id, feature_id: id, story_id: storyId || null, candidate_sha: candidate.sha,
            base_sha: candidate.base_sha, workspace: candidate.workspace, evaluator_id: evaluatorId, acceptance_criteria: criteria };
    });
}

function verifyCandidate(root, run, config, candidate, gh) {
    requireValue(baseSha(root, config, gh) === run.base_sha, 'GitHub base changed outside this run; stop and replan');
    worktree(root, candidate.workspace, candidate.sha);
    if (candidate.story_id) {
        const job = run.jobs[candidate.story_id];
        if (!job.backend || job.backend === 'cloud') session(root, config, job, gh);
        requireValue(job.status === 'ready', 'Cloud session is no longer ready');
        if (candidate.kind === 'verification') {
            requireValue(job.base_sha === candidate.sha && candidate.sha === run.base_sha, 'Verification baseline changed');
        } else {
            const snapshot = storySnapshot(root, config, job, candidate.workspace, gh);
            requireValue(snapshot.sha === candidate.sha && snapshot.base_sha === candidate.base_sha, 'Reviewed PR head or base changed');
        }
    } else {
        requireValue(baseSha(root, config, gh) === candidate.sha, 'Reviewed feature base changed');
    }
}

function review(root, report, gh = github) {
    return locked(root, (cwd, loc) => {
        const { run, config, model: project } = current(cwd, loc);
        const candidate = run.candidate;
        requireValue(candidate?.phase === 'review', 'No review candidate is ready');
        budget(run, config);
        verifyCandidate(cwd, run, config, candidate, gh);
        const criteria = candidate.story_id ? project.stories.get(candidate.story_id).acceptance_criteria : project.features.get(candidate.feature_id).acceptance_criteria;
        validateReview(report, { id: run.id, feature_id: candidate.feature_id }, candidate, criteria);
        candidate.review = report;
        save(loc, run);
        return { verdict: report.verdict, candidate_sha: candidate.sha };
    });
}

function merge(root, approve, gh = github) {
    return locked(root, (cwd, loc) => {
        const { run, config } = current(cwd, loc);
        const candidate = run.candidate;
        requireValue(approve && !run.paused && candidate?.story_id && candidate.phase === 'review' && candidate.review?.verdict === 'PASS', 'An unpaused run, passing story review, and --approve are required');
        requireValue(candidate.kind !== 'verification', 'Verification-only evidence is accepted without a fabricated PR merge');
        budget(run, config);
        clean(cwd);
        verifyCandidate(cwd, run, config, candidate, gh);
        checks(candidate.workspace, run, config);
        if (config.require_ci) {
            const results = JSON.parse(gh(cwd, ['pr', 'checks', String(run.jobs[candidate.story_id].pr), '--repo', config.repository, '--json', 'name,bucket']));
            requireValue(Array.isArray(results) && results.length > 0 && results.every(item => item.bucket === 'pass'), 'GitHub checks are missing, pending, or failing');
        }
        verifyCandidate(cwd, run, config, candidate, gh);
        budget(run, config);
        const job = run.jobs[candidate.story_id];
        job.status = 'merging';
        candidate.phase = 'merging';
        save(loc, run);
        const args = ['pr', 'merge', String(job.pr), '--repo', config.repository, '--match-head-commit', candidate.sha];
        if (config.merge_method !== 'queue') args.push(`--${config.merge_method}`);
        try {
            gh(cwd, args);
        } catch (error) {
            job.status = 'merge-uncertain';
            job.error = error.message;
            save(loc, run);
            throw error;
        }
        return mergeResult(cwd, loc, run, config, job, gh);
    });
}

function acceptFinal(root, approve, gh = github) {
    return locked(root, (cwd, loc) => {
        const { run, config } = current(cwd, loc);
        const candidate = run.candidate;
        requireValue(approve && !run.paused && candidate && !candidate.story_id && candidate.phase === 'review' && candidate.review?.verdict === 'PASS', 'An unpaused run, passing full-feature review, and --approve are required');
        budget(run, config);
        verifyCandidate(cwd, run, config, candidate, gh);
        checks(candidate.workspace, run, config);
        budget(run, config);
        run.features[candidate.feature_id] = { status: 'verified', sha: candidate.sha, evaluation: candidate.review };
        run.candidate = null;
        save(loc, run);
        return { feature_id: candidate.feature_id, status: 'verified', sha: candidate.sha };
    });
}

function publish(root, approve, gh = github) {
    return locked(root, (cwd, loc) => {
        const { run, config, backlog } = current(cwd, loc);
        requireValue(approve && run.status === 'active' && !run.paused && !run.candidate, 'Publication requires an unpaused run, --approve, and no review candidate');
        budget(run, config);
        clean(cwd);
        const sha = baseSha(cwd, config, gh);
        requireValue(sha === run.base_sha, 'GitHub base changed outside this run; stop and replan');
        requireValue(git(cwd, ['rev-parse', 'HEAD']) === sha, 'Fast-forward the clean coordinator checkout to the merged GitHub base before publication');
        requireValue(config.feature_ids.every(id => run.features[id]?.status === 'verified' && run.features[id].sha === sha), 'Every feature needs a full local review on the current merged base');
        const featureUpdates = new Map(config.feature_ids.map(id => [id, 'complete']));
        const storyUpdates = new Map(Object.values(run.jobs).filter(job => job.status === 'merged').map(job => [job.id, 'done']));
        const evidence = new Map(Object.values(run.jobs).filter(job => job.status === 'merged').map(job => [job.id, `Cloud PR #${job.pr} merged at ${job.merged_sha}; local evaluator ${job.evaluation.evaluator_id} passed.`]));
        if (backlog.epics) for (const id of config.feature_ids) storyUpdates.set(id, 'complete');
        const featuresFile = path.join(cwd, 'docs', 'FEATURES.json');
        const backlogFile = path.join(cwd, 'docs', 'backlog', 'backlog.json');
        const progressFile = path.join(cwd, 'docs', 'PROGRESS.md');
        const nextFeatures = replaceStatuses(fs.readFileSync(featuresFile, 'utf8'), featureUpdates);
        const nextBacklog = replaceStatuses(fs.readFileSync(backlogFile, 'utf8'), storyUpdates, evidence);
        budget(run, config);
        const progress = `\n## Cloud parallel delivery - ${new Date().toISOString().slice(0, 10)}\n\n* Run: ${run.id}.\n* Features: ${config.feature_ids.join(', ')}.\n* Merged stories: ${[...evidence.keys()].join(', ')}.\n* Local feature reviews and configured checks passed on ${sha}.\n`;
        fs.writeFileSync(featuresFile, nextFeatures);
        fs.writeFileSync(backlogFile, nextBacklog);
        fs.appendFileSync(progressFile, progress);
        run.status = 'published';
        run.published_sha = sha;
        save(loc, run);
        fs.unlinkSync(loc.active);
        return { status: 'published-locally', feature_ids: config.feature_ids, base_sha: sha, commit_required: true };
    });
}

function control(root, action, storyId, approve, gh = github) {
    return locked(root, (cwd, loc) => {
        const run = active(loc);
        requireValue(run.root === cwd, 'Use the original coordinator worktree');
        const config = { repository: run.repository };
        requireValue(approve, `${action} requires --approve`);
        if (action === 'abort-review') {
            requireValue(run.candidate && run.candidate.phase !== 'merging', 'No safely abortable review');
            run.candidate = null;
        } else if (action === 'pause') {
            requireValue(run.status === 'active' && !run.paused, 'Only an unpaused active run can pause');
            run.paused = true;
        } else if (action === 'resume') {
            const project = current(cwd, loc);
            budget(run, project.config);
            requireValue(run.status === 'active' && run.paused, 'Only a paused active run can resume');
            run.paused = false;
        } else if (action === 'recover-merge') {
            const candidate = run.candidate;
            const job = candidate && run.jobs[candidate.story_id];
            requireValue(candidate?.phase === 'merging' && job && ['merging', 'merge-uncertain'].includes(job.status), 'No uncertain or queued merge to recover');
            const info = pull(cwd, config, job.pr, gh);
            if (info.state === 'MERGED') return mergeResult(cwd, loc, run, config, job, gh);
            requireValue(info.state === 'OPEN' && info.autoMergeRequest === null, 'Confirm the PR is open and no auto-merge is active');
            const project = current(cwd, loc);
            budget(run, project.config);
            verifyCandidate(cwd, run, project.config, candidate, gh);
            candidate.phase = 'review';
            job.status = 'ready';
            delete job.error;
        } else if (action === 'abandon') {
            const job = run.jobs[storyId];
            requireValue(!run.candidate && job && ['creating', 'uncertain', 'awaiting-reference', 'blocked', 'ready', 'built', 'local-ready', 'publish-uncertain', 'update-uncertain'].includes(job.status), 'Story does not need reconciliation or a review remains active');
            if (job.backend === 'local' && job.pid) requireValue(!require('../../../hybrid/local.cjs').processAlive(job.pid), 'Stop the specific local worker before abandoning');
            if (job.pr) requireValue(pull(cwd, config, job.pr, gh).state === 'CLOSED', 'Close the unmerged PR before abandoning');
            job.status = 'abandoned';
        } else if (action === 'cancel') {
            requireValue(!run.candidate && Object.values(run.jobs).every(job => ['merged', 'verified', 'abandoned', 'merged-unverified'].includes(job.status)), 'Reconcile all remote work before cancelling');
            run.status = 'cancelled';
            save(loc, run);
            fs.unlinkSync(loc.active);
            return { status: 'cancelled' };
        } else {
            throw new Error(`Unknown control action: ${action}`);
        }
        save(loc, run);
        return { status: run.status, paused: run.paused, story_id: storyId || null };
    });
}

function recoverLock(root, approve) {
    root = repository(root);
    const loc = locations(root);
    requireValue(approve && !absent(loc.lock), 'recover-lock requires --approve and an existing lock');
    const owner = path.join(loc.lock, 'owner.json');
    const value = readJson(owner);
    requireValue(Number.isInteger(value.pid) && value.pid > 0, 'Invalid lock owner');
    let alive = true;
    try { process.kill(value.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    requireValue(!alive, 'The recorded coordinator process is still alive');
    fs.unlinkSync(owner);
    fs.rmdirSync(loc.lock);
    return { recovered: true };
}

function plan(root, configPath) {
    root = repository(root);
    requireValue(typeof configPath === 'string' && configPath, 'Provide --config');
    const project = load(root, path.resolve(root, configPath));
    const run = { jobs: {} };
    const available = ready(run, project.model, project.config);
    const availableIds = new Set(available.map(story => story.id));
    const blocked = project.config.feature_ids.flatMap(id => project.model.features.get(id).stories)
        .filter(id => project.model.stories.get(id).status !== 'done' && !availableIds.has(id))
        .map(id => ({ story_id: id, unmet: project.model.graph.get(id).filter(dep => !model.isSatisfied(project.model, dep)) }));
    return { feature_ids: project.config.feature_ids, ready: [...availableIds], blocked, max_workers: project.config.max_workers };
}

function status(root) {
    root = repository(root);
    const loc = locations(root);
    const { run, config, model: project } = current(root, loc);
    const slots = config.max_workers - Object.values(run.jobs).filter(job => CLOUD_ACTIVE.has(job.status)).length;
    return {
        run_id: run.id, status: run.status, paused: run.paused, feature_ids: config.feature_ids, available_slots: slots,
        ready: run.status === 'active' && !run.paused && slots > 0 ? ready(run, project, config).map(story => story.id) : [],
        jobs: Object.values(run.jobs).map(job => ({ story_id: job.id, feature_id: job.feature_id, status: job.status, attempt: job.attempt,
            pr: job.pr || null, session_id: job.session_id || null, job_id: job.job_id || null, error: job.error || null })),
        candidate: run.candidate, features: run.features
    };
}

function main(argv) {
    requireValue(Number(process.versions.node.split('.')[0]) >= 22 && typeof path.posix.matchesGlob === 'function', 'Node.js 22.20+ or 24+ is required');
    const command = argv.shift(), options = {};
    for (let i = 0; i < argv.length; i++) {
        requireValue(argv[i].startsWith('--'), 'Expected named arguments');
        const key = argv[i].slice(2);
        requireValue(['root', 'config', 'story', 'feature', 'workspace', 'agent', 'session', 'approve'].includes(key) && options[key] === undefined, 'Unknown or duplicate argument');
        options[key] = key === 'approve' ? true : argv[++i];
        requireValue(options[key] !== undefined, 'Missing argument value');
    }
    const root = path.resolve(options.root || process.cwd());
    const loc = locations(repository(root));
    if (!absent(loc.active)) requireValue(active(loc).mode !== 'hybrid', 'Use hybrid/runtime.cjs for the active Jira hybrid run');
    const operations = {
        plan: () => plan(root, options.config),
        begin: () => begin(root, options.config, options.approve),
        dispatch: () => dispatch(root, options.story, options.approve),
        refresh: () => refresh(root),
        attach: () => attach(root, options.story, options.session, options.approve),
        'prepare-review': () => { requireValue(options.story, 'prepare-review requires --story'); return prepare(root, options.story, null, options.workspace, options.agent, options.approve); },
        'prepare-final': () => { requireValue(options.feature, 'prepare-final requires --feature'); return prepare(root, null, options.feature, options.workspace, options.agent, options.approve); },
        'review-report': () => review(root, JSON.parse(fs.readFileSync(0, 'utf8'))),
        merge: () => merge(root, options.approve),
        'accept-final': () => acceptFinal(root, options.approve),
        publish: () => publish(root, options.approve),
        status: () => status(root),
        'abort-review': () => control(root, 'abort-review', null, options.approve),
        'recover-merge': () => control(root, 'recover-merge', null, options.approve),
        pause: () => control(root, 'pause', null, options.approve),
        resume: () => control(root, 'resume', null, options.approve),
        abandon: () => control(root, 'abandon', options.story, options.approve),
        cancel: () => control(root, 'cancel', null, options.approve),
        'recover-lock': () => recoverLock(root, options.approve),
        'recover-start': () => shared.recoverStartGuard(root, options.approve)
    };
    requireValue(Object.hasOwn(operations, command), 'Unknown cloud parallel command');
    return operations[command]();
}

if (require.main === module) {
    try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + '\n'); }
    catch (error) { process.stderr.write(`Harness cloud parallel: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = {
    begin, dispatch, refresh, attach, prepare, review, merge, acceptFinal, publish, control, status, plan,
    locations, parseConfig, created, main, github, locked, current, save, active, budget, baseSha, ready,
    prompt, pull, verifyCandidate, load, worktree, recoverLock
};
