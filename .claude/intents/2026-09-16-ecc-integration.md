# Intent: Selective Everything Claude Code (ECC) Integration

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [ ] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [x] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)
- **Problem Statement**:
  Everything Claude Code (ECC, `github.com/affaan-m/ECC`, v2.2.1) ships 68 agents, ~292
  skills, 94 commands, 122 rule files and 24 hooks. Installed in full it would bury this
  repository's own `.claude/` system: it would create `.claude/commands/` and a second
  memory store - both **CI-prohibited paths** in `scripts/check_agent_config.py` - install
  always-loaded rules against a repo whose entire "Navigating This Repo Without Burning
  Context" contract exists to prevent that, and merge a `PostToolUseFailure` hook event
  that `check_agent_config.py` rejects outright.

  Ignoring ECC entirely is also wrong: three of its skills fill real gaps here. Nothing in
  `.claude/` teaches FastAPI/Pydantic-v2 implementation (the `backend-reviewer` agent
  audits, it does not teach), there is no accessibility skill despite a11y being a stated
  top-three priority, and `navigation.md` budgets context per *file* with nothing that
  budgets it per loaded *component*.

  The gap is a small, auditable, reversible integration with a boundary that CI enforces
  rather than one held by convention.

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - ADR-001: Pure vanilla ES modules. No frameworks (React, Vue, etc.) or component abstractions.
  - ADR-016: Zero third-party asset requests. All scripts, fonts, and stylesheets must remain local/self-hosted.
  - ADR-023: Client cannot dictate model ID, system prompt, or token ceilings.
  - `scripts/check_agent_config.py` is the binding contract: `.claude/commands`,
    `.claude/memory`, `.claude/adrs` and `.claudeignore` must not exist; the 7 project
    skills and 4 project agents must keep their names; `.claude/rules/*.md` must declare a
    `paths:` list; `settings.json` hook events must come from a fixed set.
  - The intent -> spec -> implementation -> tests -> review workflow stays authoritative.
    ECC augments it; it does not replace it.
- **Explicit Non-Goals**:
  - No ECC rules, agents, commands, hooks, memory system, MCP configuration or doc locales.
  - No global installation. Nothing is written under `~/.claude/`.
  - No `/plugin` installation, and no stacking of install mechanisms (ECC's own docs warn
    this produces duplicate skills and duplicate hook execution).
  - No hand-editing of vendored ECC files - that breaks ECC's digest-based upgrade path.
  - No change to application behaviour, AWS resources, or production infrastructure.

## 3. Impacted Layer Matrix & Quality Gates
Determine impacted layers and execute matching quality gates:

- [x] **Frontend**: `npm run lint` && `npm test` && `npm run build`
- [x] **Backend**: `ruff check server tests` && `PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55`
- [ ] **Database**: `PYTHONPATH=. alembic check` (from `server/`)
- [x] **Docs / Hashes**: `python3 scripts/check_csp_hashes.py` && `python3 scripts/check_docs.py`

Plus the gate this change is really about: `python3 scripts/check_agent_config.py`.

## 4. Risks & Mitigations
- **Performance / Asset Size Impact**: None. No shipped asset changes; nothing enters
  `frontend/` or `dist/`. Context cost is the analogue here: three extra skill descriptions
  (~120 tokens) are always loaded, and the ~7,000-token bodies load only on invocation.
- **API Cost / Rate Limits**: None. No Bedrock, database or network call path changes.
- **Security / Authentication**: No auth surface changes. Two indirect exposures are handled:
  the installer would write `"includeCoAuthoredBy": false` into `.claude/settings.json`
  unless an explicit preference already exists, so the preference is set to `true` first;
  and ECC's 24 hooks - which execute shell commands on every Bash, Edit and Stop event -
  are not installed, so no third-party code gains a runtime trigger in this repo.

## 5. Acceptance Criteria
- Exactly three ECC skills exist under `.claude/skills/`, each carrying `origin: ECC`.
- `.claude/settings.json` gains one key and no hooks.
- `scripts/check_agent_config.py` fails if a fourth ECC skill appears, or if a vendored
  skill loses its provenance marker.
- All seven project skills, four project agents, two rules files, six hooks, ten intents
  and ten specs are byte-unchanged.
- Nothing under `~/.claude/` is created or modified.
- `npx ecc-universal@2.2.1 uninstall --target claude-project` removes the integration and
  nothing else.
