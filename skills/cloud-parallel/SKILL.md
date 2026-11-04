---
name: cloud-parallel
description: "Dispatch approved independent stories to GitHub Copilot cloud tasks with gh, then independently review exact PR commits and integrate serially."
disable-model-invocation: true
---

# Guided GitHub Cloud Stories

One local coordinator uses GitHub CLI for approved cloud tasks. The coordinator
manually checks dependencies, ownership, budgets, and approvals; `gh` is not a
story scheduler or replacement for the removed local enforcement. Follow
`/plan-execution` and the [parallel guide](../../parallel/README.md) first.

## Prerequisites

- Authenticate `gh`, verify GitHub Copilot eligibility, repository permissions,
  the target repository and base, and the actual `gh agent-task` help. These
  commands are a preview and may change.
- Run real baseline tests on the approved base. Review required CI, branch
  protection or merge queue, story criteria, design, paths, shared resources,
  and limits. If stale-base protection cannot be verified, do not merge.
- Confirm any needed plugin components are available in the cloud session as
  described in the [cloud guide](../../cloud/README.md). If not, stop or use an
  explicitly approved self-contained brief; do not claim the plugin loaded.
- Obtain approval for the exact story and the information sent to GitHub.
  Never include credentials, Jira comments, attachments, or other unapproved
  private context in a brief.

## Dispatch and monitor

Prepare a separate approved brief for each ready, nonconflicting story. Include
the run and story IDs, criteria, allowed paths, base, project instructions,
actual checks, and reporting boundary. A cloud builder must not merge its own
PR or update shared status. For UI stories, verify `/frontend-design` is
available to the cloud builder or include the relevant approved guidance in the
brief; the independent evaluator must also follow it. After approval, replace
the example values:

```powershell
gh agent-task create --repo OWNER/REPO --base main --from-file 'C:\work\approved-story.md'
gh agent-task list --json id,name,repository,state,pullRequestNumber,pullRequestUrl
gh agent-task view '<session-id>' --repo OWNER/REPO
```

Record the returned task/session and PR identities in the run record. A task
can be queued before a PR exists. If creation times out or is ambiguous, inspect
GitHub task sessions and PRs and reconcile the result before any retry; the
local command's failure alone does not prove that no task was created.

## Review exact candidates

For each ready PR, record its head and base, inspect its changed paths, and
check the required GitHub checks:

```powershell
gh pr view 123 --repo OWNER/REPO --json url,headRefOid,baseRefOid,baseRefName,isDraft,mergeStateStatus
gh pr checks 123 --repo OWNER/REPO
gh pr checkout 123 --repo OWNER/REPO --worktree 'C:\work\review-story' --detach
git -C 'C:\work\review-story' rev-parse HEAD
```

Use a new, separately opened review worktree; never overwrite existing work.
If the installed `gh` lacks `--worktree`, create a separate detached Git
worktree first and run `gh pr checkout 123 --repo OWNER/REPO --detach` inside
it. Verify the checked-out SHA matches `headRefOid`, the base is current, and
editing tools target that workspace. Pending or failed checks are not a pass.

Assign a fresh evaluator independent of the cloud builder. Require the
structured verdict in the parallel guide with evidence for every criterion and
actual checks. The coordinator manually checks the report, approved scope,
candidate SHA, and current base. A changed head, base, or criteria invalidates
the review and requires fresh checks and evaluation.

## Integrate serially

With an independent PASS, successful required checks, current-base protection,
and explicit merge approval, the coordinator may use the repository's
approved merge method. For an approved squash merge:

```powershell
gh pr merge 123 --repo OWNER/REPO --squash --match-head-commit '<reviewed-head-sha>'
```

`--match-head-commit` guards the PR head, not an advancing base. Require branch
protection or a merge queue that enforces the current base; otherwise stop. For
a required merge queue, use the repository's approved queue procedure rather
than forcing a merge strategy. Never use `--admin` to bypass protections.
Confirm the actual merge result before releasing dependent work. Reconcile
ambiguous results instead of repeating a merge blindly.

Integrate one PR at a time and re-evaluate later candidates after base changes.
Run a separate full-feature review and regression checks before marking a
parent feature complete. Pause on scope drift, missing evidence, failed checks,
uncertain provider state, or an exhausted budget.
