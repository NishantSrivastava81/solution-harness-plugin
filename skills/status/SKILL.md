---
name: status
description: "Show a dashboard of project status — features complete, in-progress, blocked, with recent activity from the progress log."
---

# Solution Status Dashboard

If a guided run is active, read its approved run record and reconcile it with
the actual workspaces and, for cloud tasks, `gh agent-task list` and
`gh agent-task view`. Show assigned stories, task/PR identities, review state,
budgets, and any missing or stale evidence. A built or reviewing story is not
done. Do not invent state or modify records to repair the display; report
missing information explicitly.

Read `docs/FEATURES.json` and `docs/PROGRESS.md` and display:

```
╔══════════════════════════════════════════╗
║         SOLUTION STATUS DASHBOARD        ║
╠══════════════════════════════════════════╣
║ Total Features:    NN                    ║
║ ✅ Complete:       NN                    ║
║ 🔨 In Progress:   NN                    ║
║ 🔄 Needs Rework:  NN                    ║
║ 🚫 Blocked:       NN                    ║
║ ⬜ Not Started:   NN                    ║
║ Progress:          NN%                   ║
╚══════════════════════════════════════════╝
```

Then list each feature:
| ID | Name | Priority | Status |

Then show the last 3 entries from PROGRESS.md.

Recommend what to do next.
