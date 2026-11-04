import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { files, frontmatter, read, root, run } from './helpers/contracts.mjs';

const roles = {
    ideator: ['read', 'search', 'edit', 'web'],
    planner: ['read', 'search', 'edit', 'web'],
    architect: ['read', 'search', 'edit', 'web'],
    builder: ['read', 'search', 'edit', 'execute'],
    evaluator: ['read', 'search', 'edit', 'execute'],
    reviewer: ['read', 'search', 'edit', 'execute'],
    janitor: ['read', 'search', 'edit', 'execute'],
    orchestrator: ['read', 'search', 'edit', 'execute', 'agent']
};
const skills = [
    'add-features', 'architecture-check', 'cloud-loop', 'cloud-parallel',
    'design-feature', 'evaluate', 'fix-issue', 'frontend-design',
    'harness-health', 'hybrid-loop', 'init-solution', 'jira-plan', 'jira-sync',
    'log-progress', 'loop', 'next-feature', 'onboard', 'parallel-loop',
    'plan-execution', 'pre-commit', 'refactor', 'refine-design', 'status',
    'sync-plan', 'testing'
];
const allowedTools = new Set([
    'read', 'search', 'edit', 'execute', 'agent', 'web', 'todo',
    'browser/openBrowserPage', 'browser/readPage', 'browser/screenshotPage',
    'browser/navigatePage', 'browser/clickElement', 'browser/dragElement',
    'browser/hoverElement', 'browser/typeInPage', 'browser/runPlaywrightCode',
    'browser/handleDialog'
]);

run([
    ['frontmatter parser rejects malformed and duplicate fields', () => {
        const parsed = frontmatter('---\r\nname: builder\r\ntools: [read, "edit"]\r\n---\r\n# Body\r\n');
        assert.strictEqual(parsed.metadata.name, 'builder');
        assert.deepStrictEqual(parsed.metadata.tools, ['read', 'edit']);
        for (const malformed of [
            'name: builder\n',
            '---\nname: builder\nname: reviewer\n---\n',
            '---\ntools: [read, edit\n---\n',
            '---\ndescription: "unclosed\n---\n',
            '---\nhooks:\n  PreToolUse: []\n---\n'
        ]) assert.throws(() => frontmatter(malformed));
    }],
    ['manifest and marketplace use canonical matching metadata', () => {
        const plugin = JSON.parse(read('plugin.json'));
        const market = JSON.parse(read('.github', 'plugin', 'marketplace.json'));
        const allowed = new Set([
            '$schema', 'name', 'version', 'description', 'author', 'homepage',
            'repository', 'license', 'keywords', 'extensions'
        ]);
        assert.strictEqual(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
        assert.strictEqual(plugin.name, 'solution-harness');
        assert.ok(/^\d+\.\d+\.\d+$/.test(plugin.version));
        assert.ok(Object.keys(plugin).every(key => allowed.has(key)));
        assert.strictEqual(market.name, 'solution-harness-marketplace');
        assert.ok(market.owner.name);
        assert.strictEqual(market.plugins.length, 1);
        assert.strictEqual(market.plugins[0].name, plugin.name);
        assert.strictEqual(market.plugins[0].version, plugin.version);
        assert.strictEqual(market.plugins[0].source, '.');
    }],
    ['all eight agents use native namespaced profiles and declared tools', () => {
        const directory = path.join(root, 'com.github.copilot', 'agents');
        const actual = fs.readdirSync(directory).filter(name => name.endsWith('.agent.md')).sort();
        const expected = Object.keys(roles).map(name => `${name}.agent.md`).sort();
        assert.deepStrictEqual(actual, expected);
        for (const role of Object.keys(roles)) {
            const profile = frontmatter(read('com.github.copilot', 'agents', `${role}.agent.md`));
            assert.strictEqual(profile.metadata.name, role);
            assert.strictEqual(profile.metadata.target, 'github-copilot');
            assert.ok(profile.metadata.description.length > 20);
            assert.ok(Array.isArray(profile.metadata.tools));
            assert.strictEqual(new Set(profile.metadata.tools).size, profile.metadata.tools.length);
            for (const tool of roles[role]) assert.ok(profile.metadata.tools.includes(tool), `${role} needs ${tool}`);
            for (const tool of profile.metadata.tools) assert.ok(allowedTools.has(tool), `${role}: ${tool}`);
            assert.ok(!Object.prototype.hasOwnProperty.call(profile.metadata, 'hooks'), `${role} has inline hooks`);
            assert.ok(profile.body.includes('# '), `${role} has no body`);
        }
    }],
    ['all 25 skills use native discovery layout and explicit invocation controls', () => {
        const directory = path.join(root, 'skills');
        const actual = fs.readdirSync(directory, { withFileTypes: true })
            .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
        assert.deepStrictEqual(actual, skills.slice().sort());
        const explicit = new Set(['cloud-loop', 'cloud-parallel', 'hybrid-loop', 'jira-plan', 'jira-sync', 'parallel-loop']);
        for (const skill of skills) {
            const parsed = frontmatter(read('skills', skill, 'SKILL.md'));
            assert.strictEqual(parsed.metadata.name, skill);
            assert.ok(parsed.metadata.description.length > 20 && parsed.metadata.description.length <= 1024, skill);
            assert.ok(parsed.body.includes('# '), `${skill} has no instructions`);
            if (explicit.has(skill)) assert.strictEqual(parsed.metadata['disable-model-invocation'], 'true', skill);
        }
    }],
    ['no legacy CommonJS files or bundled hook registrations remain', () => {
        const legacy = files().filter(file => /\.cjs$/i.test(file));
        assert.deepStrictEqual(legacy.map(file => path.relative(root, file)), []);
        for (const parts of [
            ['com.github.copilot', 'hooks', 'hooks.json'],
            ['hooks', 'hooks.json'],
            ['hooks.json'],
            ['cloud', 'hooks.json']
        ]) assert.ok(!fs.existsSync(path.join(root, ...parts)), parts.join('/'));
    }],
    ['active documentation and workflows contain no legacy script references', () => {
        for (const file of files()) {
            const relative = path.relative(root, file);
            if (relative.startsWith(`tests${path.sep}`) || relative === path.join('docs', 'PROGRESS.md')) continue;
            if (!/\.(?:md|json|ya?ml)$/i.test(file)) continue;
            const contents = fs.readFileSync(file, 'utf8');
            assert.ok(!/\.cjs\b/i.test(contents), `Legacy script reference: ${relative}`);
        }
    }],
    ['local Markdown links in active guidance resolve', () => {
        for (const file of files()) {
            const relative = path.relative(root, file);
            if (!file.endsWith('.md') || relative === path.join('docs', 'PROGRESS.md')) continue;
            const contents = fs.readFileSync(file, 'utf8');
            const links = /\[[^\]]+\]\(([^)]+)\)/g;
            let match;
            while ((match = links.exec(contents)) !== null) {
                let target = match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, '');
                if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
                target = decodeURIComponent(target.split('#')[0]);
                assert.ok(fs.existsSync(path.resolve(path.dirname(file), target)), `${relative}: ${target}`);
            }
        }
    }],
    ['backlog schema keeps criterion coverage and done-story evidence', () => {
        const schema = JSON.parse(read('parallel', 'backlog.schema.json'));
        const story = schema.$defs.story;
        assert.ok(story.required.includes('acceptance_criteria'));
        assert.ok(story.required.includes('covers_feature_criteria'));
        assert.ok(story.then.required.includes('evidence'));
        assert.strictEqual(story.properties.covers_feature_criteria.items.minimum, 1);
        assert.ok(new RegExp(story.properties.id.pattern).test('F001-S01'));
        assert.ok(!new RegExp(story.properties.id.pattern).test('F001'));
    }]
]);
