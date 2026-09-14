---
name: verify
description: Independent verification orchestration skill that executes non-mutating quality gates and invokes the verifier subagent.
---

# Independent Verification Protocol (/verify)

When `/verify` is invoked:

## 1. Targeted Quality Gate Execution
Determine impacted layers from `git status` / `git diff`, then run the gates the
`testing` skill defines for those layers - it is the single source of truth for
the commands, and `.github/workflows/deploy.yml` runs the same ones.

Two differences apply here, because verification must not mutate the tree:

- `python3 scripts/check_docs.py --show-tokens` - never `--fix`.
- Report what you ran. A gate you skipped, and why, belongs in the output.

## 2. Independent Verifier Subagent Delegation
Invoke the `.claude/agents/verifier.md` subagent to conduct a clean-context evaluation of the repository and verify that no unwanted temporary files or uncommitted artifacts remain.

## 3. Reporting
Format output strictly into the `AGENTS.md §5` table format or report `VERIFICATION PASSED`.
