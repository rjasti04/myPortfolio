<!--
IMPORTANT INSTRUCTION FOR AI AGENTS:
DO NOT overwrite this template file (.claude/templates/intent.md).
When drafting or preparing an intent document for a feature, create a new distinct file at:
  .claude/intents/YYYY-MM-DD-<feature-slug>.md
-->

# Intent: Developer Apps UI/UX Harmonization & Quality Remediation

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [ ] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)
- **Problem Statement**:
  A comprehensive audit of the two standalone developer tools on `rjasti.com`—**Cron & Regex Visualizer** (`/cron`) and **Crypto & Encoders** (`/crypto`)—identified 18 UI/UX inconsistencies, accessibility gaps, mobile layout bugs, and interaction defects.
  Key issues include:
  - Theme storage key collision (`theme` vs `rj-theme`) breaking cross-page theme synchronization between the tools and the main portfolio.
  - Theme toggle button in `/cron` never updating its icon or accessible label when switched.
  - Destructive copy buttons in `/cron` erasing SVG/FontAwesome icons on text content mutation.
  - Mobile viewport overflow on small devices (<600px) in the regex input row and tiny 32px flag pills violating WCAG touch targets.
  - Mobile tab labels completely hidden at <=640px in `/crypto` without accessible button labels or tooltips.
  - Unbound keyboard controls on the Base64 file dropzone (`role="button"` missing Enter/Space handlers).
  - Background live clock interval continuously polling and mutating DOM nodes even when inactive.
  - Asymmetrical page footer, brand badge styles, preset chips, and color palette tokens across sibling tools.

  Remediating these findings elevates both utilities to professional production standards while demonstrating strong frontend engineering discipline without framework abstractions.

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules. No frameworks (React, Vue, Svelte) or external UI component libraries.
  - **ADR-016**: Zero third-party asset requests. All icons, fonts (Plus Jakarta Sans), and styles must remain local and self-hosted.
  - **ADR-023**: 100% client-side execution; zero backend endpoints or network egress for logic inspection or data transformation.
  - **WCAG AA Compliance**: All touch targets must clear minimum 44px (48px under 640px); all text variants must clear WCAG AA contrast against `--bg` (`docs/DESIGN.md §Accessibility obligations`).
- **Explicit Non-Goals**:
  - **New Functional Panels or Generators**: No new encoding algorithms, hashing formats, or regex parsers; this initiative strictly focuses on UI/UX, accessibility, performance, and layout polish.
  - **Merging into Single Route**: `/cron` and `/crypto` remain distinct standalone pages accessible from the Apps shelf (`/#apps`) while sharing consistent component design language.
  - **Framework Introduction**: No component abstractions or virtual DOM libraries.

## 3. Scope of Remediation & Acceptance Criteria

### A. Theme Synchronization & Status Bar Parity
- [ ] Align `localStorage` key in `frontend/js/cron/cron-main.js` from `rj-theme` to `theme`, synchronizing with `frontend/js/theme.js` and `frontend/js/crypto/crypto-main.js`.
- [ ] Dynamically swap the theme toggle icon between `fa-sun` and `fa-moon` in `cron-main.js` with updated `aria-label`.
- [ ] Dynamically synchronize `<meta name="theme-color">` between dark (`#090d16`) and light (`#f8fafc`) across both `/cron` and `/crypto`.
- [ ] Ensure `crypto-main.js` respects system `prefers-color-scheme: light` if no preference is stored.
- [ ] Add smooth `body { transition: background-color 0.2s ease, color 0.2s ease; }` to `cron.css` matching `crypto.css`.

### B. Button Feedback & Interaction Non-Destructiveness
- [ ] Replace destructive `textContent = "Copied!"` in `cron-ui.js` and `regex-ui.js` with non-destructive HTML preservation and `<i class="fas fa-check"></i> Copied!` feedback matching `crypto-ui.js`.
- [ ] Add `.copied` CSS class with `--color-success` feedback styling to `cron.css`.
- [ ] Replace native blocking `window.confirm()` in `privacy-clear-all-btn` (`crypto-ui.js`) with a non-blocking 2-step inline confirmation.

### C. Mobile Responsiveness & Touch Accessibility
- [ ] Expand `.flag-pill` touch target dimensions in `cron.css` to min 44px × 44px.
- [ ] Enable flex wrapping on `.input-group` in `cron.css` at `<=640px` so that regex pattern input, flag pills, and copy button never overflow viewports on screens down to 320px.
- [ ] Retain readable tab text labels or supply explicit accessible `aria-label`s on mobile (`<=640px`) in `crypto.css` rather than unconditionally hiding `span` text.
- [ ] Synchronize `.test-backdrop` height with `.test-textarea` via `ResizeObserver` or CSS containment so match highlights stay pixel-aligned when resized.

### D. Accessibility & Keyboard Navigation
- [ ] Bind keyboard `Enter` and `Space` handlers to the file dropzone (`#file-dropzone`) in `crypto-ui.js` (WCAG 2.1.1).
- [ ] Add `role="alert"` and `aria-live="polite"` to `#cron-error` and `#regex-error` banners in `cron.html`.
- [ ] Prevent 5-part cron dropdown blankouts when custom non-preset values are parsed into `#cron-input`.

### E. Component & Layout Harmonization
- [ ] Add matching `.app-footer` to `cron.html` linking back to the portfolio (`/`), Apps Shelf (`/#apps`), and sibling tool (`/crypto`), with matching styles in `cron.css`.
- [ ] Unify brand tag styling in `crypto.html` (`.brand-tag`) to match the neat uppercase badge pill in `cron.html`.
- [ ] Harmonize preset chip styling (`.chip-btn` / `.hasher-chip`) and eliminate redundant nested `.presets-wrap` containers in `cron.html`.
- [ ] Align `.card-title` typography to `1.15rem` on the design scale across both apps.
- [ ] Align active tab colors in `crypto.css` using defined tokens (`--accent-encoder`, `--color-success`, `--accent-crypto`, `--primary`).
- [ ] Add a "Now" button to Converter 2 and a Copy button to `Local Date` in `crypto.html` for affordance parity.
- [ ] Optimize live clock in `crypto-ui.js` to tick only when the Time panel is visible and unhidden.

## 4. Impacted Layer Matrix & Quality Gates
- [x] **Frontend**:
  - `npm run lint` (ESLint + Stylelint must be clean)
  - `npm test` (JSDOM unit test suites must pass)
  - `npm run build` (esbuild bundle must compile within budgets)
- [ ] **Backend**: Not impacted (Zero API changes).
- [ ] **Database**: Not impacted (Zero schema changes).
- [x] **Docs / Hashes**:
  - `python3 scripts/check_csp_hashes.py` (Verify inline script hashes remain untouched)
  - `python3 scripts/check_docs.py --fix --show-tokens` (Update line counts and token metrics)

## 5. Risks & Mitigations
- **CSP Hash Invalidation**:
  - *Risk*: Touching inline `<script>` tags in `index.html` or other documents breaks CSP hashes.
  - *Mitigation*: All JavaScript logic resides in external ES modules (`cron-main.js`, `cron-ui.js`, `crypto-main.js`, `crypto-ui.js`). No inline script tags will be added or altered.
- **Visual Regressions on Mobile**:
  - *Risk*: Adjusting input group flex wrapping or flag pill touch sizes alters desktop layout.
  - *Mitigation*: Gate responsive layout changes behind `@media (max-width: 640px)` and verify responsive breakpoints across 360px, 480px, 640px, 768px, and 1024px.
- **Scroll Sync Disconnect**:
  - *Risk*: Adding ResizeObserver to the regex textarea could cause jitter during rapid typing.
  - *Mitigation*: Debounce height synchronizations and preserve lightweight scroll event forwarding.
