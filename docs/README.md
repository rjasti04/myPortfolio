# Documentation

Reference documentation for `rjWebApp`. Start with the root
[`README.md`](../README.md) for setup and quick start.

## Map

| Document | Read it when you need... |
| :--- | :--- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The system topology, the repository map, the request lifecycle, or how data moves between tiers |
| [`API.md`](API.md) | The HTTP contract: every endpoint, its auth, its limits, its error shapes |
| [`BACKEND.md`](BACKEND.md) | What each `server/` package does and why it is shaped that way |
| [`DATABASE.md`](DATABASE.md) | Tables, columns, indexes, the migration chain, and the rules for changing them |
| [`FRONTEND.md`](FRONTEND.md) | The page shell, CSS organisation, PWA behaviour, fonts, the build |
| [`DESIGN.md`](DESIGN.md) | The design tokens: the scales, the colour rules, and what is deliberately off-scale |
| [`JAVASCRIPT.md`](JAVASCRIPT.md) | Any ES module: its exports, its responsibilities, its storage keys |
| [`CONFIGURATION.md`](CONFIGURATION.md) | Any environment variable, its default, and what breaks without it |
| [`SECURITY.md`](SECURITY.md) | The auth model, capability tokens, rate limits, CSP, or the pre-merge checklist |
| [`OPERATIONS.md`](OPERATIONS.md) | Build, CI/CD, deploy, rollback, monitoring, or the runbook |
| [`TESTING.md`](TESTING.md) | What each suite covers, how to run it, and what is deliberately untested |
| [`ADR.md`](ADR.md) | Why a decision was made, and whether it still holds |
| [`ECC.md`](ECC.md) | What of Everything Claude Code is vendored into `.claude/`, what was refused, and how to upgrade or remove it |

[`../AGENTS.md`](../AGENTS.md) is the operating protocol for AI agents working in
this repository, including context-efficient navigation of the large files.

## Task index

| Task | Read |
| :--- | :--- |
| Set the project up locally | [`../README.md`](../README.md) |
| Add or change an API endpoint | [`API.md`](API.md) → [`BACKEND.md`](BACKEND.md) → [`SECURITY.md`](SECURITY.md#checklist-for-changes) |
| Change the database schema | [`DATABASE.md`](DATABASE.md#working-with-migrations) |
| Add or refactor a frontend module | [`JAVASCRIPT.md`](JAVASCRIPT.md) → [`FRONTEND.md`](FRONTEND.md) |
| Change styling | [`DESIGN.md`](DESIGN.md) for the token to use → [`FRONTEND.md`](FRONTEND.md#styling) — get the `#region` map first |
| Edit `index.html` | [`FRONTEND.md`](FRONTEND.md#content-security-policy) — the CSP hashes will bite otherwise |
| Add a config value | [`CONFIGURATION.md`](CONFIGURATION.md) and `.env.example` |
| Add a dependency | [`OPERATIONS.md`](OPERATIONS.md#manual-procedures) — regenerate **both** locks |
| Diagnose a failing deploy | [`OPERATIONS.md`](OPERATIONS.md#runbook) |
| Understand a past decision | [`ADR.md`](ADR.md) |
| Write a test | [`TESTING.md`](TESTING.md#writing-new-tests) |
| Add, upgrade or remove an ECC skill | [`ECC.md`](ECC.md#upgrading) — the `--skills` list and `check_agent_config.py` must move together |

## Keeping these accurate

These files describe behaviour, not intentions. When a change makes one of them
wrong, fix it in the same change — a confidently wrong document costs more than
a missing one.

The *numbers* drift faster than the prose, because a wrong sentence is obvious
on the next read and a wrong line count is not. `scripts/check_docs.py` guards
the derivable ones — file sizes, grep yields, per-module line counts, module and
test-file coverage — and runs in the `frontend-check` gate. Run it with `--fix`
to apply the corrections, then re-read what surrounds a number that moved a long
way: the description above it is usually stale too.

The highest-drift areas it cannot check, in practice:

- **Endpoint lists** — `API.md` and `test_frontend_api_contract.py`.
- **Environment variables** — `CONFIGURATION.md` and `.env.example`.
- **Event types** — `API.md`, `JAVASCRIPT.md` and `schemas/event.py`.
- **Module exports** — `JAVASCRIPT.md`.
- **Deploy steps** — `OPERATIONS.md` and `.github/workflows/deploy.yml`.
