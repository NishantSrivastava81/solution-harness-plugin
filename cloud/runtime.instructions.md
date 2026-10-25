---
applyTo: "**"
excludeAgent: "code-review"
---

# Solution Harness Cloud Runtime

These instructions apply only when running in GitHub Copilot cloud agent.
In a local IDE, keep the repository's existing plugin and interactive workflows.

For cloud implementation, select the orchestrator profile and use cloud-loop.
Build one explicitly requested, allowlisted feature per session. Require a green
baseline, separate builder and evaluator subagents, and all configured checks.
Do not treat a builder's self-assessment as independent verification.

The runtime owns feature-status transitions and progress/evaluation records.
Never edit its receipts or bypass its gates. Do not change tests, acceptance
criteria, configuration, hooks, or workflow policy to make a failed gate pass.
The builder may add appropriate tests, but must not weaken existing ones.

The bundled local skills remain useful for planning and investigation. Their
IDE dialogs, handoff buttons, manual commits, and multi-feature loops do not
apply in cloud mode. Use the approved task inputs; missing or ambiguous inputs
require an explicit blocker. Do not initialize Git or replace existing project
instructions during onboarding. No test runner means blocked, never skipped.

Use portable tool capabilities, not VS Code extension tool IDs. External
research, package registries, and services require the appropriate firewall and
Agents-secret configuration. Never include secrets in prompts, receipts, or logs.

Working budgets do not extend GitHub's session limit. Save a durable checkpoint
with runtime.cjs finish before ending. Let the platform manage branch commits,
pushes, and PR creation. Required CI and human review/merge remain mandatory.