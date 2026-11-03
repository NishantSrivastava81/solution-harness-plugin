'use strict';

const crypto = require('node:crypto');

const pageLimit = 100;
const pageSize = 100;
const timeoutMilliseconds = 15_000;
const sourcePattern = /^F\d{3,}(?:-S\d{2,})?$/;
const configFields = new Set([
    'url', 'board_id', 'source_id_field', 'acceptance_criteria_field',
    'token_env', 'email_env', 'auth', 'dependency_link_types'
]);
const labels = new Map([
    ['source id', 'source_id'], ['acceptance criteria', 'acceptance_criteria'],
    ['feature acceptance coverage', 'coverage'], ['direct story prerequisites', 'prerequisites'],
    ['work kind', 'work_kind'], ['design readiness', 'design_status'],
    ['source delivery priority', 'source_priority']
]);

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value, limit, multiline = false) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
        && !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value);
}

function validateJiraConfig(jira) {
    if (!object(jira) || ![Object.prototype, null].includes(Object.getPrototypeOf(jira))
        || Object.getOwnPropertyNames(jira).some(key => !configFields.has(key)) || Object.getOwnPropertySymbols(jira).length) {
        throw new Error('Invalid Jira config; store credentials only in environment variables.');
    }
    let url;
    try {
        if (!boundedText(jira.url, 2048) || /[\\\s?#]/.test(jira.url) || !/^https:\/\/[^/]+\/?$/i.test(jira.url)) {
            throw new Error();
        }
        url = new URL(jira.url);
        if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/') {
            throw new Error();
        }
    } catch {
        throw new Error('Jira url must be an HTTPS site base URL without credentials, path, query, or fragment.');
    }
    if (!Number.isSafeInteger(jira.board_id) || jira.board_id <= 0) {
        throw new Error('Jira board_id must be a positive integer.');
    }
    if (jira.source_id_field !== undefined
        && (!boundedText(jira.source_id_field, 128) || !/^customfield_\d+$/.test(jira.source_id_field))) {
        throw new Error('Jira source_id_field must be a customfield ID.');
    }
    if (jira.acceptance_criteria_field !== undefined
        && (typeof jira.acceptance_criteria_field !== 'string'
            || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(jira.acceptance_criteria_field))) {
        throw new Error('Jira acceptance_criteria_field must be a field ID.');
    }
    const token_env = jira.token_env === undefined ? 'JIRA_API_TOKEN' : jira.token_env;
    const email_env = jira.email_env === undefined ? 'JIRA_EMAIL' : jira.email_env;
    if (![token_env, email_env].every(name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))) {
        throw new Error('Jira credential environment variable names must be nonempty valid names.');
    }
    const auth = jira.auth === undefined ? 'basic' : jira.auth;
    if (!['basic', 'bearer'].includes(auth)) throw new Error('Jira auth must be basic or bearer.');
    const types = jira.dependency_link_types === undefined ? ['Blocks'] : jira.dependency_link_types;
    if (!Array.isArray(types) || types.length > 32 || !types.every(type => boundedText(type, 128))
        || new Set(types.map(type => type.trim().toLowerCase())).size !== types.length) {
        throw new Error('Jira dependency_link_types must contain unique link type names.');
    }
    return {
        url: url.origin, board_id: jira.board_id,
        ...(jira.source_id_field === undefined ? {} : { source_id_field: jira.source_id_field }),
        ...(jira.acceptance_criteria_field === undefined ? {} : { acceptance_criteria_field: jira.acceptance_criteria_field }),
        token_env, email_env, auth, dependency_link_types: types.map(type => type.trim())
    };
}

function clientFor(jira, fetchImpl, env) {
    const config = validateJiraConfig(jira);
    if (typeof fetchImpl !== 'function') throw new Error('A Jira fetch implementation is required.');
    if (!object(env)) throw new Error('Jira authentication requires an environment object.');
    const token = env[config.token_env];
    const email = env[config.email_env];
    if (!boundedText(token, 16_384) || /\s/.test(token)
        || (config.auth === 'basic' && (!boundedText(email, 320) || !/^[^\s:@]+@[^\s:@]+$/.test(email)))) {
        throw new Error('Missing or invalid Jira authentication credentials in the environment.');
    }
    const authorization = config.auth === 'bearer' ? `Bearer ${token}`
        : `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

    async function request(route, { method = 'GET', query = {}, body, json = true } = {}) {
        const url = new URL(route, `${config.url}/`);
        if (url.origin !== config.url || url.username || url.password || !url.pathname.startsWith('/rest/')) {
            throw new Error('Cross-origin Jira requests are not allowed.');
        }
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
        const controller = new AbortController();
        let timer;
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new Error('Jira request timed out.'));
            }, timeoutMilliseconds);
        });
        async function execute() {
            let response;
            try {
                response = await fetchImpl(url.href, {
                    method, redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
                    headers: {
                        Accept: 'application/json', Authorization: authorization,
                        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
                    },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) })
                });
            } catch {
                throw new Error(controller.signal.aborted ? 'Jira request timed out.' : 'Jira request failed; check connectivity and TLS.');
            }
            if (!response || !Number.isInteger(response.status)) throw new Error('Invalid Jira HTTP response.');
            if (response.redirected || (response.status >= 300 && response.status < 400)) {
                throw new Error('Jira redirects are not allowed.');
            }
            if (response.url) {
                let returned;
                try { returned = new URL(response.url); } catch { throw new Error('Invalid Jira response origin.'); }
                if (returned.origin !== config.url || returned.username || returned.password) {
                    throw new Error('Cross-origin Jira responses are not allowed.');
                }
            }
            if (response.status === 401) throw new Error('Jira authentication failed (HTTP 401).');
            if (response.status === 403) throw new Error('Jira permission denied (HTTP 403).');
            if (response.status === 429) throw new Error('Jira rate limit exceeded (HTTP 429); retry later.');
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Jira request failed (HTTP ${response.status}).`);
            }
            if (!json || response.status === 204) return null;
            try {
                return await response.json();
            } catch {
                throw new Error(controller.signal.aborted ? 'Jira request timed out.' : 'Jira returned invalid JSON.');
            }
        }
        try {
            return await Promise.race([execute(), deadline]);
        } finally {
            clearTimeout(timer);
            controller.abort();
        }
    }
    return { config, request };
}

function identifier(value) {
    if (Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === 'string' && /^[1-9]\d{0,31}$/.test(value)) return value;
    throw new Error('Invalid Jira issue, comment, or transition identity.');
}

function issueKey(value) {
    if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,254}-[1-9]\d{0,31}$/.test(value)) {
        throw new Error('Invalid Jira issue key.');
    }
    return value;
}

function pageValues(page, key) {
    if (!object(page) || !Array.isArray(page[key]) || page[key].length > pageSize) {
        throw new Error('Invalid Jira pagination response.');
    }
    return page[key];
}

async function offsetPages(client, route, key, query = {}) {
    const result = [];
    const seen = new Set();
    let startAt = 0;
    for (let pageNumber = 0; pageNumber < pageLimit; pageNumber++) {
        const page = await client.request(route, { query: { ...query, startAt, maxResults: pageSize } });
        const values = pageValues(page, key);
        if ((page.startAt !== undefined && page.startAt !== startAt)
            || (page.maxResults !== undefined && (!Number.isSafeInteger(page.maxResults) || page.maxResults <= 0))
            || (page.total !== undefined && (!Number.isSafeInteger(page.total) || page.total < startAt + values.length))
            || (page.isLast !== undefined && typeof page.isLast !== 'boolean')
            || (page.isLast === undefined && page.total === undefined)) {
            throw new Error('Invalid or repeated Jira pagination offset.');
        }
        for (const value of values) {
            const id = identifier(value?.id);
            if (seen.has(id)) throw new Error('Repeated Jira ID in pagination.');
            seen.add(id);
            result.push(value);
        }
        const last = page.isLast === undefined ? startAt + values.length >= page.total : page.isLast;
        if (last) {
            if (page.total !== undefined && startAt + values.length !== page.total) {
                throw new Error('Contradictory Jira pagination total.');
            }
            return result;
        }
        if (!values.length || (page.total !== undefined && startAt + values.length >= page.total)) {
            throw new Error('Stalled Jira pagination.');
        }
        startAt += values.length;
    }
    throw new Error('Jira pagination page limit exceeded.');
}

function issueFields(config, sourceField) {
    return [...new Set([
        'summary', 'description', 'status', 'updated', 'issuelinks', sourceField,
        config.acceptance_criteria_field
    ].filter(Boolean))].join(',');
}

async function sprintIssues(client, sprintId, sourceField) {
    const result = [];
    const ids = new Set();
    const cursors = new Set();
    const fields = issueFields(client.config, sourceField);
    let cursor;
    for (let pageNumber = 0; pageNumber < pageLimit; pageNumber++) {
        const page = await client.request(`/rest/software/1.0/board/${client.config.board_id}/sprint/${sprintId}/issue`, {
            query: { maxResults: pageSize, fields, ...(cursor === undefined ? {} : { nextPageToken: cursor }) }
        });
        for (const issue of pageValues(page, 'issues')) {
            const id = identifier(issue?.id);
            if (ids.has(id)) throw new Error('Repeated Jira issue ID in pagination.');
            ids.add(id);
            result.push(issue);
        }
        if (typeof page.isLast !== 'boolean') throw new Error('Invalid Jira token pagination.');
        const next = page.nextPageToken;
        if (next !== undefined && next !== null && next !== '') {
            if (!boundedText(next, 4096) || cursors.has(next)) throw new Error('Invalid or repeated Jira pagination cursor.');
            cursors.add(next);
        }
        if (page.isLast) return result;
        if (!boundedText(next, 4096)) throw new Error('Missing Jira pagination cursor.');
        cursor = next;
    }
    throw new Error('Jira pagination page limit exceeded.');
}

function adfText(value) {
    let count = 0;
    function render(node, depth = 0) {
        if (++count > 20_000 || depth > 40) throw new Error('Jira document exceeds safe limits.');
        if (node === null || node === undefined) return '';
        if (typeof node === 'string') {
            if (node.length > 1_000_000) throw new Error('Jira document exceeds safe limits.');
            return node;
        }
        if (!object(node) || typeof node.type !== 'string'
            || (node.content !== undefined && !Array.isArray(node.content))) {
            throw new Error('Invalid Jira document.');
        }
        if (node.type === 'text') {
            if (typeof node.text !== 'string') throw new Error('Invalid Jira document text.');
            return render(node.text, depth + 1);
        }
        if (node.type === 'hardBreak') return '\n';
        const children = () => (node.content || []).map(child => render(child, depth + 1)).join('');
        if (node.type === 'heading') {
            const level = node.attrs?.level;
            if (!Number.isInteger(level) || level < 1 || level > 6) throw new Error('Invalid Jira document heading.');
            return `${'#'.repeat(level)} ${children().trim()}\n\n`;
        }
        if (node.type === 'bulletList' || node.type === 'orderedList') {
            const start = node.attrs?.order === undefined ? 1 : node.attrs.order;
            if (!Number.isSafeInteger(start) || start < 1) throw new Error('Invalid Jira document list.');
            return (node.content || []).map((child, index) => {
                const marker = node.type === 'bulletList' ? '- ' : `${start + index}. `;
                return marker + render(child, depth + 1).trim().replace(/\n{2,}/g, '\n')
                    .replace(/\n/g, `\n${' '.repeat(marker.length)}`);
            }).join('\n') + '\n\n';
        }
        if (node.type === 'codeBlock') return `\`\`\`\n${children().trim()}\n\`\`\`\n\n`;
        if (node.type === 'blockquote') return children().trim().replace(/^/gm, '> ') + '\n\n';
        if (node.type === 'rule') return '---\n\n';
        if (node.type === 'tableRow') {
            return `| ${(node.content || []).map(child => render(child, depth + 1).trim().replace(/\n/g, ' ')).join(' | ')} |\n`;
        }
        if (node.type === 'table') return children() + '\n';
        if (node.type === 'mention' || node.type === 'emoji') {
            return typeof node.attrs?.text === 'string' ? node.attrs.text : '';
        }
        const content = children();
        return node.type === 'paragraph' ? `${content}\n\n` : content;
    }
    return render(value).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function planningMetadata(description) {
    const result = new Map();
    let section;
    let fence;
    function add(name, value) {
        if (value.trim()) result.set(name, [...(result.get(name) || []), value.trim()]);
    }
    function flush() {
        if (section) add(section.name, section.lines.join('\n'));
        section = null;
    }
    for (const line of description.split('\n')) {
        const fenceMatch = line.trim().match(/^(`{3,}|~{3,})/);
        if (fenceMatch || fence) {
            if (section?.name === 'acceptance_criteria') section.lines.push(line);
            if (fenceMatch && (!fence || fence[0] === fenceMatch[1][0])) fence = fence ? null : fenceMatch[1];
            continue;
        }
        const headingMatch = line.trim().match(/^(?:(#{1,6})\s+|h([1-6])\.\s+)(.+?)(?:\s+#+)?$/);
        const heading = headingMatch ? {
            level: headingMatch[1]?.length || Number(headingMatch[2]), text: headingMatch[3]
        } : null;
        let candidate = (heading ? heading.text : line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, ''))
            .replace(/\*\*|__/g, '');
        if (candidate.startsWith('|') && candidate.endsWith('|')) {
            const cells = candidate.slice(1, -1).split('|').map(cell => cell.trim());
            if (cells.length === 2) candidate = `${cells[0]}: ${cells[1]}`;
        }
        const match = candidate.match(/^([^:]+?)(?:\s*:\s*(.*))?$/);
        const name = match && labels.get(match[1].trim().toLowerCase());
        if (name) {
            flush();
            const inline = match[2]?.trim();
            if (inline && !['acceptance_criteria', 'coverage', 'prerequisites'].includes(name)) add(name, inline);
            else section = { name, level: heading?.level || 6, lines: inline ? [inline] : [] };
        } else if (heading) {
            if (section?.name === 'acceptance_criteria' && heading.level > section.level) section.lines.push(line);
            else flush();
        } else if (/^---+$/.test(candidate)) {
            flush();
        } else if (section) {
            section.lines.push(line);
        }
    }
    flush();
    return result;
}

function scalarMetadata(metadata, name) {
    const values = (metadata.get(name) || []).map(value => value
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '').replace(/`/g, '').replace(/\s+/g, ' ').trim());
    if (new Set(values).size > 1) throw new Error('Contradictory Jira planning metadata.');
    if (values[0] && !boundedText(values[0], 500)) throw new Error('Invalid Jira planning metadata.');
    return values[0] || null;
}

function sourceIdentity(fields, sourceField, metadata) {
    const raw = fields[sourceField];
    const field = raw === undefined || raw === null ? null : adfText(raw);
    const values = [field, scalarMetadata(metadata, 'source_id')].filter(Boolean);
    if (values.some(value => !sourcePattern.test(value))) throw new Error('Invalid Jira Source ID.');
    if (new Set(values).size > 1) throw new Error('Contradictory Jira Source ID field and planning metadata.');
    return values[0] || null;
}

function listMetadata(metadata, name) {
    return (metadata.get(name) || []).join('\n').replace(/\*\*|`/g, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '').trim();
}

function noReferences(value) {
    return !value || /^(?:none|n\/a|not applicable|[-—])\.?$/i.test(value);
}

function separatorsOnly(value) {
    return /^[\s,;|/&()[\].-]*$/.test(value.replace(/\band\b/gi, ''));
}

function prerequisites(metadata) {
    const value = listMetadata(metadata, 'prerequisites');
    if (noReferences(value)) return [];
    const pattern = /\bF\d{3,}(?:-S\d{2,})?\b/g;
    const ids = value.match(pattern) || [];
    if (!ids.length || !separatorsOnly(value.replace(pattern, ''))) throw new Error('Invalid Jira prerequisite metadata.');
    return [...new Set(ids)];
}

function coverage(metadata, sourceId) {
    const value = listMetadata(metadata, 'coverage');
    if (noReferences(value)) return [];
    const pattern = /\b(F\d{3,})\s+criterion\s+([1-9]\d*)\b/gi;
    const matches = [...value.matchAll(pattern)];
    if (!matches.length || !separatorsOnly(value.replace(pattern, ''))) throw new Error('Invalid Jira feature acceptance coverage.');
    const features = new Set(matches.map(match => match[1].toUpperCase()));
    if (features.size !== 1 || (sourceId && !features.has(sourceId.split('-S')[0]))) {
        throw new Error('Contradictory Jira feature acceptance coverage.');
    }
    const numbers = matches.map(match => Number(match[2]));
    if (!numbers.every(Number.isSafeInteger)) throw new Error('Invalid Jira feature acceptance coverage number.');
    return [...new Set(numbers)];
}

function criteria(value) {
    if (Array.isArray(value)) return value.flatMap(criteria);
    const lines = adfText(value).split('\n');
    const pattern = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/;
    const matches = lines.map(line => line.match(pattern)).filter(Boolean);
    const clean = text => text.replace(/^\[[ xX]\]\s*/, '').trim();
    if (!matches.length) return lines.map(clean).filter(Boolean);
    const indentation = Math.min(...matches.map(match => match[1].length));
    const result = [];
    for (const line of lines) {
        const match = line.match(pattern);
        if (match && match[1].length === indentation) result.push(clean(match[2]));
        else if (line.trim() && result.length && !/^#{1,6}\s+/.test(line.trim())) {
            result[result.length - 1] += `\n${line.trimEnd()}`;
        }
    }
    return result.map(value => value.trim()).filter(Boolean);
}

function normalizeIssue(raw, sourceField, config) {
    if (!object(raw?.fields) || !boundedText(raw.fields.summary, 1000)
        || !boundedText(raw.fields.status?.name, 255)
        || (raw.fields.updated != null && !boundedText(raw.fields.updated, 128))) {
        throw new Error('Invalid Jira issue content.');
    }
    const fields = raw.fields;
    const description = adfText(fields.description);
    const metadata = planningMetadata(description);
    const source_id = sourceIdentity(fields, sourceField, metadata);
    const depends_on = prerequisites(metadata);
    if (source_id && depends_on.includes(source_id)) throw new Error('Jira prerequisite metadata contains a self-dependency.');
    const priority = scalarMetadata(metadata, 'source_priority');
    if (priority !== null && (!/^(?:0|[1-9]\d*)$/.test(priority) || !Number.isSafeInteger(Number(priority)))) {
        throw new Error('Invalid Jira source delivery priority.');
    }
    const key = issueKey(raw.key);
    const sections = metadata.get('acceptance_criteria') || [];
    if (config.acceptance_criteria_field === undefined && new Set(sections).size > 1) {
        throw new Error('Contradictory Jira acceptance criteria sections.');
    }
    return {
        id: identifier(raw.id), key, url: `${config.url}/browse/${key}`, source_id,
        title: fields.summary.trim(), description,
        acceptance_criteria: criteria(config.acceptance_criteria_field === undefined ? sections[0] : fields[config.acceptance_criteria_field]),
        covers_feature_criteria: coverage(metadata, source_id), depends_on, blocked_by: [],
        work_kind: scalarMetadata(metadata, 'work_kind'), design_status: scalarMetadata(metadata, 'design_status'),
        status: fields.status.name.trim(), updated: fields.updated?.trim() || null,
        source_priority: priority === null ? null : Number(priority)
    };
}

function normalizeSprint(raw) {
    if (!Number.isSafeInteger(raw?.id) || raw.id <= 0 || !boundedText(raw.name, 1000)
        || !['active', 'future', 'closed'].includes(raw.state)
        || ['startDate', 'endDate'].some(key => raw[key] != null && !boundedText(raw[key], 128))) {
        throw new Error('Invalid Jira sprint content.');
    }
    return {
        id: raw.id, name: raw.name.trim(), state: raw.state,
        ...(raw.startDate == null ? {} : { startDate: raw.startDate }),
        ...(raw.endDate == null ? {} : { endDate: raw.endDate })
    };
}

async function discoverSourceField(client) {
    const fields = await client.request('/rest/api/3/field');
    if (!Array.isArray(fields)) throw new Error('Invalid Jira field metadata.');
    const candidates = fields.filter(field => typeof field?.name === 'string' && field.name.trim().toLowerCase() === 'source id');
    if (candidates.length !== 1 || !boundedText(candidates[0].id, 128) || !/^customfield_\d+$/.test(candidates[0].id)) {
        throw new Error('Configure one unambiguous custom Source ID field.');
    }
    return candidates[0].id;
}

async function normalizeIssues(client, rawIssues, sourceField) {
    const { config } = client;
    const issues = rawIssues.map(issue => normalizeIssue(issue, sourceField, config));
    const byId = new Map();
    const byKey = new Map();
    const sourceOwners = new Map();
    function remember(id, key, sourceId) {
        if (sourceId && sourceOwners.has(sourceId) && sourceOwners.get(sourceId) !== id) {
            throw new Error('Duplicate Jira Source ID on different issues.');
        }
        if (byId.has(id) && byId.get(id).sourceId !== sourceId) throw new Error('Contradictory Jira Source ID for an immutable issue.');
        if (byKey.has(key) && byKey.get(key).id !== id) throw new Error('Ambiguous Jira issue key identity.');
        const identity = { id, sourceId };
        byId.set(id, identity);
        byKey.set(key, identity);
        if (sourceId) sourceOwners.set(sourceId, id);
        return identity;
    }
    for (const issue of issues) remember(issue.id, issue.key, issue.source_id);
    const dependencyTypes = new Set(config.dependency_link_types.map(type => type.toLowerCase()));
    for (let index = 0; index < issues.length; index++) {
        const links = rawIssues[index].fields.issuelinks ?? [];
        if (!Array.isArray(links)) throw new Error('Invalid Jira dependency links.');
        for (const link of links) {
            if (typeof link?.type?.name !== 'string') throw new Error('Invalid Jira dependency link type.');
            if (!dependencyTypes.has(link.type.name.trim().toLowerCase()) || !link.inwardIssue) continue;
            if (link.outwardIssue) throw new Error('Ambiguous Jira blocking link direction.');
            const target = link.inwardIssue;
            if (!object(target)) throw new Error('Invalid Jira blocking issue identity.');
            const targetId = target.id === undefined ? null : identifier(target.id);
            const targetKey = target.key === undefined ? null : issueKey(target.key);
            if (!targetId && !targetKey) throw new Error('Missing Jira blocking issue identity.');
            if (targetId && targetKey && byKey.has(targetKey) && byKey.get(targetKey).id !== targetId) {
                throw new Error('Contradictory Jira blocking issue identity.');
            }
            let resolved = targetId ? byId.get(targetId) : byKey.get(targetKey);
            if (!resolved) {
                const linked = await client.request(`/rest/api/3/issue/${targetId || targetKey}`, {
                    query: { fields: `${sourceField},description` }
                });
                if (!object(linked?.fields)) throw new Error('Invalid Jira blocking issue content.');
                const id = identifier(linked.id);
                if (targetId && id !== targetId) throw new Error('Contradictory Jira blocking issue identity.');
                const sourceId = sourceIdentity(linked.fields, sourceField, planningMetadata(adfText(linked.fields.description)));
                resolved = remember(id, issueKey(linked.key), sourceId);
                if (targetKey) byKey.set(targetKey, resolved);
            }
            if (!resolved.sourceId) throw new Error('A blocking Jira issue has no Source ID; reconcile it before importing.');
            if (resolved.id === issues[index].id) throw new Error('Jira blocking prerequisite contains a self-dependency.');
            if (!issues[index].blocked_by.includes(resolved.sourceId)) issues[index].blocked_by.push(resolved.sourceId);
        }
    }
    return issues;
}

async function readIssue(jira, idOrKey, options = {}) {
    if (!object(options)) throw new Error('Invalid Jira read options.');
    const { fetchImpl = globalThis.fetch, env = process.env } = options;
    const numeric = typeof idOrKey === 'number' || (typeof idOrKey === 'string' && /^\d+$/.test(idOrKey));
    const reference = numeric ? identifier(idOrKey) : issueKey(idOrKey);
    const client = clientFor(jira, fetchImpl, env);
    const sourceField = client.config.source_id_field || await discoverSourceField(client);
    const raw = await client.request(`/rest/api/3/issue/${reference}`, { query: { fields: issueFields(client.config, sourceField) } });
    if (numeric && identifier(raw?.id) !== reference) throw new Error('Contradictory Jira immutable issue identity.');
    return (await normalizeIssues(client, [raw], sourceField))[0];
}

async function readSprint(jira, options = {}) {
    if (!object(options)) throw new Error('Invalid Jira read options.');
    const { fetchImpl = globalThis.fetch, env = process.env, sprintId, allowFuture = false } = options;
    if (typeof allowFuture !== 'boolean' || (sprintId !== undefined && (!Number.isSafeInteger(sprintId) || sprintId <= 0))) {
        throw new Error('Invalid Jira sprint selection or allowFuture approval.');
    }
    const client = clientFor(jira, fetchImpl, env);
    const { config } = client;
    const sprints = (await offsetPages(client, `/rest/agile/1.0/board/${config.board_id}/sprint`, 'values', {
        state: sprintId === undefined ? 'active' : 'active,future,closed'
    })).map(normalizeSprint);
    const selected = sprints.filter(sprint => sprintId === undefined ? sprint.state === 'active' : sprint.id === sprintId);
    if (selected.length !== 1) {
        throw new Error(sprintId === undefined ? 'Choose exactly one active sprint or provide sprintId.'
            : 'The selected sprint is not on the configured board.');
    }
    const sprint = selected[0];
    if (sprint.state === 'future' && !allowFuture) throw new Error('A future sprint requires explicit allowFuture approval.');
    const sourceField = config.source_id_field || await discoverSourceField(client);
    const issues = await normalizeIssues(client, await sprintIssues(client, sprint.id, sourceField), sourceField);
    // Workflow timestamps and renamed keys are not requirement changes; immutable IDs are.
    const requirements = issues.map(({ key, url, status, updated, ...content }) => content)
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const snapshot = { version: 1, site: config.url, board_id: config.board_id, sprint, issues };
    return {
        ...snapshot,
        digest: crypto.createHash('sha256').update(JSON.stringify({ ...snapshot, issues: requirements })).digest('hex')
    };
}

function validateEvidence(evidence) {
    if (!object(evidence) || !boundedText(evidence.marker, 200) || !boundedText(evidence.summary, 2000, true)) {
        throw new Error('Evidence requires a bounded, nonempty marker and summary.');
    }
    if (typeof evidence.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(evidence.sha)) {
        throw new Error('Evidence requires a full 40-character commit SHA.');
    }
    if (typeof evidence.repository !== 'string'
        || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(evidence.repository)
        || ['.', '..'].includes(evidence.repository.split('/')[1])) {
        throw new Error('Evidence repository must be OWNER/REPO.');
    }
    let url;
    try {
        if (!boundedText(evidence.url, 2048) || /[\\\s?#]/.test(evidence.url)) throw new Error();
        url = new URL(evidence.url);
        const parts = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|commit)\/([^/]+)\/?$/);
        if (url.protocol !== 'https:' || url.host !== 'github.com' || url.username || url.password || !parts
            || `${parts[1]}/${parts[2]}`.toLowerCase() !== evidence.repository.toLowerCase()
            || (parts[3] === 'pull' ? !/^[1-9]\d*$/.test(parts[4]) : parts[4].toLowerCase() !== evidence.sha.toLowerCase())) {
            throw new Error();
        }
    } catch {
        throw new Error('Evidence URL must be a matching HTTPS GitHub repository PR or commit URL.');
    }
    return {
        marker: evidence.marker.trim(), summary: evidence.summary.replace(/\r\n?/g, '\n').trim(),
        repository: evidence.repository, sha: evidence.sha.toLowerCase(), url: url.href
    };
}

async function syncEvidence(jira, issue, evidence, options = {}) {
    if (!object(options) || options.approve !== true) throw new Error('Explicit approval is required to sync Jira evidence.');
    const { fetchImpl = globalThis.fetch, env = process.env, transitionId = null, targetStatusId = null } = options;
    const proof = validateEvidence(evidence);
    if (!object(issue) || (issue.id === undefined && issue.key === undefined)) throw new Error('A Jira issue identity is required.');
    const requestedId = issue.id === undefined ? null : identifier(issue.id);
    const requestedKey = issue.key === undefined ? null : issueKey(issue.key);
    const transition = transitionId === null ? null : identifier(transitionId);
    const target = targetStatusId === null ? null : identifier(targetStatusId);
    if (transition !== null && target === null) {
        throw new Error('A Jira transition requires an explicit target status ID.');
    }
    const client = clientFor(jira, fetchImpl, env);
    const resolved = await client.request(`/rest/api/3/issue/${requestedId || requestedKey}`, { query: { fields: 'status' } });
    const id = identifier(resolved?.id);
    issueKey(resolved?.key);
    if (requestedId && id !== requestedId) throw new Error('Contradictory Jira immutable issue identity.');
    let shouldTransition = false;
    if (transition !== null && identifier(resolved.fields?.status?.id) !== target) {
        const available = await client.request(`/rest/api/3/issue/${id}/transitions`);
        if (!Array.isArray(available?.transitions) || available.transitions.length > 1000) {
            throw new Error('Invalid Jira available transitions.');
        }
        const seen = new Set();
        for (const candidate of available.transitions) {
            const candidateId = identifier(candidate?.id);
            if (seen.has(candidateId)) throw new Error('Ambiguous Jira transition IDs.');
            seen.add(candidateId);
        }
        const selected = available.transitions.find(candidate => String(candidate.id) === transition);
        if (!selected) throw new Error('The requested Jira transition is not available.');
        const destination = identifier(selected.to?.id);
        if (destination !== target) throw new Error('The Jira transition destination does not match the approved target status.');
        shouldTransition = true;
    }
    const comments = await offsetPages(client, `/rest/api/3/issue/${id}/comment`, 'comments');
    const matches = comments.filter(comment => adfText(comment.body).includes(proof.marker));
    if (matches.length > 1) throw new Error('Ambiguous Jira evidence marker in multiple comments.');
    let commentId = matches.length ? identifier(matches[0].id) : null;
    if (!commentId) {
        const paragraph = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
        const body = { version: 1, type: 'doc', content: [
            paragraph(proof.marker), ...proof.summary.split('\n').map(paragraph),
            paragraph(`Repository: ${proof.repository}`), paragraph(`Commit: ${proof.sha}`),
            { type: 'paragraph', content: [{ type: 'text', text: proof.url, marks: [{ type: 'link', attrs: { href: proof.url } }] }] }
        ] };
        const created = await client.request(`/rest/api/3/issue/${id}/comment`, { method: 'POST', body: { body } });
        commentId = identifier(created?.id);
    }
    if (shouldTransition) {
        await client.request(`/rest/api/3/issue/${id}/transitions`, {
            method: 'POST', body: { transition: { id: transition } }, json: false
        });
    }
    return {
        comment_id: commentId, comment_created: matches.length === 0, transitioned: shouldTransition,
        ...(target === null ? {} : { target_status_id: target })
    };
}

module.exports = { validateJiraConfig, readSprint, readIssue, syncEvidence, adfText };
