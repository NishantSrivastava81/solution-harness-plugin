---
title: Manual Jira hybrid execution
description: Plan Jira Cloud sprint stories, dispatch cloud and local developers, review exact candidates locally, and integrate accepted delivery.
---

## Scope

Version 1.3 adds manually triggered Jira Cloud planning and mixed cloud/local
story execution. There is no sprint watcher, webhook listener, automatic sprint
start, or always-on service.

Invoke `/jira-plan` for a read-only preview and `/hybrid-loop` for an explicitly
approved run. The local orchestrator coordinates a bounded sequence of runtime
commands. Starting a sprint in Jira alone does not launch anything.

This mode reuses the existing cloud coordinator's ledger and integration
controls, with one authority for both builder types. Standalone `/loop`,
`/parallel-loop`, `/cloud-parallel`, and hosted cloud-loop remain separate.
Concurrent execution modes are rejected, including simultaneous starts.

The local plugin runs this coordinator directly. The
[cloud installer](../scripts/install-cloud.cjs) is not a prerequisite for a fresh
GH CLI-driven target; it remains available for standalone hosted cloud-loop
users. Existing installed cloud hooks still require explicit migration before
story dispatch.

Version 1.5 migrates the plugin package to Agent Plugins 1.0 and the shared
Copilot hook/agent contract. Select Copilot as the VS Code Session Target or use
Copilot CLI. The workflow remains manually triggered, with the same story
allowlist, independent review, and serial integration. Pause existing runs and
verify the migrated hook decisions before resuming; never activate duplicate
legacy hooks.

## Requirements

* The updated full local Solution Harness plugin
* Node.js 22.20+ or 24+ on the PATH used by terminals, hooks, and CLI workers
* Git, GitHub CLI 2.80+ with task status JSON and guarded PR merge support
* An eligible Copilot account, repository access, and provider authorization
* A clean named coordinator branch at the current approved GitHub base
* An onboarded target with its full feature catalog, backlog, plan, architecture,
  progress, designs, and meaningful verification commands
* Reviewed instruction exceptions for assigned developers and independent
  evaluators, with coordinator-only shared publication
* Repository protections or a merge queue preventing stale-base integration

Worktrees, hooks, agent labels, and remembered permissions are not security
sandboxes. Use trusted code and appropriately isolated test resources. Never
give workers production credentials or interpret a passing unit test as
permission to operate a live pilot.

The implementation is tested with mocked Jira/GitHub and local fixture processes.
That does not establish the user's hosted-agent entitlement, actual CLI tool
isolation, or live Jira workflow permissions. Validate those in a bounded pilot.

## Configure outside the target checkout

Copy and review the [template](config.json). Keep secrets out of it. Select the
actual Jira site, board, repository, base, tests, and ownership.

```json
{
  "version": 1,
  "execution_mode": "hybrid-stories",
  "repository": "OWNER/REPO",
  "base_branch": "main",
  "jira": {
    "url": "https://YOUR-SITE.atlassian.net",
    "board_id": 2,
    "source_id_field": "customfield_12345",
    "auth": "basic",
    "token_env": "JIRA_API_TOKEN",
    "email_env": "JIRA_EMAIL"
  },
  "feature_ids": ["F001"],
  "story_ids": ["F001-S01", "F001-S02"],
  "routes": { "F001-S01": "cloud", "F001-S02": "local" },
  "approved_designs": ["F001"],
  "approved_verification": [],
  "instructions_reviewed": true,
  "workspace_isolation_confirmed": true,
  "cloud_context_approved": true,
  "branch_protection_confirmed": true,
  "eligible_statuses": ["To Do"],
  "allow_future": false,
  "max_workers": 3,
  "max_minutes": 120,
  "max_attempts": 2,
  "lease_minutes": 30,
  "require_ci": true,
  "merge_method": "squash",
  "ownership": {
    "F001-S01": { "allowed_paths": ["src/alpha/**", "tests/alpha/**"], "resources": [] },
    "F001-S02": { "allowed_paths": ["src/beta/**", "tests/beta/**"], "resources": [] }
  },
  "verification": [
    {
      "name": "Actual project tests",
      "kind": "test",
      "command": "node",
      "args": ["--test"],
      "timeout_seconds": 300
    }
  ],
  "local": {
    "mode": "manual-workspace",
    "command": "copilot",
    "args": ["--prompt", "{prompt}"],
    "timeout_seconds": 1200,
    "permissions_reviewed": false
  },
  "jira_writeback": {
    "enabled": false,
    "transition_id": null,
    "target_status_id": null
  }
}
```

All confirmations are operator attestations, not automatic policy audits.
Configure real commands and scopes rather than copying the example blindly.
The three-worker ceiling is the harness's global policy, not a GitHub quota.

Jira authentication is separately authorized. Provision the named variables
through an approved credential/environment mechanism; do not paste their values
into chat or put them in arguments, receipts, configuration, or source.
`bearer` authentication is available when the configured site endpoint and
token are authorized for it. Cross-origin redirects are refused.

If `source_id_field` is omitted, discovery requires one unambiguous Source ID
field. An optional `acceptance_criteria_field` selects a custom field; otherwise
the reader uses the description's Acceptance criteria section. Structured
planning metadata preserves criterion coverage and direct prerequisites.
Inward blocking links are resolved to their linked Source IDs; unrelated
relationships are not treated as dependencies.

This adapter uses current Jira Cloud Software cursor pagination and does not
support Data Center or legacy Cloud search pagination.

## Preview and approve

Resolve the runtime from the installed plugin, not from the target repository:

```powershell
$runtime = '<absolute plugin path>\hybrid\runtime.cjs'
$config = '<absolute configuration path>'
node $runtime plan --config $config
```

An empty `story_ids` list is permitted for preview, which shows all observed
items and unmapped issues. Execution requires an explicit nonempty allowlist.
The complete repository backlog is never replaced with a sprint-only catalog.

No or multiple active sprints require explicit operator action. Use `--sprint`
for an explicit choice. A planned sprint requires `allow_future: true`; the
runtime never starts it. Store `sprint_id` in configuration or pass the same
choice to preview and begin.

Changed Jira criteria/dependencies must be reconciled by the planner with
existing repository requirements. A source snapshot's historical prerequisite
status is not completion evidence. Retain all feature and architecture gates.

After reviewing the scope, routes, resource policy, and readiness:

```powershell
node $runtime begin --config $config --snapshot '<preview snapshot_digest>' --approve
node $runtime dispatch --approve
node $runtime refresh
node $runtime status
```

The digest must still match. Jira drift pauses progress rather than changing
active contracts. Raw comments and attachments are not automatically forwarded
to workers. Cloud prompts contain the approved repository criteria and minimal
Jira provenance.

Developer briefs also include the bundled
[frontend-design guidance](../skills/frontend-design/SKILL.md), applied only to
UI work. Hybrid CLI evaluators receive the same guidance in read-only evaluator
mode. This needs no cloud installer or external skill download and does not
expand ownership, criteria, or design approvals.

Requirement hashing excludes renamed issue keys and workflow timestamps, but
each execution mutation still checks the configured eligible workflow statuses.
Choose permitted in-progress/review statuses explicitly if other integrations
update them during a run; no status is treated as completion evidence.

## Local developers

Manual mode returns separate assigned worktrees. Open each in a verified
workspace. Inside a developer checkout:

```powershell
node $runtime context
node $runtime worker-report
```

Use `worker-block --reason environment`, `tests-failing`, `out-of-scope`, or
`design-question` when blocked. Reports replace the sequential shared
progress/commit obligation. Developers never commit, push, merge, or deploy.

For attached CLI execution, choose `local.mode: "copilot-cli"`, configure the
actual executable and its operator-reviewed scoped arguments, and set
`permissions_reviewed: true` only after validating them. Exactly one `{prompt}`
placeholder is required. Do not use broad all-tools/all-paths/yolo permission
flags. Use a real executable or Node plus the CLI entrypoint, not an unsupported
Windows shell shim.

Each process runs in its own worktree, has a bounded timeout and PID receipt,
and excludes the configured Jira credentials from its environment. Missing CLI
tools, permission failures, timeouts, nonzero exits, and missing reports are
explicit failures; there is no silent manual fallback.

The child inherits the supported Node runtime and plugin root, not a different
Node version earlier on PATH. Its absolute deadline is capped by the original
run budget and, for builders, the worker lease.

The dispatch command remains attached while local builders run and cloud
builders can work concurrently. Stopping the coordinator can stop attached
children, but cannot be assumed to cancel cloud tasks. Restart by reconciling
receipts and reports rather than redispatching.

The coordinator captures and publishes accepted local implementations:

```powershell
node $runtime capture --story F001-S02 --approve
node $runtime publish-local --story F001-S02 --approve
```

Publication uses the approved origin without force pushing and creates a PR.
An uncertain push/PR creation must be reconciled with `attach-pr`, not blindly
retried. Source capture and PR creation are not delivery acceptance.

## Independent review and integration

Create a separate detached review worktree at the exact ready PR head using the
repository's approved Git/GitHub workflow. A terminal `cwd` does not isolate
VS Code editing tools.

```powershell
node $runtime prepare-review --story F001-S01 --workspace '<review root>' --agent checker-1 --approve
```

Open that workspace in a fresh evaluator session, or run `launch-review --approve`
with the approved CLI configuration. Evaluators write only their private report:

```json
{
  "run_id": "<run ID>",
  "feature_id": "F001",
  "story_id": "F001-S01",
  "candidate_sha": "<exact head SHA>",
  "evaluator_id": "checker-1",
  "assignment_nonce": "<nonce returned by context>",
  "verdict": "PASS",
  "criteria": [
    { "criterion": "<exact criterion>", "passed": true, "evidence": "<actual observed evidence>" }
  ],
  "issues": []
}
```

Submit through `review-report` from the coordinator. Passing code uses
`merge --approve`; required CI and repository approvals still apply. A local
AI report is not automatically an approving GitHub review.

When the base changes, `update-pr --story <id> --approve` requests a guarded
provider-side update. Obtain fresh tests and review. Use `reconcile-update`
after an ambiguous update, never a cached passing verdict.

Verification-only routes require empty source ownership and an explicit
`approved_verification` entry. They use a current-base independent review and
`accept-evidence --approve` instead of a fake PR/commit. Environment criteria
remain blockers until actually observed in an authorized environment.

## Finish a sprint subset

After all selected stories are accepted, review fully delivered parent features
with `prepare-final --feature <id>` and `accept-final --approve`. Unselected
unfinished siblings prevent parent completion.

Obtain independent `prepare-delivery` review on the current merged base. Its
criteria are prefixed with story IDs to retain exact traceability across
features; `feature_id` and `story_id` are null for this selected-story review.
Submit the report and run `accept-evidence`.

Fast-forward the clean coordinator under the normal approved Git workflow, then
run `finish --approve`. The runtime publishes story evidence and an appended
progress record locally. Partial features stay in progress; complete requires
full-feature review on that same base. It does not commit or push those metadata
updates. Follow the repository's normal approval and publication process.

Interrupted publication uses `recover-publish --approve`, accepting only the
recorded before/after content and refusing unrelated edits.

## Optional Jira evidence

`/jira-sync` is separate and disabled by default. Enable it only with write
approval. Comments use stable run/story/commit markers, immutable issue IDs,
and PR/commit links. Requirements are rechecked before writes.

An optional transition requires both its configured ID and destination status.
Already reaching that destination is idempotent. No sprint is started, closed,
reordered, or populated.

Failed/ambiguous Jira publication has its own state. Retry reconciliation does
not rebuild completed code. Concurrent evidence publishers are refused.

## Recovery and validation

Use `pause --approve` before handoff and `resume --approve` within the original
budget. Abandon only reconciled tasks/closed unmerged PRs and stopped local
processes. Cancellation preserves worktrees and does not claim remote tasks
were stopped.

`recover-lock`, `recover-start`, and `recover-sync` remove only recorded stale
locks after their specific owner process stopped. Never edit private receipts,
steal live locks, reset budgets, or force history.

Run the new dependency-free tests:

```powershell
node --test tests\jira.test.cjs tests\hybrid-local.test.cjs tests\hybrid.test.cjs
```
