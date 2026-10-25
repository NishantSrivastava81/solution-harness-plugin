const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const seedFiles = new Set(['.github/harness/config.json', '.github/workflows/copilot-setup-steps.yml']);

function destinationFor(root, relativePath) {
    if (!relativePath || relativePath.includes('\\') || path.isAbsolute(relativePath)
        || path.win32.isAbsolute(relativePath) || relativePath.split('/').includes('..')) {
        throw new Error(`Unsafe bundle path: ${relativePath}`);
    }

    const destination = path.resolve(root, relativePath);
    if (destination === root) {
        throw new Error(`Unsafe bundle path: ${relativePath}`);
    }

    const segments = path.relative(root, destination).split(path.sep);
    let current = root;
    for (const segment of segments) {
        current = path.join(current, segment);
        if (!fs.existsSync(current) && !fs.lstatSync(current, { throwIfNoEntry: false })) {
            continue;
        }
        const entry = fs.lstatSync(current);
        if (entry.isSymbolicLink()) {
            throw new Error(`Refusing a symlinked destination: ${relativePath}`);
        }
        if (current !== destination && !entry.isDirectory()) {
            throw new Error(`Destination parent is not a directory: ${relativePath}`);
        }
        if (current === destination && !entry.isFile()) {
            throw new Error(`Destination is not a regular file: ${relativePath}`);
        }
    }
    return destination;
}

function installBundle(targetDirectory, files, options = {}) {
    const root = fs.realpathSync(targetDirectory);
    if (!fs.statSync(root).isDirectory()) {
        throw new Error('The target must be an existing directory.');
    }

    const pending = [];
    const unchanged = [];
    const preserved = [];
    const conflicts = [];
    for (const [relativePath, content] of files) {
        const destination = destinationFor(root, relativePath);
        if (fs.existsSync(destination)) {
            if (fs.readFileSync(destination).equals(Buffer.isBuffer(content) ? content : Buffer.from(content))) {
                unchanged.push(relativePath);
            } else if (options.preserveExisting?.has(relativePath)) {
                preserved.push(relativePath);
            } else {
                conflicts.push(relativePath);
            }
        } else {
            pending.push({ relativePath, destination, content });
        }
    }

    if (conflicts.length) {
        throw new Error(`Installation conflicts; no files written:\n${conflicts.join('\n')}`);
    }

    if (!options.dryRun) {
        for (const { relativePath, content } of pending) {
            const destination = destinationFor(root, relativePath);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, content, { flag: 'wx' });
        }
    }

    return { added: pending.map(file => file.relativePath), unchanged, preserved };
}

function copyTree(files, source, destination) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((first, second) => first.name.localeCompare(second.name))) {
        const location = path.join(source, entry.name);
        const relativePath = `${destination}/${entry.name}`;
        if (entry.isSymbolicLink()) {
            throw new Error(`Bundle sources must not contain symlinks: ${location}`);
        }
        if (entry.isDirectory()) {
            copyTree(files, location, relativePath);
        } else if (entry.isFile()) {
            files.set(relativePath, fs.readFileSync(location));
        } else {
            throw new Error(`Unsupported bundle source: ${location}`);
        }
    }
}

function buildBundle(sourceRoot = path.resolve(__dirname, '..')) {
    const files = new Map();
    copyTree(files, path.join(sourceRoot, 'cloud/agents'), '.github/agents');
    copyTree(files, path.join(sourceRoot, 'skills'), '.github/skills');
    copyTree(files, path.join(sourceRoot, 'cloud/skills'), '.github/skills');
    for (const [source, destination] of [
        ['cloud/runtime.cjs', '.github/harness/runtime.cjs'],
        ['cloud/config.json', '.github/harness/config.json'],
        ['cloud/hooks.json', '.github/hooks/solution-harness.json'],
        ['cloud/runtime.instructions.md', '.github/instructions/solution-harness-cloud.instructions.md'],
        ['cloud/copilot-setup-steps.yml', '.github/workflows/copilot-setup-steps.yml'],
        ['cloud/README.md', '.github/harness/README.md']
    ]) {
        files.set(destination, fs.readFileSync(path.join(sourceRoot, source)));
    }
    files.set('.github/harness/.gitignore', '/runtime/\n');
    const hashes = Object.fromEntries([...files].sort(([first], [second]) => first.localeCompare(second))
        .map(([filename, content]) => [filename, crypto.createHash('sha256').update(content).digest('hex')]));
    const plugin = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'plugin.json'), 'utf8'));
    files.set('.github/harness/manifest.json', `${JSON.stringify({
        bundle_format: 1, plugin_version: plugin.version,
        bundle_sha256: crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
        seed_files: [...seedFiles], files: hashes
    }, null, 2)}\n`);
    return files;
}

function main(argumentsList) {
    if (argumentsList.includes('--help')) {
        process.stdout.write('Usage: node scripts/install-cloud.cjs [--dry-run] TARGET_REPOSITORY\n');
        return;
    }
    if (Number(process.versions.node.split('.')[0]) < 22) {
        throw new Error('Node.js 22 or newer is required.');
    }
    const targets = argumentsList.filter(argument => argument !== '--dry-run');
    if (targets.length !== 1 || targets[0].startsWith('-')) {
        throw new Error('Usage: node scripts/install-cloud.cjs [--dry-run] TARGET_REPOSITORY');
    }
    const target = fs.realpathSync(targets[0]);
    const repository = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: target, encoding: 'utf8' });
    if (repository.status !== 0 || fs.realpathSync(repository.stdout.trim()) !== target) {
        throw new Error('The target must be an existing Git repository root.');
    }
    const files = buildBundle();
    const dryRun = argumentsList.includes('--dry-run');
    const result = installBundle(target, files, { dryRun, preserveExisting: seedFiles });
    process.stdout.write(`${dryRun ? 'Would add' : 'Added'} ${result.added.length} files; ${result.unchanged.length} unchanged; ${result.preserved.length} project-owned files preserved.\n`);
    if (dryRun) {
        for (const filename of result.added) {
            process.stdout.write(`  ${filename}\n`);
        }
    }
    for (const filename of result.preserved) {
        process.stdout.write(`Preserved: ${filename}; review it against the cloud setup guide.\n`);
    }
    const manifest = JSON.parse(files.get('.github/harness/manifest.json'));
    process.stdout.write(`Bundle SHA-256: ${manifest.bundle_sha256}\n`);
    process.stdout.write('Next: configure approved feature IDs, real test commands, and dependency setup; review and merge to the default branch.\n');
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = { buildBundle, installBundle, seedFiles };