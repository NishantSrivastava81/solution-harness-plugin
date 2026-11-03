'use strict';

const fs = require('node:fs');
const path = require('node:path');
const model = require('../parallel/model.cjs');
const { repository } = require('../parallel/runtime.cjs');
const { requireValue, readJson } = model;

function validate(config) {
    requireValue(config?.version === 1 && config.execution_mode === 'hybrid-stories', 'Expected version 1 hybrid-stories configuration');
    require('../jira/client.cjs').validateJiraConfig(config.jira);
    for (const name of ['feature_ids', 'story_ids', 'approved_designs', 'approved_verification']) {
        model.strings(config[name], name);
    }
    requireValue(config.routes && typeof config.routes === 'object' && !Array.isArray(config.routes), 'Declare cloud/local/verification routes');
    requireValue(Object.values(config.routes).every(route => ['cloud', 'local', 'verification'].includes(route)), 'Unsupported story backend');
    requireValue(Number.isInteger(config.max_workers) && config.max_workers >= 1 && config.max_workers <= 3, 'max_workers must be 1-3 across all backends');
    model.validateOwnership(config.ownership);
    model.validateVerification(config.verification);
    requireValue(config.allow_future === undefined || typeof config.allow_future === 'boolean', 'allow_future must be explicit');
    for (const object of [config, config.jira, config.local || {}]) {
        requireValue(!Object.keys(object).some(key => /^(token|secret|password|authorization|api_key)$/i.test(key)), 'Use environment references, not credentials in configuration');
    }
    if (config.eligible_statuses !== undefined) model.strings(config.eligible_statuses, 'eligible_statuses', { empty: false });
    if (config.jira_writeback !== undefined) {
        requireValue(typeof config.jira_writeback.enabled === 'boolean', 'Explicitly enable or disable Jira write-back');
        if (config.jira_writeback.transition_id) {
            requireValue(typeof config.jira_writeback.transition_id === 'string' && typeof config.jira_writeback.target_status_id === 'string'
                && config.jira_writeback.target_status_id.trim(), 'Configure both workflow transition and destination status IDs');
        }
    }
    return config;
}

function load(root, configPath) {
    root = repository(root);
    const config = validate(readJson(path.resolve(root, configPath)));
    const features = readJson(path.join(root, 'docs', 'FEATURES.json'));
    const backlog = readJson(path.join(root, 'docs', 'backlog', 'backlog.json'));
    for (const name of ['PLAN.md', 'ARCHITECTURE.md', 'PROGRESS.md']) {
        const filename = path.join(root, 'docs', name);
        model.noLinks(filename);
        requireValue(fs.statSync(filename).isFile(), `Missing project ${name}; onboard the target repository first`);
    }
    return { root, config, features, backlog, model: model.parseModel(features, backlog) };
}

function sameCriteria(first, second) {
    const normalized = values => values.map(value => value.trim().replace(/\s+/g, ' ')).sort();
    return JSON.stringify(normalized(first)) === JSON.stringify(normalized(second));
}

function reconcile(project, source, config = project.config) {
    requireValue(source?.version === 1 && /^[a-f0-9]{64}$/.test(source.digest || '')
        && Array.isArray(source.issues) && Number.isInteger(source.sprint?.id), 'Invalid Jira snapshot');
    requireValue(source.sprint.state === 'active' || (source.sprint.state === 'future' && config.allow_future === true), 'No approved active sprint; explicitly select a future sprint rather than starting it');
    const bySource = new Map();
    for (const issue of source.issues) {
        if (issue.source_id) {
            requireValue(!bySource.has(issue.source_id), `Duplicate Jira Source ID ${issue.source_id}`);
            bySource.set(issue.source_id, issue);
        }
    }
    const ids = config.story_ids.length ? config.story_ids : source.issues.map(issue => issue.source_id || `jira:${issue.key}`);
    const stories = ids.map(id => {
        const issue = bySource.get(id), story = project.model.stories.get(id);
        const blockers = [];
        if (!issue) blockers.push('missing-source-id-or-not-in-selected-sprint');
        if (!story) blockers.push('source-id-not-in-repository-backlog');
        if (story && issue) {
            if (story.status === 'done') return { story_id: id, jira_key: issue.key, state: 'done', blockers: [], backend: config.routes[id] || null };
            if (!Array.isArray(issue.acceptance_criteria) || !issue.acceptance_criteria.length) blockers.push('missing-jira-acceptance-criteria');
            else if (!sameCriteria(story.acceptance_criteria, issue.acceptance_criteria)) blockers.push('jira-criteria-differ-reconcile-with-planner');
            if (issue.covers_feature_criteria?.length
                && JSON.stringify([...issue.covers_feature_criteria].sort((a, b) => a - b)) !== JSON.stringify([...story.covers_feature_criteria].sort((a, b) => a - b))) {
                blockers.push('jira-feature-coverage-differs');
            }
            for (const prerequisite of [...new Set([...(issue.depends_on || []), ...(issue.blocked_by || [])])]) {
                if (!project.model.graph.get(id).includes(prerequisite)) blockers.push(`jira-dependency-not-in-approved-graph:${prerequisite}`);
            }
            if (!(config.eligible_statuses || ['To Do']).includes(issue.status)) blockers.push('jira-status-not-eligible-no-completion-inferred');
            if (!config.approved_designs.includes(story.feature_id)) blockers.push('design-not-approved');
            if (!['not-started', 'in-progress', 'needs-rework'].includes(project.model.features.get(story.feature_id).status)) {
                blockers.push('parent-feature-not-eligible');
            }
            if (config.story_ids.length && !config.feature_ids.includes(story.feature_id)) blockers.push('parent-feature-not-in-approved-scope');
            if (!config.ownership[id]) blockers.push('missing-ownership');
            for (const prerequisite of project.model.graph.get(id)) {
                if (!model.isSatisfied(project.model, prerequisite)) blockers.push(`unmet:${prerequisite}`);
            }
        }
        const route = config.routes[id];
        if (!route) blockers.push('missing-backend');
        if (route === 'cloud' && config.cloud_context_approved !== true) blockers.push('cloud-context-not-approved');
        if (route === 'local') {
            if (!['manual-workspace', 'copilot-cli'].includes(config.local?.mode)) blockers.push('local-launch-not-configured');
            if (config.workspace_isolation_confirmed !== true) blockers.push('workspace-isolation-not-confirmed');
            if (config.local?.mode === 'copilot-cli' && config.local.permissions_reviewed !== true) blockers.push('local-permissions-not-reviewed');
        }
        if (route === 'verification') {
            if (!config.approved_verification.includes(id)) blockers.push('verification-environment-not-approved');
            if (config.ownership[id]?.allowed_paths.length !== 0) blockers.push('verification-only-must-not-own-source');
        }
        if (issue?.work_kind === 'verification' && route && route !== 'verification') blockers.push('verification-work-requires-evidence-backend');
        if (config.instructions_reviewed !== true) blockers.push('instructions-not-reviewed');
        if (!config.verification.some(check => check.kind === 'test')) blockers.push('missing-test-command');
        return { story_id: id, jira_key: issue?.key || null, feature_id: story?.feature_id || null,
            backend: route || null, state: blockers.length ? 'blocked' : 'ready', blockers };
    });
    const groups = [];
    for (const story of stories.filter(story => story.state === 'ready')) {
        let group = groups.find(items => items.length < config.max_workers
            && !items.some(id => model.conflicts(config.ownership[id], config.ownership[story.story_id])));
        if (!group) { group = []; groups.push(group); }
        group.push(story.story_id);
    }
    return { sprint: source.sprint, snapshot_digest: source.digest, stories, initial_batches: groups,
        dispatches_workers: false, changes_jira: false, approval_required: true };
}

function assertExecutable(project, source, config = project.config) {
    validate(config);
    requireValue(config.story_ids.length > 0, 'Approve an explicit story_ids allowlist from the Jira preview');
    const preview = reconcile(project, source, config);
    const structural = preview.stories.filter(story => story.blockers.some(blocker => !blocker.startsWith('unmet:')));
    requireValue(!structural.length, `Resolve Jira readiness blockers before beginning: ${structural.map(story => `${story.story_id}: ${story.blockers.join(', ')}`).join('; ')}`);
    requireValue(preview.stories.some(story => story.state === 'ready'), 'No selected story is ready; retained external and feature prerequisites still apply');
    return preview;
}

module.exports = { validate, load, reconcile, assertExecutable };
