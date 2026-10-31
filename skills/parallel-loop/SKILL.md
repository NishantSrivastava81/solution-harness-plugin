---
name: parallel-loop
description: "Coordinate approved local stories in separate worktrees, with independent review and serialized integration."
disable-model-invocation: true
---

# Parallel Loop

Run local parallel stories within one approved feature. The normal `/loop` remains
sequential. This workflow does not launch workers into a shared VS Code editing
root, schedule multiple features, or run hosted/cloud parallel agents.

## Prerequisites

1. Read the installed `.github/harness/parallel/README.md` and run `/plan-execution`.
2. Require Node.js 22.20+ or 24+, the updated plugin, a clean named branch, real
   tests, explicit scope/design approval, and reviewed ownership/resources.
3. Confirm project instructions have the assigned-story exception and that each
   worker/evaluator uses a separately opened workspace with verified editing-tool
   isolation. Do not treat a terminal working directory as isolation.
4. Review the run-wide time, commit, worker, lease, and attempt budgets with the
   user. Do not silently set approval flags or expand the approved feature.

## Quick start

Use the orchestrator as the only coordinator. Run the installed CLI from the
original project checkout:

```powershell
node .github\harness\parallel\runtime.cjs begin --feature F001 --approve
node .github\harness\parallel\runtime.cjs status
node .github\harness\parallel\runtime.cjs claim --story F001-S01 --agent maker-alpha
```

Open the returned worktree separately and assign its context to a builder.
Respect runtime capacity/resource checks; never reuse an active worker label.
Only explicitly selected ready stories may be claimed.

## Required workflow

1. Builders read `context`, implement their assigned story, and call
   `worker-report`. They do not commit, select more work, merge, deploy, or update
   shared status. A blocker uses `worker-block --reason <reason>`.
2. The coordinator calls `capture --story ID`. A worker commit/report alone
   never releases dependent work.
3. With approval, call `prepare-review --story ID --agent <checker> --approve`.
   Open the combined candidate in a fresh evaluator workspace, distinct from
   every builder in this run.
4. The evaluator reviews the exact returned SHA, tests every criterion, and
   submits `review-report` using the JSON shape in the installed guide. It may
   write only its private report, not source or shared evaluation/status files.
5. With approval, call `accept --approve`. Integration is serial. On any failure,
   preserve evidence, report the blocker, and use explicit abort/release/retry
   commands. Never resolve a candidate in place and reuse an old verdict.
6. After all stories are integrated, call `prepare-final --agent <checker>
   --approve`. Require a separate full-feature evaluation, including parent
   criteria and configured regression checks, before final `accept --approve`.
7. Report accepted story/feature SHAs, remaining blockers, budgets, and worktrees.
   Do not push. Offer cleanup only after worker sessions are closed.

## Parameters and controls

| Control                         | Rule                                         |
|---------------------------------|----------------------------------------------|
| `--feature`, `--story`           | Exact catalog/backlog IDs                    |
| `--agent`                       | Unique builder or independent evaluator label |
| `--approve`                     | Explicit operator decision, never inferred   |
| `status`, `pause`, `resume`      | Durable state, checkpoint, and continuation   |
| `heartbeat`, `release`           | Renew a live lease or fence a stopped attempt |
| `abort-candidate`, `recover`     | Preserve failed work; reconcile interruptions |
| `cancel`, `cleanup`              | Stop first; never discard dirty worktrees    |

## Troubleshooting

Pause before handing control back while workers are outstanding. Expiration,
input drift, ambiguous requirements, failed tests, conflicting ownership,
missing independent evidence, or moved target branches stop progress. Do not
reset budgets, steal locks, change runtime state by hand, or use live deployment
credentials to force completion. The manual-workspace release cannot prove
agent identity or provide an operating-system sandbox.
