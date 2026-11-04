import assert from 'assert';
import { spawnSync } from 'child_process';
import { frontmatter, read, run } from './helpers/contracts.mjs';

function skill(name) {
    return frontmatter(read('skills', name, 'SKILL.md')).body;
}

function includesAll(text, expressions, label) {
    const normalized = text.replace(/\s+/g, ' ');
    for (const expression of expressions) {
        assert.ok(expression.test(normalized), `${label}: missing ${expression}`);
    }
}

run([
    ['planning requires traceability, approvals, and conservative conflict checks', () => {
        includesAll(skill('plan-execution'), [
            /criteria/i, /dependencies/i, /ownership/i, /shared resources/i,
            /approval/i, /serialize/i, /not a lock/i
        ], 'plan-execution');
    }],
    ['guided local work uses separate workspaces and exact-candidate review', () => {
        includesAll(skill('parallel-loop'), [
            /git worktree add/, /editing root/i, /baseline tests/i,
            /independent/i, /candidate SHA|exact-SHA/i, /integrate one/i,
            /fresh checks and review/i, /no bundled scheduler/i
        ], 'parallel-loop');
    }],
    ['cloud workflow uses supported task, check, and guarded merge commands', () => {
        const text = skill('cloud-parallel');
        includesAll(text, [
            /gh agent-task create --repo OWNER\/REPO --base main --from-file/,
            /gh agent-task list --json/,
            /gh agent-task view/,
            /gh pr view .*headRefOid,baseRefOid/,
            /gh pr checks/,
            /gh pr checkout/,
            /gh pr merge .*--match-head-commit/,
            /independent/i, /explicit merge approval/i,
            /guards the PR head, not an advancing base/i,
            /branch protection or a merge queue/i,
            /ambiguous/i, /before any retry/i
        ], 'cloud-parallel');
        const blocks = text.match(/```powershell\n[\s\S]*?```/g) || [];
        assert.ok(blocks.length >= 3);
        for (const block of blocks) {
            assert.ok(!/--admin|--force|git reset|git clean/.test(block), 'unsafe command in example');
        }
    }],
    ['Jira planning and write-back require separate access and approval', () => {
        includesAll(skill('jira-plan'), [
            /Jira MCP server or client/i, /gh.*not Jira/i, /pagination/i,
            /approval/i, /re-read/i, /no automatic snapshot/i
        ], 'jira-plan');
        includesAll(skill('jira-sync'), [
            /separately approved/i, /each comment and each transition/i,
            /search existing comments/i, /ambiguous/i, /exactly-once/i,
            /Never start, close, reorder/i
        ], 'jira-sync');
        includesAll(skill('hybrid-loop'), [
            /one coordinator/i, /no sprint watcher/i, /independent evaluator/i,
            /serially/i, /full-feature completion/i, /separate authorization/i
        ], 'hybrid-loop');
    }],
    ['cloud loop cannot self-certify when an independent evaluator is absent', () => {
        includesAll(skill('cloud-loop'), [
            /one approved feature/i, /baseline/i, /separate evaluator/i,
            /independent local evaluator/i, /Do not mark the feature complete/i,
            /orchestrator delegates to a builder/i, /stops rather than implementing/i,
            /does not automatically/i
        ], 'cloud-loop');
    }],
    ['review report example has the complete required output shape', () => {
        const guide = read('parallel', 'README.md');
        const blocks = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)];
        const examples = blocks.map(match => JSON.parse(match[1]));
        const report = examples.find(example => example.run_id);
        assert.ok(report, 'Missing structured verdict example');
        for (const key of ['run_id', 'feature_id', 'story_id', 'source_id', 'candidate_sha', 'base_sha', 'evaluator', 'verdict', 'criteria', 'checks', 'issues']) {
            assert.ok(Object.prototype.hasOwnProperty.call(report, key), `Missing report field: ${key}`);
        }
        assert.strictEqual(report.verdict, 'PASS');
        assert.ok(report.criteria.length > 0);
        for (const criterion of report.criteria) {
            assert.ok(criterion.criterion && criterion.evidence);
            assert.ok(['PASS', 'FAIL'].includes(criterion.result));
        }
        assert.ok(report.checks.length > 0);
        for (const check of report.checks) {
            assert.ok(check.command && check.result);
            assert.strictEqual(typeof check.exit_code, 'number');
        }
        includesAll(guide, [/PASS requires evidence for every criterion/i, /Missing access or unverified criteria/i], 'report');
    }],
    ['agent assignment protocols retain maker-checker separation', () => {
        const builder = read('com.github.copilot', 'agents', 'builder.agent.md');
        const evaluator = read('com.github.copilot', 'agents', 'evaluator.agent.md');
        const orchestrator = read('com.github.copilot', 'agents', 'orchestrator.agent.md');
        includesAll(builder, [/explicitly assigns an approved story/i, /do not merge/i, /not independent evaluation/i], 'builder');
        includesAll(evaluator, [/independent of the builder/i, /exact commit/i, /Do not edit source/i], 'evaluator');
        includesAll(orchestrator, [/fresh independent evaluator/i, /not automatic locks/i, /never duplicate an ambiguous task/i], 'orchestrator');
    }],
    ['evaluation skill follows the guided candidate reporting protocol', () => {
        const text = skill('evaluate');
        includesAll(text, [/assigned local, cloud, or Jira candidate/i, /exact candidate SHA/i, /base SHA/i, /structured verdict/i, /all parent criteria/i], 'evaluate');
        assert.ok(!/`(?:context|review-report)`/.test(text), 'evaluate references removed runtime commands');
    }],
    ['existing skills cover applicable SaaS design and boundaries', () => {
        includesAll(skill('design-feature'), [
            /SaaS and multi-tenant impact/i, /When applicable/i,
            /verified identity and authorization/i, /isolation/i,
            /customer data/i, /telemetry/i, /billable work/i,
            /tenant-attributed usage/i, /diagnostic logs.*not a billing ledger/i,
            /safe retries/i, /without approval/i
        ], 'design-feature');
        includesAll(skill('architecture-check'), [
            /when applicable/i, /tenant isolation and authorization/i,
            /telemetry privacy/i, /usage or entitlement/i, /evidence and gaps/i,
            /not.*compliance certification/i
        ], 'architecture-check');
    }],
    ['SaaS tests and evaluation require evidence where relevant', () => {
        includesAll(skill('testing'), [
            /when applicable/i, /two tenant identities/i, /denied cross-tenant/i,
            /telemetry privacy/i, /billable work/i, /duplicate or retried events/i,
            /not production data/i, /NOT VERIFIED/i
        ], 'testing');
        includesAll(skill('evaluate'), [
            /confirmed cross-tenant/i, /authorization/i, /regardless of score/i,
            /unverified required control.*FAIL/i, /evidence and gaps/i,
            /not.*compliance certification/i,
            /assigned candidates.*criteria\[\]\.result.*PASS or FAIL/i,
            /missing evidence rather than inventing results/i
        ], 'evaluate');
    }],
    ['pre-commit reports missing evidence and respects assignment boundaries', () => {
        includesAll(skill('pre-commit'), [
            /no test runner.*NOT RUN/i, /required.*missing evidence/i,
            /cannot.*Ready to commit/i, /security.*isolation.*billing/i,
            /do not guarantee/i, /assigned work.*shared-state checks N\/A/i,
            /does not authorize a commit/i
        ], 'pre-commit');
    }],
    ['B2B UI guidance remains scoped and does not replace server authorization', () => {
        includesAll(skill('frontend-design'), [
            /in-scope onboarding.*workspace roles/i, /plan or usage/i,
            /UI restrictions do not replace server-side authorization/i
        ], 'frontend-design');
    }],
    ['frontend guidance keeps role boundaries and measurable accessibility checks', () => {
        includesAll(skill('frontend-design'), [
            /Non-UI tasks do not acquire UI work/i, /keyboard operation/i,
            /WCAG 2\.2 AA/, /4\.5:1/, /3:1/, /24 by 24/,
            /text resizing at 200%/i, /reflow at 320 CSS pixels/i,
            /320, 768, and 1440 CSS-pixel widths/,
            /evaluators do not implement fixes/i, /missing evidence.*cannot receive PASS/i
        ], 'frontend-design');
        for (const [file, text] of [
            ['builder', read('com.github.copilot', 'agents', 'builder.agent.md')],
            ['evaluator', read('com.github.copilot', 'agents', 'evaluator.agent.md')],
            ['design-feature', read('skills', 'design-feature', 'SKILL.md')]
        ]) assert.ok(text.includes('/frontend-design'), `${file} must load frontend guidance`);
        includesAll(skill('cloud-parallel'), [/UI stories/i, /frontend-design/i], 'cloud UI brief');
    }],
    ['installed gh supports the documented noninteractive command flags', () => {
        const commands = [
            { args: ['agent-task', 'create', '--help'], flags: ['--repo', '--base', '--from-file'] },
            {
                args: ['agent-task', 'list', '--help'], flags: ['--json'],
                fields: ['id', 'name', 'repository', 'state', 'pullRequestNumber', 'pullRequestUrl']
            },
            { args: ['agent-task', 'view', '--help'], flags: ['--repo'] },
            {
                args: ['pr', 'view', '--help'], flags: ['--repo', '--json'],
                fields: ['url', 'headRefOid', 'baseRefOid', 'baseRefName', 'isDraft', 'mergeStateStatus']
            },
            { args: ['pr', 'checks', '--help'], flags: ['--repo'] },
            { args: ['pr', 'checkout', '--help'], flags: ['--repo', '--detach'] },
            { args: ['pr', 'merge', '--help'], flags: ['--repo', '--squash', '--match-head-commit'] }
        ];
        for (const command of commands) {
            const result = spawnSync('gh', command.args, { encoding: 'utf8', windowsHide: true });
            if (result.error && result.error.code === 'ENOENT') {
                console.log('# SKIP gh capability check: GitHub CLI is not installed');
                return;
            }
            if (result.error) throw result.error;
            assert.strictEqual(result.status, 0, result.stderr);
            for (const flag of command.flags) {
                assert.ok(result.stdout.includes(flag), `gh ${command.args.join(' ')} lacks ${flag}`);
            }
            if (command.fields) {
                const fieldList = result.stdout.split('JSON FIELDS')[1];
                assert.ok(fieldList, `gh ${command.args.join(' ')} did not list JSON fields`);
                for (const field of command.fields) {
                    assert.ok(new RegExp(`\\b${field}\\b`).test(fieldList), `gh ${command.args.join(' ')} lacks field ${field}`);
                }
            }
        }
    }]
]);
