'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'com.github.copilot', 'agents');
const roles = {
    ideator: { persona: 'Product Strategist and Solution Architect', tools: ['read', 'search', 'edit', 'web'] },
    planner: { persona: 'Solution Planner', tools: ['read', 'search', 'edit', 'web'] },
    architect: { persona: 'Solution Architect', tools: ['read', 'search', 'edit', 'web'] },
    builder: { persona: 'Solution Builder', tools: ['read', 'search', 'edit', 'execute'] },
    evaluator: { persona: 'Solution Evaluator', tools: ['read', 'search', 'edit', 'execute'] },
    reviewer: { persona: 'Code Reviewer', tools: ['read', 'search', 'edit', 'execute'] },
    janitor: { persona: 'Codebase Janitor', tools: ['read', 'search', 'edit', 'execute'] },
    orchestrator: { persona: 'Loop Orchestrator', tools: ['read', 'search', 'edit', 'execute', 'agent'] }
};
const aliases = new Set(['read', 'search', 'edit', 'execute', 'agent', 'web', 'todo']);
const browserTools = new Set([
    'browser/openBrowserPage', 'browser/readPage', 'browser/screenshotPage',
    'browser/navigatePage', 'browser/clickElement', 'browser/dragElement',
    'browser/hoverElement', 'browser/typeInPage', 'browser/runPlaywrightCode',
    'browser/handleDialog'
]);
const cache = new Map();

function scalar(value) {
    value = value.trim();
    assert.ok(value.length, 'Frontmatter values must not be empty');
    if (value.startsWith('"')) return JSON.parse(value);
    if (value.startsWith("'")) {
        assert.match(value, /^'(?:[^']|'')*'$/);
        return value.slice(1, -1).replace(/''/g, "'");
    }
    assert.doesNotMatch(value, /['"\[\]{}#]/);
    return value;
}

function parseFrontmatter(contents) {
    const normalized = contents.replace(/\r\n/g, '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
    assert.ok(match, 'Expected a delimited YAML frontmatter header');
    const metadata = Object.create(null);
    for (const line of match[1].split('\n')) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        const field = /^([a-z][a-z0-9-]*):[ \t]*(.*)$/.exec(line);
        assert.ok(field, `Unsupported frontmatter line: ${line}`);
        const [, key, value] = field;
        assert.ok(!Object.hasOwn(metadata, key), `Duplicate frontmatter key: ${key}`);
        if (value.startsWith('[')) {
            assert.ok(value.endsWith(']'), `Unclosed frontmatter list: ${key}`);
            const items = value.slice(1, -1).trim();
            metadata[key] = items ? items.split(',').map(scalar) : [];
        } else {
            metadata[key] = scalar(value);
        }
    }
    return { metadata, body: normalized.slice(match[0].length), contents: normalized };
}

function profile(role) {
    if (!cache.has(role)) {
        cache.set(role, parseFrontmatter(fs.readFileSync(path.join(directory, `${role}.agent.md`), 'utf8')));
    }
    return cache.get(role);
}

function section(role, heading) {
    const body = profile(role).body;
    const start = body.indexOf(`## ${heading}\n`);
    assert.notEqual(start, -1, `Missing ${role} section: ${heading}`);
    const end = body.indexOf('\n## ', start + heading.length + 4);
    return body.slice(start, end === -1 ? undefined : end);
}

function matches(text, requirements) {
    for (const requirement of requirements) assert.match(text, requirement);
}

test('lightweight frontmatter parser handles scalar and inline-list profile fields', () => {
    const parsed = parseFrontmatter('---\r\nname: builder\r\ndescription: "Build, verify"\r\ntarget: github-copilot\r\ntools: [read, "edit", \'execute\']\r\n---\r\n# Builder\r\n');
    assert.equal(parsed.metadata.description, 'Build, verify');
    assert.deepEqual(parsed.metadata.tools, ['read', 'edit', 'execute']);
    assert.equal(parsed.body, '# Builder\n');
    for (const malformed of [
        'name: builder\n',
        '---\nname: builder\nname: reviewer\n---\n',
        '---\ntools: [read, edit\n---\n',
        '---\ndescription: "unclosed\n---\n',
        '---\nhandoffs:\n  - label: Continue\n---\n'
    ]) assert.throws(() => parseFrontmatter(malformed));
});

test('all eight stable profiles live only in the Agent Plugins 1.0 namespace', () => {
    const expected = Object.keys(roles).map(role => `${role}.agent.md`).sort();
    assert.deepEqual(fs.readdirSync(directory).filter(file => file.endsWith('.agent.md')).sort(), expected);
    for (const file of expected) {
        assert.equal(fs.existsSync(path.join(root, 'agents', file)), false, `Legacy profile remains: ${file}`);
    }
});

for (const [role, requirements] of Object.entries(roles)) {
    test(`${role} has a stable Copilot identity and native capabilities for its role`, () => {
        const { metadata, body } = profile(role);
        assert.deepEqual(Object.keys(metadata).sort(), ['description', 'name', 'target', 'tools']);
        assert.equal(metadata.name, role);
        assert.equal(metadata.target, 'github-copilot');
        assert.equal(typeof metadata.description, 'string');
        assert.ok(metadata.description.length > 30);
        assert.equal(metadata.model, undefined);
        assert.equal(metadata['reasoning-effort'], undefined);
        assert.ok(Array.isArray(metadata.tools));
        assert.equal(new Set(metadata.tools).size, metadata.tools.length);
        for (const tool of requirements.tools) assert.ok(metadata.tools.includes(tool), `${role} needs native ${tool}`);
        for (const tool of metadata.tools) {
            assert.ok(aliases.has(tool) || browserTools.has(tool), `Nonportable tool: ${role}: ${tool}`);
        }
        assert.ok(body.includes(`**${requirements.persona}**`), `Persona changed: ${role}`);
        assert.ok(body.length < 30000);
    });
}

test('Copilot profiles contain neither Local-only mandatory tool names nor UI handoffs', () => {
    for (const role of Object.keys(roles)) {
        const { metadata, contents, body } = profile(role);
        assert.equal(metadata.handoffs, undefined);
        assert.doesNotMatch(contents, /\b(?:agent|execute|read|edit|search|web)\/[a-zA-Z]\w*\b/);
        assert.doesNotMatch(contents, /\b(?:runSubagent|create_file|replace_string_in_file|run_in_terminal)\b/);
        assert.doesNotMatch(contents, /solution-harness-plugin:\w+\.agent/);
        assert.doesNotMatch(body, /\bhandoffs?\b|\bhand(?:ing)?[ -]off\b|\b(?:button|click|send)\b/i);
        assert.ok(!metadata.tools.includes('task'), 'Use the portable agent alias, not a runtime tool name');
    }
});

test('detailed persona principles and ordinary sequential protocols remain present', () => {
    const headings = {
        ideator: ['## Phase 1: Understand the Core Intent', '## Phase 4: Define the MVP', '## Phase 5: Produce the Specification'],
        planner: ['## PRINCIPLE: Feedforward Guides', '### Step 3: Generate the Feature List', '## Harnessability Guidance'],
        architect: ['## Design Principles Applied', '### PRINCIPLE: Enforce Invariants', '### PRINCIPLE: Build to Delete', '### Phase 3: Module Boundaries'],
        builder: ['### Tier 1 — Guard Rails', '### Tier 2 — Structural Discipline', '### Tier 3 — Quality', '## Working with Existing Code', '## Security: Credentials'],
        evaluator: ['## Your Mindset', '### Step 3: Grade Using These Criteria', '## Calibration Rules'],
        reviewer: ['## PRINCIPLE: Feedback Sensor', '**Security Review**', '**Architecture Review**', '**Quality Review**'],
        janitor: ['## PRINCIPLE: Entropy and Garbage Collection', '## PRINCIPLE: Continuous Drift Detection', '### 6. Dependency Health'],
        orchestrator: ['## PRINCIPLE: Verification Is the Load-Bearing Wall', '## PRINCIPLE: Budget as a Control Surface', '## PRINCIPLE: Surface Comprehension Debt']
    };
    for (const [role, fragments] of Object.entries(headings)) {
        for (const fragment of fragments) assert.ok(profile(role).body.includes(fragment), `${role} lost ${fragment}`);
    }
});

test('explicit next-step agent switching preserves the former transition workflows', () => {
    matches(profile('ideator').body, [/switch to \*\*planner\*\*/i, /docs\/SPEC\.md/, /\/init-solution/]);
    matches(section('planner', 'Next Steps'), [/switch to \*\*builder\*\*/i, /local \*\*orchestrator\*\*/, /docs\/PLAN\.md/, /docs\/FEATURES\.json/, /\/loop/, /loop contract/]);
    matches(profile('architect').body, [/Switch to \*\*planner\*\*/, /\/design-feature/, /Switch to \*\*builder\*\*/, /\/next-feature/, /local \*\*orchestrator\*\*/, /\/loop/]);
    matches(section('builder', 'Next Steps'), [/switch to \*\*evaluator\*\*/, /switch\s+to \*\*reviewer\*\*/, /stop after the required report/]);
    matches(section('evaluator', 'Next Steps'), [/switch to \*\*builder\*\*/, /docs\/EVALUATION\.md/, /private\/JSON report and stop/]);
    matches(section('reviewer', 'Next Steps'), [/switch to \*\*builder\*\*/, /docs\/REVIEW\.md/]);
    matches(section('orchestrator', 'Next Steps'), [/switch to \*\*builder\*\*/, /docs\/LOOP\.md/, /docs\/loop-run-log\.md/, /switch to \*\*evaluator\*\*/, /runtime recovery/]);
});

test('builder writes files and runs checks through enabled edit and shell capabilities', () => {
    matches(section('builder', 'CRITICAL: Write Files Directly — Do Not Show Code in Chat'), [
        /enabled file-edit tools \(`edit`\)/,
        /enabled shell tools \(`execute`\)/,
        /verified workspace/,
        /Never paste code into the chat/
    ]);
    matches(section('builder', 'Implementation Protocol'), [/use enabled file-edit tools/, /Run tests[\s\S]*enabled shell tools/]);
});

test('explicit GitHub cloud story briefs override local coordination and sequential publication', () => {
    const body = profile('builder').body;
    const cloud = section('builder', 'Assigned-story mode for GitHub cloud jobs');
    assert.ok(body.indexOf(cloud) < body.indexOf('## Assigned-story mode for local parallel runs'));
    assert.ok(body.indexOf(cloud) < body.indexOf('## Session Start Protocol'));
    matches(cloud, [
        /GitHub cloud job with an explicit\s+`Solution Harness cloud story assignment v1`/,
        /instead\s+of the local assignment and ordinary sequential protocols/,
        /Implement only the assigned story, exact acceptance criteria, and allowed\s+paths\/ownership/,
        /Run the brief's verification commands and report actual evidence or blockers/,
        /Never invoke local coordinator operations[\s\S]*parallel\/hybrid[\s\S]*`context`[\s\S]*`worker-report`[\s\S]*`worker-block`/,
        /Do not update or publish shared planning, feature status, progress, or\s+evaluation/,
        /Do not approve or merge a PR/,
        /Cloud task creation handles commits and PR artifacts/,
        /Do not run the ordinary\s+sequential commit\/progress protocol/,
        /Stop after returning/,
        /independent review and integration belong to the local coordinator/,
        /Missing, stale, or conflicting assignment details are blockers/,
        /not permission\s+to fall back to sequential feature work/
    ]);
});

test('local builder assignments retain runtime validation, ownership, blockers, and report-only completion', () => {
    matches(section('builder', 'Assigned-story mode for local parallel runs'), [
        /node \.github\/harness\/parallel\/runtime\.cjs context/,
        /A story ID in a prompt alone does not establish an assignment/,
        /Work only on that story, its criteria, and its owned files/,
        /Confirm editing tools use this root, not merely the terminal/,
        /Do not commit, merge, deploy, edit shared planning\/progress\/configuration/,
        /spawn writers sharing the same checkout/,
        /worker-report/,
        /worker-block --reason environment/,
        /tests-failing[\s\S]*out-of-scope[\s\S]*design-question/,
        /Stop after reporting/,
        /Independent review and serialized integration belong\s+to the coordinator/,
        /A worker report is not feature completion/,
        /invalid, expired,[\s\S]*stop and notify the coordinator/
    ]);
});

test('manual Jira hybrid builders keep Source ID, rooted ownership, and no-publication boundaries', () => {
    matches(section('builder', 'Assigned-story mode for manual Jira hybrid runs'), [
        /absolute\s+hybrid runtime path supplied by `\/hybrid-loop`/,
        /valid current assignment/,
        /assigned Source ID, exact criteria, and owned paths/,
        /Verify editing tools target the returned workspace/,
        /Do not commit, push, merge, deploy, edit shared planning, or choose other work/,
        /worker-report[\s\S]*worker-block/,
        /Stop after the report/,
        /coordinator captures and\s+publishes the code for independent review/,
        /stale attempts, changed contracts, or missing environment access as\s+blockers/,
        /Do not fall back to sequential work or invent verification evidence/,
        /reviewed assigned-story instruction exception/
    ]);
});

test('ordinary local builder sessions retain feature selection, shared progress, and incremental commits', () => {
    matches(section('builder', 'Session Start Protocol'), [/Every ordinary unassigned local sequential session/, /docs\/PROGRESS\.md/, /docs\/FEATURES\.json/, /passing baseline/]);
    matches(section('builder', 'Implementation Protocol'), [/ordinary local sequential mode/, /Self-verify/, /not independent evaluation/, /never act as the evaluator for your own changes/, /"complete"/, /docs\/PROGRESS\.md/, /feat\(F###\): <description>/]);
    matches(section('builder', 'Rules'), [/ordinary local sequential sessions/, /assignments follow their respective protocols/, /ONE feature at a time/, /Update progress EVERY session/]);
    matches(profile('janitor').body, [/commit with `chore: janitor cleanup`/, /Never modify feature behavior/, /Update docs\/PROGRESS\.md/]);
});

test('local evaluators review exact candidates and write only their private commit-bound verdict', () => {
    matches(section('evaluator', 'Assigned-candidate mode for local parallel runs'), [
        /node \.github\/harness\/parallel\/runtime\.cjs context/,
        /exact candidate SHA/,
        /fresh session independent of every builder/,
        /Do not reuse a\s+builder session under a different label/,
        /Do not edit\s+source, resolve conflicts, commit, or update shared evaluation\/progress files/,
        /only to the private `report_path`/,
        /\.github\/harness\/parallel\/README\.md/,
        /review-report/,
        /FAIL if a human\/environment requirement has not been verified/,
        /story_id: null/,
        /Passing individual stories is insufficient/,
        /Stop after the report/,
        /Invalid\s+assignment state is a blocker/
    ]);
});

test('cloud PR evaluators return exact-candidate JSON without shared writes or self-review', () => {
    matches(section('evaluator', 'Cloud PR candidate mode'), [
        /local orchestrator requests `\/cloud-parallel` review/,
        /exact candidate SHA and review worktree/,
        /fresh session independent of every cloud builder/,
        /Do not\s+edit source, shared planning, progress, evaluation, or runtime receipts/,
        /Return the exact JSON report/,
        /run, feature, story, SHA, evaluator label, verdict, and evidence/,
        /coordinator submits the report and decides whether to merge/,
        /replaces the ordinary feature-wide status and report-writing protocol/
    ]);
});

test('manual Jira hybrid evaluators preserve private identity-bound evidence and fresh-review requirements', () => {
    matches(section('evaluator', 'Manual Jira hybrid candidate mode'), [
        /supplied absolute\s+hybrid runtime path/,
        /fresh session,[\s\S]*independent of every builder/,
        /Do not edit source, merge, commit,[\s\S]*operate live infrastructure, or update shared status\/progress/,
        /Write only the private JSON report/,
        /exact run\/story\/feature\/SHA\/evaluator\s+identity, `assignment_nonce`/,
        /observed authorized environment evidence/,
        /FAIL when required access or observations are missing/,
        /prefixed by Source ID/,
        /Parent-feature completion has a separate full review/,
        /Stop after reporting/,
        /Changed SHA, base, contract, or nonce requires a fresh\s+review/,
        /do not reuse an old PASS or fall back to shared-file writes/
    ]);
});

test('evaluator edits remain report-only and ordinary shared evaluation never overrides assignments', () => {
    matches(profile('evaluator').body, [
        /Keep implementation read-only/,
        /`edit` capability is only for reports and\s+ordinary evaluation status updates/,
        /Assigned-candidate modes permit only their\s+private report or returned JSON, never shared files/,
        /Do not implement fixes or\s+commit/,
        /Separate Generation from Evaluation/,
        /You are SEPARATE from the builder/,
        /Any criterion scoring 1 or 2 means the feature FAILS/,
        /Only ordinary unassigned evaluation writes this shared report/,
        /In ordinary unassigned evaluation, for any feature that FAILS/
    ]);
});

test('frontend guidance is conditional, invoked or read, and keeps evaluator and assignment boundaries', () => {
    const builder = section('builder', 'UI and UX work');
    const evaluator = section('evaluator', 'UI and UX evaluation');
    matches(builder, [
        /For pages, forms, dashboards, navigation, or visual components/,
        /`\/frontend-design` before implementation/,
        /invocation is unavailable, read/,
        /`SKILL\.md` and follow its builder guidance/,
        /Non-UI work does not acquire UI requirements/,
        /existing design system/,
        /available browser tools or existing UI tests/,
        /Report missing browser\s+verification explicitly/,
        /never expands assigned ownership/
    ]);
    matches(evaluator, [
        /For interface changes, load `\/frontend-design` in evaluator mode/,
        /invocation\s+is unavailable, read/,
        /`SKILL\.md` and use\s+only its evaluation guidance/,
        /Non-UI work does not acquire UI requirements/,
        /Independently\s+check the actual candidate/,
        /Do not edit source or redesign the product/,
        /existing report/,
        /missing evidence for\s+a required UI criterion cannot support PASS/
    ]);
    for (const role of ['builder', 'evaluator']) {
        assert.ok(profile(role).metadata.tools.includes('browser/readPage'));
    }
    for (const role of ['ideator', 'planner', 'architect', 'reviewer', 'janitor', 'orchestrator']) {
        assert.doesNotMatch(profile(role).body, /\/frontend-design|mandatory UI|always.*UI design/i);
    }
});

test('Copilot targeting never turns the local orchestrator into a hosted coordinator', () => {
    const context = section('orchestrator', 'Local coordinator execution context');
    matches(context, [
        /This is a local coordinator profile/,
        /target: github-copilot[\s\S]*does not authorize a hosted coordinator/,
        /remain local coordinator workflows/,
        /coordination\s+and independent review remain local/,
        /Never launch this orchestrator as a GitHub\s+hosted\/cloud coordinator/,
        /Hosted `cloud-loop` uses its separate cloud profile\s+and contract/
    ]);
    for (const command of ['/loop', '/parallel-loop', '/cloud-parallel', '/jira-plan', '/hybrid-loop', '/jira-sync']) {
        assert.ok(context.includes(`\`${command}\``), `Missing local mode boundary: ${command}`);
    }
});

test('orchestrator retains opt-in parallel and manual Jira hybrid scheduler and publication protocols', () => {
    matches(section('orchestrator', 'Opt-in local parallel story mode'), [
        /Only an explicit `\/parallel-loop` request/,
        /\.github\/harness\/parallel\/README\.md/,
        /authoritative scheduler and state machine/,
        /one\s+feature active/,
        /own verified workspace/,
        /terminal `cwd` isolates their editing tools/,
        /independent commit-bound evidence/,
        /full-feature review before final publication/,
        /Workers do not write global\s+status\/progress/,
        /do not steal leases, reset budgets/,
        /runtime recovery commands/
    ]);
    matches(section('orchestrator', 'Opt-in cloud parallel story mode'), [
        /Only an explicit `\/cloud-parallel` request/,
        /local\s+coordinator mode, not a hosted orchestrator/,
        /approved independent\s+stories to GitHub cloud agents/,
        /exact PR commits locally with a separate\s+evaluator/,
        /integrate serially/,
        /Do not treat cloud builders as reviewers/,
        /publish completion before merge/
    ]);
    matches(section('orchestrator', 'Opt-in manual Jira hybrid mode'), [
        /Only explicit `\/jira-plan`, `\/hybrid-loop`, or `\/jira-sync` requests/,
        /local-only workflows/,
        /There is no sprint watcher/,
        /one authority for cloud\/local claims, budgets, ownership, reviews, and\s+integration/,
        /never run the standalone coordinators alongside it/,
        /preserve existing Source IDs/,
        /approval for the exact snapshot and story\s+allowlist/,
        /To Do status is not\s+implementation or merge authorization/,
        /ready nonconflicting work/,
        /fresh independent evaluators/,
        /protected PR lane/,
        /actual baseline-bound evidence/,
        /selected-story delivery review, separate complete-parent review/,
        /coordinator-only metadata publication/,
        /Jira write-back is optional and separate/,
        /Resume through durable\s+state/,
        /Do not claim mock tests prove\s+hosted-agent behavior/
    ]);
});

test('orchestrator keeps portable native delegation, independent makers/checkers, and bounded stop contracts', () => {
    matches(profile('orchestrator').body, [
        /You don't write features yourself and you don't\s+grade them yourself/,
        /MUST keep generation and evaluation in separate subagents/,
        /BUILD \(maker\)[\s\S]*\*\*builder\*\*[\s\S]*`agent` capability \(Copilot's native `task` delegation tool\)/,
        /VERIFY \(checker\)[\s\S]*\*\*evaluator\*\*[\s\S]*`agent` capability in a fresh independent session/,
        /Never build and grade in the same step/,
        /No green, no commit/,
        /Default to L1/,
        /max_iterations/,
        /max_commits/,
        /max_rework_per_feature/,
        /same root cause twice/,
        /Triage Inbox/,
        /Honor the budget/,
        /Report comprehension debt/
    ]);
});

test('reviewer has shell and report-writing capabilities without permission to change source', () => {
    matches(profile('reviewer').body, [
        /Keep source read-only/,
        /shell tools only for read-only inspection/,
        /`edit` capability is limited to\s+`docs\/REVIEW\.md`/,
        /do not edit source, implement fixes, commit, or merge/,
        /git log --oneline -10/,
        /Every finding must include the file and line/,
        /Every finding must include a recommended fix/
    ]);
});

test('profile namespace does not relocate project state or installed local runtime paths', () => {
    for (const role of Object.keys(roles)) {
        assert.doesNotMatch(profile(role).body, /com\.github\.copilot[\\/](?:docs|\.github[\\/]harness)/);
    }
    for (const role of ['planner', 'architect', 'builder', 'evaluator', 'janitor', 'orchestrator']) {
        assert.ok(profile(role).body.includes('docs/FEATURES.json'), `${role} lost the project feature path`);
    }
    for (const role of ['builder', 'evaluator']) {
        assert.ok(profile(role).body.includes('node .github/harness/parallel/runtime.cjs context'));
    }
    assert.ok(profile('orchestrator').body.includes('.github/harness/parallel/README.md'));
});
