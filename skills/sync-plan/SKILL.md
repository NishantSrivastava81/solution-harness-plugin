---
name: sync-plan
description: "Sync FEATURES.json and PLAN.md after architecture or scope changes mid-project. Preserves completed feature status while updating not-started features to align with the latest ARCHITECTURE.md and PLAN.md."
---

# Sync Plan with Architecture Changes

You are reconciling the feature plan with architectural changes that happened
mid-project. Features already completed should be preserved. Features not yet
started should be updated to align with the new architecture.

## When to Use
- Architecture changed after features were already planned
- Modules were renamed, merged, or split
- Tech stack decisions changed (e.g., switched database)
- Cross-cutting patterns were updated
- New architectural constraints affect planned features

## Process

### Step 1: Understand What Changed

1. Read `docs/ARCHITECTURE.md` — understand the CURRENT architecture
2. Read `docs/FEATURES.json` — understand the CURRENT feature plan and statuses
3. Read `docs/PLAN.md` — understand the original plan
4. Read `docs/PROGRESS.md` — understand what was recently changed and why

Ask the user: "What changed in the architecture and why?" if it's not clear
from the docs.

### Step 2: Categorize Features by Impact

Sort every feature into one of these buckets:

| Category | Action |
|----------|--------|
| **Complete — no impact** | Features already done that aren't affected by the change. Leave as-is. |
| **Complete — affected** | Features already done that may need rework due to architecture change. Flag for review, add note, but do NOT change status automatically. |
| **In progress — affected** | Features being worked on that are impacted. Add a warning note. |
| **Not started — needs update** | Features not yet built that should be updated to align with new architecture. Update acceptance criteria, sprint contracts, module references. |
| **Not started — obsolete** | Features that no longer make sense under the new architecture. Mark as `"cancelled"` with reason. |
| **New features needed** | The architecture change introduces work that wasn't planned. Add new features. |

### Step 3: Update docs/FEATURES.json

For each affected feature:

**Not-started features that need updating:**
- Update `description` to reference correct modules/patterns
- Update `acceptance_criteria` to match new architecture constraints
- Update `contract.deliverable` and `contract.verification`
- Update `dependencies` if module relationships changed
- Add `"architecture_revision": "[date] — [summary of change]"` field

**Completed features that may need rework:**
- Do NOT change status from `"complete"` — the evaluator should assess this
- Add `"architecture_note": "Architecture changed on [date]: [what changed]. May need rework — run /evaluate to assess."` field

**Obsolete features:**
- Change status to `"cancelled"`
- Add `"cancel_reason": "[why this feature is no longer needed]"`

**New features from architecture change:**
- Add with `F` prefix, next available ID number
- Status `"not-started"`
- Note in description that this was added due to architecture revision

### Step 4: Update docs/PLAN.md

Update the Plan to reflect:
- Revised tech stack (if changed)
- Revised feature list (new, updated, cancelled)
- Add a section:

```markdown
## Architecture Revision — [date]
### What Changed
[Summary of architectural changes]

### Impact on Features
- **Updated**: F003, F005, F007 — [what changed]
- **Cancelled**: F004 — [why]
- **Added**: F016, F017 — [what and why]
- **May need rework**: F001, F002 — [pending /evaluate]
```

### Step 5: Update docs/PROGRESS.md

```markdown
## Plan Synced with Architecture Changes — [date]
- **Architecture Change**: [summary]
- **Features Updated**: [list of IDs]
- **Features Cancelled**: [list of IDs with reasons]
- **Features Added**: [list of new IDs]
- **Features Flagged for Rework Review**: [list of IDs]
- **Next**: Run /evaluate on flagged features, then /next-feature
```

### Step 6: Report

Summarize:
- How many features were updated, cancelled, added
- Which completed features may need rework (recommend running `/evaluate`)
- What the next steps are
- Show the updated feature status dashboard

## Rules
- **NEVER change a completed feature's status** — that's the evaluator's job
- **NEVER delete features** — cancel them with a reason so there's an audit trail
- **Preserve completed work** — the goal is to align future work, not redo past work
- **Document every change** — the architecture revision section in PLAN.md is the audit trail
- **Be conservative** — if unsure whether a completed feature is affected, flag it for review rather than assuming it's fine
