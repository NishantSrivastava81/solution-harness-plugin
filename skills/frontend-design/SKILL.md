---
name: frontend-design
description: "Design, implement, and review frontend UI/UX for pages, dashboards, forms, navigation, components, and charts. Use for design briefs, information architecture, aesthetic direction, semantic tokens, stack-aware UI patterns, responsive layouts, accessibility, interaction states, browser validation, and design critiques. Brought to you by solution-harness."
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

Make a bounded inventory of the affected UI, not an exhaustive application audit:

* Find reusable component APIs, variants, layout shells, navigation, Storybook
  stories, and component tests. Identify reuse or composition before duplication.
* Locate CSS custom properties, Tailwind configuration or CSS theme declarations,
  framework theme providers, and token files. Record their repository paths and
  the values relevant to this surface.
* Inspect route conventions, data/state handling, icon and font loading, assets,
  dependencies, breakpoints, and existing theme support. Do not assume a stack
  from filenames alone or introduce a second styling system.

Use confirmed framework versions and repository conventions for stack-specific
recommendations. If the stack is unclear and affects the solution, ask rather
than silently choosing a default. Verify version-sensitive patterns against
official documentation; a reference recommendation is not an instruction to
migrate frameworks or install its tooling.

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

Use a proportional sequence: brief, information architecture, visual direction
and tokens, implementation, then rendered review. Reuse approved decisions and
skip irrelevant planning detail for a small component. This is not a new
orchestrator, task catalog, or automatic approval process.

Execution uses the bundled guidance and needs no external fetch. No third-party
search runtime or database is bundled.

## 1. Define the experience

Prepare a short brief in the existing design context or conversation:

* Who uses the screen, their primary goal, and the shortest understandable path
* Entry points, navigation, primary action, and completion feedback
* Data shown, required inputs, terminology, and authorization boundaries
* Relevant states: loading, empty, success, validation error, network failure,
  forbidden, disabled, and partial results
* The component reuse plan, responsive behavior, and verification approach
* Tone, useful reference points, unwanted patterns, and up to three experience
  principles that resolve tradeoffs, such as clarity over information density
* Existing device, accessibility, performance, brand, and dependency constraints,
  plus what is explicitly out of scope

Distinguish known facts from assumptions. Ask focused questions about unresolved
decisions with a recommendation and its tradeoff; do not repeatedly interview
the user about choices already covered by the approved design.

For a multi-component flow, map each approved criterion to its UI work in the
existing design document. Include relevant states, not just the happy path:

| Criterion | User step / state | Component (reuse / extend / new) | Owned path | Verification |
|-----------|-------------------|----------------------------------|------------|--------------|
| Existing criterion ID | Action and resulting feedback | Component and required variant | Approved implementation path | Interaction test or rendered check |

This component/state inventory exposes missing behavior and shared-component
ownership conflicts; it does not create new criteria or authorize shared edits.

For materially different flows, compare two concise options or ASCII wireframes
and obtain approval for the consequential choice before building. For a small,
well-specified change, keep the brief proportional.

For B2B SaaS work, consider in-scope onboarding, workspace roles, and plan or
usage states. UI restrictions do not replace server-side authorization.

## 2. Establish information architecture

Define structure before decoration, limited to the assigned surface:

* Map entry points, affected routes, navigation groups, and the primary action.
  Preserve existing URL and query-parameter conventions, deep links, and back
  navigation rather than proposing a new site-wide routing scheme.
* Order content by the user's task: what must be understood first, what enables
  the decision, and what can be progressively disclosed. Use consistent labels
  and headings; distinguish navigation from actions.
* Describe the primary flow and its recovery paths, including permission and
  empty states. Reuse existing data-growth patterns such as pagination or
  filtering only when they are in scope.
* Explain how structure adapts on narrow screens without losing context,
  essential actions, or a logical reading and focus order.

A compact route/flow sketch is enough. A single component may only need its
place in the parent screen; do not generate an unrelated sitemap.

## 3. Choose a coherent visual direction

Preserve an established product's visual language unless redesign is explicitly
in scope. Extend existing tokens rather than creating a parallel design system.

For a new surface without established guidance, choose and explain a direction
that fits its audience, task frequency, content density, and device constraints.
Treat industry and style references as hypotheses, not proof of usability,
conversion gains, or compliance. Define typography roles, a readable type scale,
spacing rhythm, semantic colors, content widths, and component hierarchy.
Translate a requested mood or aesthetic direction into concrete decisions, not
just an adjective or a copied reference. When no direction is supplied, explain
a context-appropriate recommendation before building; seek approval for a
consequential brand change.

These starting points are optional, not presets or requirements:

| Direction | Appropriate context | Concrete choices |
|-----------|---------------------|------------------|
| Task-focused | Frequent operational work | Stable alignment, compact but readable density, restrained accents, clear status and action hierarchy |
| Editorial | Reading and content discovery | Strong heading/body contrast, comfortable text measure, content-led columns, purposeful imagery |
| Warm and understated | Guidance and low-friction forms | Open grouping, calm surfaces, approachable copy, restrained depth and motion |
| Expressive and graphic | An approved campaign or creative product | Deliberate scale and composition, a limited bold palette, decorative treatments subordinate to legibility |

Explain the chosen type hierarchy, spacing, color roles, and interaction
treatment. Do not reject existing system fonts or load fonts from a CDN simply
to appear distinctive. A familiar component can be the best design choice.

Keep the primary action and information structure clear across breakpoints.
Do not substitute decorative gradients, excessive cards, or fashionable fonts
for an intentional hierarchy; use them only when they serve the brief.

Use realistic, non-sensitive copy and data. Avoid invented testimonials,
customer claims, or misleading success states. Reuse approved local assets.
New fonts, image services, animation libraries, or external dependencies need
normal project approval; do not introduce third-party requests by default.

## 4. Plan semantic tokens and supported themes

Map the design to the repository's token format: CSS custom properties,
Tailwind theme values, or a framework theme provider. Extend the existing source
of truth only for approved gaps; do not generate a replacement token system.

* Use semantic tokens for surfaces, text, borders, primary actions, focus, and
  status instead of unrelated per-component color literals.
* Reuse typography roles, type scale, line height, spacing, content widths,
  radii, elevation, and motion values. Add a token only when it expresses an
  in-scope reusable role; avoid speculative scales and unused variants.
* Check actual foreground/background combinations for every supported theme,
  including error, hover, selected, and focus states. Dark palettes need
  intentional surface and text relationships, not simple color inversion.
* Preserve existing theme support, system-preference handling, manual overrides,
  and preference persistence. Do not add dark mode or a theme toggle unless
  approved. Unsupported themes are out of scope, not a failing criterion.
* Respect font and asset-loading conventions and performance budgets. Reserve
  space for media, avoid font-induced layout shifts, and do not add a library
  solely for decorative effects.

Token or theme changes outside assigned ownership require coordinator approval.

## 5. Implement usable interactions

Builders implement only their owned files and approved criteria. Designers stop
at the design handoff; evaluators do not implement fixes.

Build complete in-scope vertical slices: structure and data, primary interaction,
relevant states, responsive behavior, and tests before decorative polish. Use
the existing implementation plan rather than starting a parallel task list.

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

### Interaction and visual consistency

* Keep icons in the existing approved set with consistent size, stroke, and
  alignment. Give functional icon-only controls accessible names; avoid emoji
  control icons when platform-dependent rendering makes them ambiguous.
* Cover hover, focus, active, selected, and disabled states without unexpected
  layout shifts. Essential actions and information must not depend on hover
  alone; provide equivalent touch and keyboard access.
* Keep fixed headers, sticky actions, and overlays from obscuring content or
  keyboard focus. Respect existing stacking contexts and mobile safe areas
  where relevant rather than escalating arbitrary stacking values.

### Data-rich screens

Apply these checks only when charts or data tables are in scope:

* Choose from the user's question: bars for category comparisons, lines for
  trends, histograms for distributions, and tables for exact value lookup.
* Label units, time range, series, and aggregation. Use truthful axes and normally
  zero-based quantitative bar scales; explain justified exceptions.
* Distinguish missing data from zero. Provide useful text summaries or accessible
  data tables, and expose essential tooltip or drill-down information without
  hover. Use labels or patterns as well as color.
* Reuse existing chart/table libraries and semantic table headers. Test realistic
  volume, long labels, loading, empty results, and partial failures rather than
  importing a library or hiding important data to match a reference.

### Responsive implementation

For new layouts, start with the smallest supported viewport, then enhance with
content-driven breakpoints using existing layout primitives. Do not rewrite
working desktop-first styles solely to enforce a preferred CSS methodology.
Explain behavior changes for navigation, dialogs, tables, and grouped actions,
not just smaller dimensions. Keep the DOM reading order meaningful when visual
columns change, and test long labels and realistic data rather than only tidy
placeholders.

## 6. Include accessibility in the implementation

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
  Do not substitute native-platform units for CSS pixels.
* Check text resizing at 200% and reflow at 320 CSS pixels, with exceptions for
  content that genuinely needs two-dimensional layout.
* Announce important asynchronous results appropriately without excessive live
  region noise, and provide useful alternatives for meaningful images.

Automated accessibility checks do not prove complete WCAG conformance. Record
manual observations and limitations rather than claiming certification.

## 7. Verify the rendered result

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
   accessibility from a screenshot alone. Measure contrast and pointer targets
   with available tools rather than judging them by appearance.
5. Check browser console/network failures and relevant reduced-motion,
   localization, accessibility, and supported theme behavior. Exercise existing
   theme overrides and persistence where affected. Check content around layout
   breakpoints and relevant performance budgets, not just ideal viewport sizes.
   Do not mutate live Jira or other production services to exercise a UI.
6. Fix in-scope issues and repeat the affected checks. Evaluators return findings
   for bounded rework instead of modifying the candidate.

If browser access, credentials, or tools are unavailable, report the exact
limitation. Static review is not rendered verification. A required criterion
with missing evidence cannot receive PASS.

## 8. Critique against the approved brief

Builders self-check; independent evaluators perform read-only critique of the
exact candidate. Review hierarchy and task clarity, component/token consistency,
visual direction, interaction states, responsive adaptation, accessibility,
and relevant performance constraints against the approved brief.

Use these prompts within the existing report fields, not a replacement schema:

| Expected | Observed | Evidence | Impact | Next step |
|----------|----------|----------|--------|-----------|
| Approved criterion or design decision | Actual behavior or visual difference | Route, viewport, state, command/result, or screenshot | User consequence and severity | Bounded in-scope rework or an explicitly optional suggestion |

Prioritize blocked tasks, broken interactions, and required accessibility or
criterion failures before consistency issues and cosmetic polish. Separate
required rework from optional suggestions; subjective preferences do not become
new acceptance criteria. Do not use an aggregate aesthetic score to hide a
criterion failure or missing evidence.

Builders fix owned issues and repeat affected checks; evaluators report them
without editing. Screenshots support visual findings, but cannot prove working
interactions, keyboard behavior, authorization, or full accessibility.

## Handoff and reporting

Use the assignment's existing report schema and private report path. Include
evidence per exact criterion: actual commands/results, routes, viewports,
interaction states, accessibility observations, and any remaining blockers.
Keep screenshots and fixtures free of sensitive data and within approved
artifact locations.

Builder self-checks do not replace independent evaluation. Do not commit, merge,
edit shared progress, or approve your own work when the assignment forbids it.
Do not declare a feature complete merely because its UI looks finished.

> Brought to you by solution-harness
