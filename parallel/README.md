---
title: Guided parallel story execution
description: Plan, review, and integrate local or cloud stories without a scheduler.
---

# Guided parallel story execution

`/plan-execution` creates a reviewed plan. `/parallel-loop` coordinates local
workspaces, and `/cloud-parallel` uses GitHub cloud tasks. One person or agent
acts as coordinator and maintains the approved run record. These procedures do
not automatically schedule, lock, fence, isolate, or validate anything.
Sequential `/loop` remains the default.

## Story model and readiness

Keep the project's feature catalog authoritative. A backlog can use the existing
nested epic/feature/story structure or the flat version 1 format described by
[backlog.schema.json](backlog.schema.json). For example:

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
    }
  ]
}
```

Criterion indexes are one-based. Done stories need evidence, and the complete
set of stories must cover the parent feature's criteria. Check feature and
story dependencies, design and architecture gates, shared resources, and
ownership manually. A dependency is ready only after its prerequisite is
actually integrated and accepted, not merely built. Unknown or conflicting
ownership, missing evidence, dependency cycles, and unapproved designs block
dispatch.

## Approved run record

Agree on a durable, appropriately protected location before starting; do not
put credentials or unnecessary Jira data in it. The coordinator records:

- Run ID, repository, approved base branch and SHA, feature/story allowlist,
  criteria, approved design, and any Jira Source IDs.
- Explicit approvals, verification commands, time/worker/attempt/commit budgets, and
  the owner of the record. Default to one worker until parallelism is approved.
- Per-story dependencies, allowed paths, shared resources, backend, assigned
  workspace or task ID, candidate SHA/PR, review, integration, and blockers.
- Baseline and final test results, evaluator identity, parent-feature review,
  and every approval or recovery decision.

Record transitions as planned, assigned, submitted, reviewed, integrated, or
blocked. A record is evidence to inspect, not a distributed lock or proof that
the underlying work is unchanged. Before a new assignment, reconcile active
workers, base SHA, changed inputs, budgets, and conflicting paths/resources.
If the state is uncertain, stop rather than starting a second coordinator.

## Independent verdict

The coordinator supplies the exact candidate SHA, current base SHA, and
criteria to a fresh evaluator who did not build the candidate. The evaluator
returns a report in this shape:

```json
{
  "run_id": "<run ID>",
  "feature_id": "F001",
  "story_id": "F001-S01",
  "source_id": null,
  "candidate_sha": "<full candidate SHA>",
  "base_sha": "<full base SHA>",
  "evaluator": "<independent session identifier>",
  "verdict": "PASS",
  "criteria": [
    { "criterion": "<exact criterion>", "result": "PASS", "evidence": "<observed evidence>" }
  ],
  "checks": [
    { "command": "<actual command>", "exit_code": 0, "result": "<observed result>" }
  ],
  "issues": []
}
```

Use `story_id: null` for a full-feature review. For verification-only work,
identify the reviewed baseline commit and actual authorized observations rather
than inventing a PR. PASS requires evidence for every criterion, successful
required checks, and no blocking issue. Missing access or unverified criteria
mean FAIL. The coordinator checks the report against the assignment and current
candidate; the format itself provides no automatic validation.

## Review and recovery

Work in distinct verified workspaces, keep shared progress under coordinator
control, and integrate one reviewed candidate at a time. If the head, base, or
criteria change, obtain fresh checks and independent review. A full-feature
review and regression checks are separate from individual story reviews.
Respect repository protections and request approval before integration.

On interruption, pause, inspect actual worktrees and provider state, preserve
dirty files, and record unresolved tasks. Do not reset, force-merge, duplicate
an ambiguous cloud task, or delete worktrees to make the record look clean.
Worktrees and agent labels are not security sandboxes.
