<!--
IMPORTANT INSTRUCTION FOR AI AGENTS:
DO NOT overwrite this template file (.claude/templates/spec.md).
When drafting or preparing a technical specification for a feature, create a new distinct file at:
  .claude/specs/YYYY-MM-DD-<feature-slug>.md
-->

# Technical Specification: Developer Apps UI/UX Harmonization & Quality Remediation

**Related Intent**: [.claude/intents/2026-09-11-developer-apps-uiux-harmonization.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-11-developer-apps-uiux-harmonization.md)  
**Target Audience**: 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX) & 2. Portfolio as a Work Sample

---

## 1. Architectural Impact & Component Overview
- **Impacted Layers**:
  - [x] Frontend Standalone Apps (`frontend/cron.html`, `frontend/cron.css`, `frontend/crypto.html`, `frontend/crypto.css`)
  - [x] Frontend Logic Controllers (`frontend/js/cron/*`, `frontend/js/crypto/*`)
  - [ ] Backend API (None: 100% client-side execution, ADR-023)
  - [ ] Database Schema (None: no server-side persistence)
  - [x] Quality Gates & Documentation (`scripts/check_docs.py`, `scripts/check_csp_hashes.py`)

---

## 2. API Contract & Schemas
*None*: Purely client-side utilities adhering to ADR-023. Zero network egress or backend dependencies.

---

## 3. Database Schema & Migration Plan
*None*: Zero database requirements.

---

## 4. Frontend Implementation & DOM Contract

### Part A: Theme Management & Mobile Status Bar Parity
1. **Unify Theme Storage Key**:
   - In [cron-main.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/cron/cron-main.js), replace `rj-theme` with the sitewide key `"theme"`.
   - On load, read `localStorage.getItem("theme") || getSystemTheme()`.
2. **Dynamic Toggle Icon & Accessible Label**:
   - In [cron-main.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/cron/cron-main.js), query `#theme-toggle-btn i` and toggle class between `fas fa-sun` (in dark mode) and `fas fa-moon` (in light mode), matching [crypto-main.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/crypto/crypto-main.js).
   - Dynamically update button `aria-label` to `"Switch to light theme"` or `"Switch to dark theme"`.
3. **Mobile Theme Color Synchronization**:
   - In both `cron-main.js` and `crypto-main.js`, update `meta[name="theme-color"]` to `#090d16` (dark) or `#f8fafc` (light) on theme switch, ensuring mobile browser chrome matches page background.
4. **Smooth Theme Transition**:
   - Add `body { transition: background-color 0.2s ease, color 0.2s ease; }` to [cron.css](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/cron.css).
5. **System Preference Fallback**:
   - Update `crypto-main.js` so that when no `"theme"` key exists in `localStorage`, it falls back to `prefers-color-scheme: light` rather than hardcoding `"dark"`.

### Part B: Non-Destructive Button Feedback & Clear Action
1. **Non-Destructive Copy Button Feedback**:
   - In [cron-ui.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/cron/cron-ui.js) and [regex-ui.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/cron/regex-ui.js), capture `btn.innerHTML`, set `btn.innerHTML = '<i class="fas fa-check" aria-hidden="true"></i> <span>Copied!</span>'`, add `.copied` class, and restore `originalHtml` after 1500ms.
   - Add `.action-btn.copied { background: var(--color-success); color: #ffffff; border-color: var(--color-success); }` to `cron.css`.
2. **Non-Blocking Privacy Clear Confirmation**:
   - In [crypto-ui.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/crypto/crypto-ui.js), replace synchronous `window.confirm()` with a 2-step click-to-confirm pattern on `#privacy-clear-all-btn`:
     - First click: change button label to `<i class="fas fa-exclamation-triangle"></i> <span>Confirm Wipe?</span>` and start 3-second reset timer.
     - Second click: execute storage removal and input wiping, then flash `<i class="fas fa-check"></i> <span>Cleared!</span>`.

### Part C: Mobile Responsiveness & Touch Target Rectification
1. **Touch Target Expansion on Regex Flag Pills**:
   - In [cron.css](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/cron.css), update `.flag-pill` to `min-width: 44px; min-height: 44px;` with `gap: 0.5rem;`, meeting WCAG 2.5.5 touch target criteria.
2. **Regex Input Row Flex Wrapping**:
   - In `cron.css`, update `.input-group` to allow `flex-wrap: wrap`.
   - Add `@media (max-width: 640px)` rules ensuring `.primary-input` takes full width (`flex: 1 1 100%`) while `.flags-bar` and `#regex-copy-btn` form a secondary accessible row below it.
3. **Preserve Mobile Tab Labels in Crypto**:
   - In [crypto.css](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/crypto.css), remove `.tab-btn span { display: none; }` under `max-width: 640px`.
   - Style tabs compactly (`padding: 0.4rem 0.6rem; font-size: 0.8rem;`) and set explicit `aria-label` attributes on each tab button.
4. **Regex Backdrop Height Synchronization**:
   - In [regex-ui.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/cron/regex-ui.js), attach a `ResizeObserver` to `.test-textarea` that automatically updates the height of `.test-backdrop` so highlights remain aligned when the textarea is manually resized.

### Part D: Accessibility & Keyboard Control
1. **Dropzone Keyboard Activation**:
   - In [crypto-ui.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/crypto/crypto-ui.js), add a `keydown` listener to `#file-dropzone` that triggers `fileInput.click()` when `Enter` or `Space` is pressed.
2. **Live Error Announcement**:
   - In [cron.html](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/cron.html), add `role="alert"` and `aria-live="polite"` to `#cron-error` and `#regex-error`.
3. **Custom Value Fallback in Cron 5-Part Picker**:
   - In [cron-ui.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/cron/cron-ui.js), if `syncPartPickers` encounters a value not in the default `<option>` list, inject a dynamic `<option value="...">` marked as `(custom)` so the dropdown displays accurately rather than going blank.

### Part E: Design Token & Layout Parity
1. **Footer Addition to Cron Visualizer**:
   - Add `<footer class="app-footer">` to [cron.html](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/cron.html) with reciprocal links to Portfolio, Apps Shelf, and `/crypto`.
   - Add `.app-footer`, `.footer-container`, `.footer-link` styles to [cron.css](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/cron.css) matching `crypto.css`.
2. **Brand Tag Badge Style**:
   - In [crypto.css](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/crypto.css), style `.brand-tag` with uppercase styling, border, background, and micro-padding matching `cron.css`.
3. **Preset Chips Hierarchy**:
   - Remove the redundant nested `.presets-wrap` in `cron.html`.
   - Align `.chip-btn` and `.hasher-chip` padding and font treatment.
4. **Card Title Scale**:
   - Unify `.card-title` across both stylesheets to `1.15rem` (Major Second ramp).
5. **Tab Active Accents in Crypto**:
   - In `crypto.css`, assign distinctive active tab colors using existing tokens:
     - `[data-tab="encoders"].active { color: var(--accent-encoder); }`
     - `[data-tab="hasher"].active { color: var(--color-success); }`
     - `[data-tab="generators"].active { color: var(--accent-crypto); }`
     - `[data-tab="time"].active { color: var(--primary); }`
6. **Time Workbench Affordance Parity**:
   - Add a "Now" button (`#time-date-now-btn`) to Converter 2 in [crypto.html](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/crypto.html).
   - Add a Copy button targeting `#time-epoch-local-out` in Converter 1.
7. **Inactive Live Clock Polling Optimization**:
   - In [crypto-ui.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/crypto/crypto-ui.js), start `setInterval(tick, 200)` only when the Time tab is active (`#panel-time.hidden === false`), and pause execution when hidden.

---

## 5. Verification & Test Plan

```bash
# 1. Lint checks
npm run lint:js
npm run lint:css

# 2. Frontend unit tests
npm test

# 3. Production build validation
npm run build

# 4. CSP hash validation (ensure zero hashes broken)
python3 scripts/check_csp_hashes.py

# 5. Documentation and token counts verification
python3 scripts/check_docs.py --fix --show-tokens
```

- **Manual Verification**:
  - Verify theme synchronization between `/`, `/cron`, and `/crypto` in light and dark modes.
  - Verify mobile responsiveness at 360px width in devtools (no overflow in regex bar, tab labels readable).
  - Verify keyboard tab navigation and `Enter`/`Space` activation on the file dropzone.
  - Test copy buttons in both apps to confirm icons persist after multiple clicks.
