---
name: architecture-check
description: "Verify that the codebase follows the documented architecture. Checks for module boundary violations, circular dependencies, and cross-cutting concern leaks."
---

# Architecture Check

## When to Use
- After implementing multiple features
- When evaluator or reviewer flags architecture concerns
- Before major refactoring decisions

## Check Protocol

### 1. Read docs/ARCHITECTURE.md
Understand module boundaries, dependency direction rules, cross-cutting concern patterns.

### 2. Scan for Violations

#### Module Boundary Violations
Check import statements. Verify modules only import from allowed dependencies.

#### Circular Dependencies
Trace import chains to detect cycles (A imports B, B imports C, C imports A).

#### Cross-Cutting Concern Leaks
Auth, logging, config, database access should go through dedicated modules only.

### 3. Report

```markdown
# Architecture Health Report

## Module Boundary Check
| Source File | Imports From | Violation? | Details |

## Circular Dependencies
[None found / List of cycles]

## Cross-Cutting Concerns
- Auth: [Clean / Violations]
- Logging: [Clean / Violations]
- Config: [Clean / Violations]

## Architecture Drift Score: [Low / Medium / High]

## Recommendations
1. [Specific actionable fix]
```
