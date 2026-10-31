'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { installBundle } = require('./install-cloud.cjs');
const { noLinks } = require('../parallel/model.cjs');

const seedFiles = new Set(['.github/harness/parallel-config.json']);

function buildBundle(sourceRoot = path.resolve(__dirname, '..')) {
    const files = new Map();
    for (const name of ['model.cjs', 'runtime.cjs', 'hooks.cjs', 'README.md', 'backlog.schema.json']) {
        const source = path.join(sourceRoot, 'parallel', name);
        noLinks(source);
        files.set(`.github/harness/parallel/${name}`, fs.readFileSync(source));
    }
    const configSource = path.join(sourceRoot, 'parallel', 'config.json');
    noLinks(configSource);
    files.set('.github/harness/parallel-config.json', fs.readFileSync(configSource));
    const manifest = {
        version: 1,
        files: Object.fromEntries([...files].map(([name, content]) => [name, crypto.createHash('sha256').update(content).digest('hex')]))
    };
    files.set('.github/harness/parallel-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
    return files;
}

function main(argv) {
    if (Number(process.versions.node.split('.')[0]) < 22 || typeof path.posix.matchesGlob !== 'function') {
        throw new Error('Local parallel execution requires Node.js 22.20+ or 24+');
    }
    const dryRun = argv.includes('--dry-run');
    const targets = argv.filter(arg => arg !== '--dry-run');
    if (targets.length !== 1 || targets[0].startsWith('-')) throw new Error('Usage: node scripts/install-parallel.cjs [--dry-run] <project-root>');
    const root = path.resolve(targets[0]);
    const result = installBundle(root, buildBundle(), { dryRun, preserveExisting: seedFiles });
    return { ...result, dry_run: dryRun, next: 'Review parallel/README.md, migrate project instructions, configure real tests and scope, and commit before beginning. The updated local plugin is required.' };
}

if (require.main === module) {
    try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + '\n'); }
    catch (error) { process.stderr.write(`Parallel installation failed: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = { buildBundle, seedFiles, main };
