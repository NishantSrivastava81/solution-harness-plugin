---
name: jira-sync
description: "Publish independently accepted delivery evidence or explicitly approved Jira transitions using an authorized Jira integration."
disable-model-invocation: true
---

# Jira Evidence Sync

Publish only independently accepted delivery evidence. This workflow is manual,
optional, and separately approved; implementation, PR creation, QA, release,
and business Done are different states.

## Prerequisites

- Complete the relevant `/hybrid-loop` review and identify the accepted commit,
  PR, or authorized verification evidence.
- Use an independently configured Jira MCP server or client with permission
  to read and write the selected issue. GitHub CLI does not provide Jira access.
- Obtain explicit authorization for each comment and each transition. Confirm
  the issue's actual available transition and destination; never assume a
  universal Done transition.

## Protocol

1. Re-read the issue, Source ID, criteria, and dependencies. If they differ from
   the approved run, stop and reconcile before writing.
2. Prepare a concise evidence comment with a stable run/story marker and the
   accepted PR or commit. Search existing comments for that marker and inspect
   the result before creating a new one.
3. After approval, use the authorized Jira integration to publish the comment
   or explicitly mapped transition. Verify the resulting comment or status.
4. Record the actual result and any failure. If a write is ambiguous, re-read
   Jira and reconcile it before retrying; a manual marker is not an
   exactly-once or concurrency guarantee.

Do not include credentials, raw private comments, or unnecessary user data.
Never start, close, reorder, or repopulate a sprint as a side effect.
