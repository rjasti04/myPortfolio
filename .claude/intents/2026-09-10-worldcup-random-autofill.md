# Intent: World Cup 2026 Predictor Randomized Auto-Fill

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: Interactive, engaging bracket exploration, mobile responsiveness, fast UX)
  - [ ] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [x] 3. Owner (Priority: Personal tournament simulation, testing unpredictable World Cup scenarios)
- **Problem Statement**:
  Currently, `frontend/worldcup.html` lacks any auto-fill capability. To reach a completed bracket and crown a champion, a visitor must manually inspect 12 groups, rank third-place wildcards, and click through all 32 knockout ties (16 R32, 8 R16, 4 QF, 2 SF, 1 3rd-place playoff, and 1 Grand Final). Without a quick-fill mechanism, casual visitors and recruiters cannot quickly explore tournament outcomes, evaluate the bracket UX, or test share links and export summaries without tedious clicking. Adding a randomized auto-fill button allows instantaneous, playful tournament generation with a single click.

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - **Standalone Predictor Architecture (AGENTS.md)**: `frontend/worldcup.html` is a self-contained standalone page outside the SPA's CSP. It uses plain vanilla JavaScript without external framework dependencies.
  - **ADR-001**: Pure vanilla JavaScript implementation; no external bracket, simulation, or UI libraries.
  - **ADR-016**: Zero new third-party asset requests; retain existing self-contained fonts and icons (standalone predictors legitimately load Google Fonts, Font Awesome via cdnjs, and FlagCDN).
  - **ADR-023**: Fully client-side execution; no backend API, Bedrock, or AI calls.
  - **Preserve User Intent**: Matches, group rankings, or wildcards explicitly set by the user must remain intact; auto-fill only populates undecided or untouched stages.
  - **Tournament Sequencing**: Knockout ties must be resolved in strict round order (R32 -> R16 -> QF -> SF -> Final & 3rd Place) so teams are propagated to subsequent match slots before a winner is decided.
- **Explicit Non-Goals**:
  - Fetching external FIFA world ranking or betting odds APIs over the network.
  - Backend database persistence for brackets (bracket state remains encoded in URL query params `?s=` and `localStorage`).
  - Modifying the UCL predictor (`frontend/ucl.html`) or SPA core files (`frontend/index.html`, `frontend/styles.css`).

## 3. Success Metrics & Verifiable Criteria
- **User-Facing Behavior**:
  - A new "Random Fill" button (`#autofill-btn`) appears in the header actions bar with a dice icon (`fa-dice`) and clear tooltip / accessible label.
  - Clicking the button resolves all untouched stages: shuffles group standings if untouched, selects 8 wildcards if unselected, and simulates remaining knockout matches using a pure 50/50 random selection.
  - Any matches or standings previously selected by the user are preserved.
  - Successive runs produce varied champions, podiums, and tournament paths.
  - The celebration confetti triggers if the Grand Final is decided during auto-fill, and a descriptive toast indicates how many matches or stages were filled.
- **Deterministic Quality Gates**:
  - [ ] Frontend tests pass (`npm test`), including dedicated tests for `worldcup.html` state serialization, auto-fill completion, and pick preservation.
  - [ ] Lint checks pass (`npm run lint`).
  - [ ] Documentation and hash verification pass (`python3 scripts/check_docs.py --fix --show-tokens`).

## 4. Risks & Mitigations
- **Downstream Match Invalidation**:
  - *Risk*: Shuffling groups when bracket picks already exist could invalidate teams in already decided knockout matches.
  - *Mitigation*: Group shuffling only applies to groups without downstream bracket dependencies or when the tournament is completely untouched. Existing bracket picks must trigger `validateKnockoutTree()` to maintain structural consistency.
- **Test Determinism**:
  - *Risk*: 50/50 random simulation could cause brittle test assertions if tests expect specific winners.
  - *Mitigation*: Test assertions will check invariant guarantees (e.g., all 32 matches resolved, champion crowned, manual picks preserved, valid state string generated) rather than specific team winners.
