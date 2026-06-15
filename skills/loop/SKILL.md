---
name: loop
description: "Run a goal-bounded autonomous loop over the harness — select, build, verify, and commit features one at a time with a maker/checker split, an explicit stop-contract, and a per-run token/commit budget. Best run in the orchestrator agent."
---

# Loop

Turn the harness from a human-driven pipeline into a **goal-bounded autonomous loop**.
Instead of you typing `/next-feature` → switch to builder → build → switch to evaluator
on every cycle, the loop does it: it selects the next in-scope item, dispatches a builder
to make it, dispatches an evaluator to check it, and commits only on a green verdict —
repeating until the goal is met or a stop condition fires.

> Run this inside the **orchestrator** agent. The orchestrator supplies the maker/checker
> discipline and the safety principles; this skill supplies the procedure, the contract,
> and the budget files.

## Prerequisites
- `docs/FEATURES.json` must exist (run `/init-solution` or `/onboard` first).
- The test suite should pass at the start (the loop refuses to run on a red baseline).

## Step 1: Establish the Loop Contract (`docs/LOOP.md`)

The contract is the loop's `/goal` — a **verifiable end state**, the scope it may touch,
how autonomously it may run, and where it must stop. If `docs/LOOP.md` does not exist,
create it from this template and confirm it with the user before any build:

```markdown
# Loop Contract

## Goal (verifiable end state)
<!-- NOT "make it better". Something a test or the evaluator can confirm. -->
e.g. "All F-prefixed features are `complete`, the full test suite is green, and the
evaluator returns PASS for each."

## Trigger
Manual — invoked via /loop in the orchestrator agent.

## Scope (in-scope feature IDs)
- Include: [F001–F006]   <!-- or "all F", "all R", a named list -->
- Exclude: [anything not listed; no new features; no edits outside the active feature's files]

## Autonomy Level
L1 (report-only)   <!-- L1 = pause after each iteration for approval (default)
                        L2 = auto-commit within scope, stop on escalation/budget
                        L3 = unattended; only for narrow, highly-verifiable scopes -->

## Verification (what can say "no")
- Independent evaluator subagent verdict (PASS/FAIL per feature)
- Full test suite green
- /pre-commit passes before any commit

## Memory
- docs/FEATURES.json — work queue + status
- docs/PROGRESS.md — narrative log
- docs/loop-run-log.md — per-iteration ledger
- docs/loop-budget.md — live budget counters

## Escalation (stop and hand back when…)
- A dependency is blocked or unmet
- Acceptance criteria are ambiguous/untestable
- Progress would require out-of-scope edits (scope creep)
- A feature fails evaluation twice with the same root cause
- The loop is uncertain

## Triage Inbox
<!-- The loop writes escalated/blocked/twice-failed items here for the human. -->
(empty)
```

## Step 2: Initialize the Budget (`docs/loop-budget.md`)

The budget is a control surface, not a guess. Loop engineering's most common failure
is runaway cost — a loop that mass-produces commits until it drifts off-task. Create
this file with caps and zeroed counters; the loop updates the counters every iteration
and **hard-stops** when any cap is hit:

```markdown
# Loop Budget — run started [ISO timestamp]

| Control | Cap | Used |
|---------|-----|------|
| Iterations | 10 | 0 |
| Commits | 15 | 0 |
| Rework per feature | 2 | — |
| Wall-clock (min) | 60 | 0 |

## Hard-kill rule
When any **Used** reaches its **Cap**, stop immediately and report. Do not run "one more".
```

Defaults are conservative on purpose. Adjust caps with the user before starting; tighten
them for L3.

## Step 3: Pre-flight

1. Read `FEATURES.json`, `PROGRESS.md`, `PLAN.md`, `ARCHITECTURE.md`.
2. Run the test suite to establish a **green baseline**. If it's red, stop — restore
   green (hand to builder) before looping. A loop can't tell its own regressions from
   pre-existing breakage on a red baseline.
3. Create `docs/loop-run-log.md` with a header if it doesn't exist.

## Step 4: Run the Iteration Cycle

Repeat until a stop condition fires. Check stop conditions **first**, every time.

```
┌─ CHECK STOP-CONTRACT ── any fire? → go to Step 5 (Terminate)
│
├─ SELECT      next-feature logic, restricted to in-scope IDs
│              (needs-rework first, then not-started; none left → SUCCESS)
├─ DESIGN?     if non-trivial and no design_doc → planner subagent runs /design-feature
├─ BUILD       builder subagent (MAKER) writes code + tests, updates FEATURES.json
├─ VERIFY      evaluator subagent (CHECKER) grades THIS feature + runs tests
├─ DECIDE      PASS → /pre-commit → commit → mark complete → commit++
│              FAIL → mark needs-rework → rework++ → record root cause
│                     (same root cause twice → ESCALATE, no third try)
│              REGRESSION not fixable in one iteration → ESCALATE
├─ RECORD      append iteration entry to loop-run-log.md; update loop-budget.md
└─ GATE        L1 → STOP and present result for approval
               L2/L3 → loop back
```

**Maker/checker is non-negotiable**: the builder that writes a feature never grades it.
A separate evaluator subagent does. That separation is what makes "complete" trustworthy.

### Run-log entry (append per iteration)
```markdown
### Iteration N — [ISO timestamp]
- **Feature**: F### — [name]
- **Action**: build → verify → (commit | rework | escalate)
- **Evaluator verdict**: PASS | FAIL — [root cause if FAIL]
- **Tests**: [pass/total]
- **Commit**: [sha] feat(F###): … | (none)
- **Budget**: iter N/MAX · commits C/MAX · rework R/MAX
- **Notes**: [scope checks, regressions, notable events]
```

## The Stop-Contract

| Class | Conditions |
|-------|-----------|
| **SUCCESS** | All in-scope items `complete` · tests green · evaluator PASS for each |
| **HARD KILL** | iterations ≥ cap · commits ≥ cap · a feature hit rework cap (same root cause twice) · any budget counter past cap · unrecoverable regression · a destructive action blocked by the PreToolUse hook |
| **ESCALATE** | blocked/unmet dependency · ambiguous criteria · scope creep (edits outside the active feature) · loop is uncertain |

When in doubt → **stop and report**. A stopped loop makes no unattended mistakes.

## Step 5: Terminate and Report

1. Append a **Loop Summary** to `docs/PROGRESS.md`:
   ```markdown
   ## Loop Run Summary — [date]
   - **Outcome**: SUCCESS | HARD KILL ([which cap]) | ESCALATED
   - **Iterations**: N   **Commits**: C
   - **Completed this run**: [F###, F###, …]
   - **Needs-rework / escalated**: [F### — root cause]
   - **Budget**: iterations C/MAX · commits C/MAX · wall-clock M/MAX
   - **Comprehension debt**: read these diffs → [commit shas]
   - **Next**: [resume /loop after triage | switch to builder | done]
   ```
2. Move escalated/blocked/twice-failed items into the **Triage Inbox** in `docs/LOOP.md`,
   each with a root cause and a suggested next step.
3. Echo the summary in chat. Always tell the user which commits to review — the loop
   ships code they didn't write, and the goal is for them to **stay the engineer**.

## Rules
- One feature per iteration. Never touch multiple feature IDs in a single iteration.
- No green, no commit. Evaluator PASS **and** green tests are both required.
- Default autonomy is **L1**. Escalate to L2/L3 only when the contract says so.
- Honor the budget. A cap hit means stop and report — not "one more".
- Stay in scope. If progress needs out-of-scope edits, escalate; don't expand the loop.
- Keep the files current every iteration so the loop survives a context reset.
