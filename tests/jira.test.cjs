'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateJiraConfig, readSprint, readIssue, syncEvidence, adfText } = require('../jira/client.cjs');

const site = 'https://jira.example.test';
const config = { url: site, board_id: 42 };
const env = { JIRA_EMAIL: 'reader@example.test', JIRA_API_TOKEN: 'test-secret-token' };
const active = { id: 7, name: 'Sprint seven', state: 'active', startDate: '2026-11-01T00:00:00Z' };
const sha = 'a'.repeat(40);
const evidence = {
    marker: '[harness:evidence:F001-S01:abc]', summary: 'Tests passed; independently reviewed.',
    repository: 'owner/repo', sha, url: `https://github.com/owner/repo/commit/${sha}`
};
const text = value => ({ type: 'text', text: value });
const paragraph = value => ({ type: 'paragraph', content: [text(value)] });
const heading = value => ({ type: 'heading', attrs: { level: 2 }, content: [text(value)] });
const doc = (...content) => ({ type: 'doc', version: 1, content });
const list = (...values) => ({
    type: 'bulletList', content: values.map(value => ({ type: 'listItem', content: [paragraph(value)] }))
});

function reply(body, status = 200, extra = {}) {
    return {
        status, ok: status >= 200 && status < 300, redirected: false, url: '',
        json: async () => structuredClone(body), ...extra
    };
}

function mocked(handler) {
    const calls = [];
    const fetchImpl = async (input, options) => {
        const url = new URL(input);
        assert.equal(url.origin, site);
        assert.equal(url.username, '');
        assert.equal(url.password, '');
        assert.equal(url.search.includes(env.JIRA_API_TOKEN), false);
        assert.equal(options.redirect, 'manual');
        assert.equal(options.credentials, 'omit');
        assert.ok(options.signal instanceof AbortSignal);
        const request = {
            url, method: options.method, headers: options.headers,
            body: options.body ? JSON.parse(options.body) : null, signal: options.signal
        };
        calls.push(request);
        return handler(request);
    };
    return { calls, fetchImpl };
}

function jiraIssue(id = '100', key = 'PLAN-1', fields = {}) {
    return {
        id, key, fields: {
            summary: 'Build the behavior', description: null, status: { id: '1', name: 'To Do' },
            updated: '2026-11-02T10:00:00Z', issuelinks: [], customfield_10000: 'F001-S01', ...fields
        }
    };
}

function sprintFixture({
    sprints = [{ values: [active], isLast: true, startAt: 0 }],
    pages = [{ issues: [jiraIssue()], isLast: true }],
    fields = [{ id: 'customfield_10000', name: 'Source ID' }], linked = {}
} = {}) {
    return mocked(({ url }) => {
        if (url.pathname === '/rest/api/3/field') return reply(fields);
        if (url.pathname === '/rest/agile/1.0/board/42/sprint') {
            const offset = Number(url.searchParams.get('startAt'));
            return reply(sprints.find(page => page.startAt === offset) || sprints[0]);
        }
        if (/^\/rest\/software\/1\.0\/board\/42\/sprint\/\d+\/issue$/.test(url.pathname)) {
            const token = url.searchParams.get('nextPageToken');
            return reply(pages[token === null ? 0 : Number(token)]);
        }
        const identifier = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)$/)?.[1];
        if (identifier && linked[identifier]) return reply(linked[identifier]);
        throw new Error('Unexpected mocked route.');
    });
}

test('exports the five contract functions and validates credential-free configuration', () => {
    assert.deepEqual(Object.keys(require('../jira/client.cjs')).sort(),
        ['adfText', 'readIssue', 'readSprint', 'syncEvidence', 'validateJiraConfig']);
    assert.deepEqual(validateJiraConfig({ ...config, url: `${site}/` }), {
        ...config, token_env: 'JIRA_API_TOKEN', email_env: 'JIRA_EMAIL', auth: 'basic',
        dependency_link_types: ['Blocks']
    });
    for (const invalid of [
        null, [], {}, { ...config, board_id: 0 }, { ...config, board_id: '42' },
        { ...config, board_id: Number.MAX_SAFE_INTEGER + 1 },
        ...['http://jira.example.test', `${site}/jira`, `${site}?token=secret`,
            `${site}#secret`, 'https://user:secret@jira.example.test', `${site}\\path`]
            .map(url => ({ ...config, url })),
        { ...config, token: env.JIRA_API_TOKEN }, { ...config, email: env.JIRA_EMAIL },
        { ...config, source_id_field: 'summary' }, { ...config, acceptance_criteria_field: '../field' },
        { ...config, source_id_field: `customfield_${'1'.repeat(200)}` },
        { ...config, token_env: '' }, { ...config, email_env: 'BAD NAME' },
        { ...config, auth: 'cookie' }, { ...config, dependency_link_types: 'Blocks' },
        { ...config, dependency_link_types: ['Blocks', 'blocks'] }
    ]) {
        assert.throws(() => validateJiraConfig(invalid), error =>
            error instanceof Error && !error.message.includes(env.JIRA_API_TOKEN));
    }
});

test('renders ADF headings, paragraphs, ordered and nested lists, and hard breaks', () => {
    const rendered = adfText(doc(
        heading('Acceptance criteria'),
        { type: 'orderedList', attrs: { order: 2 }, content: [
            { type: 'listItem', content: [paragraph('First'), list('Nested')] },
            { type: 'listItem', content: [paragraph('Second')] }
        ] },
        { type: 'paragraph', content: [text('Line one'), { type: 'hardBreak' }, text('Line two')] }
    ));
    assert.equal(rendered, '## Acceptance criteria\n\n2. First\n   - Nested\n3. Second\n\nLine one\nLine two');
    assert.equal(adfText(null), '');
    assert.equal(adfText(' plain\r\ntext '), 'plain\ntext');
    assert.throws(() => adfText({ type: 'text', text: {} }), /document/i);
});

test('reads every offset sprint page and enhanced token issue page in original order', async () => {
    const mock = sprintFixture({
        sprints: [
            { startAt: 0, values: [active], isLast: false, maxResults: 1 },
            { startAt: 1, values: [{ id: 8, name: 'Next', state: 'future' }], isLast: true }
        ],
        pages: [
            { issues: [jiraIssue('101', 'PLAN-2', { customfield_10000: 'F001-S02' })], isLast: false, nextPageToken: '1' },
            { issues: [jiraIssue()], isLast: true }
        ]
    });
    const result = await readSprint(config, { ...mock, env, sprintId: 7 });
    assert.equal(result.version, 1);
    assert.equal(result.site, site);
    assert.equal(result.board_id, 42);
    assert.deepEqual(result.sprint, active);
    assert.deepEqual(result.issues.map(issue => issue.id), ['101', '100']);
    assert.deepEqual(result.issues.map(issue => issue.source_id), ['F001-S02', 'F001-S01']);
    assert.equal(result.issues[0].url, `${site}/browse/PLAN-2`);
    assert.match(result.digest, /^[0-9a-f]{64}$/);
    assert.ok(mock.calls.every(call => call.method === 'GET'));
    assert.ok(mock.calls.every(call => !call.url.pathname.includes('/search')));
    assert.equal(mock.calls.filter(call => call.url.pathname.endsWith('/issue')).length, 2);
});

test('uses total-based sprint offsets and preserves opaque enhanced cursors without legacy offsets', async () => {
    const cursor = 'opaque+/=cursor ?';
    const mock = mocked(({ url }) => {
        if (url.pathname === '/rest/api/3/field') return reply([{ id: 'customfield_10000', name: 'Source ID' }]);
        if (url.pathname.endsWith('/sprint')) {
            const startAt = Number(url.searchParams.get('startAt'));
            return reply({
                startAt, maxResults: 1, total: 2,
                values: [{ ...active, id: startAt === 0 ? 6 : 7, state: startAt === 0 ? 'closed' : 'active' }]
            });
        }
        assert.equal(url.searchParams.has('startAt'), false);
        const next = url.searchParams.get('nextPageToken');
        if (next === null) return reply({ issues: [jiraIssue()], isLast: false, nextPageToken: cursor });
        assert.equal(next, cursor);
        return reply({ issues: [jiraIssue('101', 'PLAN-2', { customfield_10000: 'F001-S02' })], isLast: true });
    });
    const result = await readSprint(config, { ...mock, env, sprintId: 7 });
    assert.deepEqual(result.issues.map(issue => issue.id), ['100', '101']);
    assert.equal(mock.calls.filter(call => call.url.pathname.endsWith('/sprint')).length, 2);
});

test('requires a choice for zero or multiple active sprints', async () => {
    for (const values of [[], [active, { ...active, id: 9 }]]) {
        const mock = sprintFixture({ sprints: [{ startAt: 0, values, isLast: true }] });
        await assert.rejects(readSprint(config, { ...mock, env }), /active sprint/i);
        assert.equal(mock.calls.some(call => call.url.pathname.endsWith('/issue')), false);
    }
    const mock = sprintFixture({ sprints: [{ startAt: 0, values: [active, { ...active, id: 9 }], isLast: true }] });
    assert.equal((await readSprint(config, { ...mock, env, sprintId: 9 })).sprint.id, 9);
    await assert.rejects(readSprint(config, { ...sprintFixture(), env, sprintId: 99 }), /selected sprint/i);
});

test('requires explicit future approval and never starts or changes a sprint', async () => {
    const fixture = () => sprintFixture({
        sprints: [{ startAt: 0, values: [{ ...active, state: 'future' }], isLast: true }]
    });
    await assert.rejects(readSprint(config, { ...fixture(), env, sprintId: 7 }), /allowFuture/i);
    const mock = fixture();
    assert.equal((await readSprint(config, { ...mock, env, sprintId: 7, allowFuture: true })).sprint.state, 'future');
    assert.ok(mock.calls.every(call => call.method === 'GET'));
    await assert.rejects(readSprint(config, { ...fixture(), env, sprintId: '7' }), /sprint/i);
});

test('discovers exactly one Source ID field or uses the configured custom field', async () => {
    for (const fields of [
        [], [{ id: 'customfield_10000', name: 'Source ID' }, { id: 'customfield_10001', name: 'Source ID' }]
    ]) {
        await assert.rejects(readSprint(config, { ...sprintFixture({ fields }), env }), /Source ID/i);
    }
    const mock = sprintFixture({
        fields: [], pages: [{ issues: [jiraIssue('100', 'PLAN-1', { customfield_20000: 'F002-S01' })], isLast: true }]
    });
    const result = await readSprint({ ...config, source_id_field: 'customfield_20000' }, { ...mock, env });
    assert.equal(result.issues[0].source_id, 'F002-S01');
    assert.equal(mock.calls.some(call => call.url.pathname === '/rest/api/3/field'), false);
    assert.ok(mock.calls.find(call => call.url.pathname.endsWith('/issue')).url.searchParams.get('fields').includes('customfield_20000'));
});

test('preserves metadata identities, returns absent IDs as null, and rejects contradictions', async () => {
    const issueWith = fields => sprintFixture({ pages: [{ issues: [jiraIssue('100', 'PLAN-1', fields)], isLast: true }] });
    const fromMetadata = await readSprint(config, {
        ...issueWith({ customfield_10000: null, description: doc(heading('Planning metadata'), list('Source ID: F123-S45')) }), env
    });
    assert.equal(fromMetadata.issues[0].source_id, 'F123-S45');
    const absent = await readSprint(config, { ...issueWith({ customfield_10000: null }), env });
    assert.equal(absent.issues[0].source_id, null);
    assert.deepEqual(absent.issues[0].acceptance_criteria, []);
    assert.equal(absent.issues[0].design_status, null);
    assert.equal(absent.issues[0].work_kind, null);
    assert.equal(absent.issues[0].source_priority, null);
    await assert.rejects(readSprint(config, {
        ...issueWith({ description: 'Source ID: F001-S02' }), env
    }), /contradict/i);
    await assert.rejects(readSprint(config, {
        ...issueWith({ customfield_10000: 'PLAN-1' }), env
    }), /Source ID/i);
    await assert.rejects(readSprint(config, {
        ...sprintFixture({ pages: [{ issues: [jiraIssue(), jiraIssue('101', 'PLAN-2')], isLast: true }] }), env
    }), /Source ID/i);
});

test('parses exact criteria and structured coverage, prerequisites, work, readiness, and priority', async () => {
    const description = doc(
        heading('Overview'), paragraph('Do not infer criteria from this paragraph.'),
        heading('Acceptance criteria'), list('Alpha works', 'Beta works'),
        heading('Planning metadata'), list(
            'Source ID: F001-S01',
            'Feature acceptance coverage: F001 criterion 1, F001 criterion 3',
            'Direct story prerequisites: F001-S02, F009-S01',
            'Work kind: implementation', 'Design readiness: approved', 'Source delivery priority: 2'
        ),
        heading('Examples'), { type: 'codeBlock', content: [text('Source ID: F999-S99')] }
    );
    const mock = sprintFixture({ pages: [{ issues: [jiraIssue('100', 'PLAN-1', { description })], isLast: true }] });
    const issue = (await readSprint(config, { ...mock, env })).issues[0];
    assert.deepEqual(issue.acceptance_criteria, ['Alpha works', 'Beta works']);
    assert.deepEqual(issue.covers_feature_criteria, [1, 3]);
    assert.deepEqual(issue.depends_on, ['F001-S02', 'F009-S01']);
    assert.equal(issue.work_kind, 'implementation');
    assert.equal(issue.design_status, 'approved');
    assert.equal(issue.source_priority, 2);
    assert.equal(issue.status, 'To Do');
    assert.equal(issue.updated, '2026-11-02T10:00:00Z');
    assert.match(issue.description, /## Acceptance criteria\n\n- Alpha works/);
});

test('uses configured AC content and does not mine approximate description sections', async () => {
    const mock = sprintFixture({
        pages: [{ issues: [jiraIssue('100', 'PLAN-1', {
            description: '## Acceptance criteria\n- Old\n## Notes\nDo not include this.',
            customfield_20000: doc(list('Authoritative criterion', 'Another criterion'))
        })], isLast: true }]
    });
    const result = await readSprint({ ...config, acceptance_criteria_field: 'customfield_20000' }, { ...mock, env });
    assert.deepEqual(result.issues[0].acceptance_criteria, ['Authoritative criterion', 'Another criterion']);
    for (const description of ['## Possible acceptance criteria\n- Not a criterion', 'General prose without a section']) {
        const fixture = sprintFixture({ pages: [{ issues: [jiraIssue('100', 'PLAN-1', { description })], isLast: true }] });
        assert.deepEqual((await readSprint(config, { ...fixture, env })).issues[0].acceptance_criteria, []);
    }
});

test('keeps nested acceptance sections but excludes following peer sections and honors empty configured AC', async () => {
    const raw = jiraIssue('100', 'PLAN-1', { description: doc(
        heading('Acceptance criteria'),
        { type: 'heading', attrs: { level: 3 }, content: [text('Primary behavior')] }, list('Alpha works'),
        { type: 'heading', attrs: { level: 3 }, content: [text('Secondary behavior')] }, list('Beta works'),
        heading('Notes'), list('Not acceptance criteria')
    ) });
    const fixture = () => sprintFixture({ pages: [{ issues: [raw], isLast: true }] });
    assert.deepEqual((await readSprint(config, { ...fixture(), env })).issues[0].acceptance_criteria,
        ['Alpha works', 'Beta works']);
    assert.deepEqual((await readSprint({ ...config, acceptance_criteria_field: 'customfield_20000' },
        { ...fixture(), env })).issues[0].acceptance_criteria, []);
});

test('rejects contradictory or malformed planning metadata rather than guessing', async () => {
    for (const description of [
        'Feature acceptance coverage: F002 criterion 1',
        'Feature acceptance coverage: F001 criterion 0',
        'Direct story prerequisites: F001-S01',
        'Direct story prerequisites: unknown',
        'Work kind: implementation\nWork kind: refactor',
        'Source delivery priority: urgent'
    ]) {
        const mock = sprintFixture({ pages: [{ issues: [jiraIssue('100', 'PLAN-1', { description })], isLast: true }] });
        await assert.rejects(readSprint(config, { ...mock, env }), /metadata|contradict|prerequisite|priority|coverage/i);
    }
});

test('resolves only inward blocking links, including feature prerequisites outside the sprint', async () => {
    const description = 'Direct story prerequisites: F009-S01';
    const inward = { type: { name: 'Blocks' }, inwardIssue: { id: '999', key: 'EXT-9' } };
    const mock = sprintFixture({
        pages: [{ issues: [jiraIssue('100', 'PLAN-1', { description, issuelinks: [
            inward, inward,
            { type: { name: 'Blocks' }, outwardIssue: { id: '998', key: 'EXT-8' } },
            { type: { name: 'Relates', inward: 'is blocked by' }, inwardIssue: { id: '997', key: 'EXT-7' } }
        ] })], isLast: true }],
        linked: { 999: jiraIssue('999', 'EXT-9', { customfield_10000: 'F002' }) }
    });
    const result = await readSprint(config, { ...mock, env });
    assert.deepEqual(result.issues[0].depends_on, ['F009-S01']);
    assert.deepEqual(result.issues[0].blocked_by, ['F002']);
    assert.equal(result.issues.length, 1);
    const lookups = mock.calls.filter(call => /^\/rest\/api\/3\/issue\//.test(call.url.pathname));
    assert.deepEqual(lookups.map(call => call.url.pathname), ['/rest/api/3/issue/999']);
});

test('reuses same-sprint source identities and refuses contradictory linked ID/key pairs', async () => {
    const first = jiraIssue('100', 'PLAN-1', { issuelinks: [
        { type: { name: 'Blocks' }, inwardIssue: { id: '101', key: 'PLAN-2' } }
    ] });
    const second = jiraIssue('101', 'PLAN-2', { customfield_10000: 'F001-S02' });
    const mock = sprintFixture({ pages: [{ issues: [first, second], isLast: true }] });
    const result = await readSprint(config, { ...mock, env });
    assert.deepEqual(result.issues[0].blocked_by, ['F001-S02']);
    assert.equal(mock.calls.some(call => call.url.pathname.startsWith('/rest/api/3/issue/')), false);
    first.fields.issuelinks[0].inwardIssue = { id: '999', key: 'PLAN-2' };
    const contradictory = sprintFixture({
        pages: [{ issues: [first, second], isLast: true }],
        linked: { 999: jiraIssue('999', 'EXT-9', { customfield_10000: 'F002' }) }
    });
    await assert.rejects(readSprint(config, { ...contradictory, env }), /contradict|identity/i);
});

test('refuses unresolved or contradictory linked Source IDs without creating placeholders', async () => {
    for (const fields of [
        { customfield_10000: null },
        { customfield_10000: 'F002', description: 'Source ID: F003' }
    ]) {
        const mock = sprintFixture({
            pages: [{ issues: [jiraIssue('100', 'PLAN-1', { issuelinks: [
                { type: { name: 'Blocks' }, inwardIssue: { id: '999' } }
            ] })], isLast: true }],
            linked: { 999: jiraIssue('999', 'EXT-9', fields) }
        });
        await assert.rejects(readSprint(config, { ...mock, env }), /Source ID/i);
    }
});

test('reads an issue by immutable ID or key with identical normalization and no sprint lookup', async () => {
    const raw = jiraIssue('100', 'RENAMED-8', {
        description: doc(heading('Acceptance criteria'), list('Behavior works'),
            heading('Planning metadata'), list('Feature acceptance coverage: F001 criterion 1')),
        issuelinks: [{ type: { name: 'Blocks' }, inwardIssue: { id: '999' } }]
    });
    const linked = { 100: raw, 'OLD-1': raw, 999: jiraIssue('999', 'EXT-9', { customfield_10000: 'F002' }) };
    const expected = (await readSprint(config, {
        ...sprintFixture({ pages: [{ issues: [raw], isLast: true }], linked }), env
    })).issues[0];
    for (const identifier of ['100', 100, 'OLD-1']) {
        const mock = sprintFixture({ linked });
        assert.deepEqual(await readIssue(config, identifier, { ...mock, env }), expected);
        assert.ok(mock.calls.every(call => call.method === 'GET'));
        assert.ok(mock.calls.every(call => !call.url.pathname.includes('/sprint')));
    }
});

test('readIssue rejects invalid or changed immutable IDs and enforces Source ID contradictions', async () => {
    for (const identifier of [null, '', '../100', 'https://other.example.test/issue/100', 0]) {
        const mock = sprintFixture();
        await assert.rejects(readIssue(config, identifier, { ...mock, env }), /identity|issue/i);
        assert.equal(mock.calls.length, 0);
    }
    const mismatched = sprintFixture({ linked: { 100: jiraIssue('101') } });
    await assert.rejects(readIssue(config, '100', { ...mismatched, env }), /identity/i);
    const contradictory = sprintFixture({ linked: {
        100: jiraIssue('100', 'PLAN-1', { description: 'Source ID: F001-S02' })
    } });
    await assert.rejects(readIssue(config, '100', { ...contradictory, env }), /contradict/i);
});

test('uses immutable identity and a deterministic requirements digest independent of credentials and workflow', async () => {
    const first = await readSprint(config, { ...sprintFixture(), env });
    const renamed = sprintFixture({
        pages: [{ issues: [jiraIssue('100', 'RENAMED-8', {
            status: { id: '3', name: 'In Progress' }, updated: '2026-11-03T10:00:00Z'
        })], isLast: true }]
    });
    const second = await readSprint(config, { ...renamed, env: { ...env, JIRA_API_TOKEN: 'different-token' } });
    assert.equal(first.issues[0].id, second.issues[0].id);
    assert.equal(first.issues[0].source_id, second.issues[0].source_id);
    assert.equal(first.digest, second.digest);
    const changed = await readSprint(config, {
        ...sprintFixture({ pages: [{ issues: [jiraIssue('100', 'PLAN-1', { summary: 'Changed requirement' })], isLast: true }] }), env
    });
    assert.notEqual(first.digest, changed.digest);
    assert.notEqual(first.digest, (await readSprint(config, {
        ...sprintFixture({ sprints: [{ startAt: 0, values: [{ ...active, id: 8 }], isLast: true }] }), env
    })).digest);
});

test('rejects repeated IDs, cursors, and stalled or overlong pagination', async () => {
    const cases = [
        sprintFixture({ sprints: [
            { startAt: 0, values: [active], isLast: false },
            { startAt: 1, values: [active], isLast: true }
        ] }),
        sprintFixture({ sprints: [{ startAt: 0, values: [], isLast: false }] }),
        sprintFixture({ pages: [
            { issues: [jiraIssue()], isLast: false, nextPageToken: '1' },
            { issues: [jiraIssue()], isLast: true }
        ] }),
        sprintFixture({ pages: [
            { issues: [], isLast: false, nextPageToken: '1' },
            { issues: [], isLast: false, nextPageToken: '1' }
        ] }),
        sprintFixture({ pages: Array.from({ length: 101 }, (_, index) => ({
            issues: [], isLast: false, nextPageToken: String(index + 1)
        })) })
    ];
    for (const mock of cases) {
        await assert.rejects(readSprint(config, { ...mock, env, sprintId: 7 }), /repeat|pagination|page limit|stalled/i);
    }
});

test('rejects redirects and cross-origin responses without reading their bodies', async () => {
    for (const extra of [
        { status: 302, ok: false }, { redirected: true },
        { url: 'https://other.example.test/rest/api/3/field' }
    ]) {
        const mock = mocked(() => reply(null, 200, {
            ...extra, json: async () => { throw new Error(env.JIRA_API_TOKEN); }
        }));
        await assert.rejects(readSprint(config, { ...mock, env }), /redirect|origin/i);
        assert.equal(mock.calls.length, 1);
    }
});

test('reports HTTP, permission, and rate failures without exposing raw bodies or credentials', async () => {
    for (const [status, message] of [
        [401, /authentication/i], [403, /permission/i], [404, /404/], [429, /rate/i], [500, /500/]
    ]) {
        let bodyRead = false;
        const mock = mocked(() => reply(null, status, {
            json: async () => { bodyRead = true; throw new Error(env.JIRA_API_TOKEN); }
        }));
        await assert.rejects(readSprint(config, { ...mock, env }), error =>
            message.test(error.message) && !error.message.includes(env.JIRA_API_TOKEN)
            && !error.message.includes(env.JIRA_EMAIL));
        assert.equal(bodyRead, false);
    }
    const failed = mocked(() => { throw new Error(`Network details ${env.JIRA_API_TOKEN}`); });
    await assert.rejects(readSprint(config, { ...failed, env }), error =>
        /request failed/i.test(error.message) && !error.message.includes(env.JIRA_API_TOKEN));
});

test('rejects invalid JSON and incomplete enhanced pagination without exposing response content', async () => {
    const invalid = mocked(() => reply(null, 200, { json: async () => { throw new Error(env.JIRA_API_TOKEN); } }));
    await assert.rejects(readSprint(config, { ...invalid, env }), error =>
        /invalid JSON/i.test(error.message) && !error.message.includes(env.JIRA_API_TOKEN));
    for (const page of [{ issues: [] }, { issues: [], isLast: false }, { issues: [], isLast: 'true' }]) {
        await assert.rejects(readSprint(config, { ...sprintFixture({ pages: [page] }), env }), /pagination/i);
    }
});

test('loads basic or bearer credentials only from the selected environment variables', async () => {
    const basic = sprintFixture();
    await readSprint(config, { ...basic, env });
    assert.equal(basic.calls[0].headers.Authorization,
        `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}`);
    const bearer = sprintFixture();
    await readSprint({ ...config, auth: 'bearer', token_env: 'CUSTOM_TOKEN' }, {
        ...bearer, env: { CUSTOM_TOKEN: 'bearer-token' }
    });
    assert.equal(bearer.calls[0].headers.Authorization, 'Bearer bearer-token');
    for (const missing of [{}, { JIRA_API_TOKEN: 'token' }, { ...env, JIRA_API_TOKEN: 'bad\r\nvalue' }]) {
        const mock = sprintFixture();
        await assert.rejects(readSprint(config, { ...mock, env: missing }), /credential|authentication/i);
        assert.equal(mock.calls.length, 0);
    }
});

test('bounds request time even when a mocked fetch ignores abort', async context => {
    let signal;
    const original = globalThis.setTimeout;
    const timer = context.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => {
        assert.ok(milliseconds > 0 && milliseconds <= 30_000);
        return original(callback, 1);
    });
    const pending = readSprint(config, {
        env, fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); }
    });
    timer.mock.restore();
    await assert.rejects(pending, /timed out/i);
    assert.equal(signal.aborted, true);
});

function evidenceFixture({
    comments = [], status = '1', transitions, resolvedId = '100',
    failTransitionOnce = false, applyThenFail = false
} = {}) {
    const stored = [...comments];
    let currentStatus = status;
    let fail = failTransitionOnce;
    const mock = mocked(({ url, method, body }) => {
        if (/^\/rest\/api\/3\/issue\/(?:100|PLAN-1)$/.test(url.pathname)) {
            return reply(jiraIssue(resolvedId, 'RENAMED-8', { status: { id: currentStatus, name: 'Current' } }));
        }
        if (url.pathname === '/rest/api/3/issue/100/transitions') {
            if (method === 'GET') return reply({
                transitions: transitions || (currentStatus === '5' ? [] : [{ id: '31', name: 'Finish', to: { id: '5', name: 'Verified' } }])
            });
            if (fail) {
                fail = false;
                if (applyThenFail) currentStatus = '5';
                return reply(null, 500);
            }
            currentStatus = '5';
            return reply(null, 204);
        }
        if (url.pathname === '/rest/api/3/issue/100/comment') {
            if (method === 'POST') {
                const comment = { id: String(900 + stored.length), body: body.body };
                stored.push(comment);
                return reply(comment, 201);
            }
            const startAt = Number(url.searchParams.get('startAt'));
            return reply({ startAt, maxResults: 1, total: stored.length, comments: stored.slice(startAt, startAt + 1) });
        }
        throw new Error('Unexpected mocked evidence route.');
    });
    return { ...mock, stored };
}

test('requires approval and validates immutable evidence and issue inputs before requests', async () => {
    const mock = evidenceFixture();
    await assert.rejects(syncEvidence(config, { id: '100', key: 'PLAN-1' }, evidence, { ...mock, env }), /approv/i);
    for (const invalid of [
        { ...evidence, sha: 'abc1234' }, { ...evidence, repository: '../repo' },
        { ...evidence, url: 'https://github.com/other/repo/pull/1' },
        { ...evidence, url: `https://github.com/owner/repo/commit/${'b'.repeat(40)}` },
        { ...evidence, url: 'https://github.com/owner/repo/pull/1?token=secret' },
        { ...evidence, url: 'https://github.com.evil.test/owner/repo/pull/1' },
        { ...evidence, marker: 'bad\nmarker' }, { ...evidence, marker: 'x'.repeat(201) },
        { ...evidence, summary: 'x'.repeat(2001) }, { ...evidence, summary: '' }
    ]) {
        await assert.rejects(syncEvidence(config, { id: '100', key: 'PLAN-1' }, invalid,
            { ...mock, env, approve: true }), /evidence|SHA|repository|marker|summary/i);
    }
    await assert.rejects(syncEvidence(config, { id: '../100' }, evidence, { ...mock, env, approve: true }), /issue/i);
    await assert.rejects(syncEvidence(config, {}, evidence, { ...mock, env, approve: true }), /issue/i);
    assert.equal(mock.calls.length, 0);
});

test('creates only authorized ADF evidence and is idempotent across comment pages and transitions', async () => {
    const mock = evidenceFixture({ comments: [
        { id: '1', body: doc(paragraph('Unrelated comment')) },
        { id: '2', body: doc(paragraph('[harness:evidence:F002-S01:other]')) }
    ] });
    const options = { ...mock, env, approve: true, transitionId: '31', targetStatusId: '5' };
    assert.deepEqual(await syncEvidence(config, { id: '100', key: 'PLAN-1' }, evidence, options), {
        comment_id: '902', comment_created: true, transitioned: true, target_status_id: '5'
    });
    assert.deepEqual(await syncEvidence(config, { id: '100', key: 'PLAN-1' }, evidence, options), {
        comment_id: '902', comment_created: false, transitioned: false, target_status_id: '5'
    });
    const writes = mock.calls.filter(call => call.method === 'POST');
    assert.deepEqual(writes.map(call => call.url.pathname), [
        '/rest/api/3/issue/100/comment', '/rest/api/3/issue/100/transitions'
    ]);
    assert.equal(writes[0].body.body.type, 'doc');
    const rendered = adfText(writes[0].body.body);
    assert.ok(rendered.includes(evidence.marker));
    assert.ok(rendered.includes(evidence.sha));
    assert.ok(rendered.includes(evidence.url));
    assert.equal(rendered.includes(env.JIRA_API_TOKEN), false);
    assert.equal(rendered.includes(env.JIRA_EMAIL), false);
    assert.deepEqual(writes[1].body, { transition: { id: '31' } });
});

test('finds split-node marker text within later comments without creating a comment', async () => {
    const mock = evidenceFixture({ comments: [
        { id: '1', body: doc(paragraph('Other')) },
        { id: '2', body: doc({ type: 'paragraph', content: [
            text('Evidence marker: '), text(evidence.marker.slice(0, 10)), text(evidence.marker.slice(10))
        ] }) }
    ] });
    const result = await syncEvidence(config, { key: 'PLAN-1' }, {
        ...evidence, url: 'https://github.com/owner/repo/pull/123'
    }, { ...mock, env, approve: true });
    assert.deepEqual(result, { comment_id: '2', comment_created: false, transitioned: false });
    assert.ok(mock.calls.every(call => call.method === 'GET'));
    assert.ok(mock.calls.slice(1).every(call => call.url.pathname.includes('/issue/100/')));
});

test('refuses ambiguous markers and repeated comment IDs before writing', async () => {
    for (const comments of [
        [{ id: '1', body: doc(paragraph(evidence.marker)) }, { id: '2', body: doc(paragraph(evidence.marker)) }],
        [{ id: '1', body: doc(paragraph('Other')) }, { id: '1', body: doc(paragraph('Other')) }]
    ]) {
        const mock = evidenceFixture({ comments });
        await assert.rejects(syncEvidence(config, { id: '100' }, evidence,
            { ...mock, env, approve: true }), /ambiguous|repeated/i);
        assert.ok(mock.calls.every(call => call.method === 'GET'));
    }
});

test('validates available transitions and immutable resolution before any writes', async () => {
    for (const overrides of [
        { transitions: [{ id: '32', to: { id: '5' } }] },
        { transitions: [{ id: '31', to: { id: '6' } }] },
        { transitions: [{ id: '31' }] },
        { transitions: [{ id: '31', to: { id: '5' } }, { id: '31', to: { id: '6' } }] },
        { resolvedId: '101' }
    ]) {
        const mock = evidenceFixture(overrides);
        await assert.rejects(syncEvidence(config, { id: '100', key: 'PLAN-1' }, evidence,
            { ...mock, env, approve: true, transitionId: '31', targetStatusId: '5' }), /transition|identity/i);
        assert.ok(mock.calls.every(call => call.method === 'GET'));
    }
    const done = evidenceFixture({ status: '5' });
    const result = await syncEvidence(config, { id: '100' }, evidence,
        { ...done, env, approve: true, transitionId: '31', targetStatusId: '5' });
    assert.equal(result.transitioned, false);
    assert.equal(result.target_status_id, '5');
    assert.equal(done.calls.some(call => call.url.pathname.endsWith('/transitions')), false);
    assert.equal(done.calls.filter(call => call.method === 'POST' && call.url.pathname.endsWith('/transitions')).length, 0);
});

test('requires a valid target status with an explicitly selected transition before any requests', async () => {
    const mock = evidenceFixture();
    for (const options of [
        { transitionId: '31' }, { transitionId: '31', targetStatusId: '../5' }
    ]) {
        await assert.rejects(syncEvidence(config, { id: '100' }, evidence,
            { ...mock, env, approve: true, ...options }), /target|transition|identity/i);
    }
    assert.equal(mock.calls.length, 0);
});

test('a target without a transition never implies a state change or includes unrelated receipt fields', async () => {
    const mock = evidenceFixture();
    const result = await syncEvidence(config, { id: '100' }, {
        ...evidence, summary: 'First line\r\nSecond line', raw_prompt: 'Do not copy this raw prompt.', token: 'unrelated-secret'
    }, { ...mock, env, approve: true, targetStatusId: '5' });
    assert.equal(result.transitioned, false);
    assert.equal(result.target_status_id, '5');
    assert.equal(mock.calls.some(call => call.url.pathname.endsWith('/transitions')), false);
    const content = JSON.stringify(mock.stored[0].body);
    assert.equal(content.includes('raw prompt'), false);
    assert.equal(content.includes('unrelated-secret'), false);
    assert.match(adfText(mock.stored[0].body), /First line\n\nSecond line/);
});

test('a failed transition retry reuses the successful evidence comment', async () => {
    const mock = evidenceFixture({ failTransitionOnce: true });
    const options = { ...mock, env, approve: true, transitionId: '31', targetStatusId: '5' };
    await assert.rejects(syncEvidence(config, { id: '100' }, evidence, options), /500/);
    const result = await syncEvidence(config, { id: '100' }, evidence, options);
    assert.equal(result.comment_created, false);
    assert.equal(result.transitioned, true);
    assert.equal(mock.stored.length, 1);
});

test('retrying an ambiguously successful transition needs neither another POST nor an available transition', async () => {
    const mock = evidenceFixture({ failTransitionOnce: true, applyThenFail: true });
    const options = { ...mock, env, approve: true, transitionId: '31', targetStatusId: '5' };
    await assert.rejects(syncEvidence(config, { id: '100' }, evidence, options), /500/);
    const result = await syncEvidence(config, { id: '100' }, evidence, options);
    assert.deepEqual(result, {
        comment_id: '900', comment_created: false, transitioned: false, target_status_id: '5'
    });
    assert.equal(mock.calls.filter(call => call.method === 'GET' && call.url.pathname.endsWith('/transitions')).length, 1);
    assert.equal(mock.calls.filter(call => call.method === 'POST' && call.url.pathname.endsWith('/transitions')).length, 1);
    assert.equal(mock.stored.length, 1);
});
