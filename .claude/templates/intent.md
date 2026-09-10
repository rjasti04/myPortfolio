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

## 3. Success Metrics & Verifiable Criteria
- **User-Facing Behavior**:
  [What should the user see, experience, or be able to do once shipped?]
- **Deterministic Quality Gates**:
  - [ ] Frontend tests pass (`npm test`) and linters pass (`npm run lint`).
  - [ ] Backend tests pass (`$env:PYTHONPATH='.'; pytest`) with >= 55% coverage.
  - [ ] Schema drift check passes (`alembic check`).
  - [ ] Documentation and CSP hashes remain in sync (`scripts/check_docs.py`, `scripts/check_csp_hashes.py`).

## 4. Risks & Mitigations
- **Performance / Asset Size Impact**: [Evaluate bundle size or paint latency impact]
- **API Cost / Rate Limits**: [Evaluate impact on Amazon Bedrock or database queries]
- **Security / Authentication**: [Evaluate auth dependencies and data access control]
