---
name: hybrid-loop
description: "Coordinate an approved Jira story subset across local workspaces and GitHub cloud tasks with independent review and manual serial integration."
disable-model-invocation: true
---

# Guided Jira Hybrid Loop

Run only an explicitly approved `/jira-plan` result. There is no sprint watcher,
automatic scheduler, shared lease, ownership guard, or automatic drift check.
One coordinator maintains the approved run record for both backends. Read the
[hybrid guide](../../hybrid/README.md) and `/plan-execution` first.

## Prepare

1. Recheck the approved Jira snapshot and repository requirements. Confirm the
   story allowlist, Source IDs, criteria, dependencies, designs, local/cloud
   routes, ownership, shared resources, budgets, and permitted cloud context.
   Changed or unavailable source data is a blocker.
2. Confirm a clean approved base, real baseline tests, project instructions,
   separate local editing roots, GitHub access, and repository protection.
   An authorized Jira integration is separate from GitHub CLI.
3. Record the plan, approvals, and actual baseline. Dispatch only ready,
   nonconflicting stories; unknown ownership or dependencies must be resolved
   or serialized.

## Execute

1. For local work, follow `/parallel-loop`; for cloud work, follow
   `/cloud-parallel`. The coordinator verifies each assignment and current
   budget before dispatch. Builders do not publish shared status or grade
   their own work.
2. Reconcile GitHub task and PR identities, including ambiguous creation. Do
   not retry until the provider state is understood.
3. Use a fresh independent evaluator for each exact candidate and the report
   shape in the parallel guide. Verification-only stories require actual
   baseline-bound evidence, not a fabricated PR.
4. Integrate approved passing code serially under repository protection.
   Recheck head, base, scope, checks, and review before each integration.
   Changed candidates or bases require fresh evaluation.
5. Review the combined selected-story delivery, then separately review all
   parent-feature criteria before marking a parent complete. A sprint subset
   does not imply full-feature completion. Publish shared status only after
   the relevant review and approval.

Use `/jira-sync` only with separate authorization. Pause on source drift, failed
checks, stale evidence, missing permissions, uncertain provider operations, or
budget exhaustion. Preserve dirty work and reconcile the run before resuming.
