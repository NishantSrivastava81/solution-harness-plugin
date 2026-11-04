---
title: GitHub Copilot cloud execution
description: Enable the native plugin and guide approved GitHub cloud tasks.
---

# GitHub cloud execution

The plugin's portable skills and Copilot-specific agents are distributed through
the native marketplace. There is no separate hosted installer or bundled
runtime. `/cloud-loop` guides one approved feature; `/cloud-parallel` guides a
local coordinator dispatching separate story tasks.

## Enable the plugin in a target repository

After the marketplace has been published, add its entry and enable the plugin
in the target repository's `.github/copilot/settings.json`, retaining existing
settings:

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

Commit the settings to the default branch and confirm the hosted session can
access the marketplace and required components. Local installation does not
prove cloud discovery. Prepare any project-specific dependency setup, tests,
credentials, and repository rules separately; the plugin does not configure
them. If a capability is unavailable, stop or use an explicitly approved,
self-contained task brief instead of claiming it was loaded.

## Create and inspect an approved task

Authenticate `gh` and confirm Copilot eligibility, repository permissions,
approved base, criteria, scope, verification commands, and spending limits.
Get approval before sending task contents to GitHub. Put only necessary,
non-secret context in the brief, then use:

```powershell
gh agent-task create --repo OWNER/REPO --base main --from-file 'C:\work\approved-story.md'
gh agent-task list
gh agent-task view '<session-id>' --repo OWNER/REPO
```

The `agent-task` commands are a GitHub CLI preview and may change. Creation may
be queued or return an ambiguous result. Reconcile the task and PR in GitHub
before retrying; lack of a local response does not prove that no task exists.
Only use `--custom-agent` when the selected target actually exposes the named
agent; do not assume a plugin agent is selectable by that flag.

## Review and integration

The task author does not independently evaluate its own work. A separate local
evaluator reviews the exact PR head, criteria, scope, and actual test results.
The coordinator verifies required GitHub checks, current base, and repository
protection, then requests merge approval. Follow `/cloud-parallel` for the
exact-head merge guard and serial integration. A task or draft PR is not
accepted delivery.

If a hosted session cannot run a separate evaluator, it must report that fact
and leave independent evaluation to a different session before completion.
Instructions do not automatically enforce budgets, ownership, or review.

## References

- [Cloud plugin settings](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/configuring-agent-settings)
- [Agent task commands](https://cli.github.com/manual/gh_agent-task)
- [Agent plugin authoring](https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference)
