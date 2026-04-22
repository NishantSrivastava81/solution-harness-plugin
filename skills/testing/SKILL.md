---
name: testing
description: "Run and verify tests for the current project. Provides patterns for writing good tests, detecting project type, and running appropriate test suites."
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

### Running Tests
- Python: `pytest tests/ -v`
- Node/TypeScript: `npm test` or `npx vitest run`
- Go: `go test ./...`
- Rust: `cargo test`

### Verifying Results
Report total, passed, failed, skipped. For failures, show the specific test name and error.
