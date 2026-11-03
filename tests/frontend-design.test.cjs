'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { frontendGuidance } = require('../skills/frontend-design/guidance.cjs');
const { prompt } = require('../skills/cloud-parallel/scripts/coordinator.cjs');
const { reviewPrompt } = require('../hybrid/runtime.cjs');
const { buildBundle } = require('../scripts/install-cloud.cjs');

const root = path.resolve(__dirname, '..');
const skillPath = path.join(root, 'skills', 'frontend-design', 'SKILL.md');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');

test('frontend-design is discoverable for UI tasks and preserves role and scope boundaries', () => {
    const skill = fs.readFileSync(skillPath, 'utf8');
    assert.match(skill, /^---\r?\nname: frontend-design\r?\ndescription: "[^"\r\n]+"\r?\n---/);
    assert.doesNotMatch(skill, /^(?:disable-model-invocation|user-invocable):/m);
    assert.ok(skill.split(/\r?\n/).length < 500);
    for (const requirement of [
        /Non-UI tasks do not\s+acquire UI work/,
        /existing.*design system/i,
        /keyboard operation/i,
        /loading, empty, success, validation error/i,
        /320, 768, and 1440 CSS-pixel widths/,
        /WCAG 2\.2 AA/,
        /evaluators do not implement fixes/i,
        /existing report schema/i,
        /missing evidence cannot receive PASS/i,
        /needs no external fetch/i
    ]) assert.match(skill, requirement);
});

test('dispatch guidance reads the bundled skill without frontmatter or working-directory assumptions', () => {
    const body = fs.readFileSync(skillPath, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, '').trim();
    const guidance = frontendGuidance();
    assert.ok(guidance.endsWith(body));
    assert.doesNotMatch(guidance, /^name:|^description:/m);
    const result = spawnSync(process.execPath, ['-e',
        'process.stdout.write(require(process.argv[1]).frontendGuidance())',
        path.join(root, 'skills', 'frontend-design', 'guidance.cjs')
    ], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, guidance);
});

test('cloud and hybrid developer briefs embed the same offline guidance without altering assignment identity', () => {
    const run = { id: '00000000-0000-0000-0000-000000000001' };
    const feature = { id: 'F001', name: 'Customer portal', design_doc: 'docs/designs/F001-design.md' };
    const story = { id: 'F001-S01', title: 'Build the customer picker', acceptance_criteria: ['Keyboard selection works'] };
    const scope = { allowed_paths: ['src/components/picker/**'], resources: ['ui-fixtures'] };
    const before = JSON.stringify({ run, feature, story, scope });
    const brief = prompt(run, feature, story, scope);
    assert.ok(brief.startsWith('Solution Harness cloud story assignment v1\n'));
    assert.match(brief, /^Run: 00000000-0000-0000-0000-000000000001$/m);
    assert.match(brief, /^Story: F001-S01 - Build the customer picker$/m);
    assert.ok(brief.includes(`Acceptance criteria: ${JSON.stringify(story.acceptance_criteria)}`));
    assert.ok(brief.includes(`Allowed paths: ${JSON.stringify(scope.allowed_paths)}`));
    assert.match(brief, /Do not approve or merge the PR/);
    assert.equal(brief.split(frontendGuidance()).length, 2);
    assert.equal(JSON.stringify({ run, feature, story, scope }), before);
    const apiBrief = prompt(run, feature, { ...story, title: 'Add a backend endpoint' }, scope);
    assert.match(apiBrief, /Non-UI tasks do not\s+acquire UI work/);
});

test('hybrid reviewer briefs keep exact criteria and read-only JSON output with evaluator-only guidance', () => {
    const run = { id: '00000000-0000-0000-0000-000000000001' };
    const config = { verification: [{ name: 'UI tests', command: 'node', args: ['--test'], kind: 'test' }] };
    const candidate = { sha: 'a'.repeat(40), workspace: 'C:\\work\\independent-review' };
    const data = {
        feature_id: 'F001', story_id: 'F001-S01', agent_id: 'checker-ui', assignment_nonce: 'nonce-1',
        acceptance_criteria: ['Keyboard selection works'], report_path: 'C:\\reports\\review.json'
    };
    const brief = reviewPrompt(run, config, candidate, data);
    assert.ok(brief.includes(`Review only ${candidate.sha} at ${candidate.workspace}`));
    assert.match(brief, /Do not edit source, commit, merge, deploy, or update shared status/);
    assert.match(brief, /evaluator mode only/);
    assert.match(brief, /does not authorize implementation or change the JSON report schema/);
    assert.equal(brief.split(frontendGuidance()).length, 2);
    const report = JSON.parse(brief.split('\nWrite JSON only at ')[1].split('\n')[1]);
    assert.equal(report.candidate_sha, candidate.sha);
    assert.equal(report.assignment_nonce, data.assignment_nonce);
    assert.equal(report.verdict, 'FAIL');
    assert.deepEqual(report.criteria.map(item => item.criterion), data.acceptance_criteria);
    assert.ok(report.criteria.every(item => item.passed === false));
});

test('local design/build/review and hosted profiles explicitly load frontend-design in the correct role', () => {
    for (const file of ['agents/builder.agent.md', 'agents/evaluator.agent.md', 'skills/design-feature/SKILL.md']) {
        assert.match(read(file), /\/frontend-design/);
    }
    assert.match(read('skills/design-feature/SKILL.md'), /designer mode/);
    assert.match(read('agents/evaluator.agent.md'), /Do not edit source or redesign/);
    assert.match(read('agents/evaluator.agent.md'), /browser\/readPage/);
    for (const role of ['builder', 'evaluator']) {
        assert.match(read(`cloud/agents/${role}.agent.md`), /\.github\/skills\/frontend-design\/SKILL\.md/);
        assert.ok(read(`cloud/agents/${role}.agent.md`).includes(`${role} mode`));
    }
});

test('hosted bundles carry the identical skill and helper with valid content hashes and local exclusions', () => {
    const files = buildBundle();
    const skill = '.github/skills/frontend-design/SKILL.md';
    const helper = '.github/skills/frontend-design/guidance.cjs';
    assert.deepEqual(files.get(skill), fs.readFileSync(skillPath));
    assert.deepEqual(files.get(helper), fs.readFileSync(path.join(root, 'skills', 'frontend-design', 'guidance.cjs')));
    const manifest = JSON.parse(files.get('.github/harness/manifest.json'));
    for (const filename of [skill, helper]) {
        assert.equal(crypto.createHash('sha256').update(files.get(filename)).digest('hex'), manifest.files[filename]);
    }
    for (const name of ['plan-execution', 'parallel-loop', 'cloud-parallel', 'jira-plan', 'hybrid-loop', 'jira-sync']) {
        assert.equal(files.has(`.github/skills/${name}/SKILL.md`), false);
    }
    assert.equal([...files.keys()].filter(name => name.endsWith('/SKILL.md')).length, 19);
});

test('plugin versions and documented skill counts match both distributions', () => {
    const plugin = JSON.parse(read('plugin.json'));
    const marketplace = JSON.parse(read('marketplace.json'));
    assert.equal(plugin.version, marketplace.plugins[0].version);
    const skills = fs.readdirSync(path.join(root, 'skills')).filter(name => fs.existsSync(path.join(root, 'skills', name, 'SKILL.md')));
    assert.equal(skills.length, 24);
    assert.match(read('README.md'), /\|\s*\*\*Skills\*\*\s*\|\s*24\s*\|/);
    assert.ok(read('README.md').includes('/frontend-design'));
});
