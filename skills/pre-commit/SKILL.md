---
name: pre-commit
description: "Run quality validation checks before committing. Tests pass, no hardcoded secrets, imports resolve, FEATURES.json consistency, progress logged. Use before every git commit."
---

# Pre-Commit Validation

Run these checks in order. If any FAIL, fix before committing:

For assigned work, mark shared-state checks N/A and follow the assignment
boundary; this skill does not authorize a commit.

### 1. Tests Pass
Use the project's configured test commands, starting with the smallest suite
covering the change and including required project checks. Examples:
- Python: `pytest tests/ -v`
- Node/TypeScript: `npm test` or `npx vitest run`
- Go: `go test ./...`
- If no test runner is configured, record tests as NOT RUN, not passed.

For applicable security, tenant isolation, and billing controls, use `/testing`
to check required project gates; report missing evidence rather than passing it.

### 2. No Hardcoded Secrets
Use the configured secret scanner when available without printing credentials;
heuristic searches do not guarantee that no secrets exist.

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
Required controls:  [PASS / FAIL / NOT VERIFIED / N/A with reason]

Ready to commit / Needs fixes / Blocked
```

Required failures or missing required evidence cannot result in Ready to commit.
These checks are guidance; actual enforcement depends on configured project
tests, CI, and repository protections.
