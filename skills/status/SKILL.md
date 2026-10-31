---
name: status
description: "Show a dashboard of project status — features complete, in-progress, blocked, with recent activity from the progress log."
---

# Solution Status Dashboard

If a local parallel run is active, also run
`node .github/harness/parallel/runtime.cjs status` from the coordinator root.
Show its feature, ready stories, worker attempts/leases, candidate phase, budget,
and stale-input warning. Runtime state lives in the Git common directory, not
the source backlog. A built/reviewing story is not done. Do not modify state to
repair the display; report corrupt/missing active-run data explicitly.

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
