---
name: plan-execution
description: "Plan dependency-aware story batches and ownership for local parallel work. Dry-run only; never launches workers."
---

# Plan Execution

Prepare an executable story plan without changing delivery status or launching
agents. This skill is local-only; hosted projects continue to use `cloud-loop`.

## Prerequisites

* Read the project's feature catalog, progress, plan, architecture, and existing backlog.
* Use the installed local parallel runtime with Node.js 22.20+ or 24+.
* If it is absent, obtain approval to run the plugin's
  `scripts/install-parallel.cjs --dry-run <project-root>`, review conflicts, then
  install. Read the resulting `.github/harness/parallel/README.md`.

## Quick start

1. Keep the feature catalog authoritative. Reuse an existing epic/feature/story
   backlog; do not replace feature definitions or flatten away source evidence.
2. With the user's approval, decompose only the requested feature's missing
   stories. Use version 1 of the installed backlog schema. Assign stable IDs,
   testable criteria, parent-criterion indexes, and explicit dependencies.
3. Identify design questions, human/environment gates, shared files, test
   resources, and ownership boundaries. Do not claim that separate branches
   eliminate logical or infrastructure conflicts.
4. Propose scoped `allowed_paths` and resource locks in the parallel config.
   Keep `mode: sequential` until execution is explicitly approved. Do not
   self-approve designs, migration, or workspace isolation.
5. Run the planner and explain its batches and blockers. Do not invent a
   different queue that bypasses its feature or architecture prerequisites.

## Parameters

| Parameter   | Default                  | Meaning                                  |
|-------------|--------------------------|------------------------------------------|
| `--feature` | All incomplete features  | Limit the derived plan to one feature    |
| `--root`    | Current project root     | Read-only project selection              |

## Script reference

From the project root:

```powershell
node .github\harness\parallel\runtime.cjs plan --feature F001
```

The output is hypothetical within-feature batches, not permission to dispatch
multiple features. Save a derived execution-plan artifact only if requested.
Use `/parallel-loop` for an explicitly approved local run.

## Troubleshooting

Cycles, unknown dependencies, missing criterion coverage, or missing done-story
evidence are planning errors. Missing ownership, architecture gates, and
unapproved designs are blockers, not reasons to weaken validation. Ask the user
to resolve ambiguous scope or product decisions before changing source plans.
