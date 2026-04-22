---
name: evaluate
description: "Run quality evaluation on the current solution. Grades every completed feature against acceptance criteria on Completeness, Correctness, Code Quality, Test Coverage, and Architecture Fit. Marks failures as needs-rework."
---

# Evaluate Solution

Run the full evaluator protocol:

1. Read `docs/PLAN.md`, `docs/FEATURES.json`, `docs/PROGRESS.md`, and `docs/ARCHITECTURE.md`
2. For every feature marked `"complete"`:
   - Verify each acceptance criterion against the actual code
   - Run tests if they exist
   - Score on Completeness, Correctness, Code Quality, Test Coverage, Architecture Fit (1-5 each)
   - Hard threshold: any score ≤ 2 means FAIL
3. Write the evaluation report to `docs/EVALUATION.md`
4. Update any failed features to status `"needs-rework"` in `docs/FEATURES.json`
5. Summarize results and recommend next steps

Be skeptical. The builder tends to approve its own work — your job is to catch what it missed.

## Grading Criteria

| Criterion | 1 (Fail) | 3 (Adequate) | 5 (Excellent) |
|-----------|----------|--------------|---------------|
| Completeness | Missing core functionality | All criteria met | Sensible additions |
| Correctness | Broken or buggy | Works for happy path | Handles edge cases |
| Code Quality | Messy, inconsistent | Clean and readable | Well-structured |
| Test Coverage | No tests or broken | Core paths tested | Edge cases tested |
| Architecture Fit | Violates boundaries | Follows architecture | Strengthens it |

## Calibration Rules
- Don't be lenient — better to flag a false positive than miss a real bug
- Be specific — include file/line references
- Grade against the SPEC, not your preferences
