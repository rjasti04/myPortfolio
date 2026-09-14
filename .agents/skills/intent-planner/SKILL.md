---
name: intent-planner
description: Rules for interviewing the user to capture feature requirements and saving distinct intent documents without overwriting templates.
---

# Feature Planning & Intent Capture Protocol

Whenever a user asks to plan, design, or prepare an intent document for a new initiative:

## 1. Interview Workflow

**Interactive sessions only.** In a non-interactive run - Claude Code on the web,
a scheduled run, CI - nobody is there to answer, and `AGENTS.md` §2 is explicit
that such a session must never end having produced nothing but a question. There,
skip the interview: infer the answers below from the request and the repo, write
the intent file with an **Assumptions** section stating what you chose and why,
and say so in your summary.

1. **Never ask the user to fill out the intent template manually.**
2. Conduct a brief, targeted interview (2–4 concise questions):
   - **Target Persona**: Is this for Visitors/Recruiters, the portfolio as a Work Sample, or the Owner?
   - **Core Need**: What problem does this solve?
   - **Non-Goals**: What should this explicitly NOT do? (Cross-reference ADR-001, ADR-016, ADR-023).
   - **Acceptance Criteria**: What deterministic checks verify completion?

## 2. File Destination Rule (Never Overwrite the Template)
- **Strictly do NOT edit or overwrite** `.claude/templates/intent.md` or `.claude/templates/spec.md`.
- Always generate and save to a new, distinct file:
  - Intent: `.claude/intents/YYYY-MM-DD-<feature-slug>.md`
  - Technical Spec (if requested): `.claude/specs/YYYY-MM-DD-<feature-slug>.md`
  *(Example: `.claude/intents/2026-09-10-login-alerts.md`)*

## 3. Post-Creation Confirmation
Present the path of the newly created intent file to the user. In an interactive
session, wait for confirmation before moving to implementation. In a
non-interactive one, state the path and the assumptions you made and continue -
do not stop and wait for an answer that cannot arrive.
