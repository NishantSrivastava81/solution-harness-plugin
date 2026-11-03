'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const local = require('../hybrid/local.cjs');
const { git, fingerprint, atomicJson, absent } = require('../parallel/runtime.cjs');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(__dirname, '.hybrid-local-fixture-'));
    const root = path.join(directory, 'project with spaces');
    const children = [];
    t.after(async () => {
        await Promise.all(children.map(child => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            return new Promise(resolve => {
                const timer = setTimeout(resolve, 3000);
                child.once('close', () => { clearTimeout(timer); resolve(); });
                child.kill('SIGKILL');
            });
        }));
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'));
    fs.writeFileSync(path.join(root, 'src', 'story.cjs'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(root, 'docs', 'PROGRESS.md'), '# Existing progress\n');
    git(root, ['init', '--quiet', '-b', 'main']);
    fs.appendFileSync(path.join(root, '.git', 'config'), `
[user]
    name = Hybrid Test
    email = hybrid-test@example.invalid
[commit]
    gpgsign = false
[core]
    autocrlf = false
    hooksPath = ${JSON.stringify(path.join(directory, 'absent-hooks'))}
`);
    git(root, ['add', '.']);
    git(root, ['commit', '--quiet', '-m', 'test: initialize fixture']);
    const base = git(root, ['rev-parse', 'HEAD']);
    return {
        directory, root, base,
        spawn(command, args, options) {
            const child = spawn(command, args, options);
            children.push(child);
            return child;
        }
    };
}

function snapshot(root) {
    return {
        fingerprint: fingerprint(root),
        branch: git(root, ['branch', '--show-current']),
        progress: fs.readFileSync(path.join(root, 'docs', 'PROGRESS.md'), 'utf8')
    };
}

function assignment(f, run = 'run-local', story = 'F001-S01', attempt = 1) {
    const workspace = local.createWorkspace(f.root, run, story, attempt, f.base);
    const directory = git(workspace.workspace, ['rev-parse', '--absolute-git-dir']);
    return {
        ...workspace, prompt: 'Build only the assigned module',
        report_path: path.join(directory, 'hybrid-report.json')
    };
}

function config(f, assigned, script, extra = []) {
    const executable = path.join(f.directory, `fake-cli-${crypto.randomUUID()}.cjs`);
    fs.writeFileSync(executable, script);
    return {
        command: process.execPath,
        args: [executable, assigned.report_path, '{prompt}', ...extra],
        timeout_seconds: 5, permissions_reviewed: true
    };
}

function junction(target, link) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function assertNotStored(directory, values) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) assertNotStored(file, values);
        else if (entry.isFile()) {
            const bytes = fs.readFileSync(file);
            for (const value of values) assert.equal(bytes.includes(Buffer.from(value)), false, `Private content stored in ${entry.name}`);
        }
    }
}

const REPORT = "require('node:fs').writeFileSync(process.argv[2], JSON.stringify({ complete: true }));";

test('exports only the local workspace, attached launch and PID probe APIs', () => {
    assert.deepEqual(Object.keys(local).sort(), ['createWorkspace', 'launch', 'processAlive']);
    assert.equal(local.launch.constructor.name, 'AsyncFunction');
});

test('processAlive probes only specific valid positive numeric PIDs', t => {
    const calls = [];
    t.mock.method(process, 'kill', (pid, signal) => {
        calls.push([pid, signal]);
        if (pid === 1235) throw Object.assign(new Error('missing'), { code: 'ESRCH' });
        if (pid === 1236) throw Object.assign(new Error('protected'), { code: 'EPERM' });
    });
    for (const value of [undefined, null, false, 0, -1, -1234, '1234', 1.5, NaN, Infinity, 0x80000000]) {
        assert.equal(local.processAlive(value), false);
    }
    assert.deepEqual(calls, []);
    assert.equal(local.processAlive(1234), true);
    assert.equal(local.processAlive(1235), false);
    assert.equal(local.processAlive(1236), true);
    assert.deepEqual(calls, [[1234, 0], [1235, 0], [1236, 0]]);
});

test('processAlive recognizes the current process and an exited fake child', () => {
    assert.equal(local.processAlive(process.pid), true);
    const ended = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
        shell: false, detached: false, stdio: 'ignore'
    });
    assert.equal(ended.status, 0);
    assert.equal(local.processAlive(ended.pid), false);
});

test('creates distinct sibling run/story/attempt worktrees without coordinator assignments', t => {
    const f = fixture(t);
    const before = snapshot(f.root);
    const requests = [
        ['run-one', 'F001-S01', 1], ['run-one', 'F001-S02', 1],
        ['run-one', 'F001-S01', 2], ['run-two', 'F001-S01', 1],
        ['aabbccdd-1234-4567-890a-aabbccddeeff', 'F001-S01', 1]
    ];
    const workspaces = requests.map(([run, story, attempt]) => {
        const created = local.createWorkspace(f.root, run, story, attempt, f.base);
        assert.deepEqual(created, {
            workspace: path.join(f.directory, `.harness-hybrid-worktrees-${path.basename(f.root)}`, run, `${story}-${attempt}`),
            branch: `harness-${run}-${story.toLowerCase()}-${attempt}`, base_sha: f.base
        });
        assert.equal(git(created.workspace, ['rev-parse', 'HEAD']), f.base);
        assert.equal(git(created.workspace, ['branch', '--show-current']), created.branch);
        assert.equal(fs.lstatSync(path.join(created.workspace, '.git')).isFile(), true);
        assert.equal(absent(path.join(git(created.workspace, ['rev-parse', '--absolute-git-dir']), 'harness-assignment.json')), true);
        fs.writeFileSync(path.join(created.workspace, 'src', 'story.cjs'), `${story}-${attempt}-${run}\n`);
        return created.workspace;
    });
    assert.equal(new Set(workspaces).size, requests.length);
    assert.deepEqual(snapshot(f.root), before);
    assert.equal(fs.readFileSync(path.join(f.root, 'src', 'story.cjs'), 'utf8'), 'module.exports = 1;\n');
});

test('uses the exact approved historical base and preserves dirty coordinator changes', t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, 'src', 'story.cjs'), 'module.exports = 2;\n');
    git(f.root, ['add', '.']);
    git(f.root, ['commit', '--quiet', '-m', 'test: advance fixture']);
    fs.writeFileSync(path.join(f.root, 'src', 'story.cjs'), 'module.exports = 3;\n');
    fs.writeFileSync(path.join(f.root, 'untracked.txt'), 'Keep this local change.\n');
    const before = snapshot(f.root);
    const created = local.createWorkspace(f.root, 'run-base', 'F001-S01', 1, f.base);
    assert.equal(created.base_sha, f.base);
    assert.equal(fs.readFileSync(path.join(created.workspace, 'src', 'story.cjs'), 'utf8'), 'module.exports = 1;\n');
    assert.deepEqual(snapshot(f.root), before);
});

test('rejects unsafe IDs, attempts and noncanonical or nonexistent base commits before creation', t => {
    const f = fixture(t);
    const valid = [f.root, 'run-valid', 'F001-S01', 1, f.base];
    for (const [index, value, expected] of [
        [1, '../run-escape', /run ID/], [1, 'run-a\\b', /run ID/], [1, 'run-A', /run ID/],
        [1, 'run-a..b', /run ID/], [1, 'run-a--b', /run ID/], [1, `run-${'a'.repeat(81)}`, /run ID/],
        [2, '../F001-S01', /story ID/], [2, 'F001/S01', /story ID/], [2, 'F001-S01.lock', /story ID/],
        [2, 'F001-S01\0', /story ID/], [2, '', /story ID/],
        [3, 0, /attempt/], [3, -1, /attempt/], [3, '1', /attempt/], [3, 1.5, /attempt/],
        [3, Number.MAX_SAFE_INTEGER + 1, /attempt/],
        [4, 'HEAD', /full base/], [4, f.base.slice(0, 12), /full base/],
        [4, `${f.base}^`, /full base/], [4, '0'.repeat(40), /Git/]
    ]) {
        const args = [...valid];
        args[index] = value;
        assert.throws(() => local.createWorkspace(...args), expected);
    }
    assert.equal(absent(path.join(f.directory, `.harness-hybrid-worktrees-${path.basename(f.root)}`)), true);
});

test('rejects nonrepository, nested and symlinked root paths', t => {
    const f = fixture(t);
    const outside = path.join(f.directory, 'not-a-repository');
    fs.mkdirSync(outside);
    const alias = path.join(f.directory, 'alias');
    junction(f.root, alias);
    for (const [root, expected] of [
        ['', /workspace root/], [outside, /Git|root/], [path.join(f.root, 'src'), /root/],
        [alias, /Symlinks and junctions/]
    ]) {
        assert.throws(() => local.createWorkspace(root, 'run-root', 'F001-S01', 1, f.base), expected);
    }
});

test('never overwrites existing workspaces, empty paths or branches', t => {
    const f = fixture(t);
    const created = local.createWorkspace(f.root, 'run-repeat', 'F001-S01', 1, f.base);
    fs.writeFileSync(path.join(created.workspace, 'keep.txt'), 'Do not replace.\n');
    assert.throws(() => local.createWorkspace(f.root, 'run-repeat', 'F001-S01', 1, f.base), /already exists/);
    assert.equal(fs.readFileSync(path.join(created.workspace, 'keep.txt'), 'utf8'), 'Do not replace.\n');
    const empty = path.join(f.directory, `.harness-hybrid-worktrees-${path.basename(f.root)}`, 'run-repeat', 'F001-S02-1');
    fs.mkdirSync(empty);
    assert.throws(() => local.createWorkspace(f.root, 'run-repeat', 'F001-S02', 1, f.base), /already exists/);
    assert.deepEqual(fs.readdirSync(empty), []);
    git(f.root, ['branch', 'harness-run-branch-f001-s01-1', f.base]);
    assert.throws(() => local.createWorkspace(f.root, 'run-branch', 'F001-S01', 1, f.base), /branch already exists/);
    assert.equal(absent(path.join(f.directory, `.harness-hybrid-worktrees-${path.basename(f.root)}`, 'run-branch')), true);
    assert.equal(git(f.root, ['rev-parse', 'harness-run-branch-f001-s01-1']), f.base);
});

test('rejects junctions at the worktree container, run directory and destination', t => {
    for (const level of ['container', 'run', 'workspace']) {
        const f = fixture(t);
        const target = path.join(f.directory, 'unrelated');
        fs.mkdirSync(target);
        const container = path.join(f.directory, `.harness-hybrid-worktrees-${path.basename(f.root)}`);
        const run = path.join(container, 'run-links');
        const destination = path.join(run, 'F001-S01-1');
        junction(target, level === 'container' ? container : level === 'run' ? run : destination);
        assert.throws(() => local.createWorkspace(f.root, 'run-links', 'F001-S01', 1, f.base), /Symlinks and junctions/);
        assert.deepEqual(fs.readdirSync(target), []);
        assert.equal(git(f.root, ['show-ref', '--verify', '--quiet', 'refs/heads/harness-run-links-f001-s01-1'], true).status, 1);
    }
});

test('launch substitutes only the approved prompt, captures the exact PID and stores no raw output or credentials', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const prompt = `Assigned task with spaces; $() and quotes: ${crypto.randomUUID()}`;
    a.prompt = prompt;
    a.sensitive_env_keys = ['CUSTOM_JIRA_TOKEN', 'ATLASSIAN_API_TOKEN'];
    const output = `private-output-${crypto.randomUUID()}`;
    const jira = `private-jira-${crypto.randomUUID()}`;
    const custom = `private-custom-${crypto.randomUUID()}`;
    const suppliedEnv = {
        ...process.env, NODE_TEST_CONTEXT: 'child-v8', node_test_context: 'child-v8',
        JIRA_API_TOKEN: jira, jira_email: jira, JIRA_BASE_URL: jira,
        CUSTOM_JIRA_TOKEN: custom, atlassian_api_token: custom, HYBRID_KEEP: 'retained'
    };
    const originalEnv = { ...suppliedEnv };
    const c = config(f, a, `
        const fs = require('node:fs');
        const path = require('node:path');
        const hash = require('node:crypto').createHash('sha256').update(process.argv[3]).digest('hex');
        const removed = ['NODE_TEST_CONTEXT', 'node_test_context', 'JIRA_API_TOKEN', 'jira_email',
            'JIRA_BASE_URL', 'CUSTOM_JIRA_TOKEN', 'atlassian_api_token'].every(key => process.env[key] === undefined);
        fs.writeFileSync(path.join(process.cwd(), 'src', 'story.cjs'), 'module.exports = 9;\\n');
        fs.writeFileSync(process.argv[2], JSON.stringify({
            cwd: process.cwd(), prompt_matches: hash === process.argv[4], removed,
            kept: process.env.HYBRID_KEEP === 'retained'
        }));
        process.stdout.write(process.argv[5]);
        process.stderr.write(process.argv[5]);
        setTimeout(() => {}, 80);
    `, [crypto.createHash('sha256').update(prompt).digest('hex'), output, '--allow-tool=shell(node --version)', '--allow-path=src']);
    const before = snapshot(f.root);
    const privateDirectory = path.dirname(a.report_path);
    atomicJson(path.join(privateDirectory, 'harness-assignment.json'), {
        version: 1, role: 'builder', run_id: 'run-local', worktree: a.workspace
    });
    a.coordinator_root = f.root;
    a.execution = 'local';
    const privateFiles = fs.readdirSync(privateDirectory).sort();
    let child, observedPid, spawnOptions, spawnArgs, completed = false;
    const pending = local.launch(c, a, {
        env: suppliedEnv,
        spawnImpl(command, args, options) {
            assert.equal(command, process.execPath);
            spawnOptions = options;
            spawnArgs = args;
            child = f.spawn(command, args, options);
            return child;
        },
        onStart(pid) {
            assert.equal(completed, false);
            assert.equal(pid, child.pid);
            assert.equal(local.processAlive(pid), true);
            observedPid = pid;
        }
    });
    assert.equal(observedPid, child.pid);
    const result = await pending;
    completed = true;
    assert.deepEqual(result, { pid: observedPid, exit_code: 0, signal: null, report_path: a.report_path });
    assert.deepEqual(spawnArgs, c.args.map(arg => arg === '{prompt}' ? prompt : arg));
    assert.equal(spawnOptions.cwd, a.workspace);
    assert.equal(spawnOptions.shell, false);
    assert.equal(spawnOptions.detached, false);
    assert.deepEqual(spawnOptions.stdio, ['ignore', 'pipe', 'pipe']);
    assert.notEqual(spawnOptions.env, suppliedEnv);
    assert.deepEqual(suppliedEnv, originalEnv);
    assert.equal(c.args[2], '{prompt}');
    assert.deepEqual(JSON.parse(fs.readFileSync(a.report_path, 'utf8')), {
        cwd: a.workspace, prompt_matches: true, removed: true, kept: true
    });
    assert.deepEqual(fs.readdirSync(privateDirectory).sort(), [...privateFiles, path.basename(a.report_path)].sort());
    assertNotStored(f.directory, [prompt, output, jira, custom]);
    assert.deepEqual(snapshot(f.root), before);
    assert.equal(git(a.workspace, ['rev-parse', 'HEAD']), a.base_sha);
    assert.equal(local.processAlive(result.pid), false);
});

test('awaits concurrent attached launches from distinct worktrees', async t => {
    const f = fixture(t);
    const assignments = [assignment(f, 'run-overlap', 'F001-S01'), assignment(f, 'run-overlap', 'F001-S02')];
    const before = snapshot(f.root);
    const pids = [];
    const pending = assignments.map(a => {
        const c = config(f, a, `
            setTimeout(() => {
                require('node:fs').writeFileSync(process.argv[2], JSON.stringify({ cwd: process.cwd() }));
            }, 120);
        `);
        c.timeout_seconds = 30;
        return local.launch(c, a, { spawnImpl: f.spawn, onStart: pid => pids.push(pid) });
    });
    const results = await Promise.all(pending);
    assert.equal(pids.length, 2);
    assert.notEqual(pids[0], pids[1]);
    assert.deepEqual(results.map(result => result.pid), pids);
    assert.deepEqual(assignments.map(a => JSON.parse(fs.readFileSync(a.report_path, 'utf8')).cwd), assignments.map(a => a.workspace));
    assert.deepEqual(snapshot(f.root), before);
});

test('requires reviewed scoped arguments, exactly one literal placeholder and a bounded timeout before spawning', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const c = config(f, a, REPORT);
    let calls = 0;
    const options = { spawnImpl() { calls += 1; throw new Error('Must not spawn'); } };
    for (const [change, expected] of [
        [{ command: '' }, /executable/], [{ command: 'node\0' }, /executable/],
        [{ permissions_reviewed: false }, /reviewed/], [{ permissions_reviewed: undefined }, /reviewed/],
        [{ args: null }, /arguments/], [{ args: [42, '{prompt}'] }, /arguments/],
        [{ args: ['bad\0', '{prompt}'] }, /arguments/],
        [{ args: [] }, /literal/], [{ args: ['{prompt}', '{prompt}'] }, /literal/],
        [{ args: ['--prompt={prompt}'] }, /literal/],
        [{ args: ['{prompt}', 'prefix{prompt}'] }, /literal/],
        ...['--allow-all-tools', '--allow-all-paths', '--allow-all', '--yolo', '--allow-all-urls',
            '--ALLOW-ALL-TOOLS', '--yolo=true', '--allow-all-tools=false', ' --allow-all ']
            .map(flag => [{ args: ['{prompt}', flag] }, /Broad CLI permission/]),
        ...[0, -1, 0.5, '1', 3601, Infinity].map(timeout => [{ timeout_seconds: timeout }, /bounded CLI timeout/])
    ]) {
        await assert.rejects(local.launch({ ...c, ...change }, a, options), expected);
    }
    assert.equal(calls, 0);
    assert.equal(absent(a.report_path), true);
});

test('rejects mismatched HEAD, coordinator or foreign report directories and malformed assignments before spawning', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const other = assignment(f, 'run-foreign', 'F001-S02');
    const c = config(f, a, REPORT);
    let calls = 0;
    const options = { spawnImpl() { calls += 1; throw new Error('Must not spawn'); } };
    const before = snapshot(f.root);
    for (const [change, expected] of [
        [{ workspace: f.root, report_path: path.join(f.root, '.git', 'report.json') }, /separate worktree/],
        [{ workspace: path.join(a.workspace, 'src') }, /root/],
        [{ workspace: '' }, /workspace root/],
        [{ base_sha: '0'.repeat(40) }, /HEAD/], [{ base_sha: 'HEAD' }, /full assignment/],
        [{ prompt: '' }, /prompt/], [{ prompt: 'bad\0prompt' }, /prompt/],
        [{ prompt: '--yolo' }, /Broad CLI permission/],
        [{ report_path: path.join(a.workspace, 'report.json') }, /private Git directory/],
        [{ report_path: path.join(f.root, '.git', 'report.json') }, /private Git directory/],
        [{ report_path: other.report_path }, /private Git directory/],
        [{ report_path: path.dirname(a.report_path) }, /private Git directory/],
        [{ report_path: 'relative-report.json' }, /absolute/],
        [{ report_path: '' }, /report path/],
        [{ sensitive_env_keys: 'JIRA_API_TOKEN' }, /array/], [{ sensitive_env_keys: null }, /array/],
        [{ sensitive_env_keys: ['BAD=KEY'] }, /environment key/],
        [{ sensitive_env_keys: ['JIRA_API_TOKEN', 'JIRA_API_TOKEN'] }, /duplicates/]
    ]) {
        await assert.rejects(local.launch(c, { ...a, ...change }, options), expected);
    }
    assert.equal(calls, 0);
    assert.deepEqual(snapshot(f.root), before);
});

test('rejects stale reports and symlinked workspace or report parents', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const c = config(f, a, REPORT);
    let calls = 0;
    const options = { spawnImpl() { calls += 1; throw new Error('Must not spawn'); } };
    atomicJson(a.report_path, { stale: true });
    await assert.rejects(local.launch(c, a, options), /already exists/);
    fs.unlinkSync(a.report_path);
    const alias = path.join(f.directory, 'worker-alias');
    junction(a.workspace, alias);
    await assert.rejects(local.launch(c, { ...a, workspace: alias }, options), /Symlinks and junctions/);
    const outside = path.join(f.directory, 'report-target');
    fs.mkdirSync(outside);
    const link = path.join(path.dirname(a.report_path), 'linked-reports');
    junction(outside, link);
    await assert.rejects(local.launch(c, { ...a, report_path: path.join(link, 'report.json') }, options), /Symlinks and junctions/);
    assert.equal(calls, 0);
    assert.deepEqual(fs.readdirSync(outside), []);
});

test('reports an absent executable as failure without a fabricated PID or raw prompt', async t => {
    const f = fixture(t);
    const a = assignment(f);
    a.prompt = `private-prompt-${crypto.randomUUID()}`;
    let calls = 0;
    await assert.rejects(local.launch({
        command: path.join(f.directory, 'not-installed-copilot.exe'),
        args: ['{prompt}'], timeout_seconds: 2, permissions_reviewed: true
    }, a, { spawnImpl: f.spawn, onStart() { calls += 1; } }), error => {
        assert.equal(error.code, 'LOCAL_CLI_START');
        assert.match(error.message, /executable.*ENOENT/);
        assert.equal(error.message.includes(a.prompt), false);
        assert.equal(Object.hasOwn(error, 'spawnargs'), false);
        assert.equal(Object.hasOwn(error, 'cause'), false);
        return true;
    });
    assert.equal(calls, 0);
    assert.equal(absent(a.report_path), true);
    assertNotStored(f.directory, [a.prompt]);
});

test('sanitizes synchronous spawn failures instead of exposing spawn arguments', async t => {
    const f = fixture(t);
    const a = assignment(f);
    a.prompt = `private-prompt-${crypto.randomUUID()}`;
    const c = config(f, a, REPORT);
    await assert.rejects(local.launch(c, a, {
        spawnImpl() { throw new Error(a.prompt); }
    }), error => {
        assert.equal(error.code, 'LOCAL_CLI_START');
        assert.equal(error.message.includes(a.prompt), false);
        assert.equal(Object.hasOwn(error, 'cause'), false);
        return true;
    });
});

test('snapshots the assigned report path before asynchronous PID registration can mutate the input', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const report = a.report_path;
    const marker = path.join(path.dirname(report), 'assignment-marker.json');
    atomicJson(marker, { version: 1 });
    const c = config(f, a, 'process.exitCode = 0;');
    await assert.rejects(local.launch(c, a, {
        spawnImpl: f.spawn,
        onStart() { a.report_path = marker; }
    }), /did not produce a private regular report/);
    assert.equal(absent(report), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), { version: 1 });
});

test('rejects nonzero exits even if a report exists and never retains CLI output', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const output = `private-output-${crypto.randomUUID()}`;
    const c = config(f, a, `${REPORT}
        process.stdout.write(process.argv[4]);
        process.stderr.write(process.argv[4]);
        process.exitCode = 7;
    `, [output]);
    let pid;
    const before = snapshot(f.root);
    await assert.rejects(local.launch(c, a, { spawnImpl: f.spawn, onStart: value => { pid = value; } }), error => {
        assert.equal(error.code, 'LOCAL_CLI_EXIT');
        assert.match(error.message, /exit 7/);
        assert.equal(error.message.includes(output), false);
        return true;
    });
    assert.equal(local.processAlive(pid), false);
    assertNotStored(f.directory, [output]);
    assert.deepEqual(snapshot(f.root), before);
});

test('rejects successful exit without a report or with a directory instead of a report', async t => {
    const f = fixture(t);
    const a = assignment(f);
    for (const script of ['process.exitCode = 0;', "require('node:fs').mkdirSync(process.argv[2]);"]) {
        const c = config(f, a, script);
        await assert.rejects(local.launch(c, a, { spawnImpl: f.spawn }), /did not produce a private regular report/);
        if (!absent(a.report_path)) fs.rmdirSync(a.report_path);
    }
});

test('rechecks report parent links after the CLI exits', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const outside = path.join(f.directory, 'outside-reports');
    fs.mkdirSync(outside);
    a.report_path = path.join(path.dirname(a.report_path), 'late-link', 'report.json');
    const c = config(f, a, `
        const fs = require('node:fs'), path = require('node:path');
        fs.symlinkSync(process.argv[4], path.dirname(process.argv[2]), process.platform === 'win32' ? 'junction' : 'dir');
        fs.writeFileSync(process.argv[2], '{}');
    `, [outside]);
    await assert.rejects(local.launch(c, a, { spawnImpl: f.spawn }), /Symlinks and junctions/);
});

test('detects an unauthorized worktree HEAD move after CLI exit without changing coordinator history', async t => {
    const f = fixture(t);
    const a = assignment(f);
    fs.writeFileSync(path.join(f.root, 'src', 'story.cjs'), 'module.exports = 2;\n');
    git(f.root, ['add', '.']);
    git(f.root, ['commit', '--quiet', '-m', 'test: advance coordinator fixture']);
    const moved = git(f.root, ['rev-parse', 'HEAD']);
    const before = snapshot(f.root);
    const c = config(f, a, `
        const result = require('node:child_process').spawnSync('git', ['update-ref', 'HEAD', process.argv[4]], { stdio: 'ignore' });
        if (result.status !== 0) process.exit(8);
        ${REPORT}
    `, [moved]);
    await assert.rejects(local.launch(c, a, { spawnImpl: f.spawn }), /HEAD does not match/);
    assert.deepEqual(snapshot(f.root), before);
});

test('times out and stops only the captured child tree, not an unrelated Node process', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const unrelated = f.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], {
        shell: false, detached: false, stdio: 'ignore'
    });
    const c = config(f, a, `
        const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
            shell: false, detached: false, stdio: 'inherit'
        });
        require('node:fs').writeFileSync(process.argv[2], JSON.stringify({ descendant: child.pid }));
        setTimeout(() => {}, 10000);
    `);
    c.timeout_seconds = 1;
    let pid;
    const before = snapshot(f.root);
    await assert.rejects(local.launch(c, a, { spawnImpl: f.spawn, onStart: value => { pid = value; } }), error => {
        assert.equal(error.code, 'LOCAL_CLI_TIMEOUT');
        return true;
    });
    assert.equal(local.processAlive(pid), false);
    const report = JSON.parse(fs.readFileSync(a.report_path, 'utf8'));
    assert.equal(local.processAlive(report.descendant), false);
    assert.equal(local.processAlive(unrelated.pid), true);
    assert.deepEqual(snapshot(f.root), before);
});

test('limits combined stdout and stderr bytes and stops the exact child without persisting output', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const c = config(f, a, `${REPORT}
        process.stdout.write(Buffer.alloc(600 * 1024, 120));
        process.stderr.write(Buffer.alloc(600 * 1024, 121));
        setTimeout(() => {}, 10000);
    `);
    let pid;
    const files = fs.readdirSync(path.dirname(a.report_path)).sort();
    await assert.rejects(local.launch(c, a, { spawnImpl: f.spawn, onStart: value => { pid = value; } }), error => {
        assert.equal(error.code, 'LOCAL_CLI_OUTPUT');
        assert.match(error.message, /output limit/);
        return true;
    });
    assert.equal(local.processAlive(pid), false);
    assert.deepEqual(fs.readdirSync(path.dirname(a.report_path)).sort(), [...files, path.basename(a.report_path)].sort());
    assertNotStored(f.directory, ['x'.repeat(1024), 'y'.repeat(1024)]);
});

test('onStart failures are visible and stop the already captured child without leaking callback details', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const c = config(f, a, 'setTimeout(() => {}, 10000);');
    const secret = `callback-private-${crypto.randomUUID()}`;
    for (const asynchronous of [false, true]) {
        let pid;
        await assert.rejects(local.launch(c, a, {
            spawnImpl: f.spawn,
            onStart(value) {
                pid = value;
                if (asynchronous) return Promise.reject(new Error(secret));
                throw new Error(secret);
            }
        }), error => {
            assert.equal(error.code, 'LOCAL_CLI_START');
            assert.match(error.message, /onStart/);
            assert.equal(error.message.includes(secret), false);
            return true;
        });
        assert.equal(local.processAlive(pid), false);
    }
    assertNotStored(f.directory, [secret]);
});

test('an unfinished onStart notification remains bounded even after child exit', async t => {
    const f = fixture(t);
    const a = assignment(f);
    const c = config(f, a, REPORT);
    c.timeout_seconds = 1;
    let pid;
    await assert.rejects(local.launch(c, a, {
        spawnImpl: f.spawn,
        onStart(value) { pid = value; return new Promise(() => {}); }
    }), error => error.code === 'LOCAL_CLI_TIMEOUT');
    assert.equal(local.processAlive(pid), false);
});
test('rejects credential arguments and session reuse before spawning a local process', async () => {
    let calls = 0;
    for (const args of [
        ['--token', 'must-not-be-logged', '{prompt}'],
        ['--github-token=must-not-be-logged', '{prompt}'],
        ['--resume', 'previous-session', '{prompt}'],
        ['--continue', '{prompt}'],
        ['--session-id=old', '{prompt}']
    ]) {
        await assert.rejects(local.launch({ command: process.execPath, args, permissions_reviewed: true, timeout_seconds: 5 }, {}, {
            spawnImpl() { calls++; throw new Error('Unexpected spawn'); }
        }), error => /credentials|fresh CLI session/.test(error.message) && !error.message.includes('must-not-be-logged'));
    }
    assert.equal(calls, 0);
});
