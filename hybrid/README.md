---
title: Guided Jira hybrid execution
description: Plan Jira stories and coordinate approved local and GitHub work manually.
---

# Guided Jira hybrid execution

Use `/jira-plan` for a read-only sprint preview, `/hybrid-loop` for an approved
mix of local and cloud stories, and `/jira-sync` for separately approved
evidence or transitions. There is no sprint watcher or automatic execution.

## Requirements

- A Jira Cloud MCP server or existing authorized Jira client, or a
  user-provided export with enough information to review the selected sprint.
  The plugin does not install or configure a Jira integration, and GitHub CLI
  cannot access Jira.
- An onboarded project with authoritative feature, backlog, design, and
  dependency information; actual test commands; and reviewed instructions.
- Git and separately opened workspaces for local work. For cloud work, an
  authenticated `gh`, eligible Copilot access, repository permissions, and
  reviewed branch protections.
- One coordinator, a durable approved run record, explicit story and data
  sharing approvals, and independent evaluators. See the
  [parallel guide](../parallel/README.md) for the record and verdict.

Do not paste tokens, credentials, private comments, or attachments into task
briefs or records. Use the organization's approved credential mechanism.
Worktrees, instructions, and agent labels do not enforce security isolation.

## Plan and approve

Read the selected board and sprint using the authorized integration. If no
active sprint exists and no future sprint was explicitly selected and approved,
access or pagination fails, or several sprints are ambiguous, report the
problem rather than treating it as an empty backlog. Do not start a future sprint.
Record the selected sprint, stable issue and Source IDs, criteria, dependencies,
and relevant update timestamps. Compare them with the complete repository
backlog, including prerequisites outside the sprint.

Review the exact story allowlist, local/cloud routes, ownership, shared
resources, tests, budgets, and permitted GitHub context with the user. Recheck
the source immediately before dispatch; changed criteria or dependencies need
reconciliation and renewed approval. No automatic snapshot or drift guard is
provided.

## Execute and review

Use one coordinator for both backends. Dispatch only approved, ready,
nonconflicting work, following `/parallel-loop` and `/cloud-parallel`. Keep
local editing roots separate and record GitHub task and PR identities. A fresh
evaluator reviews the exact candidate and every criterion. Integrate accepted
code serially under repository protection; a changed head or base requires
fresh evidence. Verification-only stories need real baseline-bound observations
instead of a fabricated PR.

After the selected stories are integrated, review their combined delivery.
Review every parent feature's full criteria before marking that parent complete;
a sprint subset may leave it in progress. Publish shared progress only after
the relevant review and approval.

## Optional Jira write-back and recovery

`/jira-sync` requires separate authorization for each evidence comment or
explicitly mapped transition. Verify issue identity and current criteria first.
Search for existing evidence before writing, and reconcile ambiguous results
before retrying. This manual procedure cannot guarantee exactly-once writes.
Never start, close, or reorder a sprint as a side effect.

Pause on missing access, changed inputs, failed checks, stale evidence, uncertain
provider results, or exhausted budgets. Reconcile actual tasks and workspaces
before resuming. Do not remove dirty work or bypass branch protection.
