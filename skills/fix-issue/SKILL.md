---
name: fix-issue
description: "Diagnose and fix a bug in the existing codebase. Enforces: reproduce first, write failing test, implement smallest fix, verify all tests pass, document root cause."
---

# Fix Issue

## Input
The user will describe the bug, error message, or unexpected behavior.

## Process

### 1. Understand the Issue
Read docs/ARCHITECTURE.md and docs/FEATURES.json to identify the affected area.

### 2. Reproduce the Issue
NEVER skip reproduction. Read the code, run existing tests, reproduce manually if possible. If you can't reproduce, document what you tried and ask for more details.

### 3. Root Cause Analysis
Trace the call chain. Check recent git commits. Check if the same pattern exists elsewhere. Classify: logic error, data error, integration error, configuration error, or regression.

### 4. Write a Failing Test FIRST
Write a test that reproduces the exact bug scenario — it must FAIL with current code and PASS after the fix.

### 5. Implement the Fix
Smallest possible change. Don't refactor surrounding code. Fix all occurrences if the same bug exists elsewhere.

### 6. Verify
Run the new test (should pass). Run ALL existing tests (nothing else should break). Reproduce original issue (should be gone).

### 7. Log the Fix
Add a B-prefix entry to docs/FEATURES.json with status "complete". Update docs/PROGRESS.md with root cause, fix, and regression test. Commit: `fix(B###): description`

### 8. Check for Systemic Issues
Is this a pattern that could exist elsewhere? Suggest /refactor if so.

## Rules
- ALWAYS reproduce before fixing
- ALWAYS write a failing test first
- ALWAYS run full test suite after
- Smallest possible change
- Document the root cause
