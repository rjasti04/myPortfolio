# Technical Specification: Selective ECC Integration

**Related Intent**: `.claude/intents/2026-09-16-ecc-integration.md`
**Target Audience**: Work Sample / Owner

---

## 1. Architectural Impact & Component Overview
- **Impacted Layers**:
  - [ ] Frontend SPA (`frontend/js/`, `frontend/index.html`, `frontend/styles.css`)
  - [ ] Backend API (`server/routers/`, `server/services/`)
  - [ ] Database Schema (`server/models/`, `server/alembic/versions/`)
  - [ ] CI/CD & Deploy (`.github/workflows/deploy.yml`)
  - [x] **Agent configuration** (`.claude/`, `scripts/check_agent_config.py`, `tests/tooling/`, `docs/`)

This change touches no application code. It is confined to the agent-configuration tier
and the CI gate that validates it.

**Ownership boundary.** After this change `.claude/` holds two kinds of file:

| Owner | Paths | Rule |
| :--- | :--- | :--- |
| Project | everything not listed below | Hand-edited freely; ECC may never write here |
| ECC | `.claude/skills/{accessibility,context-budget,fastapi-patterns}/`, `.claude/ecc/` | Never hand-edited; replaced only by the installer |

ECC's own `scripts/lib/install/ownership-guard.js` refuses to write any destination that
already exists and is not recorded in its install-state, so the project side is protected
structurally, not just by convention. `scripts/check_agent_config.py` enforces the
converse: ECC may not grow past the three approved skills.

---

## 2. API Contract & Schemas
**N/A.** No route is added, removed or modified. No Pydantic schema changes. The vendored
`fastapi-patterns` skill is reference prose loaded on demand; it prescribes nothing and
`AGENTS.md` §1 ("match the idiom of the code you are editing") still governs.

---

## 3. Database Schema & Migration Plan
**N/A.** No model, index or migration changes. ADR-014 is untouched: ECC's
`database-migrations` skill is explicitly **not** installed, partly because it contains no
Alembic content at all and would compete with the project's `alembic-guard` skill.

---

## 4. Frontend Implementation & DOM Contract
**N/A.** No module, stylesheet or DOM change. ECC's `frontend-patterns` and `frontend-a11y`
skills are **not** installed because both are React/Next.js-centric and would contradict
ADR-001. The installed `accessibility` skill is framework-agnostic (WCAG 2.2 Level AA, zero
React references) and is the one piece of ECC frontend guidance compatible with this repo.

---

## 5. Security & Rate Limiting Review
- [x] Rate limits configured on endpoints - unchanged; no endpoint touched.
- [x] No secrets logged or returned in payload - no code path changes.
- [x] Inline script modifications accounted for in CSP hashes - `frontend/index.html` is not touched.
- [x] **No third-party runtime execution added.** ECC's 24 hooks run shell commands on
      every Bash, Edit, Write and Stop event. They are not installed, and `--enable-hooks`
      is never passed, so nothing in ECC gains a runtime trigger.
- [x] **Commit attribution preserved.** `.claude/settings.json` gains
      `"includeCoAuthoredBy": true` *before* the installer runs, so ECC's
      `scripts/lib/install/apply.js` leaves the key alone instead of writing `false`.

---

## 6. Implementation Steps

| # | Change | File |
| :--- | :--- | :--- |
| 1 | Add `"includeCoAuthoredBy": true` | `.claude/settings.json` |
| 2 | Dry-run, then install three skills, project-local, hooks off | (installer) |
| 3 | Add `check_vendored_ecc()` + call it from `main()` | `scripts/check_agent_config.py` |
| 4 | Add boundary regression tests | `tests/tooling/test_agent_config_check.py` |
| 5 | Exclude vendored markdown from the formatter | `.prettierignore` |
| 6 | Document the integration, rollback and upgrade path | `docs/ECC.md` (new) |
| 7 | Register the new doc | `.claude/rules/reference-docs.md`, `docs/README.md` |
| 8 | Refresh generated counts | `docs/TESTING.md`, `.claude/rules/reference-docs.md` |
| 9 | Point at the new doc in ≤ 6 always-loaded lines | `AGENTS.md` |

Install command (one mechanism only, never stacked with `/plugin`):

```bash
npx ecc-universal@2.2.1 install --target claude-project \
  --skills accessibility,context-budget,fastapi-patterns [--dry-run --json]
```

`--skills` resolves through the synthetic per-skill components ECC generates in
`scripts/lib/install-manifests.js`, which is the smallest unit it supports. No profile is
used: even `--profile minimal` pulls `rules-core`, `agents-core` and `commands-core`.

---

## 7. Verification & Test Plan

```bash
# The gate this change is about
python3 scripts/check_agent_config.py

# Frontend
npm run lint
npm test
npm run build

# Backend
ruff check server tests
PYTHONPATH=. pytest

# Docs / Hashes Verification (non-mutating)
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py

# ECC install health, idempotence and reversibility
npx ecc-universal@2.2.1 list-installed
npx ecc-universal@2.2.1 uninstall --target claude-project --dry-run
```

Expected: one project-local ECC install holding exactly three skills; a re-run of the
install command produces no new changes; the uninstall dry-run lists only those three
skills plus `.claude/ecc/install-state.json`; nothing under `~/.claude/` is reported.

---

## 8. Rollback

```bash
npx ecc-universal@2.2.1 uninstall --target claude-project
git checkout -- .claude/settings.json .prettierignore scripts/check_agent_config.py \
                tests/tooling/test_agent_config_check.py .claude/rules/reference-docs.md \
                docs/README.md docs/TESTING.md AGENTS.md
rm -f docs/ECC.md
python3 scripts/check_agent_config.py && python3 scripts/check_docs.py
```

The uninstaller is state-driven: it removes only paths recorded as ECC-managed in
`.claude/ecc/install-state.json` and leaves hand-edited (drifted) files in place. No global
state exists to undo.
