---
title: Solution Harness Copilot Agent Plugin
description: Native Copilot agents and skills for incremental delivery and guided GitHub and Jira workflows.
---

# Solution Harness

Solution Harness packages specialized agents and reusable skills for planning,
building, evaluating, reviewing, and maintaining software with GitHub Copilot.
It uses the Agent Plugins 1.0 layout: portable skills live under `skills/`, and
Copilot-specific agents live under `com.github.copilot/agents/`.

## What's included

| Component | Contents |
|-----------|----------|
| 8 agents | ideator, planner, architect, builder, evaluator, reviewer, janitor, orchestrator |
| Planning skills | `/init-solution`, `/onboard`, `/add-features`, `/design-feature`, `/refine-design`, `/refactor`, `/fix-issue`, `/sync-plan`, `/next-feature` |
| Delivery and review skills | `/frontend-design`, `/evaluate`, `/pre-commit`, `/status`, `/log-progress`, `/harness-health`, `/testing`, `/architecture-check` |
| Guided execution skills | `/loop`, `/plan-execution`, `/parallel-loop`, `/cloud-parallel`, `/cloud-loop`, `/jira-plan`, `/hybrid-loop`, `/jira-sync` |

Version 2.0 removes the legacy runtime, installers, and bundled hooks. Parallel,
cloud, and Jira workflows are now **guided, manual procedures**, not automated
schedulers. The operator must verify approvals, assignments, ownership, budgets,
reports, and integration. There are no bundled locks, leases, command guards,
automatic session-status injection, trajectory logging, or stop gates.
Copilot instructions are not a security boundary; use host permissions,
repository protections, required reviews, and CI for controls.

## Install

### VS Code

Select **Copilot** as the session target. Run **Chat: Install Plugin From
Source** and provide the repository URL, or add a local checkout to settings:

```json
{
  "chat.pluginLocations": {
    "C:/path/to/solution-harness-plugin": true
  }
}
```

Reload or update the plugin and start a fresh session. Verify that the expected
agents and skills are enabled in the selected host; availability can vary by
host and policy.

### Copilot CLI

With Copilot CLI installed, either install a local checkout:

```powershell
copilot plugin install 'C:\path\to\solution-harness-plugin'
copilot plugin list --json
```

Or install the published marketplace:

```powershell
copilot plugin marketplace add NishantSrivastava81/solution-harness-plugin
copilot plugin install solution-harness@solution-harness-marketplace
```

The marketplace is declared at `.github/plugin/marketplace.json`. The
published marketplace must contain this version before the remote install can
pick it up. `copilot` and `gh` are separate CLIs.

### GitHub Copilot cloud agent

Enable the published plugin in the **application repository's**
`.github/copilot/settings.json`, preserving any existing settings:

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

Commit the settings on the target repository's default branch, confirm that the
marketplace is accessible, and verify component availability in the actual
cloud session. Installing locally does not install the plugin in a cloud job.
Configure the target project's own dependency setup and tests separately.
See the [cloud guide](cloud/README.md).

## Workflows

### Start or onboard a project

For a new project, use `/init-solution` with the planner and optionally use the
ideator and architect first. For an existing codebase, use `/onboard`. Both
establish project-specific plans, feature state, progress, and instructions.
Use `/next-feature`, `/design-feature`, the builder, and `/evaluate` for
incremental delivery. `/frontend-design` supplies UI and accessibility guidance.

### Frontend design

Use [`/frontend-design`](skills/frontend-design/SKILL.md) for UI planning,
implementation, or review. It follows a proportional sequence: a design brief,
information architecture, purposeful visual direction and semantic tokens,
usable implementation, then rendered verification and structured critique.
It also covers stack-aware recommendations, consistent icons and interaction
states, and truthful, accessible charts and data tables when they are in scope.

```text
/frontend-design Design the account settings flow using existing components.
Map approved criteria to components and states; explain mobile behavior and
supported themes before implementation.

/frontend-design Review the approved settings candidate against its brief.
Report expected versus observed behavior with viewport, state, and test evidence.
```

The skill inventories existing components and styles rather than replacing the
design system. New themes, fonts, dependencies, and consequential design changes
still need approval. Designers use the existing feature-design document;
builders stay within owned paths; independent evaluators inspect the actual
candidate without editing it. No separate design workspace or new orchestration
is required.

The staged approach takes inspiration from
[Designer Skills](https://github.com/julianoczkowski/designer-skills) and
[UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), with
original guidance adapted to harness scope and reporting boundaries. Their
search tooling and databases are not bundled or required.

### SaaS-aware guidance

Existing skills consider tenant isolation, observability, usage, and B2B UX
where relevant. They guide, but do not enforce, project controls.

### Sequential loop

Run `/loop` in the orchestrator for a goal-bounded, one-feature-at-a-time
workflow. Agree on scope, verification, autonomy, and budgets first. The builder
and evaluator must be separate, and a passing verdict and real tests are
required before completion. The default autonomy level pauses for approval.

### Guided parallel and cloud work

Use `/plan-execution` to review dependencies and ownership, then explicitly
choose `/parallel-loop` for local worktrees or `/cloud-parallel` for GitHub
cloud tasks. One coordinator records assignments, checks exact candidates with
an independent evaluator, and integrates accepted changes serially. See the
[local guide](parallel/README.md).

For GitHub cloud work, `gh agent-task` is currently a preview feature. After
approving the repository, base, and sanitized task brief, a typical operator
flow is:

```powershell
gh agent-task create --repo OWNER/REPO --base main --from-file 'C:\work\approved-story.md'
gh agent-task list
gh agent-task view '<session-id>' --repo OWNER/REPO
gh pr checks 123 --repo OWNER/REPO
```

Replace the example values with the approved ones. Task creation sends the
brief to GitHub; never include credentials or unapproved private context.
Before any merge, follow `/cloud-parallel` for exact-head review, required
checks, branch protection, and explicit approval. `/cloud-loop` describes a
single-feature hosted task, not a multi-feature scheduler.

### Jira hybrid work

Use `/jira-plan` to preview a selected sprint, `/hybrid-loop` for an explicitly
approved mix of local and GitHub cloud stories, and `/jira-sync` only for
separately approved write-back. Jira requires an independently configured,
authorized Jira MCP server, client, or user-provided export; `gh` does not
provide Jira access. See the [Jira hybrid guide](hybrid/README.md).

## Upgrading from an earlier version

Pause active runs and reconcile outstanding worktrees, GitHub tasks, PRs, and
Jira operations before updating. Preserve run evidence and back up customized
project files. Review any previously installed Solution Harness hooks,
instructions, and runtime commands in each application repository; disable
only the obsolete entries with approval, without removing unrelated hooks or
user data. Updating this plugin does not change installed copies in other
repositories.

Update or reinstall the plugin through the host rather than editing its cache,
then reload and start a new session. Version 2.0 does not resume a legacy
coordinator automatically. Establish a new approved guided run record after
reconciling the old one. The repository's CI job names and coverage have also
changed; administrators should review any required status-check rules that
refer to the old jobs.

## Project state

`/init-solution` and `/onboard` may create `AGENTS.md`,
`.github/copilot-instructions.md`, and project-specific documents such as
`docs/PLAN.md`, `docs/FEATURES.json`, `docs/PROGRESS.md`, and
`docs/ARCHITECTURE.md`. `/loop` adds its approved contract, budget, and run
log. Operators explicitly maintain these files; the plugin no longer writes a
trajectory log automatically.

Feature IDs use `E` for existing features, `F` for new features, `R` for
refactoring, and `B` for bug fixes.

## Requirements and validation

- VS Code with GitHub Copilot or a compatible Copilot CLI host.
- Git for worktree and repository operations.
- An authenticated `gh` CLI, eligible Copilot access, and repository
  permissions for cloud tasks and PR operations.
- An authorized Jira integration or export only when using Jira workflows.
- Node.js is **not** required to use the plugin. Contributors can run the
  dependency-free packaging and guidance checks with Node.js:

  ```powershell
  node tests\plugin.test.mjs
  node tests\workflows.test.mjs
  ```

These checks do not prove hosted discovery, agent independence, Jira access,
or repository policy. Verify those in the intended environment.

References: [Agent plugin authoring](https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference),
[cloud plugin settings](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/configuring-agent-settings),
and [GitHub CLI agent tasks](https://cli.github.com/manual/gh_agent-task).
