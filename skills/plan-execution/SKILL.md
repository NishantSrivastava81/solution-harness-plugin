---
name: plan-execution
description: "Plan approved story batches, dependencies, ownership, and verification for guided local or GitHub cloud work. Does not launch workers."
---

# Plan Execution

Create a reviewable plan without launching tasks or changing delivery status.
This is a guided analysis, not an automatic scheduler or validator.

## Inputs and readiness

1. Read the project's feature catalog, progress, plan, architecture, existing
   backlog, and referenced designs. The feature catalog remains authoritative.
2. With the user's approval, decompose only the requested scope. Preserve
   original Source IDs and existing criteria. Use the
   [story schema](../../parallel/backlog.schema.json) for new backlogs.
3. Check each story's testable criteria and one-based parent-criterion
   coverage. Verify evidence for stories already marked done.
4. Trace all story, feature, and architecture prerequisites, including those
   outside the selected subset. Unknown dependencies, cycles, missing criteria,
   or unresolved design gates are blockers.
5. Identify owned paths and shared resources, including tests and infrastructure.
   Treat overlapping or uncertain ownership/resources as conflicts and
   serialize them. Separate branches do not eliminate logical conflicts.

## Propose and approve

Show a table of story IDs, dependencies, owned paths, shared resources, proposed
local/cloud route, verification commands, and blockers. A dependent story is
ready only after its prerequisites are integrated and accepted. Default to one
worker unless parallelism is explicitly approved.

Agree on the exact feature/story allowlist, base branch and SHA, designs,
workspace isolation, verification, worker/time/attempt/commit budgets, and permitted
cloud data sharing. Obtain approval before creating worktrees or cloud tasks.
Review existing project instructions before proposing an assigned-story
exception; never override higher-priority instructions.

Choose an approved durable location for a run record. The
[parallel guide](../../parallel/README.md) describes the record and independent
verdict. Do not include credentials or unnecessary private data. A manually
maintained record is not a lock or automatic drift detector.

Each assignment must name the run, feature and story, Source ID if applicable,
exact criteria, allowed paths, base SHA, workspace or repository, tests, limits,
and reporting boundary. Reconcile actual state before each dispatch.

Use `/parallel-loop`, `/cloud-parallel`, or `/hybrid-loop` only after the user
approves the corresponding execution. If required information is absent or
uncertain, report the blocker instead of inventing a ready batch.
