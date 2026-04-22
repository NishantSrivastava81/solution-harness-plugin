---
name: onboard
description: "Onboard an existing codebase into the harness. Analyzes the project, documents architecture, catalogs existing features, and creates all harness state files. Use when you want to apply the harness to a project that already has code."
---

# Onboard Existing Project

You are onboarding an existing codebase into the solution harness.
This is NOT a greenfield project — code already exists. Your job is to
**understand what's here** and generate the harness state files so that
all agents can work effectively on this codebase.

## Step 1: Analyze the Existing Codebase

### Project Basics
- Read README.md, CONTRIBUTING.md, any existing docs
- Identify language(s), framework(s), runtime(s)
- Find package manager and dependency files
- Locate entry point(s)

### Build & Run
- Find and document build commands
- Run the build to verify it works — document any issues
- Run tests if they exist — document pass/fail status
- Document environment setup requirements

### Architecture
- Map directory structure and identify modules/packages
- Trace dependency graph between modules
- Identify architectural pattern (MVC, layered, microservices, monolith, etc.)
- Find cross-cutting concerns (auth, logging, config, error handling)
- Identify data storage

### Code Patterns
- Note naming conventions, formatting style, error handling patterns
- Check for linting config
- Identify existing test patterns

### Current State Assessment
- Search for TODO, FIXME, HACK, XXX comments
- Check git log for recent activity
- Note visible technical debt

## Step 2: Create Harness Files

Create AGENTS.md at the project root (same format as /init-solution produces).

Create `.github/copilot-instructions.md` — **adapt to the project's EXISTING conventions** (naming, formatting, patterns). Don't impose new conventions that conflict with the established codebase.

Create `.github/instructions/docs-protection.instructions.md` and `.github/instructions/test-standards.instructions.md`.

## Step 3: Generate docs/IDEA.md
Document what this project is, its current state, and that it was onboarded (not greenfield).

## Step 4: Generate docs/ARCHITECTURE.md
Document the ACTUAL architecture — module structure, boundary rules, data flow, cross-cutting concerns, known technical debt.

## Step 5: Generate docs/PLAN.md
Document overview, tech stack, existing features with locations and quality assessments, build/run/test commands, environment requirements.

## Step 6: Generate docs/FEATURES.json
Catalog existing features with `E` prefix IDs and status `"existing"`:
```json
{
  "project_type": "onboarded",
  "onboarded_date": "[today]",
  "features": [
    {
      "id": "E001",
      "name": "Existing Feature Name",
      "priority": 0,
      "status": "existing",
      "description": "What this feature does",
      "location": ["src/module/file.ts"],
      "test_coverage": "partial",
      "quality": "good",
      "acceptance_criteria": ["Criterion based on observed behavior"],
      "contract": { "deliverable": "Already implemented", "verification": "Existing tests pass" },
      "dependencies": []
    }
  ]
}
```

## Step 7: Initialize docs/PROGRESS.md
```markdown
# Progress Log

## Project Onboarded — [today's date]
- **Type**: Existing codebase onboarded into harness
- **Language**: [language]
- **Framework**: [framework]
- **Size**: ~[N] source files
- **Test Coverage**: [assessment]
- **Architecture Health**: [assessment]
- **Known Issues**: [count] TODOs/FIXMEs found
- **Build Status**: [passing/failing]
- **Next**: Ready for /add-features or /refactor
```

## Step 8: Report
Summarize what was analyzed, key findings, and recommend next steps (/add-features or /refactor).
