---
title: Solution Harness implementation progress
description: Delivery and validation records for changes to the harness plugin.
---

## 2026-10-31 - Local parallel story execution

* Implemented version 1.1.0 planning and local execution for parallel stories
  within one approved feature. Sequential execution remains the default.
* Added versioned backlog validation, parent-criterion traceability, feature and
  architecture prerequisites, conservative ownership/resource batching, and
  explicit design, instruction-migration, and workspace-isolation approvals.
* Added isolated branches/worktrees, coordinator locking, fenced attempts,
  leases, run-wide budgets, bounded checks, private reports, and serialized
  exact-commit evaluation/integration.
* Required independent full-feature review before publishing status, story
  evidence, and appended progress. Added pause, retry/release, interrupted
  promotion recovery, cancellation, and non-forced cleanup.
* Added `/plan-execution` and `/parallel-loop`, assignment-aware local hooks,
  narrow builder/evaluator/coordinator protocols, initialization/onboarding
  guidance, an additive installer, and the [operator guide](../parallel/README.md).
* Preserved hosted single-feature behavior. The cloud bundle still contains
  18 skills and excludes both local-only skills.
* Validated compatibility with the application backlog read-only: 79 features,
  272 stories, and 351 graph nodes. No application files or live infrastructure
  were modified by this implementation.
* Validated 36 distinct local parallel cases and 18 existing cloud tests on
  Windows with Node.js 24.22.0. The combined run passed; after removing a duplicate
  nested test registration, both affected boundary cases passed a focused rerun.
  One existing cloud file-symlink test was explicitly excluded after the unfiltered baseline and
  combined runs both failed at symlink creation with Windows `EPERM`. Its
  assertions and Linux coverage remain unchanged; the new junction-parent
  refusal test passed on Windows.
* Validated source syntax, imports, JSON, packaging boundaries, hook routing,
  ESM installation, concurrent process claims, the three-worker ceiling, and
  secret-free runtime receipts. Added Windows/Linux CI on Node.js 22.20 and 24;
  that CI matrix has not yet been executed remotely.
* Deferred automatic worker launch, multi-feature scheduling, hosted
  parallelism, distributed locking, and model/token metering. Workers and
  evaluators require separately opened, verified workspaces; worktrees and
  hooks are not a security sandbox.

The plugin repository has no feature catalog to mark complete. This entry records
the requested harness change without creating or changing application features.

## 2026-11-03 - Cloud-built parallel stories

* Added the opt-in /cloud-parallel workflow for up to three independent GitHub
  cloud story tasks across approved features, without installing a runtime into
  the target repository. Reused the existing story graph, ownership, and checks.
* Added local exact-commit evaluation, serial SHA-guarded PR merges, current-base
  checks, merge reconciliation, full-feature review, and post-merge local status
  publication. Ambiguous task creation and merging require explicit recovery.
* Added privacy-preserving local hook routing and mutually exclusive local/cloud
  coordinator runs. Existing hosted cloud-loop behavior remains the default;
  already installed cloud hooks require an explicit story-mode migration.
* Added 22 mocked-GitHub and real-Git integration cases. All passed on Windows
  with Node.js 22.20.0 and 24.22.0. On Node.js 24, 18 existing cloud cases
  and nine targeted local-parallel regressions passed; five scheduler and
  packaging checks also passed on Node.js 22. The existing Windows file-symlink case was
  excluded because it fails at symlink creation with EPERM. An unfiltered
  baseline did not finish within 12 minutes and was stopped.
* Verified the installed GitHub CLI 2.103.3 command options without launching a
  hosted task. The local default PATH still resolves Node.js 12 and does not
  include GitHub CLI; users must provide supported versions on the agent PATH.
  Hosted agent behavior and the new Windows/Linux CI matrix remain unverified.

## 2026-11-03 - Manual Jira hybrid execution

* Added version 1.3.0 with `/jira-plan`, `/hybrid-loop`, and `/jira-sync`.
  Execution is manually triggered; no sprint watcher, webhook listener, or
  automatic Jira sprint start was added.
* Added authorized Jira Cloud reads with current pagination, ADF normalization,
  stable Source IDs, criterion/dependency reconciliation, and explicit active or
  approved future-sprint selection. Existing repository definitions remain
  authoritative for readiness and retained external prerequisites.
* Extended the existing cloud coordinator's ledger into one opt-in hybrid
  authority. Added a story allowlist, global backend/resource ownership, shared
  start exclusion, isolated local workspaces and attached CLI processes, fenced
  reports, absolute budgets/leases, local PR publication, and independent
  exact-head/current-base evaluation.
* Added no-code verification evidence, selected-story delivery review,
  partial-feature-safe metadata publication, interrupted-publication recovery,
  guarded base updates, and separately approved idempotent Jira evidence and
  workflow transitions. Required repository approvals remain in force.
* Wired assigned agent protocols, argument-free hook receipts, operator
  documentation, version metadata, and Windows/Linux CI. The hosted
  single-feature bundle still contains 18 skills and excludes the new local
  workflows. The cloud installer remains optional for fresh GH CLI-driven
  targets and available for standalone hosted users.
* Added root ignore rules for local credentials, dependencies, validation
  output, temporary executor fixtures, and generated trajectory logs while
  preserving environment templates and project configuration.
* Validated all 68 distinct new/updated cases on Node.js 24.21.0: 33 Jira
  adapter, 26 local executor, and nine hybrid integration cases. The combined
  run passed 67; its unrelated-process fixture expired naturally under load.
  Extending that fixture's bounded lifetime made the focused timeout-isolation
  rerun pass without changing production shutdown behavior.
* All 36 existing local-parallel and 22 existing cloud-parallel cases passed.
  All 18 applicable hosted-cloud cases passed. The existing Windows symlink
  case reproduced its documented EPERM at fixture creation and was explicitly
  excluded from the hosted compatibility rerun; its source and Linux coverage
  are unchanged. Syntax/imports, JSON/version alignment, packaging, secret-free
  configuration, and the absence of watcher APIs were also checked.
* No live Jira data, application files, cloud jobs, production resources, or
  remote Git history were changed. Actual Copilot CLI isolation, hosted-agent
  behavior, Jira workflow permissions, account entitlements, and the remote CI
  matrix still require an approved pilot. The default terminal Node remains
  version 12, and no Copilot executable was found on PATH; provision supported
  tools and credentials before use.

The plugin has no feature catalog to update. Application Source IDs and plans
were not generated or modified by this implementation.
