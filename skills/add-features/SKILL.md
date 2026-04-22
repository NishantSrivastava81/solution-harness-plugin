---
name: add-features
description: "Plan new features to add to an existing onboarded project. Analyzes impact on existing modules, designs features that fit the current architecture, and ensures backward compatibility."
---

# Add Features to Existing Project

## Input
The user will describe what new capabilities they want.

## Prerequisites
- docs/ARCHITECTURE.md and docs/FEATURES.json must exist (run /onboard first if not)

## Process

### 1. Understand Current State
Read docs/ARCHITECTURE.md, docs/FEATURES.json, docs/PLAN.md, docs/PROGRESS.md

### 2. Analyze Impact
For each requested feature: which existing modules are affected? New modules needed? Database schema changes? New dependencies? Conflicts with existing features?

### 3. Design Features
For each new feature, following the existing architecture:
- Description, User Story, Affected Modules, New Files, Schema Changes
- Dependencies (reference existing E-prefix features)
- Acceptance Criteria (MUST include "All existing tests continue to pass")
- Sprint Contract (deliverable + verification)

### 4. Update docs/PLAN.md
Append a "New Features" section with impact analysis and feature specs.

### 5. Update docs/FEATURES.json
Append new features with `F` prefix IDs, status `"not-started"`.
Do NOT modify any existing feature entries.

### 6. Update docs/PROGRESS.md
Log what was planned and recommend next steps.

### 7. Report
Tell the user to switch to builder agent and run /next-feature.
