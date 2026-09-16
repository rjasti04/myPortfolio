# Intent: Circuit Board Background Across All SPA Pages (Including Apps, Excluding Standalone Apps)

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: First paint, visual cohesion, immersive cyberpunk / engineering aesthetic, 4.5:1 text contrast)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, responsive SVG-CSS alignment, strict CSS budget)
  - [ ] 3. Owner (Priority: Consistent personal branding and aesthetic excellence)

- **Problem Statement**:
  Previously, the circuit board / technical schematic backdrop existed only on the landing view (`#home`), leaving subsequent pages (`#about`, `#resume`, `#hobbies`, `#apps`, `#activity`, `#contact`, `#ai`) with either an un-themed plexus canvas or flat gradients. 
  
  The user requested to implement the circuit board background across **all pages of the SPA, explicitly including the Apps page (`#apps`)**, while **excluding all standalone pages that are launched independently from the Apps page** (`/arcade`, `/cron`, `/crypto`, `/json`, `/diff`, `/ucl`, `/worldcup`).

---

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules and CSS. Zero framework dependencies (no React, Three.js, PixiJS).
  - **ADR-016**: Zero third-party asset requests. All backdrop images and styles are local and self-hosted.
  - **Exclusion of Standalone Apps**: The 7 standalone developer tools and games launched from `#apps` (`arcade.html`, `cron.html`, `crypto.html`, `json.html`, `diff.html`, `ucl.html`, `worldcup.html`) are independent documents with separate stylesheets and standalone scopes. They must **NOT** inherit the circuit board backdrop or load `styles.css`.
  - **Full SPA Inclusivity (Including `#apps`)**: The circuit board backdrop must sit behind all 8 SPA sections (`#home`, `#about`, `#resume`, `#hobbies`, `#apps`, `#activity`, `#contact`, `#ai`) via a single root-level fixed element (`.site-backdrop`).
  - **Strict Contrast & Readability**: Body text and cards must maintain WCAG 2.2 Level AA compliance (minimum 4.5:1 contrast for regular copy) across every section through a calibrated `--backdrop-scrim` wash.
  - **CSS Size Budget**: CSS bundle must remain strictly under the 288 KiB hard budget enforced by `scripts/build.mjs`. The legacy `#home`-only `.home-schematic` markup and CSS (~350 lines) will be retired to make room for the unified `.site-backdrop`.
  - **Battery & Mobile Protection**: Hide the backdrop entirely on mobile phones (`@media (pointer: coarse) and (width <= 768px)`) to preserve battery life and screen clarity.

- **Explicit Non-Goals**:
  - Modifying any standalone app page markup or stylesheet (`frontend/arcade.*`, `cron.*`, `crypto.*`, `json.*`, `diff.*`, `ucl.html`, `worldcup.html`).
  - Running continuous JavaScript rAF rendering loops for the background; all backdrop display and transit animations must execute purely through CSS and SVG vector dashoffset.
  - Altering the contact form, auth modal, or chat widget behavior.

---

## 3. Impacted Layer Matrix & Quality Gates

Determine impacted layers and execute matching quality gates:

- [x] **Frontend**:
  - Markup: `frontend/index.html` (mount `.site-backdrop` and `.site-backdrop-flow`, retire `.home-schematic`)
  - Styles: `frontend/styles.css` (tokens `--backdrop-scrim`, `--backdrop-tint`, `--backdrop-flow-ink`, layout rules, responsive gates)
  - Assets: `frontend/site-backdrop.webp`, `frontend/site-backdrop.jpg`
  - Scripts: `scripts/generate_backdrop.py`, `scripts/check_backdrop_traces.py`
  - Gates: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no backend routes or services touched.
- [ ] **Database**: N/A — no models or migrations touched.
- [x] **Docs / Hashes / Verification**:
  - `python3 scripts/check_csp_hashes.py` (ensure inline script hashes remain valid)
  - `python3 scripts/check_backdrop_traces.py` (ensure 100% on-trace luminance >= 120 for SVG transit pulses)
  - `python3 scripts/check_docs.py --fix --show-tokens` (synchronize reference and navigation docs)

---

## 4. Risks & Mitigations

- **Risk: Contrast Degradation on Content-Heavy Sections (`#about`, `#resume`, `#apps`)**:
  - *Mitigation*: Calibrated `--backdrop-scrim` (80% wash of `--bg` in light theme, 85% in dark theme) ensures that high-frequency copper traces remain strictly background texture, preserving contrast ratios > 4.5:1 for body copy and interactive cards.
- **Risk: Bundle Budget Overflow**:
  - *Mitigation*: Retiring the obsolete `#home`-only `.home-schematic` CSS reclaims ~350 lines (~10 KiB), creating ample headroom for the ~150 lines of `.site-backdrop` and `.site-backdrop-flow` rules while keeping the final CSS bundle under 287 KiB (budget: 288 KiB).
- **Risk: Trace Misalignment on Viewport Resize**:
  - *Mitigation*: Both the raster backdrop (`background-size: cover; background-position: center;`) and the SVG pulse overlay (`viewBox="0 0 1920 1191" preserveAspectRatio="xMidYMid slice"`) share identical 1920:1191 coordinate geometry, ensuring mathematically identical scaling and zero offset drift at all aspect ratios.
