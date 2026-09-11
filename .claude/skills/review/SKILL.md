---
name: review
description: Code review orchestration skill that delegates to specialist subagents and consolidates structured review findings according to .claude/REVIEW.md.
---

# Code Review Protocol (/review)

When `/review` is invoked:

## 1. Context & Scope Determination
1. Read `.claude/REVIEW.md` for team review policy and severity definitions.
2. Determine impacted layers based on `git diff` or changed files.
3. Select relevant specialist subagents in `.claude/agents/`:
   - `frontend-reviewer` (if `frontend/` files changed)
   - `backend-reviewer` (if `server/` or `tests/backend/` changed)
   - `security-reviewer` (if auth, API routes, permissions, secrets, or dependencies changed)

## 2. Review Delegation & Specialist Execution
Invoke selected specialist agents. Specialists perform read-only review with concrete code location citations.

## 3. Findings Consolidation
1. Consolidate findings from specialists.
2. Deduplicate findings across agents.
3. Format output strictly into the `AGENTS.md §5` table format:

| Category | Severity | Location | The "Why" | The Fix |
| :--- | :--- | :--- | :--- | :--- |
| (Bug/Security/Performance/Architecture) | (Critical/High/Medium/Low) | `file:line` | Impact description | Concrete resolution |

If no issues are identified, report:
`REVIEW PASSED: Zero defects found across inspected layers.`
