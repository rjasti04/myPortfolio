# Technical Specification: UCL Predictor Randomized Auto-Fill

**Related Intent**: [.claude/intents/2026-09-10-ucl-random-autofill.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-10-ucl-random-autofill.md)  
**Target Audience**: 1. Visitor / Recruiter & 3. Owner  

---

## 1. Architectural Impact & Component Overview
- **Impacted Layers**:
  - [x] Standalone Frontend Predictor (`frontend/ucl.html`)
  - [x] Frontend Test Suite (`frontend/tests/ucl-bracket.test.js`)
  - [ ] Main SPA (`frontend/index.html`, `frontend/js/`, `frontend/styles.css` — unaffected)
  - [ ] Backend API & Database (None: 100% client-side computation, ADR-023)
  - [ ] CI/CD & Deploy (No workflow changes required)

- **Context & Constraints**:
  - Per `AGENTS.md`, `frontend/ucl.html` is a standalone, single-file predictor that is outside the main SPA's strict Content Security Policy.
  - All styling, markup, and JavaScript logic reside within `frontend/ucl.html`.
  - Must remain strictly vanilla JavaScript (ADR-001) with zero third-party script or runtime framework dependencies (ADR-016).

---

## 2. API Contract & Schemas
*None*: Fully client-side execution adhering to ADR-023. No backend endpoints or network requests required (`connect-src` unaffected).

---

## 3. Database Schema & Migration Plan
*None*: State persistence remains client-side in `window.localStorage` (`ucl-predictor-state`) and URL query parameters (`?s=...`).

---

## 4. Implementation Details & DOM Contract

### 4.1. Randomization Model & Algorithm
Currently, `autoFillBracket()` deterministically awards every undecided tie to `m.team1` (in playoffs) or `seedRankOf(m.team1) <= seedRankOf(m.team2) ? m.team1 : m.team2` (in bracket), causing seed #1 to win every time.

The updated algorithm introduces weighted seed probability while permitting upsets:
1. **Seed Rank Calculation**:
   - `seedRankOf(team)` returns the 0-indexed league phase rank (0 for 1st place, 35 for 36th place).
2. **Win Probability Distribution**:
   - Given `team1` with rank $R_1$ and `team2` with rank $R_2$, let $\Delta = R_2 - R_1$.
   - A positive $\Delta$ indicates `team1` finished higher in the league phase standings.
   - Calculate advancement probability $P(team1)$:
     $$P(team1) = 0.5 + \text{clamp}(\Delta \times 0.015, -0.35, 0.35)$$
   - *Example outcomes*:
     - Top seed vs 24th seed ($\Delta \approx 23$): $P(team1) \approx 0.845$ (84.5% favorite win rate; 15.5% upset rate).
     - 8th seed vs 9th seed ($\Delta \approx 1$): $P(team1) \approx 0.515$ (near coin-flip).
     - Identical ranks or unseeded: $P(team1) = 0.500$.
3. **Winner Resolution Function**:
   ```javascript
   function pickRandomWinner(team1, team2) {
     if (!team1 && !team2) return null;
     if (!team1) return team2;
     if (!team2) return team1;

     const r1 = seedRankOf(team1);
     const r2 = seedRankOf(team2);
     const delta = r2 - r1;
     const probTeam1 = 0.5 + Math.max(-0.35, Math.min(0.35, delta * 0.015));

     return Math.random() < probTeam1 ? team1 : team2;
   }
   ```

### 4.2. Sequential Fill Execution
- **Step 1: Knockout Play-offs (8 ties)**
  - Iterate over `PLAYOFF_TIES`.
  - If `state.playoffWinner[tie.id]` already exists (user manual pick), skip.
  - Otherwise, resolve match via `calculateMatchesData()[tie.id]` and assign:
    `state.playoffWinner[tie.id] = pickRandomWinner(m.team1, m.team2).name;`
- **Step 2: Knockout Bracket (15 ties)**
  - Iterate sequentially over `BRACKET_IDS` (`r16-1` ... `r16-8`, `qf-1` ... `qf-4`, `sf-1`, `sf-2`, `final`).
  - For each tie, recalculate match participants using `calculateMatchesData()[id]`.
  - If `state.bracketWinner[id]` is already decided, preserve it.
  - Otherwise, assign winner:
    `state.bracketWinner[id] = pickRandomWinner(m.team1, m.team2).name;`
- **Step 3: State Persistence & UI Refresh**
  - Call `saveStateToLocalStorage()`.
  - Call `renderAllViews()`.
  - If ties were added, display toast:
    `showToast("Filled ${added} ${added === 1 ? "tie" : "ties"} with randomized outcomes.", "success")`
  - If all 23 ties were already decided, display warning toast:
    `showToast("Every tie was already decided. Reset the bracket to re-roll.", "warning")`

### 4.3. UI & Accessibility Updates
- Update the button element in `frontend/ucl.html` (line ~1603):
  ```html
  <button id="autofill-btn" class="btn btn-outline"
    aria-label="Randomly fill undecided ties across the bracket"
    title="Randomize remaining ties">
    <i class="fas fa-dice"></i> <span class="sr-only-mobile">Random Fill</span>
  </button>
  ```
- Icon changed from `fa-wand-magic-sparkles` to `fa-dice` for immediate visual clarity of randomized behavior.
- Retain the exact DOM ID `id="autofill-btn"` ensuring backwards compatibility with any existing selectors and tests.

---

## 5. Security, CSP & Performance Review
- **CSP Impact**: Zero impact on SPA CSP. `ucl.html` is outside the main app and contains its own inline script block.
- **Data Sanitization**: Team names assigned to state are sourced directly from internal constants (`LEAGUE_TEAMS`); escaped when rendered.
- **Performance**: Algorithmic complexity is $O(1)$ across exactly 23 ties. Execution duration is under 5ms on low-end mobile devices.

---

## 6. Verification & Test Plan

### 6.1. Test Suite Adjustments (`frontend/tests/ucl-bracket.test.js`)
1. **Assertion Update for Auto-Fill Completion**:
   - In test `"quick fill completes every undecided tie"`:
     - Currently asserts `assert.equal(doc.querySelector("#d-champion .champion-team span").textContent, names[0]);`
     - Update assertion to verify champion is a valid participating club name from `names` and not empty:
       ```javascript
       const championName = doc.querySelector("#d-champion .champion-team span").textContent;
       assert.ok(names.includes(championName), "champion is a valid club from the tournament");
       ```
     - Retain assertions verifying all 23 ties are decided and progress bar reads `"Bracket complete"`.
2. **Manual Pick Preservation Test**:
   - Verify that test `"quick fill preserves picks already made"` continues to pass without alteration, confirming user-picked upsets (e.g., 24th seed in play-off 1) are never overwritten.
3. **Randomization Diversity Test**:
   - Add new test verifying non-deterministic variety:
     - Boot two separate brackets.
     - Execute `autofill-btn` on both.
     - Compare serialized state (`ucl-predictor-state`) or champions across multiple runs to verify randomized branching occurs across the 23 ties.

### 6.2. Quality Gate Commands
```bash
npm run lint
npm test
python scripts/check_csp_hashes.py
python scripts/check_docs.py --fix --show-tokens
```
