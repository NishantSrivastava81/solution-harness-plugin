'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FEATURE = /^[FREB]\d{3}$/;
const STORY = /^([FREB]\d{3})-S\d{2,3}$/;
const completed = new Set(['complete', 'existing']);
const featureStatuses = new Set(['not-started', 'in-progress', 'needs-rework', 'blocked', 'complete', 'existing', 'cancelled']);
const protectedPaths = [
    '.git', '.github/harness', '.github/hooks', '.github/agents', '.github/skills',
    '.github/copilot', '.github/plugin', 'com.github.copilot', 'plugin.json',
    '.github/copilot-instructions.md', '.github/instructions', 'AGENTS.md',
    'docs/FEATURES.json', 'docs/PLAN.md', 'docs/PROGRESS.md', 'docs/EVALUATION.md',
    'docs/backlog', 'docs/LOOP.md', 'docs/loop-budget.md', 'docs/loop-run-log.md',
    'docs/trajectory.jsonl'
];

function requireValue(condition, message) {
    if (!condition) throw new Error(message);
}

function strings(value, label, { empty = true } = {}) {
    requireValue(Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim()), `${label} must be an array of nonempty strings`);
    requireValue(empty || value.length > 0, `${label} must not be empty`);
    requireValue(new Set(value).size === value.length, `${label} contains duplicates`);
    return value;
}

function parseModel(catalog, backlog) {
    requireValue(Array.isArray(catalog?.features), 'FEATURES.json must contain features');
    requireValue(backlog?.version === undefined || backlog.version === 1, 'Unsupported backlog version');
    requireValue(Array.isArray(backlog?.epics) || (backlog?.version === 1 && Array.isArray(backlog.stories)), 'Expected the existing epic backlog or version 1 stories');
    requireValue(!(backlog.epics && backlog.stories), 'Use either nested epics or flat stories, not both');
    const features = new Map();
    for (const feature of catalog.features) {
        requireValue(FEATURE.test(feature.id) && !features.has(feature.id), 'Invalid or duplicate feature ID');
        requireValue(featureStatuses.has(feature.status), `Invalid status for ${feature.id}`);
        requireValue(Number.isFinite(feature.priority), `Missing numeric priority for ${feature.id}`);
        strings(feature.acceptance_criteria, `${feature.id} acceptance criteria`, { empty: false });
        strings(feature.dependencies, `${feature.id} dependencies`);
        features.set(feature.id, { ...feature, dependencies: [...feature.dependencies], stories: [] });
    }
    for (const gate of catalog.architecture_delivery_gates || []) {
        requireValue(features.has(gate.prerequisite), 'Unknown architecture prerequisite');
        strings(gate.applies_to, 'Architecture gate targets');
        for (const id of gate.applies_to) {
            requireValue(features.has(id), `Unknown architecture target ${id}`);
            features.get(id).dependencies = [...new Set([...features.get(id).dependencies, gate.prerequisite])];
        }
    }
    const epicIds = new Set(), backlogFeatures = new Set();
    const entries = backlog.epics
        ? backlog.epics.flatMap(epic => {
            requireValue(typeof epic.id === 'string' && epic.id.trim() && !epicIds.has(epic.id), 'Invalid or duplicate epic ID');
            epicIds.add(epic.id);
            requireValue(Array.isArray(epic.features), 'Invalid epic features');
            return epic.features.flatMap(feature => {
                requireValue(features.has(feature.id) && Array.isArray(feature.stories), 'Unknown backlog feature or missing stories');
                requireValue(!backlogFeatures.has(feature.id) && typeof feature.status === 'string', 'Duplicate backlog feature or missing status snapshot');
                backlogFeatures.add(feature.id);
                return feature.stories.map(story => ({ ...story, feature_id: feature.id }));
            });
        })
        : backlog.stories;
    const stories = new Map();
    for (const story of entries) {
        const match = STORY.exec(story.id);
        requireValue(match && match[1] === story.feature_id && features.has(story.feature_id), 'Invalid story parent or ID');
        requireValue(!stories.has(story.id), `Duplicate story ${story.id}`);
        requireValue(['todo', 'done'].includes(story.status), `Invalid source story status ${story.id}`);
        requireValue(typeof story.title === 'string' && story.title.trim(), `Missing title for ${story.id}`);
        strings(story.acceptance_criteria, `${story.id} criteria`, { empty: false });
        strings(story.depends_on || [], `${story.id} prerequisites`);
        const feature = features.get(story.feature_id);
        requireValue(Array.isArray(story.covers_feature_criteria) && story.covers_feature_criteria.length > 0, `Missing criterion traceability for ${story.id}`);
        requireValue(story.covers_feature_criteria.every(index => Number.isInteger(index) && index >= 1 && index <= feature.acceptance_criteria.length), `Invalid criterion index for ${story.id}`);
        requireValue(new Set(story.covers_feature_criteria).size === story.covers_feature_criteria.length, `Duplicate criterion index for ${story.id}`);
        requireValue(story.evidence == null || typeof story.evidence === 'string', `Invalid evidence for ${story.id}`);
        if (story.status === 'done') requireValue(typeof story.evidence === 'string' && story.evidence.trim(), `Done story ${story.id} needs evidence`);
        const normalized = { ...story, depends_on: story.depends_on || [] };
        stories.set(story.id, normalized);
        feature.stories.push(story.id);
    }
    const graph = new Map();
    for (const feature of features.values()) {
        for (const dep of feature.dependencies) requireValue(features.has(dep), `Unknown prerequisite ${dep}`);
        graph.set(feature.id, [...feature.dependencies, ...feature.stories]);
        if (feature.stories.length) {
            const covered = new Set(feature.stories.flatMap(id => stories.get(id).covers_feature_criteria));
            feature.acceptance_criteria.forEach((criterion, index) => {
                if (!/^All existing tests continue to pass\.?$/i.test(criterion.trim())) {
                    requireValue(covered.has(index + 1), `${feature.id} criterion ${index + 1} has no story`);
                }
            });
        }
    }
    for (const story of stories.values()) {
        const parent = features.get(story.feature_id);
        const dependencies = [...new Set([...parent.dependencies, ...story.depends_on])];
        for (const dep of dependencies) requireValue(features.has(dep) || stories.has(dep), `Unknown prerequisite ${dep}`);
        graph.set(story.id, dependencies);
    }
    const visiting = new Set();
    const visited = new Set();
    function visit(id) {
        requireValue(!visiting.has(id), `Dependency cycle at ${id}`);
        if (visited.has(id)) return;
        visiting.add(id);
        for (const dep of graph.get(id)) visit(dep);
        visiting.delete(id);
        visited.add(id);
    }
    for (const id of graph.keys()) visit(id);
    return { features, stories, graph };
}

function isSatisfied(model, id, integrated = new Set()) {
    if (model.features.has(id)) return completed.has(model.features.get(id).status);
    return model.stories.get(id)?.status === 'done' || integrated.has(id);
}

function readyStories(model, featureId, integrated = new Set(), unavailable = new Set()) {
    const feature = model.features.get(featureId);
    requireValue(feature && feature.stories.length, 'Feature has no executable story breakdown');
    if (completed.has(feature.status) || ['blocked', 'cancelled'].includes(feature.status)) return [];
    return feature.stories.map(id => model.stories.get(id))
        .filter(story => story.status !== 'done' && !integrated.has(story.id) && !unavailable.has(story.id))
        .filter(story => model.graph.get(story.id).every(dep => isSatisfied(model, dep, integrated)))
        .sort((a, b) => a.id.localeCompare(b.id));
}

function relativePath(value) {
    requireValue(typeof value === 'string' && value.length > 0, 'Expected a relative path');
    const normalized = value.replace(/\\/g, '/');
    requireValue(!path.isAbsolute(value) && !/^[a-z]:/i.test(value) && !normalized.startsWith('/') && !normalized.split('/').some(part => part === '..' || part === '.' || part === ''), 'Path must stay inside the worktree');
    return normalized;
}

function allowed(file, patterns) {
    const name = relativePath(file);
    if (protectedPaths.some(item => name.toLowerCase() === item.toLowerCase() || name.toLowerCase().startsWith(item.toLowerCase() + '/'))) return false;
    return patterns.some(pattern => path.posix.matchesGlob(name, pattern));
}

function overlap(first, second) {
    const prefix = pattern => pattern.split(/[*?[\]{}]/, 1)[0].toLowerCase();
    return first.some(a => second.some(b => {
        const ap = prefix(a), bp = prefix(b);
        return ap.startsWith(bp) || bp.startsWith(ap);
    }));
}

function conflicts(first, second) {
    return overlap(first.allowed_paths, second.allowed_paths)
        || first.resources.some(item => second.resources.includes(item));
}

function validateVerification(verification) {
    requireValue(Array.isArray(verification), 'verification must be an array');
    for (const check of verification) {
        requireValue(typeof check.name === 'string' && check.name.trim() && typeof check.command === 'string' && check.command.trim(), 'Checks require a name and executable');
        requireValue(Array.isArray(check.args) && check.args.every(arg => typeof arg === 'string' && !arg.includes('\0')), 'Check arguments must be strings without NUL characters');
        requireValue(['setup', 'test', 'lint', 'build'].includes(check.kind), 'Invalid check kind');
        requireValue(Number.isInteger(check.timeout_seconds) && check.timeout_seconds > 0 && check.timeout_seconds <= 3600, 'Invalid check timeout');
    }
    requireValue(new Set(verification.map(check => check.name)).size === verification.length, 'Verification names must be unique');
    return verification;
}

function validateOwnership(ownership) {
    requireValue(ownership && typeof ownership === 'object' && !Array.isArray(ownership), 'ownership must be an object');
    for (const [id, scope] of Object.entries(ownership)) {
        requireValue(STORY.test(id), 'Invalid ownership story');
        strings(scope.allowed_paths, `${id} allowed paths`);
        strings(scope.resources, `${id} resources`);
        for (const pattern of scope.allowed_paths) relativePath(pattern);
    }
    return ownership;
}

function parseConfig(value) {
    requireValue(value?.version === 1, 'Parallel config version must be 1');
    requireValue(['sequential', 'parallel-stories'].includes(value.mode), 'Only sequential and local parallel-stories modes are supported');
    requireValue(value.launch_mode === 'manual-workspace', 'This release supports explicitly opened worker workspaces only');
    requireValue(typeof value.workspace_isolation_confirmed === 'boolean', 'workspace_isolation_confirmed must be a boolean');
    requireValue(typeof value.instructions_migration_confirmed === 'boolean', 'instructions_migration_confirmed must be a boolean');
    strings(value.feature_ids, 'Approved features');
    strings(value.approved_designs, 'Approved designs');
    for (const [key, min, max] of [
        ['max_workers', 1, 3], ['max_minutes', 1, 1440], ['max_attempts', 1, 5],
        ['max_commits', 1, 100], ['lease_minutes', 1, 240]
    ]) requireValue(Number.isInteger(value[key]) && value[key] >= min && value[key] <= max, `Invalid ${key}`);
    validateVerification(value.verification);
    validateOwnership(value.ownership);
    return value;
}

function readJson(file) {
    try { noLinks(file); return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { throw new Error(`Cannot read valid JSON: ${file}`, { cause: error }); }
}

function noLinks(file) {
    let current = path.resolve(file);
    while (true) {
        try { requireValue(!fs.lstatSync(current).isSymbolicLink(), 'Symlinks and junctions are not allowed in harness-owned paths'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const parent = path.dirname(current);
        if (parent === current) return;
        current = parent;
    }
}

function hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function loadProject(root) {
    const files = ['docs/FEATURES.json', 'docs/backlog/backlog.json', '.github/harness/parallel-config.json'];
    const values = files.map(file => readJson(path.join(root, file)));
    const model = parseModel(values[0], values[1]), config = parseConfig(values[2]);
    for (const id of [...config.feature_ids, ...config.approved_designs]) requireValue(model.features.has(id), `Unknown configured feature ${id}`);
    for (const id of Object.keys(config.ownership)) requireValue(model.stories.has(id), `Unknown ownership story ${id}`);
    return {
        model, config,
        inputs: Object.fromEntries(files.map((file, i) => [file, hash(JSON.stringify(values[i]))]))
    };
}

function plan(project, featureId) {
    const { model, config } = project;
    const featureIds = featureId ? [featureId] : [...model.features.values()]
        .filter(f => f.stories.length && !completed.has(f.status))
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)).map(f => f.id);
    return featureIds.map(id => {
        const feature = model.features.get(id);
        requireValue(feature, `Unknown feature ${id}`);
        const integrated = new Set();
        const groups = [];
        const remaining = new Set(feature.stories.filter(s => model.stories.get(s).status !== 'done'));
        while (remaining.size) {
            const group = [];
            for (const story of readyStories(model, id, integrated)) {
                const scope = config.ownership[story.id];
                if (!scope) continue;
                if (group.some(other => conflicts(scope, config.ownership[other]))) continue;
                group.push(story.id);
                if (group.length === config.max_workers) break;
            }
            if (!group.length) break;
            group.forEach(story => { integrated.add(story); remaining.delete(story); });
            groups.push(group);
        }
        return {
            feature_id: id, priority: feature.priority, batches: groups,
            design_approved: config.approved_designs.includes(id),
            dispatch_enabled: config.mode === 'parallel-stories' && config.feature_ids.includes(id)
                && config.approved_designs.includes(id) && config.workspace_isolation_confirmed
                && config.instructions_migration_confirmed && config.verification.some(check => check.kind === 'test')
                && remaining.size === 0 && groups.length > 0,
            execution_blockers: [
                ...(config.mode !== 'parallel-stories' ? ['sequential-mode'] : []),
                ...(!config.feature_ids.includes(id) ? ['scope-not-approved'] : []),
                ...(!config.approved_designs.includes(id) ? ['design-not-approved'] : []),
                ...(!config.workspace_isolation_confirmed ? ['workspace-isolation-not-confirmed'] : []),
                ...(!config.instructions_migration_confirmed ? ['instructions-not-migrated'] : []),
                ...(!config.verification.some(check => check.kind === 'test') ? ['missing-test-command'] : [])
            ],
            blocked: [...remaining].map(story => ({
                story_id: story,
                missing_ownership: !config.ownership[story],
                feature_state: feature.status,
                unmet: model.graph.get(story).filter(dep => !isSatisfied(model, dep, integrated))
            }))
        };
    });
}

module.exports = {
    parseModel, parseConfig, loadProject, plan, readyStories, isSatisfied,
    requireValue, readJson, hash, allowed, overlap, conflicts, protectedPaths, noLinks,
    strings, relativePath, validateVerification, validateOwnership
};
