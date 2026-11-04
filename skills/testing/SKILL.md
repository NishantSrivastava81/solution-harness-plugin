---
name: testing
description: "Write and run project tests, including tenant isolation, authorization, metering, telemetry privacy, and resilience when applicable."
---

# Testing Skill

## When to Use
- After implementing a feature, to write and run tests
- When an evaluator reports failing or missing tests
- When verifying that existing tests still pass after changes

## Test Writing Guidelines

### Structure
- Place tests in `tests/` directory, mirroring `src/`
- Name test files with `test_` prefix (Python) or `.test.` / `.spec.` (JS/TS)

### Naming
- GOOD: `test_login_rejects_invalid_email_format`
- BAD: `test_login_1`

### Coverage Priorities
1. Happy path — the normal expected flow
2. Error handling — invalid inputs, network failures, missing data
3. Edge cases — empty strings, zero values, boundary conditions
4. Integration — components working together

### SaaS and Operational Tests (when applicable)

Use approved requirements and safe fixtures, not production data:

- Verify isolation and authorization with at least two tenant identities,
  including denied cross-tenant access.
- Check telemetry privacy and relevant failure or recovery behavior.
- For billable work, test usage attribution and duplicate or retried events
  against the agreed billing rules.

### Running Tests
- Prefer the project's configured commands and the smallest suite covering the change.
- Python: `pytest tests/ -v`
- Node/TypeScript: `npm test` or `npx vitest run`
- Go: `go test ./...`
- Rust: `cargo test`

### Verifying Results
Report total, passed, failed, and skipped. For failures, show the specific test
name and error without exposing secrets. Missing required evidence is
**NOT VERIFIED**, not a pass; explicitly report unrun checks and blockers.
