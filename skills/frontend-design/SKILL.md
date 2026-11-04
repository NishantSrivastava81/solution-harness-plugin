---
name: frontend-design
description: "Design, implement, and review frontend UI/UX for pages, dashboards, forms, navigation, and components. Use for user-interface work, visual design, responsive layouts, accessibility, interaction states, and browser validation. Brought to you by solution-harness."
---

# Frontend Design

Apply this guidance when the task changes a user interface. Non-UI tasks do not
acquire UI work or new acceptance criteria from this skill.

Work in the role assigned by the harness. A designer proposes the experience;
a builder implements approved scope; an independent evaluator checks it without
editing source. Existing instructions, exact acceptance criteria, ownership,
design approvals, and report formats remain authoritative. Do not use a design
improvement to expand a story or bypass an approval.

## Prerequisites

* Read the assigned story or feature, approved design, and applicable project
  instructions. Understand the primary user, task, and success condition.
* Inspect existing screens, components, tokens, styles, assets, and UI tests.
  Reuse the repository's framework, design system, localization, and conventions.
* Identify the actual application URL, supported viewports, and available browser
  or UI-test tools. Use a local test instance with safe fixture data.
* Ask about consequential missing product decisions instead of inventing a
  business workflow, changing brand direction, or silently adding requirements.

## Quick start

Invoke `/frontend-design` with a page, component, or UI story. For example:

```text
Design the customer picker for this story using the existing portal components.
Cover empty, loading, error, and keyboard interaction states before implementing.
```

Agents can also load the skill automatically for UI tasks. Under a harness
assignment, follow the role-specific steps below and stop at its reporting
boundary. Do not create a separate design document unless requested or required
by the existing feature-design workflow.

## 1. Define the experience

Prepare a short brief in the existing design context or conversation:

* Who uses the screen, their primary goal, and the shortest understandable path
* Entry points, navigation, primary action, and completion feedback
* Data shown, required inputs, terminology, and authorization boundaries
* Relevant states: loading, empty, success, validation error, network failure,
  forbidden, disabled, and partial results
* The component reuse plan, responsive behavior, and verification approach

For materially different flows, compare two concise options or ASCII wireframes
and obtain approval for the consequential choice before building. For a small,
well-specified change, keep the brief proportional.

For B2B SaaS work, consider in-scope onboarding, workspace roles, and plan or
usage states. UI restrictions do not replace server-side authorization.

## 2. Choose a coherent visual direction

Preserve an established product's visual language unless redesign is explicitly
in scope. Extend existing tokens rather than creating a parallel design system.

For a new surface without established guidance, choose and explain a direction
that fits its audience and content. Define typography roles, a readable type
scale, spacing rhythm, semantic colors, content widths, and component hierarchy.
Keep the primary action and information structure clear across breakpoints.
Do not substitute decorative gradients, excessive cards, or fashionable fonts
for an intentional hierarchy; use them only when they serve the brief.

Use realistic, non-sensitive copy and data. Avoid invented testimonials,
customer claims, or misleading success states. Reuse approved local assets.
New fonts, image services, animation libraries, or external dependencies need
normal project approval; do not introduce third-party requests by default.

## 3. Implement usable interactions

Builders implement only their owned files and approved criteria. Designers stop
at the design handoff; evaluators do not implement fixes.

* Reuse shared components and existing state/data patterns. If a necessary
  shared token or component is outside ownership, request coordinator approval.
* Make every visible action work or clearly indicate why it is unavailable.
  Never replace real integration with mock success or a decorative control.
* Validate forms with clear labels, helpful examples, and field-level errors.
  Preserve user input on failure and explain how to recover.
* Distinguish loading, no results, no permission, and failed requests. Provide
  safe retry behavior and prevent unintended duplicate submissions.
* Keep destructive actions explicit and consistent with existing confirmation,
  undo, and authorization patterns. Avoid confusing or coercive defaults.
* Adapt navigation, tables, dialogs, and forms to narrow layouts without hiding
  essential actions. Keep intentional wide-data scrolling local to its region.
* Respect the project's locale, formatting, text expansion, and RTL behavior
  where applicable. Do not hard-code user-facing strings around localization.
* Use motion to communicate change, honor reduced-motion preferences, and avoid
  disrupting focus or task completion.

## 4. Include accessibility in the implementation

Follow the project's accessibility contract; target WCAG 2.2 AA where required.
Prefer native HTML semantics and established accessible components over custom
ARIA behavior.

* Use meaningful headings, landmarks, accessible names, and label associations.
  Do not communicate status or errors through color alone.
* Support keyboard operation, logical focus order, and visible focus. Dialogs
  need appropriate focus placement, containment, closing, and restoration.
* Check text contrast: normally 4.5:1, or 3:1 for qualifying large text. Relevant
  non-text controls and indicators generally need 3:1 contrast.
* Aim for at least 24 by 24 CSS-pixel pointer targets or sufficient spacing,
  accounting for WCAG exceptions; use larger targets when the product permits.
* Check text resizing at 200% and reflow at 320 CSS pixels, with exceptions for
  content that genuinely needs two-dimensional layout.
* Announce important asynchronous results appropriately without excessive live
  region noise, and provide useful alternatives for meaningful images.

Automated accessibility checks do not prove complete WCAG conformance. Record
manual observations and limitations rather than claiming certification.

## 5. Verify the rendered result

Builders and evaluators use the existing test tools. Evaluators independently
inspect the exact assigned candidate, not the builder's screenshots alone.

1. Run focused interaction/component tests, then required regression checks.
2. Open the actual local application with available browser tools or the
   project's existing Playwright setup. Exercise the primary flow and relevant
   error, empty, loading, and permission states using safe fixtures.
3. Check supported mobile and desktop sizes. If none are specified, inspect
   representative 320, 768, and 1440 CSS-pixel widths and record what was tested.
4. Inspect overflow, alignment, typography, focus, keyboard navigation, and
   readable content. Use screenshots when helpful; do not infer behavior or
   accessibility from a screenshot alone.
5. Check browser console/network failures and relevant reduced-motion,
   localization, and accessibility behavior. Do not mutate live Jira or other
   production services to exercise a UI.
6. Fix in-scope issues and repeat the affected checks. Evaluators return findings
   for bounded rework instead of modifying the candidate.

If browser access, credentials, or tools are unavailable, report the exact
limitation. Static review is not rendered verification. A required criterion
with missing evidence cannot receive PASS.

## Handoff and reporting

Use the assignment's existing report schema and private report path. Include
evidence per exact criterion: actual commands/results, routes, viewports,
interaction states, accessibility observations, and any remaining blockers.
Keep screenshots and fixtures free of sensitive data and within approved
artifact locations.

Builder self-checks do not replace independent evaluation. Do not commit, merge,
edit shared progress, or approve your own work when the assignment forbids it.
Do not declare a feature complete merely because its UI looks finished.

## Reference

The [Frontend Design reference](https://agenticskills.io/skills/frontend-design)
is optional background. This is original harness guidance, not a vendored copy
of that prompt. Execution uses the bundled guidance and needs no external fetch.

> Brought to you by solution-harness
