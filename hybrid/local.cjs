'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { repository, git, noLinks, absent } = require('../parallel/runtime.cjs');
const { requireValue, strings } = require('../parallel/model.cjs');

const MAX_TIMEOUT_SECONDS = 3600;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const STOP_TIMEOUT_MS = 3000;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const RUN_ID = /^(?:run-[a-z0-9]+(?:-[a-z0-9]+)*|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;

function validPid(pid) {
    return Number.isInteger(pid) && pid > 0 && pid <= 0x7fffffff;
}

function processAlive(pid) {
    if (!validPid(pid)) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) {
        if (error.code === 'EPERM') return true;
        if (error.code === 'ESRCH') return false;
        throw error;
    }
}

function text(value, label) {
    requireValue(typeof value === 'string' && value.trim() && !value.includes('\0'), `Invalid ${label}`);
}

function worktreeRoot(root) {
    text(root, 'workspace root');
    noLinks(root);
    root = repository(root);
    noLinks(path.join(root, '.git'));
    const directory = path.resolve(git(root, ['rev-parse', '--absolute-git-dir']));
    noLinks(directory);
    return { workspace: root, directory };
}

function createWorkspace(root, runId, storyId, attempt, baseSha) {
    requireValue(typeof runId === 'string' && runId.length <= 80 && RUN_ID.test(runId), 'Invalid stable run ID');
    requireValue(typeof storyId === 'string' && storyId.length <= 80 && /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(storyId), 'Invalid stable story ID');
    requireValue(Number.isSafeInteger(attempt) && attempt > 0, 'Invalid workspace attempt');
    requireValue(typeof baseSha === 'string' && SHA.test(baseSha), 'A full base commit SHA is required');
    root = worktreeRoot(root).workspace;
    requireValue(git(root, ['rev-parse', '--verify', `${baseSha}^{commit}`]) === baseSha, 'Base SHA must identify a commit');

    const branch = `harness-${runId}-${storyId.toLowerCase()}-${attempt}`;
    const directory = path.join(path.dirname(root), `.harness-hybrid-worktrees-${path.basename(root)}`, runId);
    const workspace = path.join(directory, `${storyId}-${attempt}`);
    noLinks(workspace);
    requireValue(absent(workspace), 'Workspace already exists; never overwrite an attempt');
    const existing = git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], true);
    requireValue(!existing.error && existing.status === 1, 'Workspace branch already exists or could not be checked');
    fs.mkdirSync(directory, { recursive: true });
    noLinks(workspace);
    fs.mkdirSync(workspace);
    noLinks(workspace);
    git(root, ['worktree', 'add', '--quiet', '-b', branch, workspace, baseSha]);
    noLinks(workspace);
    requireValue(git(workspace, ['rev-parse', 'HEAD']) === baseSha, 'New workspace base changed');
    return { workspace, branch, base_sha: baseSha };
}

function privateReport(assignment, fresh) {
    requireValue(assignment && typeof assignment === 'object' && !Array.isArray(assignment), 'An assignment is required');
    text(assignment.prompt, 'assignment prompt');
    requireValue(typeof assignment.base_sha === 'string' && SHA.test(assignment.base_sha), 'A full assignment base SHA is required');
    text(assignment.report_path, 'report path');
    requireValue(path.isAbsolute(assignment.report_path), 'Report path must be absolute');
    const { workspace, directory } = worktreeRoot(assignment.workspace);
    requireValue(git(workspace, ['rev-parse', 'HEAD']) === assignment.base_sha, 'Workspace HEAD does not match the assignment base SHA');
    const common = path.resolve(workspace, git(workspace, ['rev-parse', '--git-common-dir']));
    noLinks(common);
    requireValue(path.relative(common, directory) !== '', 'Use a separate worktree with its own private Git directory');
    const backlink = path.join(directory, 'gitdir');
    noLinks(backlink);
    requireValue(path.relative(path.join(workspace, '.git'), path.resolve(directory, fs.readFileSync(backlink, 'utf8').trim())) === '', 'Private Git directory belongs to another worktree');

    const report = path.resolve(assignment.report_path);
    const relative = path.relative(directory, report);
    requireValue(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Report must be inside this worktree private Git directory');
    noLinks(report);
    if (fresh) requireValue(absent(report), 'Report already exists; stale reports cannot complete an attempt');
    else requireValue(!absent(report) && fs.lstatSync(report).isFile() && fs.lstatSync(report).nlink === 1, 'Local CLI did not produce a private regular report file');
    return { workspace, directory, report };
}

function failure(code, message) {
    return Object.assign(new Error(message), { code });
}

function stopChild(child, pid) {
    if (!validPid(pid) || child.pid !== pid || child.exitCode !== null || child.signalCode !== null) return;
    try { stopTree(pid); }
    finally { child.kill('SIGKILL'); }
}

function stopTree(pid) {
    if (process.platform === 'win32') {
        const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
        childProcess.spawnSync(executable, ['/PID', String(pid), '/T', '/F'], {
            shell: false, windowsHide: true, timeout: STOP_TIMEOUT_MS, stdio: 'ignore'
        });
    } else {
        const listing = childProcess.spawnSync('ps', ['-axo', 'pid=,ppid='], {
            encoding: 'utf8', shell: false, timeout: STOP_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES
        });
        if (!listing.error && listing.status === 0) {
            const children = new Map();
            for (const line of listing.stdout.trim().split('\n')) {
                const [id, parent] = line.trim().split(/\s+/).map(Number);
                if (validPid(id) && validPid(parent)) {
                    if (!children.has(parent)) children.set(parent, []);
                    children.get(parent).push(id);
                }
            }
            const seen = new Set([pid]);
            function stopDescendants(parent) {
                for (const id of children.get(parent) || []) {
                    if (seen.has(id)) continue;
                    seen.add(id);
                    stopDescendants(id);
                    try { process.kill(id, 'SIGKILL'); }
                    catch (error) { if (error.code !== 'ESRCH') throw error; }
                }
            }
            stopDescendants(pid);
        }
    }
}

async function launch(localConfig, assignment, { spawnImpl = childProcess.spawn, onStart = () => {}, env = process.env } = {}) {
    requireValue(localConfig && typeof localConfig === 'object' && !Array.isArray(localConfig), 'Local CLI configuration is required');
    text(localConfig.command, 'CLI executable');
    requireValue(localConfig.permissions_reviewed === true, 'CLI scoped permissions must be explicitly reviewed');
    requireValue(Array.isArray(localConfig.args) && localConfig.args.every(arg => typeof arg === 'string' && !arg.includes('\0')), 'CLI arguments must be strings without NUL characters');
    requireValue(localConfig.args.filter(arg => arg === '{prompt}').length === 1
        && localConfig.args.every(arg => arg === '{prompt}' || !arg.includes('{prompt}')), 'CLI arguments require exactly one literal {prompt} placeholder');
    requireValue(!localConfig.args.some(arg => /(?:^|\s)--(?:allow-all(?:-[a-z-]+)?|yolo)(?=$|[\s=])/i.test(arg)), 'Broad CLI permission flags are not allowed; review scoped permissions');
    requireValue(!localConfig.args.some(arg => /^--(?:github-token|token|api-key|secret|password|authorization)(?:=|$)/i.test(arg)), 'Provision credentials outside CLI arguments');
    requireValue(!localConfig.args.some(arg => /^--(?:resume|continue|session-id)(?:=|$)/i.test(arg)), 'Each builder and evaluator needs a fresh CLI session');
    requireValue(Number.isInteger(localConfig.timeout_seconds) && localConfig.timeout_seconds > 0
        && localConfig.timeout_seconds <= MAX_TIMEOUT_SECONDS, 'Invalid bounded CLI timeout');
    requireValue(typeof spawnImpl === 'function' && typeof onStart === 'function', 'Invalid CLI launch callbacks');
    requireValue(env && typeof env === 'object' && !Array.isArray(env), 'Invalid CLI environment');
    requireValue(assignment && typeof assignment === 'object' && !Array.isArray(assignment), 'An assignment is required');
    const sensitive = strings(assignment.sensitive_env_keys === undefined ? [] : assignment.sensitive_env_keys, 'Sensitive environment keys');
    requireValue(sensitive.every(key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)), 'Invalid sensitive environment key');
    const location = privateReport(assignment, true);
    const expected = {
        workspace: location.workspace, report_path: location.report,
        prompt: assignment.prompt, base_sha: assignment.base_sha
    };
    const excluded = new Set(['NODE_TEST_CONTEXT', ...sensitive.map(key => key.toUpperCase())]);
    const environment = Object.fromEntries(Object.entries(env).filter(([key]) => !excluded.has(key.toUpperCase()) && !/^JIRA(?:_|$)/i.test(key)));
    const pathKey = Object.keys(environment).find(key => key.toUpperCase() === 'PATH') || 'PATH';
    environment[pathKey] = [path.dirname(process.execPath), environment[pathKey]].filter(Boolean).join(path.delimiter);
    environment.PLUGIN_ROOT = path.resolve(__dirname, '..');
    const args = localConfig.args.map(arg => arg === '{prompt}' ? expected.prompt : arg);
    requireValue(!/^\s*--(?:allow-all(?:-[a-z-]+)?|yolo)(?=$|[\s=])/i.test(expected.prompt), 'Broad CLI permission flags cannot be supplied as the prompt argument');
    const deadline = assignment.deadline_at === undefined ? null : Date.parse(assignment.deadline_at);
    requireValue(deadline === null || (typeof assignment.deadline_at === 'string' && Number.isFinite(deadline)), 'Invalid absolute assignment deadline');
    if (deadline !== null && deadline <= Date.now()) throw failure('LOCAL_CLI_TIMEOUT', 'Local assignment budget or lease expired before launch');
    let child;
    try {
        child = spawnImpl(localConfig.command, args, {
            cwd: location.workspace, env: environment, shell: false, detached: false,
            windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch {
        throw failure('LOCAL_CLI_START', 'Local CLI executable could not be started');
    }
    const pid = child.pid;
    const result = await new Promise((resolve, reject) => {
        let problem, closed = false, started = false, settled = false, outputBytes = 0, outcome;
        let timer, stopTimer;
        function finish(force = false) {
            if (settled || (!force && (!closed || !started))) return;
            settled = true;
            clearTimeout(timer);
            clearTimeout(stopTimer);
            if (problem) reject(problem);
            else resolve(outcome);
        }
        function fail(error) {
            if (settled || problem) return;
            problem = error;
            started = true;
            try { stopChild(child, pid); }
            catch { problem = failure('LOCAL_CLI_STOP', 'Local CLI failed and its process tree could not be stopped'); }
            stopTimer = setTimeout(() => {
                child.stdout.destroy();
                child.stderr.destroy();
                try {
                    if (validPid(pid) && processAlive(pid)) problem = failure('LOCAL_CLI_STOP', 'Local CLI child shutdown could not be confirmed');
                } catch {
                    problem = failure('LOCAL_CLI_STOP', 'Local CLI child shutdown could not be confirmed');
                }
                finish(true);
            }, STOP_TIMEOUT_MS);
            finish();
        }
        child.on('error', error => {
            const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : '';
            fail(failure('LOCAL_CLI_START', `Local CLI executable failed${code}`));
        });
        child.once('close', (exitCode, signal) => {
            closed = true;
            outcome = { pid, exit_code: exitCode, signal, report_path: location.report };
            finish();
        });
        for (const stream of [child.stdout, child.stderr]) {
            stream.on('data', chunk => {
                outputBytes = Math.min(MAX_OUTPUT_BYTES + 1, outputBytes + Buffer.byteLength(chunk));
                if (outputBytes > MAX_OUTPUT_BYTES) fail(failure('LOCAL_CLI_OUTPUT', 'Local CLI exceeded the bounded output limit'));
            });
            stream.on('error', () => fail(failure('LOCAL_CLI_OUTPUT', 'Local CLI output stream failed')));
        }
        const timeout = deadline === null ? localConfig.timeout_seconds * 1000 : Math.max(1, Math.min(localConfig.timeout_seconds * 1000, deadline - Date.now()));
        timer = setTimeout(() => fail(failure('LOCAL_CLI_TIMEOUT', 'Local CLI exceeded its configured timeout or assignment deadline')), timeout);
        if (validPid(pid)) {
            try {
                const notification = onStart(pid);
                if (notification && typeof notification.then === 'function') {
                    Promise.resolve(notification).then(() => { started = true; finish(); }, () => fail(failure('LOCAL_CLI_START', 'Local CLI onStart callback failed')));
                } else started = true;
            } catch {
                fail(failure('LOCAL_CLI_START', 'Local CLI onStart callback failed'));
            }
        } else started = true;
    });
    requireValue(validPid(result.pid), 'Local CLI did not provide a valid child PID');
    if (result.exit_code !== 0 || result.signal) throw failure('LOCAL_CLI_EXIT', `Local CLI failed (exit ${result.exit_code}, signal ${result.signal || 'none'})`);
    const finalLocation = privateReport(expected, false);
    requireValue(finalLocation.workspace === location.workspace && finalLocation.directory === location.directory, 'CLI workspace identity changed');
    return result;
}

module.exports = { createWorkspace, launch, processAlive };
