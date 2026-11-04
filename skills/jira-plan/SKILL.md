---
name: jira-plan
description: "Read a selected Jira sprint or approved export, reconcile Source IDs and dependencies, and propose a manual hybrid execution plan."
disable-model-invocation: true
---

# Jira Plan

Preview a selected Jira Cloud sprint without launching workers or changing
Jira. Use an independently configured and authorized Jira MCP server or client,
or a user-provided export. The plugin does not supply Jira access; `gh` is for
GitHub, not Jira. See the [hybrid guide](../../hybrid/README.md).

## Read and reconcile

1. Confirm the Jira site, board, selected sprint, access, and permitted data.
   Use the organization's credential mechanism; never paste tokens into chat,
   task briefs, or run records.
2. Read all relevant pages of issues, stable issue and Source IDs, criteria,
   dependencies, and update timestamps. Surface permission, pagination, and
   rate-limit failures. If no active sprint exists, require an explicitly
   selected and approved future sprint or report an error. Multiple candidates
   require an explicit choice; do not start a future sprint.
3. Read the repository's full feature catalog, backlog, plan, architecture,
   progress, and designs. Reconcile each Jira issue with existing definitions,
   including prerequisites outside the sprint. Report unmapped or changed
   requirements; do not invent criteria or replace the source catalog.
4. Use `/plan-execution` to propose ownership, shared resources, tests, local or
   cloud routes, budgets, and ready batches. No issue status alone authorizes
   implementation.

## Approval and drift

Present the selected sprint and exact issue/story allowlist, normalized
criteria, source timestamps, blockers, and permitted GitHub context. Obtain
approval and record the result in an agreed safe location. Immediately before
dispatch, re-read the source or obtain an updated export and compare it with
the approved snapshot. Changed criteria, dependencies, or scope require
reconciliation and renewed approval.

This comparison is manual: there is no automatic snapshot digest or drift guard.
If the source cannot be rechecked or the integration is unavailable, report the
blocker. Use `/hybrid-loop` only after approval; do not start a sprint or create
tasks as part of this preview.
