---
name: jira-plan
description: "Preview user stories from a Jira sprint, reconcile Source IDs and repository readiness, and plan manual hybrid cloud/local execution. Never launches workers or changes Jira."
disable-model-invocation: true
---

# Jira Plan

Read the selected Jira Cloud sprint and reconcile it with the target project's
existing feature catalog and backlog. Preserve original Source IDs, criteria,
dependencies, and delivery evidence. This skill is local-only and manually
invoked; there is no sprint watcher.

## Prerequisites

* Use the updated full plugin and Node.js 22.20+ or 24+.
* Onboard the target repository before planning. Read its catalog, backlog,
  architecture, plan, progress, and referenced designs.
* Configure the [hybrid template](../../hybrid/config.json) outside the target
  checkout. Replace its repository, Jira site, board, tests, and ownership with
  real values. Read the [operator guide](../../hybrid/README.md).
* Supply authorized Jira credentials through the configured environment
  references. Browser login alone does not authorize the REST client. Do not
  extract cookies, create tokens without approval, or paste secrets into chat.

## Quick start

Resolve the [runtime](../../hybrid/runtime.cjs) relative to the installed skill,
not a hard-coded plugin-cache path. Run from the target coordinator checkout:

```powershell
$runtime = '<absolute plugin path>\hybrid\runtime.cjs'
$config = '<absolute approved configuration path>'
node $runtime plan --config $config
```

No active sprint is an explicit error. Multiple active sprints require a choice.
Use `--sprint <id>` to select one. A planned sprint additionally requires the
explicit `allow_future` configuration; selection never starts it in Jira.

## Review the preview

1. Show the sprint, snapshot digest, Source ID mappings, ready stories, initial
   batches, and every blocker. Do not hide unmapped Jira issues.
2. Retain outside-sprint and omitted-feature prerequisites. A historical
   "complete at review" statement is not fresh repository evidence.
3. Resolve changed criteria/dependency coverage with the planner. Do not
   overwrite feature definitions or invent acceptance requirements.
4. Approve an explicit `story_ids` allowlist, parent features/designs, backend
   routes, ownership/resources, real checks, budgets, and environment gates.
5. Obtain approval to share the necessary story context with GitHub before any
   cloud dispatch. Keep raw comments, attachments, and credentials out of briefs.
6. Rerun the preview after configuration changes. `/hybrid-loop` begins only
   with the exact approved `snapshot_digest`.

## Parameters

| Parameter  | Default       | Meaning                                    |
|------------|---------------|--------------------------------------------|
| `--root`   | Current root  | Explicit target coordinator checkout       |
| `--config` | Required      | External, credential-free configuration    |
| `--sprint` | Active sprint | Explicit choice; future scope is opt-in    |

## Troubleshooting

Missing or conflicting Source IDs, absent criteria, changed parent coverage,
unknown prerequisites, and unsupported Jira fields are blockers. Resolve them
explicitly; do not bypass the existing model validator. HTTP, permission,
pagination, and rate-limit failures are errors, not empty backlogs.

The current adapter supports Jira Cloud, not Data Center. See the operator
guide for authentication, field discovery, and rollout limitations.

> Brought to you by solution-harness
