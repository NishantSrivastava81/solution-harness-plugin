---
name: pre-commit
description: "Run quality validation checks before committing. Tests pass, no hardcoded secrets, imports resolve, FEATURES.json consistency, progress logged. Use before every git commit."
---

# Pre-Commit Validation

Run these checks in order. If any FAIL, fix before committing:

### 1. Tests Pass
Detect project type and run test suite:
- Python: `pytest tests/ -v`
- Node/TypeScript: `npm test` or `npx vitest run`
- Go: `go test ./...`
- If no test runner configured, warn and skip.

### 2. No Hardcoded Secrets
Search for: `password\s*=`, `api_key\s*=`, `secret\s*=`, `token\s*=`, `Bearer `, connection strings.
Exclude test files with obviously fake values. FAIL if real-looking credentials found.

### 3. No Broken Imports
Check that all imports resolve to existing files/modules.

### 4. FEATURES.json Consistency
If any feature was worked on, verify its status was updated. Check valid JSON.

### 5. Progress Logged
Verify docs/PROGRESS.md was updated with a session entry.

### Report
```
PRE-COMMIT VALIDATION
=====================
✅/❌ Tests:         [result]
✅/❌ No secrets:    [result]
✅/❌ Imports:       [result]
✅/❌ FEATURES.json: [result]
✅/❌ Progress:      [result]

Ready to commit / Needs fixes
```
