# Technical Specification: World Cup 2026 Predictor Randomized Auto-Fill

**Related Intent**: [.claude/intents/2026-09-10-worldcup-random-autofill.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-10-worldcup-random-autofill.md)  
**Target Audience**: 1. Visitor / Recruiter & 3. Owner  

---

## 1. Architectural Impact & Component Overview
- **Impacted Layers**:
  - [x] Standalone Frontend Predictor (`frontend/worldcup.html`)
  - [x] Frontend Test Suite (`frontend/tests/worldcup-bracket.test.js` [NEW])
  - [ ] Main SPA (`frontend/index.html`, `frontend/js/`, `frontend/styles.css` — unaffected)
  - [ ] Backend API & Database (None: 100% client-side computation, ADR-023)
  - [ ] CI/CD & Deploy (No workflow changes required)

- **Context & Invariants**:
  - Per `AGENTS.md`, `frontend/worldcup.html` is a self-contained, standalone single-page tournament predictor outside the SPA's strict Content Security Policy.
  - All styling, markup, and JavaScript logic reside within `frontend/worldcup.html`.
  - Must strictly remain vanilla JavaScript without build-step requirements or framework dependencies (ADR-001, ADR-016).
  - Preserves user selections: ties, group standings, or wildcards already manually configured by the user must not be clobbered.

---

## 2. API Contract & Schemas
*None*: Fully client-side execution adhering to ADR-023. No backend endpoints, Amazon Bedrock calls, or external network requests (`connect-src` unaffected).

---

## 3. Database Schema & Migration Plan
*None*: State persistence remains client-side in `window.localStorage` (`predictor-state`) and URL query parameters (`?s=...`) via existing compact serialization.

---

## 4. Implementation Details & DOM Contract

### 4.1. Randomization Model & 50/50 Coin-Flip Algorithm
Unlike the seed-weighted probability model used in `ucl.html`, World Cup ties will use an unbiased 50/50 coin flip to simulate authentic, high-variance knockout drama:

1. **Coin-Flip Winner Selection**:
   ```javascript
   function pickRandomCoinFlipWinner(team1, team2) {
     if (!team1 && !team2) return null;
     if (!team1) return team2;
     if (!team2) return team1;
     return Math.random() < 0.5 ? team1 : team2;
   }
   ```

2. **Fisher-Yates Array Shuffle (for Group Standings & Wildcard Pools)**:
   ```javascript
   function shuffleArray(array) {
     const arr = [...array];
     for (let i = arr.length - 1; i > 0; i--) {
       const j = Math.floor(Math.random() * (i + 1));
       [arr[i], arr[j]] = [arr[j], arr[i]];
     }
     return arr;
   }
   ```

---

### 4.2. Multi-Stage Auto-Fill Logic & Preservation Rules
The auto-fill action executes across the three tournament stages (Group Stage -> 3rd Place Wildcards -> Knockout Bracket) while strictly preserving prior user inputs:

1. **Stage 1: Group Standings Shuffling**
   - **Condition**: Only shuffle groups that remain in their default initial order.
   - For each group $G \in \{A..L\}$:
     - Compare current `state.groups[G]` to `INITIAL_GROUPS[G]`.
     - If identical (user has not dragged/reordered this group) and no downstream bracket picks exist, randomize the standing with `shuffleArray(state.groups[G])`.
     - If the user has manually reordered the group, keep it intact.

2. **Stage 2: Third-Place Wildcards Selection**
   - **Condition**: Only randomize wildcards if `state.bracketWinner` contains zero picks and `state.wildcards` matches the default configuration (`["A", "B", "C", "D", "E", "F", "G", "H"]`).
   - If untouched, select 8 distinct groups at random:
     ```javascript
     const allGroups = Object.keys(INITIAL_GROUPS); // 12 groups
     state.wildcards = shuffleArray(allGroups).slice(0, 8);
     ```
   - If the user has customized wildcard selections, retain them.

3. **Stage 3: Sequential Knockout Progression (32 Matches)**
   - Resolves matches round-by-round so advancing teams populate subsequent fixtures before a winner is picked:
     - **Round of 32**: Matches `r32-1` through `r32-16`
     - **Round of 16**: Matches `r16-1` through `r16-8`
     - **Quarterfinals**: Matches `qf-1` through `qf-4`
     - **Semifinals**: Matches `sf-1` and `sf-2`
     - **Finals**: `final` (Grand Final) and `third-place` (Third Place Playoff)
   - For each match ID $M$:
     - If `state.bracketWinner[M]` is already chosen by the user, **preserve it**.
     - Otherwise, compute match participants via `calculateMatchesData()[M]`.
     - If both `team1` and `team2` are resolved, assign:
       `state.bracketWinner[M] = pickRandomCoinFlipWinner(m.team1, m.team2).name;`

4. **Stage 4: Post-Fill Persistence, Celebration & UI Feedback**
   - Save updated state: `saveStateToLocalStorage()`.
   - Re-render all 3 views: `renderAllViews()`.
   - If `final` was decided during this run, trigger `triggerGoldPodiumCelebration()`.
   - Calculate number of newly resolved knockout matches `added`:
     - If `added > 0`: `showToast("Simulated ${added} ${added === 1 ? "match" : "matches"} with random outcomes!", "success")`
     - If all matches were already decided: `showToast("All tournament matches were already decided. Reset the bracket to re-roll.", "warning")`

---

### 4.3. DOM Contract & UI Updates
- In `frontend/worldcup.html`, insert the `#autofill-btn` inside `.header-actions` between `#theme-toggle-btn` and `#reset-btn` (matching `ucl.html` layout):
  ```html
  <button id="autofill-btn" class="btn btn-outline"
    aria-label="Randomly fill undecided stages and matches across the tournament"
    title="Random fill remaining matches">
    <i class="fas fa-dice"></i> <span class="sr-only-mobile">Random Fill</span>
  </button>
  ```
- In `setupUtilityButtons()`, attach the event listener:
  ```javascript
  document.getElementById("autofill-btn").addEventListener("click", autoFillTournament);
  ```

---

## 5. Security, CSP & Performance Review
- **Content Security Policy**: Zero impact on SPA CSP (`frontend/index.html` inline script hashes unaffected). `worldcup.html` is an independent document with its own inline script.
- **Input Sanitization**: Team names and codes are read strictly from immutable constants (`INITIAL_GROUPS`) and sanitized templates.
- **Performance**: Complexity is $O(1)$ across exactly 12 groups, 8 wildcards, and 32 knockout ties. Execution completes in $< 3\text{ms}$.

---

## 6. Verification & Test Plan

### 6.1. New Automated Test Suite (`frontend/tests/worldcup-bracket.test.js`)
Build a dedicated test suite using Node's test runner (`node:test`, `node:assert/strict`) and `jsdom`:
1. **DOM Structure**: Verify 12 groups, 8 default wildcards, all 32 bracket match cards, and presence of `#autofill-btn` with `fa-dice`.
2. **Auto-Fill Completion**: Clicking `#autofill-btn` on an empty bracket fills all 32 matches, populates the podium with Gold, Silver, and Bronze winners, and updates localStorage.
3. **User Pick Preservation**: When a user pre-selects a specific winner in `r32-1` or changes Group A's standing, auto-fill leaves that choice intact.
4. **Randomization Diversity**: Running auto-fill across two fresh instances yields divergent tournament paths and champions.
5. **State Serialization**: Verified that `serializeState()` and `deserializeState()` accurately encode brackets completed via auto-fill.

### 6.2. Quality Gate Commands
```bash
npm run lint
npm test
python scripts/check_csp_hashes.py
python scripts/check_docs.py --fix --show-tokens
```
