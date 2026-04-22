---
name: harness-health
description: "Assess whether the harness components are still appropriate for the current model and project. Audits each component for relevance, checks evaluator accuracy, measures feature velocity, and recommends simplifications."
---

# Harness Health Check

Every harness component encodes an assumption about what the model can't do on its own. Those assumptions expire. Periodically re-evaluate.

## 1. Component Inventory
List every harness component and assess if it's still needed:

| Component | Load-Bearing? | Evidence |
|-----------|---------------|----------|
| Planner agent | Yes/Maybe/No | [Why] |
| Builder agent | Yes/Maybe/No | [Why] |
| Evaluator agent | Yes/Maybe/No | [Why] |
| Reviewer agent | Yes/Maybe/No | [Why] |
| Janitor agent | Yes/Maybe/No | [Why] |
| SessionStart hook | Yes/Maybe/No | [Why] |
| Stop hook | Yes/Maybe/No | [Why] |
| PreToolUse hook | Yes/Maybe/No | [Why] |
| PostToolUse hook | Yes/Maybe/No | [Why] |

## 2. Evaluator Accuracy
Review docs/EVALUATION.md if it exists. Were findings legitimate or false positives?

## 3. Progress Log Quality
Review docs/PROGRESS.md. Are logs detailed enough? Gaps? Consistent format?

## 4. Feature Velocity
From FEATURES.json and PROGRESS.md: features per session? Stuck items?

## 5. Recommendations
- **Keep**: components still adding value
- **Simplify**: over-engineered for current model
- **Drop**: no longer load-bearing
- **Add**: gaps to fill
