---
name: status
description: "Show a dashboard of project status — features complete, in-progress, blocked, with recent activity from the progress log."
---

# Solution Status Dashboard

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
