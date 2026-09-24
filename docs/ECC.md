# ECC Integration

[Everything Claude Code](https://github.com/affaan-m/ECC) (ECC) is a third-party agent
operating layer: at v2.2.1 it ships 68 agents, ~292 skills, 94 command shims, 122 rule
files and 24 hooks. **Three of its skills are vendored into this repository. Nothing else
is, and nothing is installed globally.**

This document is the record of what was taken, what was refused, and how to undo or
upgrade it. `scripts/check_agent_config.py` enforces the boundary described here, so this
page and CI cannot drift apart silently.

## What is installed

| Path | Skill | Why it is here |
| :--- | :--- | :--- |
| `.claude/skills/fastapi-patterns/` | `fastapi-patterns` | Nothing in `.claude/` teaches FastAPI implementation. The `backend-reviewer` agent *audits* a diff; this covers Pydantic v2 schemas, dependency injection, async route design, the service layer, and testing with httpx + pytest — the exact stack in `server/` |
| `.claude/skills/accessibility/` | `accessibility` | WCAG 2.2 Level AA, framework-agnostic. Accessibility is a stated top-three priority in `AGENTS.md` and had no skill at all. ECC's other a11y skill, `frontend-a11y`, is React-specific and was rejected |
| `.claude/skills/context-budget/` | `context-budget` | `.claude/rules/navigation.md` budgets context per *file*. This budgets it per loaded *component* — agents, skills, rules, MCP servers — which is the axis that moves when configuration changes |
| `.claude/ecc/install-state.json` | — | ECC's own manifest. It is what makes the install reversible: uninstall removes only the paths recorded in it |

All three are single self-contained `SKILL.md` files with no external tooling, MCP server
or `~/.claude/` dependency. They load **on demand**: only their `description` line is
always in context (~120 tokens total); the ~7,000-token bodies load when invoked.

`.claude/settings.json` briefly carried `"includeCoAuthoredBy": true` for this install.
The key is deprecated and has been removed — see
[Why there is no attribution key](#why-there-is-no-attribution-key).

## What is deliberately not installed

Each of these was evaluated against the repository, not skipped by default.

| Rejected | Reason |
| :--- | :--- |
| **All 24 hooks** | Four independent blockers. `check_vendored_ecc` in `scripts/check_agent_config.py` requires every configured hook to run a script from `.claude/hooks/`, so merging them fails CI — that check is by authorship and holds under any event name, including the `PostToolUseFailure` one ECC uses. (It used to be the event name that blocked them, because `VALID_HOOK_EVENTS` listed only nine of the documented thirty-three. Widening that set to all thirty-three left the authorship check as the guard, which is the stronger one.) `pre:edit-write:gateguard-fact-force` blocks the first `Edit`/`Write` to every file; `pre:config-protection` blocks edits to `ruff.toml`, `.eslintrc.json` and `pytest.ini`; `pre:write:doc-file-warning` fires on exactly the `.claude/intents/` and `.claude/specs/` writes this repo's workflow produces. They would also stack a Bash pre-dispatcher and two `.*`-matched PostToolUse dispatchers on top of the eight hooks in `.claude/hooks/`, which already run `check_docs.py` and `check_csp_hashes.py` on every write |
| **All 122 rule files** | ECC rules carry no `paths:` frontmatter, so they are always-loaded — the opposite of what `.claude/rules/` and the "Navigating This Repo Without Burning Context" contract exist to do (~5,000 tokens per session). `rules/common` also contradicts the repo directly: it documents a `~/.claude/agents/` roster that does not exist here, mandates `gh search` (no `gh` CLI) and Context7/Exa MCP servers (not configured), and states that ECC installs set `includeCoAuthoredBy: false` |
| **All 68 agents** | `agents/security-reviewer.md` collides by name with a project agent that `check_agent_config.py` pins. Adding language-specific reviewers would also fragment the fan-out that `.claude/skills/review/SKILL.md` defines over the four project agents |
| **All 94 commands** | `.claude/commands` is a **prohibited path** in `check_agent_config.py` |
| **Memory** (`unified-memory`, `continuous-learning`, `continuous-learning-v2`) | `.claude/memory` is a **prohibited path**. `continuous-learning` is hook-driven and inert with hooks off, and this repo has no memory system to compete with — which is the point |
| `tdd-workflow` | Hardcodes "Minimum 80% coverage". This repo's gate is `--cov-fail-under=55` |
| `database-migrations` | Covers Prisma, Drizzle, Django and TypeORM, and contains no Alembic content. ADR-014 makes Alembic the only schema path; `alembic-guard` already covers it |
| `frontend-patterns`, `frontend-a11y` | React/Next.js-centric. ADR-001 |
| `security-review`, `security-scan` | Would be a second security checklist beside the `security-audit` skill and `docs/SECURITY.md`, whose version knows about the three guard tiers and the `router.add_api_route` registrations a `@router` grep misses |
| `python-testing`, `verification-loop` | Duplicate authority for commands the `testing` and `verify` skills already own |
| `postgres-patterns` | Supabase/RLS-flavoured; `docs/DATABASE.md` is authoritative and wins per `AGENTS.md` |
| `architecture-decision-records` | Maintains its own ADR log — a second store beside `docs/ADR.md` |
| MCP configs, 10 doc locales, remaining ~280 skills | Not relevant to this stack, and every installed skill costs always-loaded description tokens |

ECC has no Kafka, AWS or Bedrock skill, so those parts of this repo gain nothing from it.

## Ownership boundary

`.claude/skills/` is flat: ECC's `claude-project` adapter copies skill directories
straight in beside the project's own, and the layout itself records nothing about which
side a directory belongs to. Two mechanisms supply that instead.

- **ECC protects the project.** `scripts/lib/install/ownership-guard.js` skips any
  destination that already exists and is not recorded in ECC's install-state, so project
  skills, agents, rules, hooks, intents, specs and templates are structurally out of reach
  of any future `ecc install`.
- **The project protects itself from ECC.** `check_vendored_ecc()` in
  `scripts/check_agent_config.py` closes the set of skill directories, requires each
  vendored one to keep the `origin: ECC` frontmatter marker the installer wrote, and
  requires every configured hook to run a script from `.claude/hooks/`. A fourth ECC
  skill, a hand-edited vendored file, or a third-party hook under a valid event name is a
  CI failure. `tests/tooling/test_agent_config_check.py` pins all four cases.

**Never hand-edit a vendored `SKILL.md`.** The installer compares content digests, so a
local edit either blocks the next upgrade or is silently replaced.

### Known rough edge

`accessibility/SKILL.md` ends with a "Related Skills" list naming `frontend-patterns`,
`design-system`, `liquid-glass-design` and `swiftui-patterns` — none of which are
installed, and three of which never should be here. The references are inert prose and are
left as-is rather than patched, because editing the file breaks the upgrade path above.

### Why there is no attribution key

`scripts/lib/install/apply.js` writes `"includeCoAuthoredBy": false` into
`.claude/settings.json` on any ECC install into a Claude target — unless an explicit
preference is already present. This repository's commit history carries the
`Co-Authored-By` trailer, so `"includeCoAuthoredBy": true` was set **before** the
installer ran, purely to pre-empt that side effect.

That key is deprecated in favour of `attribution`, and `true` was the default — Claude
Code adds attribution unless you turn it off — so it has been deleted rather than
translated. The docs give no `includeCoAuthoredBy` → `attribution` mapping, and an
`attribution` block exists to *change or hide* the trailer, which is not what this repo
wants. Deleting it gives up the pre-emption, so `check_settings()` in
`scripts/check_agent_config.py` now **fails CI if the key reappears at all**. An install
that writes it back is caught loudly, which the old placeholder value never would have
been: a silent flip from `true` to `false` looks identical in a diff nobody reads.

## Upgrading

Re-run the same command with a newer pinned version. Nothing else changes:

```bash
npx ecc-universal@<version> install --target claude-project \
  --skills accessibility,context-budget,fastapi-patterns
```

It updates only the paths recorded in `.claude/ecc/install-state.json`. To add or drop a
skill, change the `--skills` list **and** `VENDORED_ECC_SKILLS` in
`scripts/check_agent_config.py` — CI fails if the two diverge — then update the tables
above.

Do **not** also run `/plugin install ecc@ecc`, `install.sh --profile full`, or an install
into `~/.claude/`. ECC's own documentation warns that stacking install mechanisms produces
duplicate skills and duplicate hook execution, and the plugin path additionally auto-loads
`hooks/hooks.json`.

## Removing

```bash
npx ecc-universal@<version> uninstall --target claude-project --dry-run   # inspect first
npx ecc-universal@<version> uninstall --target claude-project
```

The uninstaller is state-driven: it removes only files recorded as ECC-managed and leaves
drifted (hand-edited) ones in place rather than deleting work. Then revert the
project-owned companions and drop the now-unused entries:

```bash
git checkout -- .claude/settings.json .prettierignore scripts/check_agent_config.py \
                tests/tooling/test_agent_config_check.py .claude/rules/reference-docs.md \
                docs/README.md docs/TESTING.md AGENTS.md
rm -f docs/ECC.md
rm -rf ~/.claude/ecc      # derived projection cache, see below
python3 scripts/check_agent_config.py && python3 scripts/check_docs.py
```

## The one global artefact

The installer writes a SQLite projection of its install-state to `~/.claude/ecc/state.db`
(outside the repository, not in any dry-run output). It is a **derived cache** — the
canonical record is `.claude/ecc/install-state.json` — and uninstall reconciles it. It is
the only thing this integration touches outside the repository; no skills, agents,
commands, rules, hooks or settings are written to `~/.claude/`.
