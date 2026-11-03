---
name: hybrid-loop
description: "Manually trigger Jira-sourced user stories with mixed GitHub cloud and isolated local developers, independent local review, and serialized protected integration. No sprint watcher."
disable-model-invocation: true
---

# Manual Jira Hybrid Loop

Run one approved Jira sprint subset through one local coordination authority.
The runtime extends the existing cloud story ledger; never run the standalone
cloud/local coordinators alongside it or remove their exclusion guards.

## Prerequisites

* Complete `/jira-plan` and approve its exact snapshot and execution contract.
* Use Node.js 22.20+ or 24+, GitHub CLI 2.80+ with task/status support, and
  authorized Jira/GitHub access. Confirm account entitlement and provider limits.
* Start on a clean named base branch at the current GitHub base. Do not stash,
  reset, overwrite, or delete user work. Keep generated trajectory logs ignored.
* Review project instructions for assigned workers, independent evaluators, and
  coordinator-only publication. Never infer that configuration flags override
  organization instructions.
* Review branch protections or merge-queue rules, actual tests, workspace and
  resource isolation, approved designs, and the permitted cloud story context.
* If hosted cloud hooks are already installed, migrate the cloud story runtime
  and enable its supported story mode before dispatch. Do not bypass old hooks.

Read the [guide](../../hybrid/README.md) and resolve the
[runtime](../../hybrid/runtime.cjs) from this installed skill.

## Quick start

```powershell
$runtime = '<absolute plugin path>\hybrid\runtime.cjs'
$config = '<absolute approved configuration path>'
node $runtime plan --config $config
node $runtime begin --config $config --snapshot '<approved digest>' --approve
node $runtime dispatch --approve
node $runtime refresh
node $runtime status
```

This is a manual trigger, not an always-on listener. The coordinator follows the
bounded workflow until delivery, a blocker, a budget, or an approval boundary.
Obtain approval per mutation or use a narrowly scoped autonomy contract the user
explicitly approved. A CLI `--approve` flag is not itself user authorization.

## Execution protocol

1. Dispatch only ready allowlisted stories. Cloud/local workers share one
   capacity, ownership, dependency, and resource policy.
2. Cloud creation can return queued or ambiguous references. Reconcile in GitHub
   and use `attach`; never retry uncertain creation blindly.
3. For local `manual-workspace` mode, open each returned workspace separately and
   confirm its editing tools use that root. For `copilot-cli`, use a configured,
   separately authenticated executable and reviewed scoped permissions. The
   command stays attached and bounded while cloud tasks also build.
4. Workers implement only their story, run checks, and submit `worker-report`
   or `worker-block`. They never commit, push, merge, deploy, or update shared
   status. The coordinator uses `capture` and `publish-local --approve`.
5. Refresh provider state. Prepare one exact-head, current-base review workspace
   at a time. Never use a builder workspace or builder identity as evaluator.
6. Run `prepare-review`, then open a separate evaluator workspace or use
   `launch-review` with approved local CLI configuration. Require actual
   criterion evidence, unchanged source, and a current assignment nonce.
7. Submit the JSON through `review-report`. FAIL means bounded rework, not a
   merge. Passing code candidates use `merge --approve`; verification-only
   candidates use `accept-evidence --approve`, never a fabricated PR.
8. If another merge advances the base, update the PR using `update-pr --approve`
   and obtain fresh tests/review. Reconcile ambiguous updates explicitly.
9. Release dependencies only after confirmed integration or accepted baseline
   verification. Full-feature prerequisites still require full-feature review.
10. Once selected stories are accepted, review complete parents with
    `prepare-final` and `accept-final`. Partial parents remain in progress.
11. Obtain `prepare-delivery` review covering every selected story on the latest
    merged base, submit it, and use `accept-evidence`.
12. Fast-forward the clean coordinator under the repository's approved Git
    workflow, then `finish --approve`. Commit/publish metadata through the normal
    approval process. Use `/jira-sync` only if separately enabled and approved.

## Parameters

| Parameter     | Default      | Meaning                                 |
|---------------|--------------|-----------------------------------------|
| `--config`    | Required     | Approved external configuration         |
| `--snapshot`  | Required     | Exact Jira preview digest for begin     |
| `--story`     | Ready batch  | Limit dispatch or a story operation     |
| `--workspace` | Required     | Separate exact-commit review checkout   |
| `--agent`     | Required     | Fresh independent evaluator identity    |
| `--approve`   | Disabled     | Approved mutation boundary              |

## Recovery and stop conditions

Pause before handing off. Jira drift, failed checks, stale reports, ownership
violations, missing environment access, uncertain provider operations, or
exhausted budgets stop progress explicitly. They never authorize a fallback.

`pause` does not stop cloud jobs. Reconcile and close unmerged PRs before
abandoning. Stop the specific local worker before abandoning its attempt.
Resume retains the original budgets and source contract. `recover-publish`
finishes only known metadata changes and refuses unrelated edits.

No deployments or live-pilot operations are implicitly authorized. Worktrees,
hooks, session labels, and permission flags are not security sandboxes.

> Brought to you by solution-harness
