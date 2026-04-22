---
name: refine-design
description: "Provide feedback on a design document and request changes. Use after /design-feature to iterate on the technical design before implementation begins. Supports multiple rounds of review."
---

# Refine Design

You are revising a technical design document based on human feedback.

## Input
The user will provide feedback on an existing design. This could be:
- Disagreement with a library choice ("use Redis instead of Memcached")
- Request for a different pattern ("use event-driven instead of polling")
- Missing considerations ("what about rate limiting?")
- Scope changes ("drop the WebSocket part, use SSE instead")
- Questions that need answers before approving
- Approval to proceed

If the user doesn't specify which feature, look for the most recently designed feature in `docs/PROGRESS.md`.

## Process

### Step 1: Load the Design
1. Read `docs/FEATURES.json` — find the feature with `"designed": true` that the feedback is about
2. Read the design doc referenced in the feature's `"design_doc"` field
3. Read `docs/PROGRESS.md` — check for any prior feedback rounds

### Step 2: Understand the Feedback
Categorize the feedback:

| Type | Action |
|------|--------|
| **Reject a decision** | Research the alternative, update the decision section with new analysis |
| **Request addition** | Research the topic, add a new section to the design |
| **Ask a question** | Answer with evidence, add to Open Questions if it needs human judgment |
| **Raise a concern** | Assess risk, add to design's risk section with mitigation |
| **Approve the design** | Mark as approved, update FEATURES.json |
| **Partial approval** | Note what's approved, flag what still needs work |

### Step 3: Research if Needed
If the feedback involves a technology or pattern you haven't evaluated:
- Search the web for the alternative approach
- Compare it against the current recommendation
- Present findings with honest assessment (the user's suggestion might be better)

### Step 4: Revise the Design Document
Update `docs/designs/[FEATURE_ID]-design.md`:

1. **Change the status** to `Draft (Revision N)` where N is the revision count
2. **Add a Revision History section** at the bottom:

```markdown
## Revision History

### Revision 1 — [date]
**Feedback**: [summary of what the user requested]
**Changes Made**:
- [Change 1 — what was modified and why]
- [Change 2 — what was modified and why]
**Decisions Changed**:
- Decision X: Changed from [old] to [new] because [reason]
```

3. **Update the affected sections** — don't just append; revise the relevant sections in place so the design doc remains coherent and readable as a single document
4. **Update the recommendation** if the feedback changes a decision
5. **Resolve or update Open Questions** based on feedback

### Step 5: Handle Approval
When the user approves the design:

1. Change the design doc status to `Approved`
2. Add final revision entry:
```markdown
### Approved — [date]
Design approved after [N] revision(s). Ready for implementation.
```
3. Update `docs/FEATURES.json`:
   - Set `"design_status": "approved"`
4. Update `docs/PROGRESS.md`:
```markdown
## Design Approved — [date]
- **Feature**: [ID] — [name]
- **Revisions**: [N] rounds of feedback
- **Key Changes from Feedback**: [summary]
- **Next**: Switch to builder agent → /next-feature
```

### Step 6: Report
After each revision:
- Summarize what was changed and why
- Highlight any remaining open questions
- Ask if the user wants to:
  - **Provide more feedback** — continue iterating
  - **Approve the design** — mark as approved, ready for builder
  - **Discuss a specific decision** — deep-dive into one area

## Rules
- **Don't be defensive** — if the user's suggestion is better, say so and update the design
- **Research before recommending against** — if you think the user's alternative is worse, show evidence, don't just assert
- **Keep the design doc coherent** — revise in place, don't just append contradictory sections
- **Track all changes** — the revision history is an audit trail of design evolution
- **Preserve what wasn't challenged** — only modify sections affected by the feedback
- **The human has final say** — if they insist on an approach you disagree with, document the trade-off and proceed
