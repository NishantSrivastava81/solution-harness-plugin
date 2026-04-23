---
name: init-solution
description: "Initialize a new harness-managed solution project from a brief idea. Use when starting a brand new project. Creates docs/IDEA.md, docs/PLAN.md, docs/FEATURES.json, docs/ARCHITECTURE.md, docs/PROGRESS.md, AGENTS.md, and .github/copilot-instructions.md."
---

# Initialize Solution

You are setting up a brand new harness-managed solution project.

## Input
The user will provide a brief idea (1-4 sentences), OR a detailed specification
may already exist at `docs/SPEC.md` from a prior `/ideate` session.

**Check for docs/SPEC.md first.** If it exists, use it as the primary input instead
of asking for a brief idea. The spec contains researched scope, MVP features, tech stack
decisions, and trade-offs already explored with the user.

## Steps

### 0. Check for Existing Artifacts
Check for pre-existing artifacts from earlier harness steps:

**docs/SPEC.md** (from `/ideate` or ideator agent):
If it exists, use it as the primary input. Skip research (Step 6).

**docs/ARCHITECTURE.md** (from architect agent):
If it exists, **DO NOT overwrite it**. Read it and use it to:
- Align the tech stack in PLAN.md with the architectural decisions
- Shape FEATURES.json — features should follow the module structure defined in the architecture
- Ensure acceptance criteria reference the correct module boundaries and patterns
- Skip generating a new ARCHITECTURE.md in Step 7

If ARCHITECTURE.md does NOT exist, generate a basic one in Step 7 as before.

### 1. Save the Idea
Create `docs/IDEA.md` with the user's idea, verbatim. Do not modify it.

### 2. Create AGENTS.md
Create `AGENTS.md` at the project root — a short table of contents (not an encyclopedia, ~70 lines max):

```markdown
# Solution Harness Project

## How to Work in This Repository
1. Read the plan before writing any code: docs/PLAN.md
2. Check progress: docs/PROGRESS.md for what's been done, docs/FEATURES.json for what's next
3. Work one feature at a time
4. Commit after each feature with a descriptive message
5. Update progress in docs/PROGRESS.md after every session

## Key Rules
- Never remove or edit feature definitions in FEATURES.json — only change status fields
- Always start a session by reading PROGRESS.md and FEATURES.json
- Always end a session by committing code + updating PROGRESS.md
- Run tests before marking any feature complete
- One feature at a time

## Project Structure
docs/          — Plan, features, progress, architecture
src/           — Application source code
tests/         — Test files

## Available Agents
planner, builder, evaluator, reviewer, janitor

## Available Skills (/ commands)
/init-solution, /onboard, /add-features, /refactor, /fix-issue, /next-feature, /evaluate, /pre-commit, /status, /log-progress, /harness-health
```

### 3. Create .github/copilot-instructions.md
Create `.github/copilot-instructions.md` with project-wide coding standards:

```markdown
# Coding Standards

## Incremental Development
- Work on exactly ONE feature at a time from docs/FEATURES.json
- Never attempt to build the entire solution in a single pass
- After completing a feature, commit before moving to the next

## Session Protocol
- Start: Read docs/PROGRESS.md and docs/FEATURES.json
- During: Work on highest-priority incomplete feature
- End: Commit code, update docs/PROGRESS.md

## Feature Lifecycle
1. Read feature spec from docs/FEATURES.json
2. Understand acceptance criteria before writing code
3. Implement the feature
4. Write or update tests
5. Run tests to verify
6. Update feature status to "complete" in FEATURES.json
7. Log progress in PROGRESS.md
8. Commit: feat(F###): description

## Code Quality
- Meaningful variable and function names
- Error handling at system boundaries
- No hardcoded secrets — use environment variables
- Follow the project's established patterns

## What NOT to Do
- Do not refactor code unrelated to the current feature
- Do not add features not in the plan
- Do not remove or modify feature definitions in FEATURES.json
- Do not skip the progress log update
```

### 4. Create .github/instructions/docs-protection.instructions.md
Create `.github/instructions/docs-protection.instructions.md`:

```markdown
---
applyTo: "docs/**"
---
# Documentation File Rules
- IDEA.md is read-only
- PLAN.md can only be modified by the planner agent
- FEATURES.json — only modify status fields
- PROGRESS.md — only append new entries
```

### 5. Create .github/instructions/test-standards.instructions.md
Create `.github/instructions/test-standards.instructions.md`:

```markdown
---
applyTo: "tests/**"
---
# Test Standards
- Descriptive test names explaining the scenario
- Arrange-act-assert structure
- Mock external dependencies, not internal modules
- Independent tests — no shared mutable state
```

### 6. Research (Optional)
If the idea references specific technologies or domains, do a quick search to gather context.

### 7. Generate the Plan
- Write `docs/PLAN.md` with the complete product specification (overview, tech stack, architecture, features with user stories and acceptance criteria, non-functional requirements, out of scope). If `docs/ARCHITECTURE.md` already exists, reference it for tech stack and architecture sections rather than inventing new choices.
- Generate `docs/FEATURES.json` with 8-15 prioritized features, all status `"not-started"`. If `docs/ARCHITECTURE.md` exists, align features with its module structure — each feature should map to the modules defined there.
- Use this format for FEATURES.json:

```json
{
  "features": [
    {
      "id": "F001",
      "name": "Feature Name",
      "priority": 1,
      "status": "not-started",
      "description": "What this feature does",
      "acceptance_criteria": ["Criterion 1", "Criterion 2"],
      "contract": {
        "deliverable": "What to build",
        "verification": "How to verify it works"
      },
      "dependencies": []
    }
  ]
}
```

- **Only if `docs/ARCHITECTURE.md` does NOT already exist**: Write `docs/ARCHITECTURE.md` with module boundaries, dependency rules, data flow, key technical decisions. If it already exists (from the architect agent), skip this — the existing one is more thorough.

### 8. Initialize Progress Tracking
Create `docs/PROGRESS.md`:

```markdown
# Progress Log

## Project Initialized — [today's date]
- **Idea**: [brief summary]
- **Plan**: docs/PLAN.md
- **Features**: [count] features planned
- **Status**: Ready for implementation
- **Next**: Begin with F001
```

### 9. Create src/ and tests/ directories
Create empty `src/` and `tests/` directories.

### 10. Initialize Git
```
git init
git add .
git commit -m "init: harness-managed solution project"
```

### 11. Report
Summarize what was created and tell the user to switch to the **builder** agent to start implementing features with `/next-feature`.
