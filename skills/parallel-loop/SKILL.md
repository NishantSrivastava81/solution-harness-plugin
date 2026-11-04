---
name: parallel-loop
description: "Coordinate approved local stories in separate worktrees with manual ownership checks, independent review, and serial integration."
disable-model-invocation: true
---

# Guided Local Parallel Loop

Run only an explicitly approved local story plan. `/loop` remains sequential.
Read `/plan-execution` and the [parallel guide](../../parallel/README.md) first.
One coordinator maintains the run record and checks all limits manually; no
bundled scheduler, lease, ownership guard, or automatic recovery exists.

## Prepare

1. Confirm a clean coordinator checkout, approved base branch and exact SHA,
   feature/story allowlist, design, dependencies, paths, shared resources,
   tests, and worker/time/attempt budgets. Run the real baseline tests; stop on
   failure. Never stash, reset, or overwrite existing work.
2. Review project instructions for the assigned-story exception. Confirm that
   each builder and evaluator can use a separately opened workspace whose edit
   tools target that workspace; a terminal directory alone is not isolation.
3. Record the approved plan and actual state as described in the guide.
   Dispatch only ready stories with nonconflicting ownership and resources.

## Assign and implement

After explicit approval, create a new branch and worktree for an assigned story,
replacing each quoted placeholder with an unused value:

```powershell
git worktree add -b '<new-story-branch>' '<absolute-worktree-path>' '<approved-base-sha>'
git -C '<absolute-worktree-path>' rev-parse --show-toplevel
```

Open that worktree separately and verify the editing root. Give the builder the
complete approved assignment from `/plan-execution`. The builder changes only
its story, runs the requested checks, and returns actual results and blockers;
it does not publish shared status or integrate. The coordinator inspects the
changes and, with approval, creates a candidate commit for exact-SHA review.
A candidate commit is not acceptance or permission to publish.

## Review and integrate

1. Ask a fresh evaluator, independent of the builder, to inspect the exact
   candidate and return the guide's structured verdict. Check each criterion,
   changed path, actual check, and current base. A missing result or changed
   candidate is a blocker.
2. Integrate one passing candidate at a time, only with approval and according
   to repository policy. Do not force a merge or overwrite a dirty checkout.
   If the base advances, update the candidate through the approved repository
   workflow and obtain fresh checks and review.
3. Reconcile dependencies and run the relevant combined tests before starting
   dependent work. After all stories, request a separate full-feature review
   and regression checks before publishing parent status or progress.

On interruption, preserve workspaces and reconcile the record with actual Git
state and active workers. Stop on unclear ownership, failed tests, stale
evidence, missing approval, or exhausted budgets. No worktree cleanup or push is
implied by finishing a guided run.
