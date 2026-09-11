---
name: verify
description: Independent verification orchestration skill that executes non-mutating quality gates and invokes the verifier subagent.
---

# Independent Verification Protocol (/verify)

When `/verify` is invoked:

## 1. Targeted Quality Gate Execution
Determine impacted layers from `git status` / `git diff` and execute applicable gates:

```bash
# Frontend
npm run lint && npm test && npm run build

# Backend
ruff check server tests
PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55

# Hashes & Documentation Invariants
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py --show-tokens
```

## 2. Independent Verifier Subagent Delegation
Invoke the `.claude/agents/verifier.md` subagent to conduct a clean-context evaluation of the repository and verify that no unwanted temporary files or uncommitted artifacts remain.

## 3. Reporting
Format output strictly into the `AGENTS.md §5` table format or report `VERIFICATION PASSED`.
