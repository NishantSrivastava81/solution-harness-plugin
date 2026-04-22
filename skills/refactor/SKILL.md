---
name: refactor
description: "Plan refactoring tasks for an existing project with risk assessment and rollback plans. Categories: structural, quality, performance, test, dependency, security. Orders tasks by risk (low first)."
---

# Plan Refactoring

## Input
The user will describe what they want to refactor or improve.

## Prerequisites
- docs/ARCHITECTURE.md and docs/FEATURES.json must exist (run /onboard first if not)

## Process

### 1. Analyze Current State
Read docs/ARCHITECTURE.md, docs/FEATURES.json, docs/PLAN.md. Scan codebase for issues.

### 2. Define Refactoring Tasks
For each task, use R-prefix IDs:
```json
{
  "id": "R001",
  "name": "Refactoring Task Name",
  "priority": 1,
  "status": "not-started",
  "type": "structural|quality|performance|test|dependency|security",
  "description": "What to change and why",
  "affected_files": ["src/module/file.ts"],
  "risk": "low|medium|high",
  "acceptance_criteria": ["All existing tests continue to pass", "Specific criterion"],
  "contract": { "deliverable": "What the refactored code should look like", "verification": "How to verify — MUST include existing tests pass" },
  "dependencies": [],
  "rollback_plan": "How to undo if something goes wrong"
}
```

### Key Rules
- Every task MUST include "All existing tests continue to pass"
- Order by risk: low first, high last
- One concern per task
- Include rollback plan
- Prefer 5 small tasks over 1 large task

### 3. Update docs/FEATURES.json, docs/PLAN.md, docs/PROGRESS.md

### 4. Report risk assessment and recommend /next-feature
