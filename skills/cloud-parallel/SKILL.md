---
name: cloud-parallel
description: "Dispatch independent user stories to GitHub cloud agents and review and merge their PRs locally."
disable-model-invocation: true
---

# Cloud Parallel Stories

Use the local orchestrator to dispatch approved stories to GitHub cloud agents.
Each cloud task builds one story and opens a PR. A separate local evaluator
reviews each exact PR commit, and the coordinator integrates PRs serially.
This opt-in workflow does not install the local parallel runtime into the target
repository. Normal `/loop`, `/parallel-loop`, and cloud-loop remain unchanged.

## Prerequisites

* Use the full Solution Harness plugin 1.2.0 or later, Node.js 22.20+ or 24+, Git,
  and GitHub CLI 2.80+ with `agent-task view --json` support.
* Ensure Node and GitHub CLI are on the PATH used by the local agent. Authenticate
  GitHub CLI with an eligible paid Copilot plan and repository access. GitHub's `agent-task` commands are a public preview and subject to
  organization policies, billing, and concurrency limits.
* Use a clean coordinator checkout on the approved base branch, at its current
  GitHub commit. Preserve existing work. If the plugin trajectory hook writes
  `docs/trajectory.jsonl`, arrange for that generated log to be Git-ignored
  before planning; do not delete or overwrite an existing user file. The project needs `docs/FEATURES.json`,
  `docs/backlog/backlog.json`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, and
  `docs/PROGRESS.md`.
* Review story criteria, feature and story dependencies, designs, file ownership,
  shared resources, verification commands, and repository instructions with the
  user. Cloud stories must not update shared status or progress files.
* Require branch protection or a merge queue that prevents merging stale bases,
  plus the repository's required reviews and checks. The confirmation in the
  configuration is an operator attestation, not an automatic policy audit.
* If the project already has the Solution Harness cloud hooks, migrate its
  runtime and instructions to the updated distribution, set
  `cloud_parallel_enabled` to `true` in its cloud config, and merge those changes
  before starting. Never bypass an older cloud-loop hook with a prompt.

Do not put secrets in story prompts, command arguments, configuration, reports,
or local receipts. GitHub receives the approved story and scope in each prompt.
Cloud sandboxes, local worktrees, agent labels, and hooks are not security
boundaries. Run untrusted PR tests only in an appropriate isolated environment.

## Configure

Create an approved JSON configuration outside the target checkout. The paths in
`ownership` are repository-relative POSIX globs. Declare shared test resources
under `resources` so conflicting stories are not dispatched together.

```json
{
  "version": 1,
  "repository": "OWNER/REPO",
  "base_branch": "main",
  "feature_ids": ["F001"],
  "approved_designs": ["F001"],
  "instructions_reviewed": true,
  "branch_protection_confirmed": true,
  "max_workers": 2,
  "max_minutes": 120,
  "max_attempts": 2,
  "require_ci": true,
  "merge_method": "squash",
  "verification": [
    {
      "name": "Project tests",
      "kind": "test",
      "command": "node",
      "args": ["--test"],
      "timeout_seconds": 300
    }
  ],
  "ownership": {
    "F001-S01": { "allowed_paths": ["src/alpha/**", "tests/alpha/**"], "resources": [] },
    "F001-S02": { "allowed_paths": ["src/beta/**", "tests/beta/**"], "resources": [] }
  }
}
```

Replace the examples with actual project commands and scopes. At least one real
`test` command is required. Commands run directly without shell expansion, at
baseline and in each review worktree. Setup commands must leave tracked and
nonignored source unchanged. The configured tests must exercise the combined
product, not unconditional success commands. `require_ci: true` also requires
at least one passing GitHub check. Set it to false only with explicit approval
when local verification and repository policy are sufficient.

`max_workers` is 1-3. `max_minutes` is a run-wide elapsed-time cap, including
pauses. `max_attempts` is 1-5 per story. `merge_method` is `merge`, `squash`, or
`queue`; select a method permitted by the repository. Feature prerequisites,
story prerequisites, architecture gates, and conservative ownership/resource
conflicts are inherited from the existing story model. Independent stories from
multiple approved features can run concurrently; dependencies wait for merged
stories and verified prerequisite features.

## Start and dispatch

Resolve [the coordinator](scripts/coordinator.cjs) relative to this skill's
installed directory. Run it from the target project's coordinator checkout. The
following PowerShell variables represent absolute paths supplied by the operator:

```powershell
$coordinator = '<absolute path to this skill>\scripts\coordinator.cjs'
$config = '<absolute path to approved configuration.json>'
node $coordinator plan --config $config
node $coordinator begin --config $config --approve
node $coordinator dispatch --approve
node $coordinator refresh
node $coordinator status
```

`plan` is read-only. `begin` validates the approved contract and runs a green
baseline before dispatch. `dispatch` starts as many ready, nonconflicting cloud
stories as capacity permits, without waiting for earlier cloud tasks to finish.
Use `--story F001-S01` to select one ready story. The coordinator stores run
state and argument-free tool receipts under the repository's Git common
directory, not in the PRs. Plugin hooks route active coordinator and evaluator
sessions without forcing shared progress edits. Confirm that the plugin routes
these hooks and records argument-free events under the Git common directory.
If the host does not load the updated plugin hooks, stop and reload it rather
than changing shared progress or bypassing the coordinator.

GitHub CLI may return a queued job ID before a session or PR exists. Do not retry
an ambiguous creation: inspect `gh agent-task list` and GitHub's agent sessions,
match the run and story, then attach the confirmed session explicitly:

```powershell
node $coordinator attach --story F001-S01 --session '<session UUID>' --approve
node $coordinator refresh
```

If creation failed or timed out, first verify whether GitHub created a task.
Only after confirming no live task exists, or closing its unmerged PR, may the
operator use `abandon --story F001-S01 --approve` and dispatch another attempt.
Never infer that a failed CLI process means the remote task was not created.

## Review and merge

Wait for `refresh` to report a completed cloud session and a ready PR. Create a
separate detached review worktree for that PR. With a GitHub CLI version that
supports `--worktree`, for example:

```powershell
gh pr checkout 123 --repo OWNER/REPO --worktree 'C:\work\review-F001-S01' --detach
node $coordinator prepare-review --story F001-S01 --workspace 'C:\work\review-F001-S01' --agent local-checker-1 --approve
```

If `--worktree` is unavailable, create a separate detached Git worktree first,
then run `gh pr checkout 123 --repo OWNER/REPO --detach` inside that worktree.
Do not reset or overwrite an existing workspace. The PR must contain the current
base commit; if the base advances after another merge, update the PR and review it
again. When a follow-up cloud session changes a PR, attach that new session and
wait for it to complete before preparing another review. The coordinator checks the exact head and base, assigned paths, a clean
worktree, and configured tests. It permits only one review candidate at a time.

Open the returned worktree in a separate VS Code workspace and verify its tools
target that workspace, not merely a terminal working directory. This release
does not open evaluator windows automatically. Dispatch a fresh local evaluator,
independent of the cloud builders, with the returned worktree, SHA, and exact
criteria. It must inspect the changes, run
appropriate checks, and return a JSON verdict. Do not accept the cloud builder's
summary as a review. The evaluator does not edit source or shared status files.
Its report has this shape:

```json
{
  "run_id": "<run ID>",
  "feature_id": "F001",
  "story_id": "F001-S01",
  "candidate_sha": "<exact SHA>",
  "evaluator_id": "local-checker-1",
  "verdict": "PASS",
  "criteria": [
    { "criterion": "<exact criterion>", "passed": true, "evidence": "<specific observed evidence>" }
  ],
  "issues": []
}
```

Save the evaluator response outside the checkout and submit it from the
coordinator. A PASS requires evidence for every exact criterion and no issues.

```powershell
Get-Content -Raw -LiteralPath '<local report.json>' | node $coordinator review-report
node $coordinator merge --approve
node $coordinator refresh
```

Obtain explicit user approval for each dispatch and merge, or follow a scoped
autonomy contract that the user approved before the run. Never infer approval
from the configuration alone.

`merge` reruns local checks, verifies the same head and base, checks CI when
configured, and uses `gh pr merge --match-head-commit`. It never uses `--admin`.
Only a GitHub-confirmed merged PR releases dependent stories. A queued or
uncertain merge is not a success; inspect GitHub and run `refresh`. If it remains
open, confirm there is no active merge queue or auto-merge before using
`recover-merge --approve` to review or retry it. Repository rules can still
require human approval. A base can race after the local check, so
branch protection or a merge queue remains necessary.

## Finish and publish

After a feature's stories have merged, create a separate clean worktree at the
current GitHub base SHA. Prepare a full-feature review with `--feature F001`
and the local evaluator label. Use the same report shape with `story_id: null`.
Submit it and run `accept-final --approve`. Repeat for every approved feature.
If the base changes, repeat any feature review that no longer matches it.

Only after all feature reviews pass on the same merged base, fast-forward the
clean coordinator checkout using the repository's approved Git workflow and run
`publish --approve`. This updates the local feature registry, story evidence,
and progress log. Review and publish those tracked changes through the normal
repository approval process; the coordinator does not commit or push them.

## Recovery

Use `pause --approve` before handing off and `resume --approve` to continue
within the original budget. `abort-review --approve` clears a non-merging
candidate without deleting its worktree. Reconcile remote tasks and close
unmerged PRs before `abandon` or `cancel --approve`. A stopped coordinator can
leave a lock; use `recover-lock --approve` only after confirming its recorded
process has stopped. None of these commands cancels a GitHub cloud task or
removes worktrees. Never edit receipts, steal a live lock, bypass branch rules,
or treat local test receipts as a security boundary.

> Brought to you by solution-harness
