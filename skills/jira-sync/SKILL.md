---
name: jira-sync
description: "Publish independently accepted manual hybrid delivery evidence and explicitly mapped Jira transitions. Idempotent, separately approved, and disabled by default."
disable-model-invocation: true
---

# Jira Evidence Sync

Publish evidence for confirmed hybrid delivery without rebuilding completed
stories. Do not equate agent completion, PR creation, implementation acceptance,
QA, release, or business Done.

## Prerequisites

* Complete `/hybrid-loop`, including independent selected-story delivery review
  and local metadata publication.
* Enable `jira_writeback` in the approved external configuration only after the
  user authorizes Jira writes. Read the [guide](../../hybrid/README.md).
* Keep credentials in environment references. Verify Jira issue-security and
  workflow permissions, not merely browser login.
* If transitions are authorized, configure both the transition ID and its
  destination status ID. Do not hard-code a universal Done transition.

## Quick start

Resolve the [runtime](../../hybrid/runtime.cjs) relative to this installed skill:

```powershell
node '<absolute plugin path>\hybrid\runtime.cjs' sync --root '<project root>' --run '<published run ID>' --approve
```

Omitting `--run` selects the most recently published hybrid run in that
repository. The operation creates no branches, commits, or coding tasks.

## Protocol

1. Confirm the run's repository, Jira site, immutable issue IDs, Source IDs, and
   accepted commit/evidence identities.
2. Re-read the issue requirements. Changed criteria or dependencies require
   explicit reconciliation, not a success comment over a different contract.
3. Publish a bounded evidence comment linking the accepted PR or commit.
   Stable markers prevent duplicate comments on retry.
4. Apply only an explicitly configured available transition. Already reaching
   its configured destination is idempotent.
5. Report each result. Ambiguous or failed writes remain pending/uncertain; do
   not re-run already merged implementation.

## Parameters

| Parameter   | Default            | Meaning                              |
|-------------|--------------------|--------------------------------------|
| `--root`    | Current root       | Original coordinator repository      |
| `--run`     | Last published run | Recorded accepted hybrid delivery    |
| `--approve` | Disabled           | Separate Jira write authorization    |

## Troubleshooting

The publisher refuses concurrent evidence writers. Recover a stale sync lock
only after confirming its recorded process stopped. Do not steal a live lock,
edit receipts, or suppress HTTP/permission/transition failures.

No sprint is started, closed, reordered, or repopulated by this skill.

> Brought to you by solution-harness
