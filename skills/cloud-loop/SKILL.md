---
name: cloud-loop
description: "Guide one approved feature in a GitHub Copilot cloud task, with real checks and independent evaluation before completion."
disable-model-invocation: true
---

# One-Feature Cloud Loop

Use this explicitly for one approved feature in a hosted Copilot task. It is
guidance, not an automatic runtime or multi-feature scheduler. Confirm the
plugin and required tools are actually available in the cloud session; see the
[cloud guide](../../cloud/README.md).

## Contract

The task must identify the feature, exact criteria, approved scope and base,
real verification commands, time and rework limits, and reporting boundary.
Read the existing feature catalog, plan, architecture, designs, dependencies,
and project instructions. Missing inputs or approval are blockers. Do not alter
the contract or invent a passing result.

## Procedure

1. Run the approved baseline checks before editing. Stop if they fail.
2. A builder or default hosted agent implements only the assigned feature.
   An orchestrator delegates to a builder if the host actually provides that
   capability; otherwise it stops rather than implementing the feature itself.
   Keep cloud story assignments within their approved paths and avoid shared
   progress edits.
3. Run the required tests and report actual commands, results, candidate SHA,
   and blockers. Do not merge or approve your own PR.
4. Request a separate evaluator, independent of the builder, for the exact
   candidate and all criteria. If the host cannot provide one, leave the PR
   for an independent local evaluator and explicitly report that review is
   pending. Do not mark the feature complete.
5. Only after independent PASS, final checks, current-base verification, and
   required approvals may the coordinator publish completion. Changed source,
   base, or criteria require fresh review. Respect the approved rework and time
   limits and stop on any blocker.

The hosted agent or GitHub manages its task and PR artifacts. This skill does
not automatically record checkpoints, enforce budgets, or prove agent
independence. Human review, branch protection, and required CI remain
authoritative.
