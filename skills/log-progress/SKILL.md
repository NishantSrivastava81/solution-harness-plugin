---
name: log-progress
description: "Record a progress log entry for the current session. Appends to docs/PROGRESS.md and updates docs/FEATURES.json if any feature status changed."
---

# Log Progress

Append a new session entry to `docs/PROGRESS.md`:

```markdown
## Session — [today's date and time]
- **Feature**: [ID] — [name]
- **Status**: [Complete / In Progress / Blocked]
- **What was built**: [summary]
- **Tests**: [what tests were added/updated]
- **Issues**: [any problems encountered]
- **Next**: [recommended next step]
```

Also update `docs/FEATURES.json` if any feature status changed.
