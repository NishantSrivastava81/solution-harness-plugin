# Solution Harness — Copilot Agent Plugin

A single-install plugin that provides everything you need to build, refactor, and maintain solutions with GitHub Copilot.

## What's Included

| Component | Count | Contents |
|-----------|-------|----------|
| **Agents** | 8 | ideator, planner, architect, builder, evaluator, reviewer, janitor, orchestrator |
| **Skills** | 17 | /init-solution, /onboard, /add-features, /design-feature, /refine-design, /refactor, /fix-issue, /sync-plan, /next-feature, /evaluate, /pre-commit, /status, /log-progress, /harness-health, /testing, /architecture-check, /loop |
| **Hooks** | 4 | SessionStart (inject status), Stop (enforce progress log), PreToolUse (block dangerous commands), PostToolUse (trajectory logging) |

## Install

### Option A: From Git URL
In VS Code, run `Chat: Install Plugin From Source` from the Command Palette and enter the repo URL.

### Option B: Local
Clone this repo, then add to your VS Code settings:
```json
{
  "chat.pluginLocations": {
    "C:/path/to/solution-harness-plugin": true
  }
}
```



## Usage

### New Project
1. Open an empty folder in VS Code
2. **(Optional)** Switch to the **ideator** agent — brainstorm scope, research similar solutions, define MVP, produce docs/SPEC.md. Click **"Initialize Project from Spec"** when ready.
3. Switch to the **planner** agent → `/init-solution`
4. **(Recommended)** Switch to the **architect** agent — research tech stack, design data model, define module boundaries, establish cross-cutting patterns. Produces a thorough docs/ARCHITECTURE.md.
5. Switch to **builder** agent → `/next-feature` → `/design-feature` → build → `/evaluate`

### Existing Project
1. Open your project in VS Code
2. Switch to the **planner** agent
3. Type `/onboard` — analyzes your codebase, generates all harness state files
4. Then:
   - `/add-features` to plan new capabilities
   - `/design-feature` to research patterns and create technical design before building
   - `/refactor` to plan improvements
   - `/fix-issue` to diagnose and fix bugs
5. Switch to **builder** → `/next-feature` → build → `/evaluate`

### Daily Workflow
```
/next-feature          → see what to build
/design-feature        → research patterns, create technical design
/refine-design         → provide feedback, iterate on the design
[switch to builder]    → implement it
/pre-commit            → validate before committing
/log-progress          → record what was done
/evaluate              → quality check
/status                → dashboard view
```

### Maintenance
```
[switch to janitor]    → detect drift, dead code, staleness
/harness-health        → audit if harness components are still needed
/architecture-check    → verify module boundaries
```

### Autonomous Loop
Instead of driving each cycle by hand, let the **orchestrator** run the pipeline for you.
It selects the next in-scope feature, dispatches a **builder** to make it and a separate
**evaluator** to check it, and commits only on a green verdict — repeating until the goal
is met or a stop condition fires.
```
[switch to orchestrator] → /loop
```
The loop is governed by three things it writes into your workspace:
- **docs/LOOP.md** — the loop contract: verifiable goal, in-scope feature IDs, autonomy
  level, verification gates, and escalation rules (the `/goal` primitive).
- **docs/loop-budget.md** — per-run caps (iterations, commits, rework-per-feature,
  wall-clock). When any cap is hit, the loop stops and reports — no runaway commits.
- **docs/loop-run-log.md** — an append-only, per-iteration ledger of what was built,
  the evaluator verdict, tests, and the commit.

**Autonomy levels** (set in the contract): **L1** report-only (pause for approval after
each iteration, the default) → **L2** assisted (auto-commit within scope) → **L3**
unattended (narrow, highly-verifiable scopes only). The builder (maker) and evaluator
(checker) are always separate subagents — the loop never grades its own work.

## Plugin Structure

```
solution-harness-plugin/
├── plugin.json                          # Plugin manifest
├── agents/
│   ├── ideator.agent.md                # Brainstorm & refine ideas before planning
│   ├── planner.agent.md                 # Idea → Plan
│   ├── architect.agent.md               # System-level architecture & tech decisions
│   ├── builder.agent.md                 # Plan → Code (one feature at a time)
│   ├── evaluator.agent.md              # Code → Quality grade (skeptical)
│   ├── reviewer.agent.md               # Security & architecture review
│   ├── janitor.agent.md                # Drift detection & cleanup
│   └── orchestrator.agent.md           # Loop driver — runs the pipeline autonomously
├── skills/
│   ├── init-solution/SKILL.md          # /init-solution — new project setup
│   ├── onboard/SKILL.md               # /onboard — existing project setup
│   ├── add-features/SKILL.md          # /add-features — plan new capabilities
│   ├── design-feature/SKILL.md       # /design-feature — research & design before building
│   ├── refine-design/SKILL.md        # /refine-design — iterate on design with feedback
│   ├── refactor/SKILL.md              # /refactor — plan improvements
│   ├── fix-issue/SKILL.md             # /fix-issue — diagnose & fix bugs
│   ├── sync-plan/SKILL.md             # /sync-plan — realign features after architecture changes
│   ├── next-feature/SKILL.md          # /next-feature — what to build next
│   ├── evaluate/SKILL.md             # /evaluate — quality evaluation
│   ├── pre-commit/SKILL.md           # /pre-commit — validate before commit
│   ├── status/SKILL.md               # /status — project dashboard
│   ├── log-progress/SKILL.md         # /log-progress — record session progress
│   ├── harness-health/SKILL.md       # /harness-health — harness self-assessment
│   ├── testing/SKILL.md              # /testing — test patterns & runners
│   ├── architecture-check/SKILL.md   # /architecture-check — boundary verification
│   └── loop/SKILL.md                 # /loop — autonomous goal-bounded build loop
├── hooks/
│   └── hooks.json                     # Lifecycle hook configuration
└── scripts/
    ├── session-start.js               # Inject project status at session start
    ├── session-stop.js                # Enforce progress logging before stop
    ├── pre-tool-use.js                # Block dangerous terminal commands
    └── post-tool-use.js               # Log agent trajectories
```

## What Gets Created in Your Workspace

When you run `/init-solution` or `/onboard`, the skill creates workspace-specific files:

```
your-project/
├── AGENTS.md                           # Table of contents for agents
├── .github/
│   ├── copilot-instructions.md         # Coding standards (always-on)
│   └── instructions/
│       ├── docs-protection.instructions.md
│       └── test-standards.instructions.md
├── docs/
│   ├── IDEA.md                         # Original idea (immutable)
│   ├── PLAN.md                         # Product specification
│   ├── FEATURES.json                   # Feature tracking (session state)
│   ├── PROGRESS.md                     # Append-only session log
│   ├── ARCHITECTURE.md                 # Module boundaries & decisions
│   ├── trajectory.jsonl                # Agent action log (auto-captured)
│   ├── LOOP.md                         # Loop contract: goal, scope, autonomy, escalation (/loop)
│   ├── loop-budget.md                  # Per-run caps & live counters (/loop)
│   └── loop-run-log.md                 # Per-iteration ledger (/loop)
├── src/
└── tests/
```

## Feature ID Conventions

| Prefix | Use |
|--------|-----|
| `E` | Existing features (documented during /onboard) |
| `F` | New features (/init-solution or /add-features) |
| `R` | Refactoring tasks (/refactor) |
| `B` | Bug fixes (/fix-issue) |



## Requirements

- VS Code with GitHub Copilot
- Node.js (for hooks)
- Git (recommended)
