# Solution Harness For Copilot Cloud Agent

The cloud distribution is a bounded, one-feature pilot. It preserves the local
VS Code plugin and supplies native repository customizations for GitHub-hosted
execution. Your machine does not need to remain online after delegation.

## Install Into A Target Repository

Use Node.js 22 or newer. From the solution-harness-plugin directory:

```sh
node scripts/install-cloud.cjs --dry-run /path/to/your-project
node scripts/install-cloud.cjs /path/to/your-project
node --test tests/cloud.test.cjs
```

The target must be a Git repository root. Installation never initializes Git,
commits, pushes, starts a cloud task, or requests credentials. It adds:

```text
.github/
  agents/                    orchestrator, builder, evaluator cloud profiles
  skills/                    original skills plus cloud-loop
  hooks/solution-harness.json cloud lifecycle hooks
  instructions/solution-harness-cloud.instructions.md
  harness/
    config.json              human-approved scope and verification commands
    runtime.cjs              hooks, verification, receipts, and checkpoints
    manifest.json            plugin version and SHA-256 bundle/file hashes
    README.md                this guide
    .gitignore               excludes ephemeral runtime receipts/event logs
  workflows/copilot-setup-steps.yml
```

Existing project instructions and AGENTS.md are not replaced. An existing
config.json or copilot-setup-steps.yml is preserved and reported; review it
manually. Any other differing destination is a conflict: the installer stops
before writing files. Identical files are left unchanged. Symlinked destinations
are rejected. Installation is additive, not an automatic upgrade/merge tool;
review upstream changes and reconcile modified files explicitly.

## Configure Before Delegating

1. Onboard the project first. docs/FEATURES.json, docs/PROGRESS.md, docs/PLAN.md,
   and docs/ARCHITECTURE.md must exist. Existing local onboarding/planning works;
   a separate cloud planning task can also create project state. Never let
   onboarding replace existing repository instructions without review.
2. Edit .github/harness/config.json. Its defaults intentionally cannot start a
   build: the allowlist and verification commands are empty. For example, for a
   project whose npm test script runs once and exits:

   ```json
   {
     "version": 1,
     "feature_ids": ["F001"],
     "max_minutes": 40,
     "max_rework": 1,
     "verification": [
       { "name": "Tests", "kind": "test", "command": "npm", "args": ["test"] },
       { "name": "Build", "kind": "build", "command": "npm", "args": ["run", "build"] }
     ]
   }
   ```

   Use your real non-interactive commands, not placeholder success commands.
   Commands run directly, without shell expansion, from the repository root.
   For a monorepo use the package manager's directory/workspace arguments.
   Do not put secrets in command arguments; use Agents secrets/environment.
3. Review .github/workflows/copilot-setup-steps.yml. The supplied workflow only
   installs Node 22 and checks runtime syntax. Add your actual dependency/tool
   installation steps, such as npm ci, Python setup, or database services.
   Keep its job ID exactly copilot-setup-steps. If installation preserved an
   existing setup workflow, ensure it also provides Node 22+ and project tools.
4. Configure Copilot access, required CI checks, firewall allowances, and Agents
   secrets in GitHub. Prefer GitHub-hosted Ubuntu for this pilot. Consider
   CODEOWNERS/review rules for harness configuration, hooks, and workflows.
5. Review and merge the customizations, approved config, and setup workflow
   into the target's default branch before starting the pilot.

## Start A Cloud Task

From GitHub's Agents UI or an issue's Copilot assignment dialog, select
orchestrator and give a bounded task, for example:

> Implement F001 only using cloud-loop. Obtain an independent evaluator verdict,
> run all configured checks, and open a draft pull request. Stop on a blocker.

The builder and evaluator are subagent-only profiles. The initial cloud pilot
does not export the other five interactive IDE agent profiles. Their planning
and maintenance skills are bundled; the original local agents remain unchanged.
Skills are discovered from descriptions/task context: do not assume an IDE-style
slash-command picker exists on every cloud entry point.

If eligible for the agent-tasks API, you can launch from GitHub CLI:

```sh
gh api --method POST /agents/repos/OWNER/REPO/tasks \
  -f custom_agent=orchestrator \
  -f base_ref=main \
  -F create_pull_request=true \
  -f prompt='Implement F001 only using cloud-loop. Verify independently and open a draft PR.'
```

The API is public preview. Its current reference restricts task creation to
Copilot Business/Enterprise and requires a user token with Agent tasks read/write
permission. GitHub App installation tokens are unsupported. Do not assume a
normal Actions GITHUB_TOKEN can start cloud tasks. The web/issue flow has its own
plan/policy eligibility. Check current GitHub documentation before deployment.

## Gates And Limits

The orchestrator runs begin, baseline verification, builder, evaluator, final
verification, and finish. Real subagentStop events record separate role receipts.
Both roles require distinct, nonempty subagent IDs; absent identities fail closed.
The evaluator must return strict JSON covering every criterion. Failed or stale
receipts, changed source, changed config/criteria, and exhausted working/rework
budgets prevent completion. The runtime executes configured checks itself;
missing tests are never silently skipped. The source repository's CI runs the
dependency-free suite on Node 22 and 24; a local run validates only its interpreter.

Completion fingerprints tracked and nonignored untracked files, including file
contents, deletions, and mode changes. Workflow reports and ephemeral receipts
are excluded so final reporting does not invalidate checks. Gitignored product
inputs must be covered by the configured checks; submodules are not supported by
the pilot fingerprint and require a separate integration design.

Finish updates only the selected feature's status and publishes progress,
evaluation, and run-log records. Runtime receipts and argument-free event logs
are gitignored and disappear with the sandbox. Durable evidence is the reports,
code diff, configured CI, and GitHub session logs. Do not rely on filesystem
timestamps or local logs as proof that work was retained.

The stop hook asks once for an unfinished active run to be checkpointed, then
self-limits to avoid an endless forced-continuation loop. Abrupt sandbox timeout
can still prevent final reporting. Start with a small feature, default 40-minute
working cap, and one corrective attempt; GitHub's 59-minute session maximum
cannot be extended by this harness. Model instructions and editable receipts
are not a security boundary. Command blocking is heuristic defense in depth,
not a shell parser or a replacement for sandbox/firewall/branch controls.

Cloud agent owns branch commits/pushes and cannot merge its own PR. PR CI requires
human approval by default unless explicitly configured otherwise. Review and
merge remain human responsibilities. Do not represent the local L1 no-commit
approval model as a cloud guarantee.

## Acceptance Check On GitHub

Local automated tests simulate lifecycle payloads and use real temporary Git
repositories and test processes. They do not prove hosted-agent behavior.

For the first hosted run, verify the profile is discovered, setup succeeds,
sessionStart initializes state, builder/evaluator subagentStop payloads are
recorded under their configured names, and all checks pass before completion.
Confirm the draft PR contains code plus accurate feature/progress/evaluation
records and no runtime receipts or secrets. Also try a failing test and confirm
the feature cannot become complete. Missing subagent events or different payload
shapes must block completion, not trigger a fabricated or self-graded fallback.

## Later Scaling

Use one feature/task/branch/PR; parallelize only independent scopes. Shared feature
registries and append-only logs are not a concurrent queue. Serialize their
reconciliation, and merge dependencies before starting dependent work. Add an
external queue/dispatcher only after the hosted pilot succeeds. Sessions remain
subject to plan/policy, Actions compute, inference billing, and platform limits.

Organization agents can centralize profiles, but skills/hooks/setup still need
repository provisioning. Native automations can schedule eligible private/internal
repositories, but are user-private and not Git-versioned. GitHub Agentic Workflows
are a separate preview option for versioned automation, not this plugin's runtime.

## References

- [Cloud agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent)
- [Custom agent configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [Agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Hooks and cloud payloads](https://docs.github.com/en/copilot/reference/hooks-configuration)
- [Environment setup](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)
- [Agent task API](https://docs.github.com/en/rest/agent-tasks/agent-tasks)