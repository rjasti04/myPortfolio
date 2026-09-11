<!--
IMPORTANT INSTRUCTION FOR AI AGENTS:
DO NOT overwrite this template file (.claude/templates/intent.md).
When drafting or preparing an intent document for a feature, create a new distinct file at:
  .claude/intents/YYYY-MM-DD-<feature-slug>.md
Create the .claude/intents/ directory if it does not already exist.
-->

# Intent: [Initiative or Feature Title]

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [ ] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX)
  - [ ] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [ ] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)
- **Problem Statement**:
  [Describe what user pain point or functional gap this change solves.]

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - ADR-001: Pure vanilla ES modules. No frameworks (React, Vue, etc.) or component abstractions.
  - ADR-016: Zero third-party asset requests. All scripts, fonts, and stylesheets must remain local/self-hosted.
  - ADR-023: Client cannot dictate model ID, system prompt, or token ceilings.
- **Explicit Non-Goals**:
  - [List what this initiative will NOT do or solve to prevent scope creep.]

## 3. Impacted Layer Matrix & Quality Gates
Determine impacted layers and execute matching quality gates:

- [ ] **Frontend**: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: `ruff check server tests` && `PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55`
- [ ] **Database**: `PYTHONPATH=. alembic check` (from `server/`)
- [ ] **Docs / Hashes**: `python3 scripts/check_csp_hashes.py` && `python3 scripts/check_docs.py`

## 4. Risks & Mitigations
- **Performance / Asset Size Impact**: [Evaluate bundle size or paint latency impact]
- **API Cost / Rate Limits**: [Evaluate impact on Amazon Bedrock or database queries]
- **Security / Authentication**: [Evaluate auth dependencies and data access control]
