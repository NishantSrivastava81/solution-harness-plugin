---
title: Solution Harness Copilot Agent Plugin
description: Agents, skills, hooks, and execution controls for incremental software delivery with GitHub Copilot.
---

A single-install plugin that provides everything you need to build, refactor, and maintain solutions with GitHub Copilot.

## What's Included

| Component | Count | Contents |
|-----------|-------|----------|
| **Agents** | 8 | ideator, planner, architect, builder, evaluator, reviewer, janitor, orchestrator |
| **Skills** | 24 | /init-solution, /onboard, /add-features, /design-feature, /frontend-design, /refine-design, /refactor, /fix-issue, /sync-plan, /next-feature, /evaluate, /pre-commit, /status, /log-progress, /harness-health, /testing, /architecture-check, /loop, /plan-execution, /parallel-loop, /cloud-parallel, /jira-plan, /hybrid-loop, /jira-sync |
| **Hooks** | 5 | sessionStart (inject status), agentStop (progress/assignment gates), subagentStop (assigned reports), preToolUse (command/ownership checks), postToolUse (argument-free receipts) |

## Install

Version 1.5 uses the canonical **Agent Plugins 1.0** format for the shared
Copilot runtime in VS Code and Copilot CLI. Select **Copilot** as the VS Code
Session Target. Skills stay under `skills/`; agents and hooks use the
`com.github.copilot/` namespace. The package no longer depends on Local-only
tool names or handoff buttons.

Use a supported Node.js 22.20+ or 24+ on the PATH inherited by the agent host,
hooks, and CLI processes. Terminal changes alone do not update an already
running host's environment.

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

### Option C: GitHub Copilot Cloud Agent (Pilot)

To enable the published plugin's skills and profiles natively, add the following
to the **application repository's** `.github/copilot/settings.json`, preserving
other settings:

```json
{
  "extraKnownMarketplaces": {
    "solution-harness-marketplace": {
      "source": {
        "source": "github",
        "repo": "NishantSrivastava81/solution-harness-plugin"
      }
    }
  },
  "enabledPlugins": {
    "solution-harness@solution-harness-marketplace": true
  }
}
```

Publish and verify the migrated marketplace before using these defaults.
Enabling a plugin does not launch work, install project dependencies, approve
designs, or create the standalone cloud-loop runtime. Local Jira/parallel
coordinators remain local-only. Confirm cloud component availability in the
actual job; local plugin installation is not automatically copied there.

The installer below is an **optional standalone cloud-loop distribution**, not
the only way to give a GH CLI-dispatched task plugin context. Use it when you
want its dedicated hosted profiles, run state, hooks, and verification setup.

Install the cloud distribution into a target Git repository with Node.js 22+:

```sh
node scripts/install-cloud.cjs --dry-run /path/to/your-project
node scripts/install-cloud.cjs /path/to/your-project
```

This adds native `.github/agents`, `.github/skills`, `.github/hooks`, and a
Copilot setup workflow. Existing project instructions are untouched; existing
setup/config files are preserved, and other differing destinations stop the
installation before writing. The local plugin is unchanged.

Before delegating, approve feature IDs and real test commands in the installed
`.github/harness/config.json`, add project dependency setup, and merge the
customizations into the target's default branch. Then select **orchestrator**
in GitHub's Agents UI or issue assignment dialog:

> Implement F001 only using cloud-loop. Obtain an independent evaluator verdict,
> run all configured checks, and open a draft pull request. Stop on a blocker.

The pilot supplies three cloud profiles (orchestrator, builder, evaluator), the
18 shared skills, including frontend-design, and a dedicated cloud-loop skill. It runs one approved
feature per session with bounded rework, real test gates, and durable reports.
It is not a multi-feature scheduler, and local tests do not prove hosted-agent
behavior. See [the cloud setup and acceptance guide](cloud/README.md) for details.

Run the dependency-free installer/runtime tests with:

```sh
node --test tests/cloud.test.cjs
```



## Usage

### CLI installation and migration

Install a local development checkout with:

```powershell
copilot plugin install 'D:\path\to\solution-harness-plugin'
copilot plugin list --json
```

For the published marketplace:

```powershell
copilot plugin marketplace add NishantSrivastava81/solution-harness-plugin
copilot plugin install solution-harness@solution-harness-marketplace
```

The catalog is published at `.github/plugin/marketplace.json`, with the stable
marketplace name `solution-harness-marketplace`. Direct plugin installations
and marketplace registrations are different operations.

Before updating an active installation, pause and reconcile coordinator work,
back up any customized project files, and start a fresh Copilot session after
updating. Do not patch installation caches or enable old and migrated hooks
together. Reinstall a path-sourced development copy when the client caches it.
For VS Code, use **Chat: Update Plugins** or the Customizations editor and
verify enabled components in the intended harness.

Agent Plugins format migration is not merely adding `$schema`: component
locations, tool/delegation semantics, and hook contracts changed together.
The older VS Code Local harness's handoff buttons are intentionally replaced
with explicit agent selection; model selection alone does not test migration.

### New Project
1. Open an empty folder in VS Code
2. **(Optional)** Switch to the **ideator** agent — brainstorm scope, research similar solutions, define MVP, produce docs/SPEC.md. Select **planner** and run `/init-solution` when ready.
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

### Local Parallel Stories

Version 1.1.0 adds opt-in parallel stories within one approved feature. Run
`/plan-execution` for dependency/resource-aware dry-run batches, then
`/parallel-loop` for coordinator-controlled worktrees, independent exact-commit
review, and serial integration. Sequential `/loop` remains the default.

Install the local runtime from this plugin checkout:

```powershell
node scripts\install-parallel.cjs --dry-run 'C:\work\project'
node scripts\install-parallel.cjs 'C:\work\project'
```

Use Node.js 22.20+ or 24+. Review instruction migration, real verification commands,
ownership, and approvals before starting. Workers must be opened in separate
verified workspaces; terminal `cwd` is not editing-tool isolation. Automatic
worker launch, multi-feature scheduling, and hosted parallelism are deferred.
The cloud installer excludes the local-only coordinator skills.

See the [local execution and recovery guide](parallel/README.md) for the story
schema, command sequence, operator approvals, limits, and cleanup. Runtime tests:

```powershell
node --test tests\parallel.test.cjs
```

### Cloud-built Parallel Stories

Use the local orchestrator with `/cloud-parallel` to dispatch independent
stories through GitHub CLI. Cloud agents build separate PRs; a separate local
evaluator reviews exact commits and the coordinator integrates them serially.
The workflow is opt-in and does not require the local parallel installer.

Use GitHub CLI 2.80+ with an eligible Copilot plan, Node.js 22.20+ or 24+,
Git, approved story scopes, real verification commands, and repository review
protections. See the [cloud parallel skill](skills/cloud-parallel/SKILL.md) for
configuration, guarded merge, and recovery. Run the coordinator tests with
`node --test tests\cloud-parallel.test.cjs`.

### Manual Jira Hybrid Execution

Version 1.3 adds an opt-in manually triggered Jira Cloud workflow. Run
`/jira-plan` to read the selected sprint and reconcile Source IDs, criteria,
dependencies, designs, and ownership with the full repository backlog. Approve
the snapshot and story allowlist, then use `/hybrid-loop` for mixed cloud/local
developers, independent local evaluation, and serial protected integration.
There is no sprint watcher or automatic Jira sprint start.

Local workers use separate verified workspaces or attached, bounded Copilot CLI
processes with reviewed scoped permissions. Verification-only work uses
baseline-bound evidence rather than a fabricated PR. Full parent-feature
completion remains separate from sprint-subset delivery.

`/jira-sync` optionally publishes accepted evidence and explicitly mapped
workflow transitions; it is separately approved and disabled by default.
Browser login does not authorize API clients. Configure credentials through
environment references, never in source, prompts, or receipts.

See the [manual Jira hybrid guide](hybrid/README.md) and
[configuration template](hybrid/config.json). Existing standalone execution
modes remain unchanged, and the hosted single-feature bundle excludes all three
new local coordinator skills.

```powershell
node --test tests\jira.test.cjs tests\hybrid-local.test.cjs tests\hybrid.test.cjs
```

### UI and UX Design

Version 1.4 adds [frontend-design](skills/frontend-design/SKILL.md) for user
journeys, deliberate visual design, existing component/token reuse, responsive
layouts, interaction states, accessibility, and rendered browser verification.
It is original harness guidance informed by the
[linked design reference](https://agenticskills.io/skills/frontend-design),
not a vendored third-party prompt.

Use `/frontend-design` directly, or let the builder load it for UI work.
`/design-feature` uses its designer workflow; independent evaluators apply its
read-only review guidance. Existing story ownership, design approvals, and
report schemas remain unchanged. Non-UI work does not acquire UI requirements.

GH CLI-dispatched cloud and hybrid local developers receive the same bundled
guidance in their briefs; hybrid CLI evaluators receive it in evaluator mode.
This needs neither the cloud installer nor access to the reference website.
The standalone hosted distribution includes the skill as well (19 skills total).
Existing hosted installations require the usual reviewed bundle update.

For example:

```text
/frontend-design
Build this story's customer picker with the existing portal design system.
Verify keyboard navigation, loading/error/empty states, and mobile layouts.
```

Reload the updated plugin to discover the new skill. Prompt and packaging tests:

```powershell
node --test tests\frontend-design.test.cjs
```

## Plugin Structure

```
solution-harness-plugin/
├── plugin.json                          # Canonical Agent Plugins 1.0 manifest
├── .github/plugin/marketplace.json       # Named marketplace catalog
├── com.github.copilot/
│   ├── hooks/hooks.json                 # Versioned shared Copilot hook configuration
│   └── agents/
│       ├── ideator.agent.md            # Brainstorm & refine ideas before planning
│       ├── planner.agent.md            # Idea → Plan
│       ├── architect.agent.md          # System-level architecture & tech decisions
│       ├── builder.agent.md            # Plan → Code (one feature at a time)
│       ├── evaluator.agent.md          # Code → Quality grade (skeptical)
│       ├── reviewer.agent.md           # Security & architecture review
│       ├── janitor.agent.md            # Drift detection & cleanup
│       └── orchestrator.agent.md       # Loop driver — runs the pipeline autonomously
├── skills/
│   ├── init-solution/SKILL.md          # /init-solution — new project setup
│   ├── onboard/SKILL.md               # /onboard — existing project setup
│   ├── add-features/SKILL.md          # /add-features — plan new capabilities
│   ├── design-feature/SKILL.md       # /design-feature — research & design before building
│   ├── frontend-design/SKILL.md      # /frontend-design - UI/UX design, implementation, review
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
│   ├── loop/SKILL.md                 # /loop — sequential goal-bounded build loop
│   ├── plan-execution/SKILL.md       # /plan-execution — local story dry-run planning
│   ├── cloud-parallel/SKILL.md       # /cloud-parallel - cloud builders, local review
│   └── parallel-loop/SKILL.md        # /parallel-loop — isolated local story execution
├── parallel/                          # Local model, coordinator, hooks, schema, and guide
└── scripts/
    ├── plugin-hook.cjs                # Native payload/output adapter and hook routing
    ├── install-parallel.cjs           # Add local runtime without replacing project instructions
    └── install-cloud.cjs              # Optional standalone hosted runtime distribution
```

The namespace hook entry translates native `toolName`/`toolArgs` and compatible
`Bash`/`Edit`/`Write` inputs into the existing assignment guards, and emits
top-level Copilot decisions/context. Ordinary receipts omit tool arguments and
results. Child completion checks assigned reports without pausing the parent
coordinator merely because a subagent returned.

Native plugin manifests, namespace components, marketplace declarations, and
repository Copilot settings are protected from assigned workers even when an
ownership glob would match them. Shared activation settings stay in source
control; personal `settings.local.json` overrides are ignored.

Hooks are not a security sandbox. Current Copilot command-hook timeouts continue
through normal permissions, and stop continuations have a runtime limit. Ensure
the runtime has its required paths, credentials, and tools, and validate actual
decisions in the selected harness. Passing schema/unit tests does not prove
host discovery or sandbox access.

Model-free contract tests:

```powershell
node --test tests\plugin.test.cjs tests\agents.test.cjs tests\frontend-design.test.cjs
```

References: [plugin authoring](https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference),
[hook migration](https://code.visualstudio.com/docs/agent-customization/migrate-customizations#_migrate-hooks),
[Copilot hook contracts](https://docs.github.com/en/copilot/reference/hooks-reference),
and [native cloud plugin settings](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/configuring-agent-settings).

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

### Local Plugin
- VS Code with GitHub Copilot
- Node.js (for hooks)
- Git (recommended)

### Cloud Pilot
- GitHub-hosted target repository with Copilot cloud agent enabled
- Node.js 22+ and Git for installation; Node 22+ in the cloud setup
- Approved feature scope, configured non-interactive tests, and project dependencies
- Human PR review/merge and required CI checks
- No running local IDE or persistent local machine required
