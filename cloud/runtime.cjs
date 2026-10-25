const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runtimeDirectory = '.github/harness/runtime';
const reportFiles = new Set([
    'docs/FEATURES.json', 'docs/PROGRESS.md', 'docs/EVALUATION.md',
    'docs/loop-run-log.md', 'docs/loop-budget.md'
]);

function digest(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function readJson(root, relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readState(root) {
    const filename = path.join(root, runtimeDirectory, 'session.json');
    return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null;
}

function saveState(root, state) {
    const directory = path.join(root, runtimeDirectory);
    if (fs.lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error('The runtime directory must not be a symlink.');
    }
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'session.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function loadConfig(root) {
    const config = readJson(root, '.github/harness/config.json');
    if (config.version !== 1 || !Array.isArray(config.feature_ids)
        || !config.feature_ids.every(identifier => typeof identifier === 'string' && identifier.trim())
        || new Set(config.feature_ids).size !== config.feature_ids.length
        || !Number.isInteger(config.max_minutes) || config.max_minutes < 1 || config.max_minutes > 45
        || !Number.isInteger(config.max_rework) || config.max_rework < 0 || config.max_rework > 2) {
        throw new Error('Invalid cloud config: version, feature_ids, max_minutes (1-45), or max_rework (0-2).');
    }
    if (!Array.isArray(config.verification) || !config.verification.length
        || !config.verification.some(check => check.kind === 'test')
        || !config.verification.every(check => typeof check.name === 'string' && check.name.trim()
            && ['test', 'lint', 'build'].includes(check.kind)
            && typeof check.command === 'string' && check.command.trim()
            && Array.isArray(check.args) && check.args.every(argument => typeof argument === 'string'))) {
        throw new Error('Configure explicit verification commands, including at least one test command.');
    }
    return config;
}

function sourceFingerprint(root) {
    const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
    });
    if (result.status !== 0) {
        throw new Error('Cannot fingerprint the worktree. Run the harness in a Git repository.');
    }
    const hash = crypto.createHash('sha256');
    const filenames = [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
    for (const filename of filenames) {
        if (reportFiles.has(filename) || filename.startsWith(`${runtimeDirectory}/`)) {
            continue;
        }
        hash.update(`${filename}\0`);
        const location = path.join(root, filename);
        const entry = fs.lstatSync(location, { throwIfNoEntry: false });
        if (!entry) {
            hash.update('deleted\0');
        } else if (entry.isSymbolicLink()) {
            hash.update(`symlink\0${fs.readlinkSync(location)}\0`);
        } else if (entry.isFile()) {
            hash.update(`file\0${entry.mode}\0`);
            hash.update(fs.readFileSync(location));
            hash.update('\0');
        } else {
            throw new Error(`Unsupported worktree entry: ${filename}. Verify submodules separately.`);
        }
    }
    return hash.digest('hex');
}

function activeState(root) {
    const state = readState(root);
    if (!state?.featureId || state.finalized) {
        throw new Error('No active cloud run. The sessionStart hook and begin command must run first.');
    }
    return state;
}

function assertBudget(state) {
    if (Date.now() - state.startedAt >= state.maxMinutes * 60_000) {
        throw new Error('Cloud working budget exhausted. Finish as blocked and report the checkpoint.');
    }
    if (state.buildAttempts > state.maxRework + 1) {
        throw new Error('Cloud rework budget exhausted. Finish as needs-rework.');
    }
}

function assertConfig(root, state) {
    const config = loadConfig(root);
    if (digest(JSON.stringify(config)) !== state.configHash) {
        throw new Error('Cloud configuration changed during this run. Stop for human review.');
    }
    return config;
}

function begin(root, featureId) {
    const state = readState(root);
    if (!state) {
        throw new Error('Missing cloud session. Confirm that the sessionStart hook is installed and loaded.');
    }
    if (state.featureId) {
        throw new Error('Only one feature may be started per cloud session.');
    }
    const config = loadConfig(root);
    if (!config.feature_ids.includes(featureId)) {
        throw new Error(`Feature ${featureId} is not in the approved feature_ids allowlist.`);
    }
    for (const filename of ['docs/PLAN.md', 'docs/ARCHITECTURE.md', 'docs/PROGRESS.md']) {
        if (!fs.existsSync(path.join(root, filename))) {
            throw new Error(`Missing ${filename}. Onboard this repository before starting a cloud build.`);
        }
    }
    const registry = readJson(root, 'docs/FEATURES.json');
    if (!Array.isArray(registry.features)
        || new Set(registry.features.map(feature => feature.id)).size !== registry.features.length) {
        throw new Error('FEATURES.json must contain a features array with unique IDs.');
    }
    const feature = registry.features.find(candidate => candidate.id === featureId);
    if (!feature || !['not-started', 'needs-rework'].includes(feature.status)
        || !Array.isArray(feature.acceptance_criteria) || !feature.acceptance_criteria.length
        || !feature.acceptance_criteria.every(criterion => typeof criterion === 'string' && criterion.trim())
        || new Set(feature.acceptance_criteria).size !== feature.acceptance_criteria.length) {
        throw new Error('Select an unfinished feature with explicit, unique acceptance criteria.');
    }
    if (!Array.isArray(feature.dependencies ?? []) || (feature.dependencies ?? []).some(identifier =>
        !registry.features.some(candidate => candidate.id === identifier
            && ['complete', 'existing'].includes(candidate.status)))) {
        throw new Error('The selected feature has unmet dependencies.');
    }
    Object.assign(state, {
        featureId, criteria: feature.acceptance_criteria, registryBefore: JSON.stringify(registry),
        configHash: digest(JSON.stringify(config)), maxMinutes: config.max_minutes,
        maxRework: config.max_rework, buildAttempts: 0, initialSource: sourceFingerprint(root)
    });
    assertBudget(state);
    saveState(root, state);
    return state;
}

function verify(root, phase, output = () => {}) {
    const state = activeState(root);
    assertBudget(state);
    const config = assertConfig(root, state);
    const before = sourceFingerprint(root);
    if (phase === 'baseline') {
        if (state.baseline || state.buildAttempts || before !== state.initialSource) {
            throw new Error('The baseline must run before the builder or any source edits.');
        }
    } else if (phase === 'final') {
        if (!state.baseline?.passed || !state.builder || !state.evaluation?.passed
            || state.builder.source !== before || state.evaluation.source !== before) {
            throw new Error('Final verification requires a green baseline, builder, and independent PASS on current source.');
        }
    } else {
        throw new Error('Verification phase must be baseline or final.');
    }

    const checks = [];
    for (const check of config.verification) {
        assertBudget(state);
        const remaining = state.maxMinutes * 60_000 - (Date.now() - state.startedAt);
        const result = spawnSync(check.command, check.args, {
            cwd: root, encoding: 'utf8', timeout: Math.max(1, remaining), maxBuffer: 4 * 1024 * 1024
        });
        output(`[${check.name}]\n${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}\n`);
        checks.push({ name: check.name, kind: check.kind, exitCode: result.status, passed: result.status === 0 });
        if (result.status !== 0) {
            break;
        }
    }
    const after = sourceFingerprint(root);
    const receipt = {
        passed: checks.length === config.verification.length && checks.every(check => check.passed) && before === after,
        source: after, at: new Date().toISOString(), checks
    };
    if (phase === 'baseline') {
        state.baseline = receipt;
    } else {
        state.verification = receipt;
    }
    saveState(root, state);
    assertBudget(state);
    if (!receipt.passed) {
        throw new Error('Verification failed or changed source files. Inspect the output; do not mark complete.');
    }
    return receipt;
}

function recordSubagent(root, payload) {
    const state = readState(root);
    if (!state?.featureId || state.finalized) {
        return;
    }
    const name = payload.agentName ?? payload.agent_name ?? payload.agentType ?? payload.agent_type;
    if (!['builder', 'evaluator'].includes(name)) {
        return;
    }
    const source = sourceFingerprint(root);
    const agentId = payload.agentId ?? payload.agent_id;
    const hasIdentity = typeof agentId === 'string' && Boolean(agentId.trim());
    if (name === 'builder') {
        state.buildAttempts += 1;
        state.builder = hasIdentity ? { source, agentId } : null;
        state.evaluation = hasIdentity ? null : { passed: false, error: 'Builder completion is missing its subagent identity.' };
        state.verification = null;
    } else {
        try {
            if (!hasIdentity || !state.builder?.agentId || agentId === state.builder.agentId) {
                throw new Error('Builder and evaluator must have distinct, nonempty subagent identities.');
            }
            if (!state.baseline?.passed || state.builder.source !== source) {
                throw new Error('Evaluator must check the current builder output after a green baseline.');
            }
            const report = JSON.parse(payload.response ?? payload.last_assistant_message ?? '');
            if (report.feature_id !== state.featureId || !['PASS', 'FAIL'].includes(report.verdict)
                || !Array.isArray(report.criteria) || report.criteria.length !== state.criteria.length
                || new Set(report.criteria.map(item => item.criterion)).size !== state.criteria.length
                || !report.criteria.every(item => state.criteria.includes(item.criterion)
                    && typeof item.passed === 'boolean' && typeof item.evidence === 'string' && item.evidence.trim())
                || !Array.isArray(report.issues) || !report.issues.every(issue => typeof issue === 'string' && issue.trim())) {
                throw new Error('Evaluator must return valid JSON with evidence for every acceptance criterion.');
            }
            const passed = report.verdict === 'PASS' && report.criteria.every(item => item.passed) && !report.issues.length;
            state.evaluation = { passed, source, report, agentId };
        } catch (error) {
            state.evaluation = { passed: false, source, error: error.message, agentId };
        }
        state.verification = null;
    }
    saveState(root, state);
}

function finish(root, outcome, reason = '') {
    const state = activeState(root);
    if (!['pass', 'needs-rework', 'blocked'].includes(outcome) || (outcome !== 'pass' && !reason.trim())) {
        throw new Error('Finish with pass, or needs-rework/blocked plus a concrete reason.');
    }
    const registry = readJson(root, 'docs/FEATURES.json');
    const feature = registry.features.find(candidate => candidate.id === state.featureId);
    if (!feature) {
        throw new Error('The active feature is missing from FEATURES.json.');
    }
    if (outcome === 'pass') {
        assertBudget(state);
        assertConfig(root, state);
        const source = sourceFingerprint(root);
        if (!state.baseline?.passed || !state.evaluation?.passed || !state.verification?.passed
            || state.evaluation.source !== source || state.verification.source !== source
            || JSON.stringify(registry) !== state.registryBefore) {
            throw new Error('Completion refused: missing/stale evidence or unauthorized feature-registry edits.');
        }
    }
    feature.status = outcome === 'pass' ? 'complete' : outcome;
    const timestamp = new Date().toISOString();
    const runId = digest(state.sessionId).slice(0, 12);
    const summary = reason.trim().replace(/\s+/g, ' ') || 'Independent evaluator PASS and all configured checks passed.';
    fs.writeFileSync(path.join(root, 'docs/FEATURES.json'), `${JSON.stringify(registry, null, 2)}\n`);
    fs.appendFileSync(path.join(root, 'docs/PROGRESS.md'),
        `\n## Cloud Run ${runId} - ${timestamp}\n- Feature: ${state.featureId}\n- Status: ${feature.status}\n- Result: ${summary}\n- Next: Human review; no automatic merge.\n`);
    fs.writeFileSync(path.join(root, 'docs/EVALUATION.md'),
        `# Cloud Evaluation - ${state.featureId}\n\nOutcome: ${outcome}\n\n${summary}\n\n\`\`\`json\n${JSON.stringify({
            evaluation: state.evaluation ?? null, verification: state.verification ?? null
        }, null, 2)}\n\`\`\`\n`);
    fs.appendFileSync(path.join(root, 'docs/loop-run-log.md'),
        `\n### Cloud Run ${runId} - ${timestamp}\n- Feature: ${state.featureId}\n- Outcome: ${outcome}\n- Builder attempts: ${state.buildAttempts}/${state.maxRework + 1}\n- Working minutes: ${Math.ceil((Date.now() - state.startedAt) / 60_000)}/${state.maxMinutes}\n- Result: ${summary}\n`);
    Object.assign(state, { finalized: true, outcome });
    saveState(root, state);
    return { feature_id: state.featureId, outcome, review_required: true };
}

function handleHook(root, event, payload) {
    if (event === 'sessionStart') {
        const sessionId = payload.sessionId ?? payload.session_id;
        if (typeof sessionId !== 'string' || !sessionId) {
            throw new Error('The sessionStart payload must include a session ID.');
        }
        if (!payload.parentAgentId && !payload.parent_agent_id && readState(root)?.sessionId !== sessionId) {
            saveState(root, {
                sessionId, rootAgentId: payload.agentId ?? payload.agent_id ?? null,
                startedAt: Date.now(), featureId: null, finalized: false
            });
        }
        return { additionalContext: 'Solution Harness cloud mode: use the orchestrator and cloud-loop skill for one approved feature. Run begin, baseline verification, separate builder and evaluator, final verification, then finish. Never skip tests or commit/push/merge yourself. Read .github/harness/config.json and docs/PROGRESS.md.' };
    }
    if (event === 'preToolUse') {
        const toolName = payload.toolName ?? payload.tool_name;
        let argumentsValue = payload.toolArgs ?? payload.tool_input ?? {};
        if (typeof argumentsValue === 'string') {
            argumentsValue = JSON.parse(argumentsValue);
        }
        if (['bash', 'Bash', 'powershell', 'run_in_terminal'].includes(toolName)) {
            const command = argumentsValue.command ?? argumentsValue.cmd ?? '';
            const forbidden = /\bdrop\s+(?:table|database)\b|\bmkfs\b|\bformat\s+c:|\bgit\s+(?:commit|push)\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f|\brm\b[^\n;&|]*\s["']?\/["']?(?:\s|$)/i;
            if (forbidden.test(command)) {
                return { permissionDecision: 'deny', permissionDecisionReason: 'Harness policy: destructive commands and manual Git commits/pushes are blocked. Let cloud agent manage its branch.' };
            }
        }
        return {};
    }
    if (event === 'subagentStop') {
        recordSubagent(root, payload);
        return {};
    }
    if (event === 'postToolUse') {
        const state = readState(root);
        if (state) {
            fs.appendFileSync(path.join(root, runtimeDirectory, 'events.jsonl'), `${JSON.stringify({
                timestamp: new Date().toISOString(), tool: String(payload.toolName ?? payload.tool_name ?? '').slice(0, 128),
                feature_id: state.featureId, result: 'success'
            })}\n`);
        }
        return {};
    }
    if (event === 'agentStop') {
        const state = readState(root);
        const agentId = payload.agentId ?? payload.agent_id;
        if (payload.parentAgentId || payload.parent_agent_id
            || (state?.rootAgentId && agentId && agentId !== state.rootAgentId)) {
            return {};
        }
        if (state?.featureId && !state.finalized && !payload.stop_hook_active) {
            return { decision: 'block', reason: 'The cloud run is unfinished. Use runtime.cjs finish pass only with current evaluator/test evidence, or finish blocked/needs-rework with a reason. Report the checkpoint.' };
        }
        return {};
    }
    throw new Error(`Unknown hook event: ${event}`);
}

function main(argumentsList) {
    const root = path.resolve(__dirname, '../..');
    const [command, ...argumentsRest] = argumentsList;
    if (['sessionStart', 'preToolUse', 'postToolUse', 'subagentStop', 'agentStop'].includes(command)) {
        try {
            const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
            process.stdout.write(JSON.stringify(handleHook(root, command, payload)));
        } catch (error) {
            if (command === 'preToolUse') {
                process.stdout.write(JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: `Harness hook error: ${error.message}` }));
            } else {
                process.stderr.write(`Harness hook error: ${error.message}\n`);
                process.exitCode = 1;
            }
        }
        return;
    }
    let result;
    if (command === 'begin') {
        result = begin(root, argumentsRest[0]);
    } else if (command === 'verify') {
        result = verify(root, argumentsRest[0], text => process.stdout.write(text));
    } else if (command === 'finish') {
        result = finish(root, argumentsRest[0], argumentsRest.slice(1).join(' '));
    } else if (command === 'status') {
        result = readState(root);
    } else {
        throw new Error('Usage: runtime.cjs begin FEATURE | verify baseline|final | finish pass|needs-rework|blocked [reason] | status');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = { begin, finish, handleHook, loadConfig, readState, sourceFingerprint, verify };