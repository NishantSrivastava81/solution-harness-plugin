# Solution Harness — Copilot Agent Plugin

A single-install plugin that provides everything you need to build, refactor, and maintain solutions with GitHub Copilot.

## What's Included

| Component | Count | Contents |
|-----------|-------|----------|
| **Agents** | 7 | ideator, planner, architect, builder, evaluator, reviewer, janitor |
| **Skills** | 16 | /init-solution, /onboard, /add-features, /design-feature, /refine-design, /refactor, /fix-issue, /sync-plan, /next-feature, /evaluate, /pre-commit, /status, /log-progress, /harness-health, /testing, /architecture-check |
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

### Option C: Marketplace
If published to a plugin marketplace, search `@agentPlugins` in the Extensions view.

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
│   └── janitor.agent.md                # Drift detection & cleanup
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
│   └── architecture-check/SKILL.md   # /architecture-check — boundary verification
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
│   └── trajectory.jsonl                # Agent action log (auto-captured)
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

## Principles Applied

| Principle | Source | How |
|-----------|--------|-----|
| Separate generation from evaluation | Anthropic | Builder + Evaluator are distinct agents |
| Work incrementally | Anthropic | One feature at a time, tracked in FEATURES.json |
| File-based session state | OpenAI | PROGRESS.md + FEATURES.json = agent memory |
| Build to delete | Schmid | Every component independently removable; /harness-health audits |
| Feedforward + feedback controls | Fowler | Instructions steer before; evaluator + hooks correct after |
| Harness as dataset | Schmid | PostToolUse hook logs trajectories |
| Entropy control | OpenAI | Janitor agent detects drift |

## Requirements

- VS Code with GitHub Copilot
- Node.js (for hooks)
- Git (recommended)
