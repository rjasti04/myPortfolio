# Intent: UCL Predictor Randomized Auto-Fill

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: Interactive, engaging bracket exploration, mobile responsiveness, fast UX)
  - [ ] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [x] 3. Owner (Priority: Personal utility, realistic tournament bracket simulation)
- **Problem Statement**:
  Currently, clicking the "Fill" button (`#autofill-btn`) in `frontend/ucl.html` deterministically selects the higher seed for every playoff and knockout tie. As a result, every invocation produces an identical bracket with the #1 seed crowned champion every single time. Users wanting to test different bracket possibilities or simulate upsets must manually pick all 23 ties one by one. Introducing randomized bracket auto-fill will make bracket generation dynamic and engaging.

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - **Standalone Predictor Architecture (AGENTS.md)**: `frontend/ucl.html` is a self-contained standalone page outside the SPA's CSP. It uses plain vanilla JavaScript without frameworks.
  - **ADR-001**: Pure vanilla JavaScript implementation; no external bracket or math libraries.
  - **ADR-016**: Zero new third-party asset requests; retain existing self-contained fonts and icons.
  - **ADR-023**: Fully client-side execution; no backend API or AI calls.
  - **Preserve User Intent**: Ties already picked manually by the user should not be overridden by auto-fill.
  - **Sequential Integrity**: Knockout ties must be resolved in order (Knockout Play-offs -> Round of 16 -> Quarter-finals -> Semi-finals -> Final) so teams are present in subsequent fixtures before a winner is picked.
- **Explicit Non-Goals**:
  - External club rating or live odds API fetching (no scraping Opta, UEFA coefficients, or betting odds over network).
  - Backend database persistence for brackets (bracket sharing remains encoded via query parameters and `localStorage`).
  - Modifying the World Cup predictor (`frontend/worldcup.html`) in this iteration.

## 3. Success Metrics & Verifiable Criteria
- **User-Facing Behavior**:
  - Clicking the auto-fill action generates varied match outcomes across all undecided ties in the bracket.
  - Successive runs produce different plausible tournament paths and diverse champions.
  - Any ties already picked by the user remain intact.
  - The completion toast, progress bar, and winner cards reflect the completed bracket accurately.
- **Deterministic Quality Gates**:
  - [ ] Frontend tests pass (`npm test`) with updated assertions in `frontend/tests/ucl-bracket.test.js` ensuring completion, state serialization, and manual pick preservation without test flakiness.
  - [ ] Code formatting and linters pass (`npm run lint`).
  - [ ] Documentation and hash verification pass (`python3 scripts/check_docs.py --fix --show-tokens`).

## 4. Risks & Mitigations
- **Test Non-Determinism (Flakiness)**:
  - *Risk*: Random winner selection could cause existing tests (e.g., asserting champion is `names[0]`) to fail intermittently.
  - *Mitigation*: Update test assertions to verify structural invariants (progress counter = 23/23, valid champion from bracket, manual picks preserved) and/or provide deterministic options (e.g., seeding vs. weighted/random).
- **Unrealistic Simulation Outcomes**:
  - *Risk*: A pure 50/50 coin flip may lead to bizarre brackets where 24th seeds consistently beat European giants.
  - *Mitigation*: Clarify whether the user wants weighted randomization (higher seeds have higher probability of advancement) vs. pure 50/50 coin flips or an upset frequency toggle.
