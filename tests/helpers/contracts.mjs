import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function read(...parts) {
    return fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
}

export function files(directory = root) {
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...files(absolute));
        else if (entry.isFile()) result.push(absolute);
    }
    return result;
}

function scalar(value) {
    value = value.trim();
    assert.ok(value, 'Frontmatter values must not be empty');
    if (value.startsWith('"')) return JSON.parse(value);
    if (value.startsWith("'")) {
        assert.ok(/^'(?:[^']|'')*'$/.test(value), `Invalid quoted scalar: ${value}`);
        return value.slice(1, -1).replace(/''/g, "'");
    }
    assert.ok(!/['"\[\]{}#]/.test(value), `Unsupported scalar: ${value}`);
    return value;
}

export function frontmatter(contents) {
    const normalized = contents.replace(/\r\n/g, '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
    assert.ok(match, 'Expected delimited YAML frontmatter');
    const metadata = Object.create(null);
    for (const line of match[1].split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const field = /^([a-z][a-z0-9-]*):[ \t]*(.*)$/.exec(line);
        assert.ok(field, `Unsupported frontmatter line: ${line}`);
        const key = field[1];
        const value = field[2];
        assert.ok(!Object.prototype.hasOwnProperty.call(metadata, key), `Duplicate frontmatter key: ${key}`);
        if (value.startsWith('[')) {
            assert.ok(value.endsWith(']'), `Unclosed list: ${key}`);
            const items = value.slice(1, -1).trim();
            metadata[key] = items ? items.split(',').map(scalar) : [];
        } else {
            metadata[key] = scalar(value);
        }
    }
    return { metadata, body: normalized.slice(match[0].length) };
}

export function run(cases) {
    let failed = 0;
    for (const [name, execute] of cases) {
        try {
            execute();
            console.log(`ok - ${name}`);
        } catch (error) {
            failed += 1;
            console.error(`not ok - ${name}`);
            console.error(error.stack || String(error));
        }
    }
    if (failed) process.exitCode = 1;
    else console.log(`${cases.length} checks passed`);
}
