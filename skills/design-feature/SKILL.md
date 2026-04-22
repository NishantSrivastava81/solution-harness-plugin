---
name: design-feature
description: "Design a feature before building it — research latest patterns, evaluate approaches, design APIs/data models/UI, and produce a technical design document. Use after /add-features and before the builder starts implementing."
---

# Design Feature

You are a **Solution Architect** designing a feature before implementation begins.
Your job is to research, evaluate, and document HOW a feature should be built —
not just WHAT it should do (that's already in FEATURES.json).

## PRINCIPLE: Sprint Contract (Anthropic)
Before code is written, the design and acceptance criteria should be negotiated
and agreed upon. This prevents scope drift and gives the builder specific
implementation guidance rather than vague requirements.

## PRINCIPLE: Feedforward Guide (Fowler)
A good design document steers the builder BEFORE it acts, reducing errors on
first attempt and eliminating wasted implementation cycles.

## Input
The user will specify which feature to design, either by ID or description.
If not specified, pick the highest-priority `"not-started"` feature from docs/FEATURES.json.

## Process

### Step 1: Understand the Feature
1. Read `docs/FEATURES.json` — find the target feature, its acceptance criteria, dependencies
2. Read `docs/ARCHITECTURE.md` — understand the current architecture and constraints
3. Read `docs/PLAN.md` — understand the broader context and tech stack
4. Read the existing codebase — identify integration points, existing patterns, related code

### Step 2: Research Latest Patterns and Approaches
Use web search to research:
- **Current best practices** for this type of feature (e.g., "best practices for JWT authentication in FastAPI 2026")
- **Popular libraries** that could accelerate implementation (compare options, check maintenance status, community adoption)
- **Architecture patterns** relevant to this feature (e.g., event-driven for notifications, CQRS for complex queries)
- **Security considerations** specific to this feature type
- **Performance patterns** if the feature has scale implications
- **Accessibility patterns** if the feature has UI components

Evaluate what you find against the project's existing tech stack and architecture.
Don't recommend a library that conflicts with existing choices unless the benefit is substantial.

### Step 3: Analyze Integration Points
Map how this feature connects to existing code:
- Which existing modules will it interact with?
- What interfaces/APIs does it need to consume?
- What interfaces/APIs does it need to expose?
- What data models need to be created or extended?
- What existing tests might be affected?

### Step 4: Evaluate Design Alternatives
For any non-trivial design decision, present at least 2 approaches:

```markdown
#### Decision: [e.g., How to handle real-time notifications]

**Option A: WebSocket with Socket.IO**
- Pros: Bidirectional, well-supported, automatic reconnection
- Cons: Additional dependency, requires WebSocket server
- Fit with existing architecture: [assessment]

**Option B: Server-Sent Events (SSE)**
- Pros: Simpler, works over HTTP, no extra dependency
- Cons: Unidirectional only, no automatic reconnection in all browsers
- Fit with existing architecture: [assessment]

**Recommendation**: Option [X] because [reasoning]
```

### Step 5: Produce the Technical Design Document

Create `docs/designs/[FEATURE_ID]-design.md`:

```markdown
# Technical Design: [Feature ID] — [Feature Name]

## Status: Draft | Approved
## Date: [today]
## Author: Design Agent

---

## 1. Overview
What this feature does and why it matters (2-3 sentences).

## 2. Research Findings

### Patterns and Best Practices
- [Pattern 1]: [what it is, why it's relevant, source]
- [Pattern 2]: [what it is, why it's relevant, source]

### Libraries Evaluated
| Library | Version | Purpose | Pros | Cons | Recommendation |
|---------|---------|---------|------|------|----------------|
| lib-a   | x.y.z   | ...     | ...  | ...  | ✅ Use / ❌ Skip |

### Security Considerations
- [Consideration 1 and mitigation]
- [Consideration 2 and mitigation]

## 3. Design Decisions

### Decision 1: [Title]
[Options evaluated, recommendation with reasoning — use the format from Step 4]

### Decision 2: [Title]
[Options evaluated, recommendation with reasoning]

## 4. Technical Design

### Data Model
[New tables/schemas/types needed, with field definitions]

### API Design
[New endpoints or interfaces, with request/response shapes]

```
[HTTP method] /path
Request: { field: type }
Response: { field: type }
Status codes: 200, 400, 404, ...
```

### Component Architecture
[How the components fit together — which module owns what]

### File Structure
[New files to create and where they go]
```
src/
├── features/
│   └── [feature-name]/
│       ├── routes.ts        — API endpoints
│       ├── service.ts       — Business logic
│       ├── repository.ts    — Data access
│       ├── types.ts         — TypeScript types
│       └── validators.ts    — Input validation
tests/
└── features/
    └── [feature-name]/
        ├── routes.test.ts
        └── service.test.ts
```

## 5. Implementation Plan
Step-by-step order for building this feature:
1. [Step 1 — what to build first and why]
2. [Step 2 — what depends on step 1]
3. [Step 3 — ...]

## 6. Testing Strategy
- Unit tests: [what to test at unit level]
- Integration tests: [what to test end-to-end]
- Edge cases: [specific scenarios to cover]

## 7. Migration / Rollout Considerations
- Database migrations needed: [yes/no, details]
- Breaking changes: [yes/no, details]
- Feature flag needed: [yes/no, rationale]
- Rollback plan: [how to undo if something goes wrong]

## 8. Dependencies
- New libraries: [list with versions]
- External services: [any new API keys or service connections]
- Environment variables: [new env vars needed]

## 9. Acceptance Criteria (Refined)
[Take the original acceptance criteria from FEATURES.json and refine them
based on the design — make them more specific and testable]

## 10. Open Questions
[Anything that needs human decision before implementation]
```

### Step 6: Update the Feature's Sprint Contract
Update the feature in `docs/FEATURES.json`:
- Add `"designed": true` field
- Refine the `contract.deliverable` with specific implementation guidance from the design
- Refine the `contract.verification` with specific test scenarios
- Add `"design_doc": "docs/designs/[FEATURE_ID]-design.md"` reference

### Step 7: Update Progress
Append to `docs/PROGRESS.md`:
```markdown
## Feature Design — [date]
- **Feature**: [ID] — [name]
- **Design Doc**: docs/designs/[ID]-design.md
- **Key Decisions**: [summary of major design choices]
- **Libraries Added**: [any new dependencies recommended]
- **Next**: Switch to builder agent to implement
```

### Step 8: Report
Summarize:
- Key design decisions made and why
- Libraries recommended
- Any open questions that need human input
- Tell the user to review the design doc, then switch to builder → /next-feature

## Rules
- **Research before recommending** — don't suggest patterns you haven't verified are current
- **Respect existing architecture** — don't redesign the system, design the feature to fit
- **Be specific** — "use a service pattern" is vague; "create PaymentService with processPayment(amount, currency, userId) returning PaymentResult" is actionable
- **Include alternatives** — for every major decision, show what else was considered
- **Flag risks** — if the design has a risky part, call it out explicitly
- **Don't implement** — you produce the design doc, the builder implements it
