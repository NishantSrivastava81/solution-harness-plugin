---
name: evaluate
description: "Evaluate features against acceptance criteria and applicable SaaS isolation, security, usage, and operational evidence; mark failures as needs-rework."
---

# Evaluate Solution

For an explicitly assigned local, cloud, or Jira candidate, use the evaluator
agent's assigned-candidate mode instead of the shared report/status-writing
protocol below. Confirm the run, exact candidate SHA, base SHA, and criteria;
review independently and return the structured verdict in the
[parallel guide](../../parallel/README.md) to the coordinator. A final feature
review must cover all parent criteria. Never write shared status or repair a
candidate from an evaluator workspace.

Run the full evaluator protocol:

1. Read `docs/PLAN.md`, `docs/FEATURES.json`, `docs/PROGRESS.md`, and `docs/ARCHITECTURE.md`
2. For every feature marked `"complete"`:
   - Verify each acceptance criterion against the actual code
   - Run tests if they exist
   - Assess applicable safety and operational controls using the checklist below
   - Score on Completeness, Correctness, Code Quality, Test Coverage, Architecture Fit (1-5 each)
   - Hard threshold: any score ≤ 2 means FAIL
3. Write the evaluation report to `docs/EVALUATION.md`
4. Update any failed features to status `"needs-rework"` in `docs/FEATURES.json`
5. Summarize results and recommend next steps

Be skeptical. The builder tends to approve its own work — your job is to catch what it missed.

## Applicable SaaS and Operational Evidence

For SaaS or tenant-scoped work, use the approved requirements and architecture
to assess applicable isolation, authorization, privacy, and usage controls.
Confirmed cross-tenant exposure or a failed or unverified required control means
FAIL regardless of score. Report evidence and gaps; this is not compliance
certification. Do not add billing requirements to non-billable work.

For assigned candidates, keep `criteria[].result` as PASS or FAIL and explain
missing evidence rather than inventing results.

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
