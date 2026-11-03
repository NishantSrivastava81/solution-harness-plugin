'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('../skills/cloud-parallel/scripts/coordinator.cjs');
const shared = require('../parallel/runtime.cjs');
const model = require('../parallel/model.cjs');
const planner = require('./plan.cjs');
const { requireValue, readJson, hash, noLinks } = model;
const { git, repository, atomicJson, absent, clean, checks, fingerprint, scopeCheck } = shared;

const runtimeFile = __filename;
const accepted = job => ['merged', 'verified'].includes(job.status);
const dependencies = options => ({ gh: options?.gh || core.github, jira: options?.jira || require('../jira/client.cjs') });

function current(root) {
    root = repository(root);
    const loc = core.locations(root);
    const project = core.current(root, loc);
    requireValue(project.run.mode === 'hybrid', 'No manually triggered Jira hybrid run in this checkout');
    return { ...project, loc };
}

async function source(root, options = {}) {
    const project = current(root);
    const snapshot = await dependencies(options).jira.readSprint(project.config.jira, {
        ...options, sprintId: project.run.source.sprint.id, allowFuture: project.config.allow_future === true
    });
    requireValue(snapshot.digest === project.run.source.digest, 'Jira scope or requirements changed; pause and reconcile rather than changing active assignments');
    for (const id of project.config.story_ids) {
        if (project.model.stories.get(id).status === 'done' || accepted(project.run.jobs[id] || {})) continue;
        const issue = snapshot.issues.find(issue => issue.source_id === id);
        requireValue(issue && (project.config.eligible_statuses || ['To Do']).includes(issue.status),
            `Jira workflow status for ${id} is outside the approved eligible_statuses; pause and reconcile without inferring completion`);
    }
    return project;
}

async function plan(root, configPath, options = {}) {
    const project = planner.load(root, configPath);
    const snapshot = await dependencies(options).jira.readSprint(project.config.jira, {
        ...options, sprintId: options.sprintId ?? project.config.sprint_id, allowFuture: project.config.allow_future === true
    });
    return planner.reconcile(project, snapshot);
}

async function begin(root, configPath, digest, approve, options = {}) {
    requireValue(approve && /^[a-f0-9]{64}$/.test(digest || ''), 'Approve the exact snapshot_digest from jira-plan before beginning');
    const project = planner.load(root, configPath);
    requireValue(Number.isInteger(project.config.lease_minutes) && project.config.lease_minutes >= 1
        && project.config.lease_minutes <= 240, 'lease_minutes must be 1-240');
    const snapshot = await dependencies(options).jira.readSprint(project.config.jira, {
        ...options, sprintId: options.sprintId ?? project.config.sprint_id, allowFuture: project.config.allow_future === true
    });
    requireValue(snapshot.digest === digest, 'Jira changed after the approved preview; preview and approve it again');
    return core.begin(root, configPath, approve, dependencies(options).gh, snapshot);
}

function assignmentPath(workspace) {
    return path.join(git(workspace, ['rev-parse', '--absolute-git-dir']), 'harness-hybrid-assignment.json');
}

function reportPath(workspace, role = 'builder') {
    return path.join(git(workspace, ['rev-parse', '--absolute-git-dir']), `hybrid-${role}-report.json`);
}

function marker(workspace, run, values) {
    atomicJson(assignmentPath(workspace), { version: 1, run_id: run.id, root: run.root, workspace, ...values });
}

function assigned(workspace) {
    workspace = repository(workspace);
    const assignment = readJson(assignmentPath(workspace));
    requireValue(assignment.version === 1 && assignment.workspace === workspace && /^[a-f0-9-]{36}$/i.test(assignment.run_id || '')
        && ['builder', 'evaluator'].includes(assignment.role), 'Invalid hybrid editing workspace');
    const project = current(assignment.root);
    const { run } = project;
    requireValue(run.id === assignment.run_id && run.status === 'active'
        && core.locations(workspace).common === project.loc.common, 'Assignment belongs to a different or closed run');
    if (assignment.role === 'builder') {
        const job = run.jobs[assignment.story_id];
        requireValue(job?.backend === 'local' && job.workspace === workspace && job.attempt === assignment.attempt
            && job.nonce === assignment.nonce && job.agent_id === assignment.agent_id, 'Stale local worker attempt');
        requireValue(job.status === 'running' && Date.parse(job.expires_at) > Date.now(), 'Worker lease expired or source was captured; stop and report');
        requireValue(git(workspace, ['branch', '--show-current']) === job.branch
            && git(workspace, ['rev-parse', 'HEAD']) === job.base_sha, 'Worker branch or baseline changed');
        return { ...project, assignment, job };
    }
    const candidate = run.candidate;
    requireValue(assignment.role === 'evaluator' && candidate?.workspace === workspace
        && candidate.nonce === assignment.nonce && candidate.evaluator_id === assignment.agent_id
        && candidate.phase === 'review' && git(workspace, ['rev-parse', 'HEAD']) === candidate.sha, 'Stale independent evaluator assignment');
    return { ...project, assignment, candidate };
}

function criteriaFor(project, candidate) {
    if (candidate.kind === 'delivery') {
        return project.config.story_ids.flatMap(id => project.model.stories.get(id).acceptance_criteria.map(criterion => `[${id}] ${criterion}`));
    }
    return candidate.story_id ? project.model.stories.get(candidate.story_id).acceptance_criteria
        : project.model.features.get(candidate.feature_id).acceptance_criteria;
}

function context(workspace) {
    const project = assigned(workspace);
    const { assignment, run, job, candidate, config } = project;
    return {
        run_id: run.id, role: assignment.role, agent_id: assignment.agent_id, assignment_nonce: assignment.nonce,
        feature_id: job?.feature_id ?? candidate?.feature_id, story_id: job?.id ?? candidate?.story_id,
        attempt: job?.attempt || null, workspace: assignment.workspace,
        candidate_sha: candidate?.sha || null, base_sha: job?.base_sha || candidate.base_sha,
        acceptance_criteria: job ? project.model.stories.get(job.id).acceptance_criteria : criteriaFor(project, candidate),
        ownership: job?.scope || { allowed_paths: [], resources: [] }, verification: config.verification,
        report_path: reportPath(workspace, assignment.role),
        instructions: job ? 'Implement only owned source. Do not commit, push, merge, deploy, or edit shared plans. Finish with worker-report.'
            : 'Review the exact candidate independently and read-only. Write only the private JSON report; do not merge or publish status.'
    };
}

function workerReport(workspace, reason = null) {
    const project = assigned(workspace);
    const { assignment, job, run, config } = project;
    requireValue(assignment.role === 'builder', 'Only an assigned local builder writes a worker report');
    if (reason) requireValue(['environment', 'tests-failing', 'out-of-scope', 'design-question'].includes(reason), 'Use a documented blocker reason');
    if (!reason) scopeCheck(workspace, job.scope);
    const verification = reason ? null : checks(workspace, run, config);
    assigned(workspace);
    const report = {
        run_id: run.id, story_id: job.id, attempt: job.attempt, agent_id: job.agent_id, nonce: job.nonce,
        verdict: reason ? 'BLOCKED' : 'READY', reason, fingerprint: reason ? null : fingerprint(workspace), verification
    };
    atomicJson(reportPath(workspace), report);
    return { story_id: job.id, verdict: report.verdict };
}

function validateWorker(job, run) {
    requireValue(Date.parse(job.expires_at) > Date.now(), 'Worker lease expired; fence the old attempt before retrying');
    const report = readJson(reportPath(job.workspace));
    requireValue(report.run_id === run.id && report.story_id === job.id && report.attempt === job.attempt
        && report.agent_id === job.agent_id && report.nonce === job.nonce, 'Worker report belongs to another attempt');
    requireValue(report.verdict === 'READY' && report.fingerprint === fingerprint(job.workspace), 'Worker is blocked or source changed after reporting');
    requireValue(report.verification?.sha === job.base_sha && report.verification.checks?.length > 0
        && report.verification.checks.every(check => check.passed === true), 'Missing actual worker verification');
    scopeCheck(job.workspace, job.scope);
    return report;
}

async function dispatch(root, storyId, approve, options = {}) {
    const project = await source(root, options);
    const local = options.local || require('./local.cjs');
    const result = core.dispatch(root, storyId, approve, dependencies(options).gh, {
        local(cwd, run, config, story, job) {
            const workspace = local.createWorkspace(cwd, run.id, story.id, job.attempt, run.base_sha);
            const agentId = `local-${story.id}-${job.attempt}`;
            const nonce = crypto.randomUUID();
            run.builder_ids.push(agentId);
            Object.assign(job, { ...workspace, agent_id: agentId, nonce,
                expires_at: new Date(Date.now() + config.lease_minutes * 60000).toISOString() });
            marker(job.workspace, run, { role: 'builder', story_id: job.id, attempt: job.attempt, agent_id: agentId, nonce });
            return { status: 'running' };
        },
        verification(cwd, run) {
            return { status: 'ready', base_sha: run.base_sha };
        }
    });
    if (project.config.local?.mode === 'copilot-cli') {
        await Promise.all(result.started.filter(item => current(root).run.jobs[item.story_id].backend === 'local').map(async item => {
            const { run, config, model: graph } = current(root);
            const job = run.jobs[item.story_id];
            const prompt = core.prompt(run, graph.features.get(job.feature_id), graph.stories.get(job.id), job.scope)
                + `\nLocal workspace: ${job.workspace}\nDo not modify any other checkout. Finish by running:\n`
                + `node "${runtimeFile}" worker-report --root "${job.workspace}"\n`
                + `If blocked, run node "${runtimeFile}" worker-block --root "${job.workspace}" --reason environment `
                + '(or tests-failing, out-of-scope, design-question). Stop after reporting.\n';
            try {
                await local.launch(config.local, { workspace: job.workspace, prompt, base_sha: job.base_sha,
                    report_path: reportPath(job.workspace),
                    deadline_at: new Date(Math.min(Date.parse(run.started_at) + config.max_minutes * 60000, Date.parse(job.expires_at))).toISOString(),
                    sensitive_env_keys: [config.jira.token_env || 'JIRA_API_TOKEN', config.jira.email_env || 'JIRA_EMAIL'] }, {
                    ...options,
                    onStart(pid) {
                        core.locked(root, (cwd, loc) => {
                            const latest = core.active(loc);
                            requireValue(latest.id === run.id && latest.jobs[job.id].nonce === job.nonce, 'Worker claim changed before launch');
                            latest.jobs[job.id].pid = pid;
                            core.save(loc, latest);
                        });
                    }
                });
                core.locked(root, (cwd, loc) => {
                    const latest = core.active(loc), live = latest.jobs[job.id];
                    requireValue(latest.id === run.id && live.nonce === job.nonce && live.status === 'running', 'Worker attempt changed during execution');
                    requireValue(Date.parse(live.expires_at) > Date.now(), 'Worker completed after its lease expired');
                    validateWorker(live, latest);
                    live.status = 'local-ready';
                    live.local_exit = 0;
                    core.save(loc, latest);
                });
            } catch (error) {
                core.locked(root, (cwd, loc) => {
                    const latest = core.active(loc), live = latest.jobs[job.id];
                    if (latest.id === run.id && live.nonce === job.nonce) {
                        live.status = 'blocked';
                        live.error = error.message;
                        core.save(loc, latest);
                    }
                });
                throw error;
            }
        }));
    }
    return { ...result, workspaces: result.started.flatMap(item => {
        const job = current(root).run.jobs[item.story_id];
        return job.workspace ? [{ story_id: job.id, workspace: job.workspace, agent_id: job.agent_id }] : [];
    }) };
}

function refresh(root, options = {}) {
    const local = options.local || require('./local.cjs');
    core.locked(root, (cwd, loc) => {
        const { run } = current(cwd);
        for (const job of Object.values(run.jobs).filter(job => job.backend === 'local' && job.status === 'running')) {
            if (job.pid && local.processAlive(job.pid)) continue;
            if (absent(reportPath(job.workspace))) {
                if (job.pid || Date.parse(job.expires_at) <= Date.now()) {
                    job.status = 'blocked';
                    job.error = 'Worker stopped or lease expired without a private report';
                }
                continue;
            }
            try {
                requireValue(Date.parse(job.expires_at) > Date.now(), 'Worker lease expired');
                validateWorker(job, run);
                job.status = 'local-ready';
            } catch (error) {
                job.status = 'blocked';
                job.error = error.message;
            }
        }
        core.save(loc, run);
    });
    const result = core.refresh(root, dependencies(options).gh);
    invalidateVerification(root);
    return { ...result, ...status(root) };
}

function invalidateVerification(root) {
    core.locked(root, (cwd, loc) => {
        const { run } = current(cwd);
        for (const job of Object.values(run.jobs).filter(job => job.backend === 'verification' && job.status === 'ready')) {
            job.base_sha = run.base_sha;
        }
        for (const job of Object.values(run.jobs).filter(job => job.status === 'verified' && job.verified_sha !== run.base_sha)) {
            job.previous_evaluations = [...(job.previous_evaluations || []), job.evaluation];
            job.status = 'ready';
            job.base_sha = run.base_sha;
            delete run.features[job.feature_id];
        }
        core.save(loc, run);
    });
}

async function capture(root, storyId, approve, options = {}) {
    await source(root, options);
    return core.locked(root, (cwd, loc) => {
        const { run, config } = current(cwd);
        const job = run.jobs[storyId];
        requireValue(approve && !run.paused && job?.backend === 'local'
            && ['running', 'local-ready'].includes(job.status), 'Capture an approved, reported local assignment');
        requireValue(!job.pid || !require('./local.cjs').processAlive(job.pid), 'Wait for the exact local worker process to stop');
        core.budget(run, config);
        const report = validateWorker(job, run);
        requireValue(git(job.workspace, ['rev-parse', 'HEAD']) === job.base_sha
            && git(job.workspace, ['branch', '--show-current']) === job.branch, 'Worker baseline or branch moved');
        const files = scopeCheck(job.workspace, job.scope);
        requireValue(files.length > 0, 'No source changes; use the explicit verification-only route rather than a fake commit');
        checks(job.workspace, run, config);
        job.status = 'capturing';
        core.save(loc, run);
        try {
            git(job.workspace, ['add', '--', ...files]);
            git(job.workspace, ['commit', '--quiet', '-m', shared.commitMessage(`feat: implement ${job.id}`)]);
            job.sha = git(job.workspace, ['rev-parse', 'HEAD']);
            const committed = git(job.workspace, ['diff', '--name-only', '--no-renames', '-z', job.base_sha, job.sha]).split('\0').filter(Boolean);
            requireValue(committed.every(file => model.allowed(file, job.scope.allowed_paths)), 'Commit hook changed unowned source; preserve this attempt');
            clean(job.workspace);
            job.status = 'built';
            job.verification = report.verification;
            core.save(loc, run);
        } catch (error) {
            job.status = 'blocked';
            job.error = error.message;
            core.save(loc, run);
            throw error;
        }
        return { story_id: job.id, sha: job.sha, publication_required: true };
    });
}

async function publishLocal(root, storyId, approve, options = {}) {
    await source(root, options);
    const { gh } = dependencies(options);
    return core.locked(root, (cwd, loc) => {
        const { run, config } = current(cwd), job = run.jobs[storyId];
        requireValue(approve && !run.paused && job?.backend === 'local' && job.status === 'built', 'Publish only an approved captured local commit; reconcile uncertain publication before retrying');
        requireValue(git(job.workspace, ['rev-parse', 'HEAD']) === job.sha, 'Captured local head changed');
        clean(job.workspace);
        core.budget(run, config);
        if (!options.push) {
            const remote = git(cwd, ['remote', 'get-url', 'origin']);
            const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
            requireValue(match && match[1].toLowerCase() === config.repository.toLowerCase(), 'Origin must match the explicitly approved GitHub repository without embedded credentials');
        }
        job.status = 'publishing';
        core.save(loc, run);
        try {
            if (options.push) options.push(job.workspace, job.branch, job.sha);
            else git(job.workspace, ['push', 'origin', `${job.branch}:${job.branch}`]);
            const output = gh(cwd, ['pr', 'create', '--repo', config.repository, '--base', config.base_branch, '--head', job.branch,
                '--title', `Implement ${job.id}`, '--body-file', '-'], `Hybrid run ${run.id}\nStory ${job.id}\nLocal implementation; independent review and required checks are pending.\n`);
            const reference = core.created(output, config.repository);
            requireValue(reference.pr, 'Unrecognized local PR creation response; reconcile before retrying');
            job.pr = reference.pr;
            job.status = 'ready';
            core.save(loc, run);
        } catch (error) {
            job.status = 'publish-uncertain';
            job.error = error.message;
            core.save(loc, run);
            throw error;
        }
        return { story_id: job.id, pr: job.pr, status: job.status };
    });
}

function attachPr(root, storyId, number, approve, options = {}) {
    return core.locked(root, (cwd, loc) => {
        const { run, config } = current(cwd), job = run.jobs[storyId];
        requireValue(approve && !run.candidate && job?.backend === 'local'
            && ['publishing', 'publish-uncertain'].includes(job.status) && Number.isInteger(number) && number > 0, 'Attach only a reconciled local PR');
        const info = core.pull(cwd, config, number, dependencies(options).gh);
        requireValue(info.state === 'OPEN' && info.baseRefName === config.base_branch && info.headRefOid === job.sha
            && !Object.values(run.jobs).some(other => other.id !== job.id && other.pr === number), 'PR is not the exact captured local candidate');
        job.pr = number;
        job.status = 'ready';
        delete job.error;
        core.save(loc, run);
        return { story_id: job.id, pr: number, status: 'ready' };
    });
}

function independent(run, agentId) {
    requireValue(typeof agentId === 'string' && /^[a-z0-9_-]{1,80}$/i.test(agentId)
        && !run.builder_ids.includes(agentId) && !Object.values(run.jobs).some(job => job.session_id === agentId), 'Use a fresh independent local evaluator identity');
}

async function prepare(root, storyId, featureId, workspace, agentId, approve, options = {}) {
    requireValue(typeof workspace === 'string' && workspace, 'Provide a separate evaluator workspace');
    await source(root, options);
    const { run } = current(root);
    independent(run, agentId);
    requireValue(!Object.values(run.jobs).some(job => job.workspace && path.resolve(job.workspace) === path.resolve(workspace)), 'Evaluator must use a different editing workspace from every builder');
    const result = core.prepare(root, storyId, featureId, workspace, agentId, approve, dependencies(options).gh);
    registerEvaluator(root);
    return { ...result, ...context(workspace) };
}

function registerEvaluator(root) {
    core.locked(root, (cwd, loc) => {
        const { run } = current(cwd);
        const candidate = run.candidate;
        candidate.nonce = crypto.randomUUID();
        marker(candidate.workspace, run, { role: 'evaluator', agent_id: candidate.evaluator_id, nonce: candidate.nonce });
        core.save(loc, run);
    });
}

async function prepareDelivery(root, workspace, agentId, approve, options = {}) {
    requireValue(typeof workspace === 'string' && workspace, 'Provide a separate delivery evaluator workspace');
    await source(root, options);
    const result = core.locked(root, (cwd, loc) => {
        const project = current(cwd), { run, config } = project;
        requireValue(approve && !run.paused && !run.candidate && config.story_ids.every(id => project.model.stories.get(id).status === 'done' || accepted(run.jobs[id] || {})), 'Accept every selected story before final delivery review');
        independent(run, agentId);
        requireValue(core.baseSha(cwd, config, dependencies(options).gh) === run.base_sha, 'Delivery baseline changed outside the run');
        requireValue(!Object.values(run.jobs).some(job => job.workspace && path.resolve(job.workspace) === path.resolve(workspace)), 'Use a separate independent delivery workspace');
        const candidate = { kind: 'delivery', feature_id: null, story_id: null, sha: run.base_sha, base_sha: run.base_sha,
            workspace: core.worktree(cwd, workspace, run.base_sha), evaluator_id: agentId, phase: 'preparing' };
        run.candidate = candidate;
        core.save(loc, run);
        try {
            candidate.verification = checks(candidate.workspace, run, config);
            candidate.phase = 'review';
            core.save(loc, run);
        } catch (error) {
            candidate.phase = 'blocked';
            candidate.error = error.message;
            core.save(loc, run);
            throw error;
        }
        return { candidate_sha: candidate.sha };
    });
    registerEvaluator(root);
    return { ...result, ...context(workspace) };
}

async function review(root, report, options = {}) {
    await source(root, options);
    const project = current(root), candidate = project.run.candidate;
    requireValue(candidate?.phase === 'review' && report.assignment_nonce === candidate.nonce, 'Report does not match the current evaluator assignment');
    if (candidate.kind !== 'delivery') return core.review(root, report, dependencies(options).gh);
    return core.locked(root, (cwd, loc) => {
        const latest = current(cwd);
        requireValue(latest.run.candidate.nonce === candidate.nonce, 'Review candidate changed');
        requireValue(core.baseSha(cwd, latest.config, dependencies(options).gh) === candidate.sha, 'Reviewed delivery base changed');
        clean(candidate.workspace);
        requireValue(git(candidate.workspace, ['rev-parse', 'HEAD']) === candidate.sha, 'Reviewed source changed');
        shared.validateReview(report, { id: latest.run.id, feature_id: null }, candidate, criteriaFor(latest, candidate));
        latest.run.candidate.review = report;
        core.save(loc, latest.run);
        return { verdict: report.verdict, candidate_sha: candidate.sha };
    });
}

async function launchReview(root, approve, options = {}) {
    const { run, config } = await source(root, options), candidate = run.candidate;
    requireValue(approve && !run.paused && candidate?.phase === 'review' && config.local?.mode === 'copilot-cli', 'Configure an approved isolated CLI evaluator or open the candidate in a separate workspace');
    const data = context(candidate.workspace);
    const prompt = `Independent hybrid evaluation. Review only ${candidate.sha} at ${candidate.workspace}.\n`
        + `Criteria: ${JSON.stringify(data.acceptance_criteria)}\nDo not edit source, commit, merge, deploy, or update shared status.\n`
        + `Run the configured checks: ${JSON.stringify(config.verification)}.\nWrite JSON only at ${data.report_path}:\n`
        + JSON.stringify({ run_id: run.id, feature_id: data.feature_id, story_id: data.story_id, candidate_sha: candidate.sha,
            evaluator_id: data.agent_id, assignment_nonce: data.assignment_nonce, verdict: 'FAIL',
            criteria: data.acceptance_criteria.map(criterion => ({ criterion, passed: false, evidence: 'Replace with actual observed evidence' })), issues: [] })
        + '\nA PASS requires every exact criterion verified and no unresolved issues. Stop after writing the report.\n';
    try {
        await (options.local || require('./local.cjs')).launch(config.local, {
            workspace: candidate.workspace, prompt, base_sha: candidate.sha, report_path: data.report_path,
            deadline_at: new Date(Date.parse(run.started_at) + config.max_minutes * 60000).toISOString(),
            sensitive_env_keys: [config.jira.token_env || 'JIRA_API_TOKEN', config.jira.email_env || 'JIRA_EMAIL']
        }, { ...options, onStart(pid) {
            core.locked(root, (cwd, loc) => {
                const latest = core.active(loc);
                requireValue(latest.candidate?.nonce === candidate.nonce, 'Evaluator candidate changed before launch');
                latest.candidate.pid = pid;
                core.save(loc, latest);
            });
        } });
        return await review(root, readJson(data.report_path), options);
    } catch (error) {
        core.locked(root, (cwd, loc) => {
            const latest = core.active(loc);
            if (latest.candidate?.nonce === candidate.nonce) {
                latest.candidate.phase = 'blocked';
                latest.candidate.error = error.message;
                core.save(loc, latest);
            }
        });
        throw error;
    }
}

async function acceptEvidence(root, approve, options = {}) {
    await source(root, options);
    return core.locked(root, (cwd, loc) => {
        const { run, config } = current(cwd), candidate = run.candidate;
        requireValue(approve && !run.paused && candidate?.phase === 'review' && candidate.review?.verdict === 'PASS'
            && ['verification', 'delivery'].includes(candidate.kind), 'A current passing independent evidence review is required');
        requireValue(core.baseSha(cwd, config, dependencies(options).gh) === candidate.sha, 'Reviewed evidence baseline changed');
        clean(candidate.workspace);
        requireValue(git(candidate.workspace, ['rev-parse', 'HEAD']) === candidate.sha, 'Evidence workspace changed');
        checks(candidate.workspace, run, config);
        if (candidate.kind === 'verification') {
            const job = run.jobs[candidate.story_id];
            requireValue(job?.backend === 'verification' && job.base_sha === candidate.sha, 'Verification assignment changed');
            job.status = 'verified';
            job.verified_sha = candidate.sha;
            job.evaluation = candidate.review;
        } else {
            run.delivery = { sha: candidate.sha, evaluation: candidate.review };
        }
        run.candidate = null;
        core.save(loc, run);
        return { status: 'evidence-accepted', sha: candidate.sha };
    });
}

async function merge(root, approve, options = {}) {
    await source(root, options);
    const result = core.merge(root, approve, dependencies(options).gh);
    invalidateVerification(root);
    return result;
}

async function updatePr(root, storyId, approve, options = {}) {
    await source(root, options);
    return core.locked(root, (cwd, loc) => {
        const { run, config } = current(cwd), job = run.jobs[storyId], gh = dependencies(options).gh;
        requireValue(approve && !run.paused && !run.candidate && job?.pr && job.status === 'ready', 'Update only a ready PR with no outstanding review');
        const info = core.pull(cwd, config, job.pr, gh);
        requireValue(info.state === 'OPEN' && info.baseRefName === config.base_branch, 'PR no longer targets the approved base');
        core.budget(run, config);
        job.status = 'update-uncertain';
        core.save(loc, run);
        gh(cwd, ['api', `repos/${config.repository}/pulls/${job.pr}/update-branch`, '--method', 'PUT', '-f', `expected_head_sha=${info.headRefOid}`]);
        job.status = 'ready';
        core.save(loc, run);
        return { status: 'base-update-requested', story_id: job.id, fresh_review_required: true };
    });
}

function reconcileUpdate(root, storyId, approve, options = {}) {
    return core.locked(root, (cwd, loc) => {
        const { run, config } = current(cwd), job = run.jobs[storyId], gh = dependencies(options).gh;
        requireValue(approve && !run.candidate && job?.status === 'update-uncertain' && job.pr, 'No uncertain PR update to reconcile');
        const info = core.pull(cwd, config, job.pr, gh);
        requireValue(info.state === 'OPEN' && info.baseRefName === config.base_branch && info.mergeable === 'MERGEABLE', 'Wait for or explicitly repair the provider-side update');
        requireValue(/^[a-f0-9]{40,64}$/i.test(info.headRefOid || ''), 'Invalid updated PR head');
        const comparison = JSON.parse(gh(cwd, ['api', `repos/${config.repository}/compare/${run.base_sha}...${info.headRefOid}`]));
        requireValue(['ahead', 'identical'].includes(comparison.status), 'The update is not confirmed on the current base; reconcile in GitHub before retrying');
        job.status = 'ready';
        core.save(loc, run);
        return { status: 'update-reconciled', story_id: job.id, fresh_review_required: true };
    });
}

function status(root) {
    const result = core.status(root), { run } = current(root);
    return { ...result, mode: 'manual-jira-hybrid', sprint: run.source.sprint, snapshot_digest: run.source.digest,
        jobs: result.jobs.map(job => ({ ...job, backend: run.jobs[job.story_id].backend,
            workspace: run.jobs[job.story_id].workspace || null })) };
}

function promotion(root, run, loc) {
    for (const file of run.promotion.files) {
        const filename = path.join(root, file.path);
        noLinks(filename);
        const digest = hash(fs.readFileSync(filename));
        requireValue(digest === file.before || digest === hash(file.after), 'Publication encountered unrelated edits; preserve them and reconcile explicitly');
        if (digest === file.before) fs.writeFileSync(filename, file.after);
    }
    run.status = 'published';
    run.published_sha = run.promotion.sha;
    core.save(loc, run);
    atomicJson(path.join(loc.directory, 'last-hybrid.json'), { id: run.id });
    fs.unlinkSync(loc.active);
    return { status: 'published-locally', run_id: run.id, base_sha: run.published_sha, commit_required: true };
}

async function finish(root, approve, options = {}) {
    await source(root, options);
    return core.locked(root, (cwd, loc) => {
        const project = current(cwd), { run, config, backlog } = project;
        requireValue(approve && !run.paused && !run.candidate && run.delivery?.sha === run.base_sha, 'Independent current-base selected-story delivery review is required');
        requireValue(config.story_ids.every(id => project.model.stories.get(id).status === 'done' || accepted(run.jobs[id] || {})), 'Selected stories remain unfinished');
        requireValue(Object.values(run.jobs).every(job => job.status !== 'verified' || job.verified_sha === run.base_sha), 'Rerun verification evidence on the latest merged base');
        const sha = core.baseSha(cwd, config, dependencies(options).gh);
        requireValue(sha === run.base_sha && git(cwd, ['rev-parse', 'HEAD']) === sha, 'Fast-forward the clean coordinator to the confirmed merged base before publication');
        clean(cwd);
        core.budget(run, config);
        const jobs = Object.values(run.jobs).filter(accepted);
        const done = new Set(jobs.map(job => job.id));
        const featureUpdates = new Map(), storyUpdates = new Map(jobs.map(job => [job.id, 'done']));
        for (const id of config.feature_ids) {
            const feature = project.model.features.get(id);
            const complete = feature.stories.every(story => project.model.stories.get(story).status === 'done' || done.has(story))
                && run.features[id]?.status === 'verified' && run.features[id].sha === sha;
            if (complete) {
                featureUpdates.set(id, 'complete');
                if (backlog.epics) storyUpdates.set(id, 'complete');
            } else if (feature.stories.some(story => done.has(story))) {
                featureUpdates.set(id, 'in-progress');
                if (backlog.epics) storyUpdates.set(id, 'in-progress');
            }
        }
        const evidence = new Map(jobs.map(job => [job.id, job.backend === 'verification'
            ? `Independent verification on ${job.verified_sha}; evaluator ${job.evaluation.evaluator_id} passed.`
            : `${job.backend} PR #${job.pr} merged at ${job.merged_sha}; evaluator ${job.evaluation.evaluator_id} passed.`]));
        const definitions = [
            ['docs/FEATURES.json', content => shared.replaceStatuses(content, featureUpdates)],
            ['docs/backlog/backlog.json', content => shared.replaceStatuses(content, storyUpdates, evidence)],
            ['docs/PROGRESS.md', content => `${content}\n## Manual Jira hybrid delivery - ${new Date().toISOString().slice(0, 10)}\n\n* Run: ${run.id}.\n* Jira sprint: ${run.source.sprint.name} (${run.source.sprint.id}).\n* Accepted stories: ${jobs.map(job => job.id).join(', ')}.\n* Independent selected-story review and configured checks passed on ${sha}.\n* Partial parent features remain in progress; completion requires full-feature review.\n`]
        ];
        run.promotion = { sha, files: definitions.map(([filename, update]) => {
            const content = fs.readFileSync(path.join(cwd, filename), 'utf8');
            return { path: filename, before: hash(content), after: update(content) };
        }) };
        run.status = 'publishing';
        core.save(loc, run);
        return promotion(cwd, run, loc);
    });
}

function recoverPublication(root, approve, options = {}) {
    return core.locked(root, (cwd, loc) => {
        const run = core.active(loc);
        requireValue(approve && run.mode === 'hybrid' && run.root === cwd && ['publishing', 'published'].includes(run.status)
            && run.promotion, 'No interrupted hybrid publication to recover');
        const config = readJson(run.config_path);
        requireValue(hash(JSON.stringify(config)) === run.inputs.config, 'Approved configuration changed');
        requireValue(core.baseSha(cwd, config, dependencies(options).gh) === run.promotion.sha
            && git(cwd, ['rev-parse', 'HEAD']) === run.promotion.sha, 'Publication base changed; do not overwrite it');
        return promotion(cwd, run, loc);
    });
}

async function syncUnlocked(root, runId, approve, options = {}) {
    root = repository(root);
    const loc = core.locations(root);
    const id = runId || readJson(path.join(loc.directory, 'last-hybrid.json')).id;
    requireValue(/^[a-f0-9-]{36}$/i.test(id || ''), 'Provide a recorded hybrid run ID');
    const run = readJson(path.join(loc.directory, 'runs', `${id}.json`));
    requireValue(approve && run.mode === 'hybrid' && run.root === root && run.status === 'published', 'Approve Jira write-back only for confirmed published delivery');
    const config = planner.validate(readJson(run.config_path));
    requireValue(config.repository === run.repository && config.jira_writeback?.enabled === true, 'Jira write-back is disabled or repository identity changed');
    const jira = dependencies(options).jira;
    requireValue(new URL(config.jira.url).origin === new URL(run.source.site).origin, 'Jira site identity changed');
    const results = [];
    for (const job of Object.values(run.jobs).filter(accepted)) {
        const original = run.source.issues.find(issue => issue.source_id === job.id);
        const issue = await jira.readIssue(config.jira, original.id, options);
        requireValue(issue.id === original.id && issue.source_id === original.source_id
            && JSON.stringify(issue.acceptance_criteria) === JSON.stringify(original.acceptance_criteria)
            && JSON.stringify(issue.depends_on) === JSON.stringify(original.depends_on)
            && JSON.stringify(issue.blocked_by) === JSON.stringify(original.blocked_by), 'Jira requirements changed after delivery; reconcile before publishing evidence');
        const sha = job.merged_sha || job.verified_sha;
        const evidence = { marker: `harness:${run.id}:${job.id}:${sha}`, repository: run.repository, sha,
            url: job.pr ? `https://github.com/${run.repository}/pull/${job.pr}` : `https://github.com/${run.repository}/commit/${sha}`,
            summary: `${job.id}: independent ${job.backend === 'verification' ? 'verification' : 'implementation review'} passed at ${sha}. Delivery acceptance is not QA or release approval.` };
        const state = { status: 'pending', marker: evidence.marker };
        run.jira_sync = { ...(run.jira_sync || {}), [job.id]: state };
        core.save(loc, run);
        try {
            const result = await jira.syncEvidence(config.jira, issue, evidence, {
                ...options, approve: true, transitionId: config.jira_writeback.transition_id || null,
                targetStatusId: config.jira_writeback.target_status_id || null
            });
            Object.assign(state, { status: 'published', ...result });
            core.save(loc, run);
            results.push({ story_id: job.id, ...result });
        } catch (error) {
            state.status = 'uncertain';
            state.error = error.message;
            core.save(loc, run);
            throw error;
        }
    }
    return { run_id: run.id, jira_evidence: results };
}

async function sync(root, runId, approve, options = {}) {
    root = repository(root);
    const lock = path.join(core.locations(root).directory, 'jira-sync.lock');
    noLinks(lock);
    try { fs.mkdirSync(lock); }
    catch (error) {
        if (error.code === 'EEXIST') throw new Error('Jira evidence publication is already in progress; do not duplicate writes');
        throw error;
    }
    const owner = path.join(lock, 'owner.json');
    try {
        atomicJson(owner, { pid: process.pid });
        return await syncUnlocked(root, runId, approve, options);
    } finally {
        if (!absent(owner)) fs.unlinkSync(owner);
        fs.rmdirSync(lock);
    }
}

function recoverSync(root, approve) {
    const lock = path.join(core.locations(repository(root)).directory, 'jira-sync.lock');
    requireValue(approve && !absent(lock), 'No interrupted Jira publication lock to recover');
    const owner = path.join(lock, 'owner.json'), value = readJson(owner);
    requireValue(Number.isInteger(value.pid) && value.pid > 0, 'Invalid Jira publisher owner');
    requireValue(!require('./local.cjs').processAlive(value.pid), 'Jira publisher is still running');
    fs.unlinkSync(owner);
    fs.rmdirSync(lock);
    return { recovered: true };
}

async function main(argv) {
    requireValue(Number(process.versions.node.split('.')[0]) >= 22 && typeof path.posix.matchesGlob === 'function', 'Node.js 22.20+ or 24+ is required');
    const command = argv.shift(), options = {};
    for (let index = 0; index < argv.length; index++) {
        const key = argv[index].slice(2);
        requireValue(argv[index].startsWith('--') && ['root', 'config', 'snapshot', 'sprint', 'story', 'feature', 'workspace', 'agent', 'session', 'pr', 'run', 'reason', 'approve'].includes(key)
            && options[key] === undefined, 'Unknown or duplicate named argument');
        options[key] = key === 'approve' ? true : argv[++index];
        requireValue(options[key] !== undefined && (key === 'approve' || (options[key] && !options[key].startsWith('--'))), 'Missing argument value');
    }
    const root = path.resolve(options.root || process.cwd());
    const request = options.sprint ? { sprintId: Number(options.sprint) } : {};
    const operations = {
        plan: () => plan(root, options.config, request),
        begin: () => begin(root, options.config, options.snapshot, options.approve, request),
        dispatch: () => dispatch(root, options.story, options.approve),
        refresh: () => refresh(root),
        status: () => status(root),
        context: () => context(root),
        'worker-report': () => workerReport(root),
        'worker-block': () => {
            requireValue(options.reason, 'worker-block requires an explicit documented --reason');
            return workerReport(root, options.reason);
        },
        capture: () => capture(root, options.story, options.approve),
        'publish-local': () => publishLocal(root, options.story, options.approve),
        'attach-pr': () => attachPr(root, options.story, Number(options.pr), options.approve),
        attach: () => core.attach(root, options.story, options.session, options.approve),
        'prepare-review': () => prepare(root, options.story, null, options.workspace, options.agent, options.approve),
        'prepare-final': () => prepare(root, null, options.feature, options.workspace, options.agent, options.approve),
        'prepare-delivery': () => prepareDelivery(root, options.workspace, options.agent, options.approve),
        'launch-review': () => launchReview(root, options.approve),
        'review-report': () => review(root, JSON.parse(fs.readFileSync(0, 'utf8'))),
        merge: () => merge(root, options.approve),
        'accept-evidence': () => acceptEvidence(root, options.approve),
        'accept-final': async () => { await source(root); return core.acceptFinal(root, options.approve); },
        'update-pr': () => updatePr(root, options.story, options.approve),
        'reconcile-update': () => reconcileUpdate(root, options.story, options.approve),
        finish: () => finish(root, options.approve),
        'recover-publish': () => recoverPublication(root, options.approve),
        sync: () => sync(root, options.run, options.approve),
        'recover-lock': () => core.recoverLock(root, options.approve),
        'recover-start': () => shared.recoverStartGuard(root, options.approve),
        'recover-sync': () => recoverSync(root, options.approve),
        pause: () => core.control(root, 'pause', null, options.approve),
        resume: async () => { await source(root); return core.control(root, 'resume', null, options.approve); },
        'abort-review': () => core.control(root, 'abort-review', null, options.approve),
        'recover-merge': () => core.control(root, 'recover-merge', null, options.approve),
        abandon: () => core.control(root, 'abandon', options.story, options.approve),
        cancel: () => core.control(root, 'cancel', null, options.approve)
    };
    requireValue(Object.hasOwn(operations, command), 'Unknown manual Jira hybrid command');
    return operations[command]();
}

if (require.main === module) {
    main(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
        .catch(error => { process.stderr.write(`Manual Jira hybrid: ${error.message}\n`); process.exitCode = 1; });
}

module.exports = {
    plan, begin, dispatch, refresh, capture, publishLocal, attachPr, prepare, prepareDelivery, review, launchReview,
    acceptEvidence, merge, updatePr, reconcileUpdate, finish, recoverPublication, sync, recoverSync, status, context, assigned, assignmentPath,
    reportPath, workerReport, main
};
