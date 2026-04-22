---
name: next-feature
description: "Show the next feature, refactoring task, or bug fix to work on from the plan. Reads docs/FEATURES.json and docs/PROGRESS.md to determine what to build next."
---

# Next Feature

Read `docs/FEATURES.json` and `docs/PROGRESS.md`, then report:

1. **Current Status**: How many items are complete, in-progress, needs-rework, blocked, and not-started (across all prefixes: F, R, B, E)
2. **Next Item**: The highest-priority item with status `"needs-rework"` (rework takes priority) or `"not-started"`
3. **Details**: Show the full spec including:
   - ID, name, priority, and type
   - Description
   - All acceptance criteria
   - Sprint contract (deliverable + verification method)
   - Dependencies and whether they're satisfied
4. **Instructions**: Remind the user to:
   - Switch to the **builder** agent
   - Follow the session protocol (read PROGRESS.md, build one feature, commit, update progress)
   - Run `/pre-commit` before committing
   - Run `/evaluate` after completing features

If all items are complete, congratulate the user and suggest running `/evaluate` for final QA.
