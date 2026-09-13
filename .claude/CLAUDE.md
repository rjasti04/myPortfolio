@../AGENTS.md

# Claude Code Project Configuration

`AGENTS.md` above is the project-wide source of truth and is imported, not linked.
Do not duplicate its rules here.

Use this project's Skills and Subagents when their descriptions match the task.

## When Compacting This Conversation

Carry forward, in this order:

1. **The task and its acceptance gates** — which of `check_docs.py`,
   `check_csp_hashes.py`, `PYTHONPATH=. pytest`, `npm test` and `npm run lint`
   this change has to pass, and which have actually been run and passed.
2. **Decisions and their reasons** — especially anything weighed against an ADR
   or `AGENTS.md`, so a settled question is not reopened.
3. **Paths already located** — the `grep -n` results and line ranges that
   replaced a whole-file read. Losing these is what makes a compacted session
   re-read `styles.css` and burn 91,000 tokens twice.
4. **What is still unverified** — assumptions stated but not checked, and gates
   not yet run.

Drop: file contents already read, full tool output, superseded drafts, and any
exploration that led nowhere. Keep the conclusion, not the transcript.
