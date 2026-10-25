---
name: cloud-loop
description: "Execute one approved Solution Harness feature in GitHub Copilot cloud agent with a baseline, separate builder/evaluator, bounded rework, final tests, and durable PR checkpoints. Use for cloud implementation tasks, not an interactive local loop."
---

# One-Feature Cloud Loop

Use this workflow in the cloud orchestrator. The local loop skill remains for
interactive IDE use; never expand this cloud run into a multi-feature loop.

## Contract

- The initiating task names one feature in docs/FEATURES.json.
- The human-approved .github/harness/config.json allowlists the feature and
  defines real verification commands, at least one of kind test.
- Existing harness state, acceptance criteria, architecture, and dependencies
  must be available before building. Run onboarding as a separate task if needed.
- max_minutes is measured from sessionStart, defaults to 40, and cannot exceed
  45. max_rework defaults to one corrective builder attempt.
- Missing inputs require a reported blocker, not an IDE question dialog or
  invented approval. Do not weaken or modify the contract during the run.

## Procedure

1. `node .github/harness/runtime.cjs begin F001` using the task's actual ID.
2. `node .github/harness/runtime.cjs verify baseline` before source edits.
3. Invoke builder through the custom-agent tool for this feature only.
4. Invoke a separate evaluator. It must return its profile's strict JSON report.
5. `node .github/harness/runtime.cjs status` to inspect actual subagent receipts.
6. `node .github/harness/runtime.cjs verify final` after independent PASS.
7. If necessary and within budget, repeat builder, evaluator, and final checks
   once. Never self-grade or continue when the same root cause repeats.
8. `node .github/harness/runtime.cjs finish pass` only when the gates succeed.
   Otherwise finish as blocked or needs-rework with a concrete quoted reason.

The runtime refuses completion with missing or stale evidence, changed criteria
or configuration, exhausted budgets, or failed checks. After any code change,
obtain a new builder/evaluator pair and rerun final verification.

## Checkpoint

Finish writes docs/FEATURES.json, docs/PROGRESS.md, docs/EVALUATION.md, and
docs/loop-run-log.md. Review those alongside the code. Runtime receipts and
argument-free event logs are ephemeral and gitignored; they are not a shared
queue or a replacement for GitHub's session logs.

Let cloud agent manage commits and PR creation. Human review/merge and required
CI remain authoritative. Never claim that a blocked or partial run succeeded.