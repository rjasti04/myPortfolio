# Technical Specification: Opaque Surfaces for Stat Cards and Skill Groups

**Related Intent**: [.claude/intents/2026-09-16-opaque-stats-and-skills.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-16-opaque-stats-and-skills.md)  
**Target Audience**: Visitor / Recruiter (typography legibility, high-contrast visual hierarchy against circuit board backdrop), Work Sample (token discipline, ADR-024 compliance)

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA (`frontend/styles.css`, `frontend/index.html`)
  - [ ] Backend API — none
  - [ ] Database Schema — none
  - [ ] CI/CD & Deploy — none

This change eliminates backdrop bleed-through in the About/Stats and Skills regions by converting translucent card containers (`.stat-card` and `.skill-group`) to 100% opaque surfaces.

In the repository, the `.glass-light` utility is used exclusively on:
- Six `.stat-card` elements in `frontend/index.html` (lines 968, 972, 976, 980, 984, 988)
- Six `.skill-group` elements in `frontend/index.html` (lines 999, 1023, 1036, 1048, 1066, 1078)

No other components in the application utilize `--glass-light-bg`. Updating this token and the card hover rules guarantees complete opacity across both viewport states and themes without affecting unrelated UI components.

---

## 2. API Contract & Schemas

**N/A.** No backend routes, parameters, or database schemas are altered.

---

## 3. Database Schema & Migration Plan

**N/A.** No database interactions or migrations required.

---

## 4. Frontend Implementation & DOM Contract

### 4.1 Token Adjustments in `frontend/styles.css`

Under `:root` (Light Theme):
```css
/* Update --glass-light-bg from semi-transparent to fully opaque white */
--glass-light-bg: #ffffff;
--glass-light-border: var(--border); /* hsl(220, 39%, 11%, 0.13) */
```

Under `body.dark-theme` (Dark Theme):
```css
/* Update --glass-light-bg from rgba(30, 41, 59, 0.45) to solid slate-800 */
--glass-light-bg: #1e293b;
--glass-light-border: var(--border); /* hsl(210, 20%, 98%, 0.14) */
```

> **Alignment Note**: The values `#ffffff` and `#1e293b` exactly match the existing `@supports not (backdrop-filter: ...)` fallback in `styles.css` (lines 13361–13375). Updating `--glass-light-bg` guarantees visual parity across all browsers.

### 4.2 Rest State and Hover State Rules for `.stat-card` and `.skill-group`

#### 4.2.1 `.stat-card`
- **Resting state**: Inherits `background: var(--glass-light-bg, #ffffff)` from `.glass-light`.
- **Hover state** in light theme:
  ```css
  .stat-card:hover {
    transform: translateY(-4px);
    border-color: var(--accent-mild);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.12), 0 0 24px var(--accent-soft);
    background: #ffffff; /* Retain solid opaque base */
  }
  ```
- **Hover state** in dark theme:
  ```css
  body.dark-theme .stat-card:hover {
    border-color: rgba(255, 255, 255, 0.28);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4), 0 0 24px var(--accent-soft);
    background: #243248; /* Lifted solid surface instead of translucent rgba(30, 41, 59, 0.65) */
  }
  ```
- **Pseudo-element bloom**:
  - Preserve `.stat-card::before` (tri-color top rule) and `.stat-card::after` (radial bloom behind the number). Because the card is now opaque, the bloom glows above the card surface rather than exposing backdrop traces.

#### 4.2.2 `.skill-group`
- **Resting state**: Inherits `background: var(--glass-light-bg, #ffffff)` from `.glass-light`.
- **Hover state** in light theme:
  ```css
  .skill-group:hover {
    transform: translateY(-4px);
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.10), 0 0 20px var(--accent-soft);
    border-color: var(--accent-fill);
    background: #ffffff; /* Retain solid opaque base */
  }
  ```
- **Hover state** in dark theme:
  ```css
  body.dark-theme .skill-group:hover {
    border-color: rgba(255, 255, 255, 0.28);
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.35), 0 0 20px var(--accent-soft);
    background: #243248; /* Lifted solid surface instead of translucent rgba(30, 41, 59, 0.65) */
  }
  ```

### 4.3 `.stat-number` Styling & Contrast Verification

`.stat-number` is configured with:
```css
.stat-number {
  font-size: var(--text-3xl);
  font-weight: var(--weight-bold);
  white-space: nowrap;
  background: linear-gradient(135deg, var(--accent-text), var(--secondary-text));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: transparent;
  margin-bottom: var(--space-sm);
  letter-spacing: var(--tracking-tight);
  position: relative;
  z-index: 1;
}
```

1. **Why it appeared transparent**:
   - The user observed circuit backdrop traces through the number because the parent container (`.stat-card`) had a 78%/55% transparent background.
   - Inspecting the number in Chrome DevTools highlighted `color: transparent; -webkit-text-fill-color: transparent;`.
2. **Behavior on Opaque Ground**:
   - With `.stat-card` made opaque (`#ffffff` / `#1e293b`), the circuit board backdrop is completely occluded.
   - In light theme: `--accent-text` (citron/olive, ~7.5:1) and `--secondary-text` (azure, ~8.2:1) produce crisp, high-contrast numbers against the pure `#ffffff` ground.
   - In dark theme: `--accent-text` (citron, ~11.2:1) and `--secondary-text` (azure, ~7.6:1) render with vibrant contrast against `#1e293b`.
   - Windows High Contrast / Forced Colors: Existing `@media (forced-colors: active)` rule ensures `color: CanvasText; -webkit-text-fill-color: CanvasText;` remains active.

---

## 5. Security & CSP Review

- [x] No changes to inline `<script>` elements in `frontend/index.html`.
- [x] Pinned CSP script hashes verified via `python scripts/check_csp_hashes.py`.
- [x] Zero third-party runtime asset requests introduced (ADR-016).

---

## 6. Verification & Test Plan

Execute the following quality gates upon implementation:

```bash
# 1. Frontend tests (Node test runner + JSDOM)
npm test

# 2. Stylesheet linting
npm run lint

# 3. Production bundle build & size budget check
npm run build

# 4. CSP Hash and Documentation synchronization
python scripts/check_csp_hashes.py
python scripts/check_docs.py --fix --show-tokens
```

### Manual Visual Verification:
1. Open `http://localhost:1991/#home`.
2. Scroll to the **About / Stats** section: confirm the 6 stat cards have opaque backgrounds with zero circuit board traces visible through the card body or behind `.stat-number`.
3. Scroll to the **Technical Skills** section: confirm all 6 `.skill-group` cards have opaque backgrounds with zero circuit board traces or animated pulses visible through them.
4. Hover over `.stat-card` and `.skill-group`: verify the hover state maintains opaque backgrounds without snapping to translucency.
5. Toggle between Light and Dark themes via the header control: confirm both themes display properly calibrated opaque surfaces (`#ffffff` in light mode, `#1e293b` in dark mode).
