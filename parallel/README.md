---
title: Local parallel story execution
description: Install, plan, run, review, and recover isolated story worktrees within one approved feature.
---

## Scope and defaults

The local coordinator supports parallel stories within **one active feature**.
Sequential `/loop` remains the default. Hosted `cloud-loop` remains single-feature
and does not install the local-only skills.

This release provides dependency-aware planning and local execution controls.
It does not automatically launch VS Code subagents into different editing roots.
Open each returned worktree in a separate workspace/window and verify its editing
tools target that worktree. A different terminal `cwd` is not sufficient.

Up to three builder assignments can be outstanding, with one integration/review
candidate at a time. Use a separate evaluator session. Session labels enforce
distinct recorded identities; the operator must attest that they represent
independent sessions. This is not cryptographic agent authentication.

> [!WARNING]
> Worktrees, prompts, and hooks are not a security sandbox. Processes share the
> machine, environment, Git object store, and potentially credentials. Use trusted
> projects and workers. Do not copy secrets, databases, deployment state, or `.env`
> files into worktrees. Never run this workflow against a live environment.

## Install and migrate

Requirements:

* The updated local Solution Harness plugin, version 1.1.0 or later
* Node.js 22.20+ or 24+ on the PATH used by VS Code hooks and terminals
* Git and a named, clean coordinator branch
* A feature catalog, story backlog, existing progress log, and real tests

From the plugin checkout:

```powershell
node scripts\install-parallel.cjs --dry-run 'C:\work\project'
node scripts\install-parallel.cjs 'C:\work\project'
```

The installer adds the runtime, schema, and this guide under
`.github/harness/parallel`, plus `.github/harness/parallel-config.json`.
It preserves an existing config and does not rewrite project instructions,
agents, hooks, or backlog definitions. Conflicting non-seed files stop the
installation before any writes. Installation is additive, not an automatic
upgrade/merge tool; review and reconcile existing runtime differences explicitly.

Before enabling execution, review `AGENTS.md`,
`.github/copilot-instructions.md`, and any relevant path instructions. Retain
their normal sequential rules, but add this narrow exception:

```text
For a valid local parallel runtime assignment only:
- A builder implements only its assigned story in its assigned worktree.
- Builders do not commit, merge, deploy, choose another feature, or edit shared
  feature/backlog/status/progress/configuration/instruction files.
- Evaluators review only the assigned exact candidate and write only their
  private review report. They do not update shared evaluation/status files.
- The coordinator alone captures commits, integrates accepted stories, and
  publishes feature status and progress after independent full-feature review.
- Assignment reports replace the usual worker end-of-session commit/progress
  requirement. Ordinary sessions retain the sequential protocol.
```

Also reconcile any organization-level instructions that conflict with this
exception. Installing files cannot override higher-priority instructions.
Set `instructions_migration_confirmed` only after that review. Reload the updated
plugin; installing the runtime alone does not activate its hook routing.

The version 1.5 plugin uses the shared Copilot runtime and versioned namespaced
hooks. Its adapter preserves the local runtime's internal assignment guards but
returns current top-level Copilot decisions. Pause existing runs before updating
the plugin/runtime, and do not run old and migrated hook copies together.

Commit the installed runtime, reviewed instruction changes, backlog, and approved
config before starting. The coordinator never stashes or discards existing work.

## Story model and planning

The feature catalog remains authoritative. Its IDs use `F`, `R`, `E`, or `B`
followed by three digits. Priorities are numeric; lower numbers run first.

The existing nested `epics -> features -> stories` backlog is supported without
rewriting it. New backlogs can declare `version: 1` with either nested epics or
flat `stories`. See [backlog.schema.json](backlog.schema.json). A flat example:

```json
{
  "version": 1,
  "stories": [
    {
      "id": "F001-S01",
      "feature_id": "F001",
      "title": "Deliver alpha behavior",
      "status": "todo",
      "acceptance_criteria": ["Alpha works"],
      "covers_feature_criteria": [1],
      "depends_on": []
    },
    {
      "id": "F001-S02",
      "feature_id": "F001",
      "title": "Deliver beta behavior",
      "status": "todo",
      "acceptance_criteria": ["Beta works"],
      "covers_feature_criteria": [2],
      "depends_on": []
    }
  ]
}
```

Store this in the project's `docs/backlog/backlog.json`. Story IDs have two or
three suffix digits. Criterion references are one-based indexes into the parent
feature's acceptance criteria. Each parent criterion needs coverage, except the
generic existing-tests regression criterion. Done stories need nonempty evidence.
Execution state is separate from the source backlog; a claim is not delivery.

Feature prerequisites, story prerequisites, and catalog
`architecture_delivery_gates` all participate in cycle and readiness checks.
A feature dependency is satisfied only by `complete` or `existing`, not by
some of its stories being done. Blocked/cancelled parents do not dispatch.
Within a feature, a dependent story waits for integration, not merely a worker
commit or report.

Use `/plan-execution`, or run from the project root:

```powershell
node .github\harness\parallel\runtime.cjs plan --feature F001
```

Omitting `--feature` lists incomplete features in priority order. Output includes
hypothetical within-feature batches, unmet dependencies, missing ownership,
feature state, design approval, and execution blockers. It never creates branches,
changes statuses, or launches workers. Schedules are derived output, not queues.

## Configuration and approval

The installed config defaults to `sequential`. An approved two-story example:

```json
{
  "version": 1,
  "mode": "parallel-stories",
  "launch_mode": "manual-workspace",
  "workspace_isolation_confirmed": true,
  "instructions_migration_confirmed": true,
  "feature_ids": ["F001"],
  "approved_designs": ["F001"],
  "max_workers": 3,
  "max_minutes": 60,
  "max_attempts": 2,
  "max_commits": 30,
  "lease_minutes": 30,
  "verification": [
    {
      "name": "Project regression tests",
      "kind": "test",
      "command": "node",
      "args": ["--test"],
      "timeout_seconds": 300
    }
  ],
  "ownership": {
    "F001-S01": {
      "allowed_paths": ["src/alpha/**", "tests/alpha/**"],
      "resources": ["alpha-test-database"]
    },
    "F001-S02": {
      "allowed_paths": ["src/beta/**", "tests/beta/**"],
      "resources": ["beta-test-database"]
    }
  }
}
```

Replace the example test command and ownership with the project's actual
commands and paths. Commands run without a shell; invoke an executable rather
than a shell alias or platform-specific package-manager shim. At least one real
`test` is required; add lint/build checks where the project requires them.
Checks run at baseline, worker capture, combined integration, and final delivery.
If fresh worktrees need dependencies, configure an idempotent `kind: "setup"`
command before the test entries. It runs in each checkout without copying the
coordinator's local dependencies. Keep generated dependencies ignored; setup may
not modify tracked source or lockfiles. Prefer the project's existing locked
restore/verification script and provision independent test resources explicitly.
Configure tests that include relevant regressions, not unconditional exit-zero
commands. Output is bounded and not persisted; failures name the check and exit
status so you can rerun it in the recorded worktree.

Ownership globs use Node's POSIX glob matching, with `/` separators. Overlap is
conservatively detected from static prefixes, so broad/glob-heavy contracts may
serialize work unnecessarily. Shared files and resources must be assigned to
one story at a time. Worktrees do not isolate ports, cloud accounts, databases,
test fixtures outside the checkout, or package caches. Provision independent
test resources or declare the same resource name to serialize their use.

An empty `allowed_paths` array is valid for a verification-only story. Shared
planning, progress, instructions, hook/runtime configuration, and backlog paths
remain protected even if an ownership glob would match them.

Design approval also attests that unresolved architecture/product decisions have
been addressed. Human validation, paid provider access, secrets, and deployment
permissions are not inferred from a green unit test. Leave those stories blocked
and record an environment/design blocker; do not manufacture acceptance evidence.

## Run a feature

Use `/parallel-loop` with the orchestrator, or run these commands from the original
coordinator checkout. `--approve` is an explicit operator approval boundary.

```powershell
node .github\harness\parallel\runtime.cjs begin --feature F001 --approve
node .github\harness\parallel\runtime.cjs claim --story F001-S01 --agent maker-alpha
node .github\harness\parallel\runtime.cjs claim --story F001-S02 --agent maker-beta
node .github\harness\parallel\runtime.cjs status
```

Each claim returns the exact worktree, branch, identity, attempt, scope, criteria,
verification commands, and private report path. Open that worktree separately.
Branches and worktrees are created from the current integration commit, outside
the source checkout in a run-specific sibling directory.

Inside each builder workspace:

```powershell
node .github\harness\parallel\runtime.cjs context
# Implement only the assigned story, then:
node .github\harness\parallel\runtime.cjs worker-report
```

A worker that cannot finish can report a non-success outcome:

```powershell
node .github\harness\parallel\runtime.cjs worker-block --reason environment
```

Other blocker reasons are `out-of-scope`, `tests-failing`, and `design-question`.
Reports replace the worker's usual shared progress/commit obligation.

Back in the coordinator, process one candidate at a time:

```powershell
node .github\harness\parallel\runtime.cjs capture --story F001-S01
node .github\harness\parallel\runtime.cjs prepare-review --story F001-S01 --agent checker-alpha --approve
```

Capture verifies ownership, the worker report, and tests before creating a
checkpoint commit. Preparation merges into a separate detached candidate
worktree and runs combined checks. A checkpoint/merge candidate is not accepted
delivery. Conflicts or regressions preserve the worktrees and block promotion.

Open the returned candidate worktree in an independent evaluator workspace.
Review the exact SHA from `context`, verify each criterion, and create JSON at
the returned private `report_path`:

```json
{
  "run_id": "<run ID>",
  "feature_id": "F001",
  "story_id": "F001-S01",
  "candidate_sha": "<exact candidate SHA>",
  "evaluator_id": "checker-alpha",
  "verdict": "PASS",
  "criteria": [
    {
      "criterion": "Alpha works",
      "passed": true,
      "evidence": "<specific files, tests, and observed behavior>"
    }
  ],
  "issues": []
}
```

Every criterion must appear exactly once. A PASS requires all criteria to pass
and no unresolved issues. Use FAIL with concrete evidence when anything is
missing. Do not include secrets or raw tool transcripts. Submit from that
evaluator workspace:

```powershell
Get-Content -Raw -LiteralPath '<report_path from context>' |
    node .github\harness\parallel\runtime.cjs review-report
```

The coordinator can then run `accept --approve`. It reruns checks, verifies the
same SHA and unchanged integration base, and fast-forwards integration. Only then
are dependents released. Repeat capture/review/accept for the remaining stories.

After every story is accepted:

```powershell
node .github\harness\parallel\runtime.cjs prepare-final --agent feature-checker --approve
```

This creates a completion candidate containing surgical feature/backlog status
updates, story evidence, and an appended progress entry. Canonical project files
are still unchanged. The independent evaluator checks **all parent-feature
criteria** at that exact commit, with `story_id: null` in its report.

Only a final `accept --approve` publishes that reviewed completion commit to the
original named branch. If the branch or checkout has moved, publication stops
instead of resetting, rebasing, or overwriting it. No pushes are performed.

## State, leases, budgets, and recovery

Run state, content-free events, and the active pointer live in the Git common
directory under `solution-harness/parallel`. Assignments and private reports live
in each worktree's Git administrative directory. Linked worktrees are supported;
the runtime never assumes `.git` is a directory.

The coordinator uses an exclusive lock and atomic JSON replacement. It records
promotion intent before Git changes. Do not run manual Git mutations in managed
worktrees or edit runtime state. One coordinator must retain exclusive use of its
checkout. Hooks add defense-in-depth; commit/SHA/scope checks remain authoritative.

| Command                  | Purpose                                                        |
|--------------------------|----------------------------------------------------------------|
| `status [--run ID]`       | Inspect workers, capacity, leases, candidate, and completion    |
| `heartbeat --story ID`   | Extend a live lease without reviving an expired attempt         |
| `pause` / `resume`        | Checkpoint dispatch/promotion while preserving reports and work |
| `release --story ID --approve` | Attest the worker stopped; fence its attempt before retry  |
| `abort-candidate --approve` | Abort a pending merge if present; preserve the worktree      |
| `recover --approve`      | Reconcile an interrupted promotion without overwriting history  |
| `recover-lock --approve` | Remove a lock only when its recorded PID is no longer alive     |
| `cancel --approve`       | Attest workers stopped; close the run without deleting work     |
| `cleanup --run ID --approve` | Remove only clean worktrees of a closed run; retain branches |

Pause before handing the coordinator session back while workers are outstanding.
Running workers can still submit reports during a pause; resume before capturing
or promoting them. Pausing does not reset or stop the wall-clock budget.

Attempts, total coordinator-created commits, and elapsed time are bounded across
the whole run. Reservations survive failures. Expired leases are never silently
reassigned; stop the old session and explicitly release it before retrying.
Commit hooks that introduce out-of-scope changes block capture.

Changed config/planning inputs require cancellation and replanning. Failed
verification or conflicts require explicit rework, not a success-shaped fallback.
For a failed combined candidate, abort it, stop/release the affected builder, and
claim a new attempt from the current integration base. Do not repair a review
worktree in place and reuse its old verdict.

Recovery is deliberately conservative. An unknown lock owner, unexpected branch
movement, dirty cleanup target, or ambiguous interrupted capture needs operator
inspection. No force removal, automatic lock stealing, reset, push, or remote
history rewriting is provided. Close worker/evaluator sessions before cleanup.
Ignored files also block cleanup; review and remove generated dependencies or
local data explicitly rather than allowing cleanup to discard them.

## Verification and release notes

Run the dependency-free tests from the plugin checkout:

```powershell
node --test tests\parallel.test.cjs tests\cloud.test.cjs
```

Version 1.1.0 adds local planning, isolated story worktrees, a serialized
commit-bound review/promotion queue, recovery controls, assignment-aware hooks,
and an additive installer. It preserves sequential execution and the cloud pilot.
Multi-feature scheduling, automatic worker launch, hosted parallelism, distributed
locks, and measured model/token accounting are deferred.
