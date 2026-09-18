# Intent: UI/UX & Visual Design Layer Comprehensive Remediation

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: Uncompromising first-paint aesthetic polish, high tactile responsiveness, intuitive feedback, WCAG 2.2 Level AA accessibility)
  - [x] 2. Portfolio as a Work Sample (Priority: High-craft architectural discipline, strict token-based CSS system, zero framework dependencies, semantic HTML)
  - [ ] 3. Owner (Priority: Confident interactive utility across admin, auth, and analytics surfaces without fear of accidental data destruction)

- **Problem Statement**:
  A rigorous audit of the `rjWebApp` frontend UI/UX and visual design layer identified four critical friction areas across the user experience:
  
  1. **Interaction & State Handling**:
     - Several destructive actions (e.g., deleting saved custom themes in `theme-customizer.js`, clearing entire JSON workbenches in `json-main.js`, and resetting custom palettes) execute instantaneously without confirmation dialogs or undo mechanisms, despite the repo owning `confirmAction` (`confirm-dialog.js`).
     - Key async views (e.g., active sessions in `auth-ui.js`, chat transcript hydration in `chat.js`) use bare text strings or unstyled spinning icons rather than high-fidelity shimmer skeleton states.
     - Critical actions (applying a theme customizer palette, saving custom themes) provide no visual completion confirmation (toasts) to sighted users.
     
  2. **Usability & Accessibility**:
     - Undersized touch targets below the 44px floor (e.g., `.dropdown-panel-close` and `.nav-menu-close` at 34px, `.theme-chip-remove` at 32px, theme save controls at 36px, `.chat-close-btn` at 36px) fail WCAG 2.2 SC 2.5.5 / 2.5.8 recommendations on coarse pointer devices.
     - Contrast deficiencies exist on placeholder text (e.g., `.terminal-input::placeholder` at 2.7:1 and `.cmd-palette-input::placeholder` at 3.2:1 against dark backgrounds) and focus ring overrides.
     - Inconsistent modal backdrops and focus trap behavior between `modal.js` and custom dropdowns/palette.

  3. **Visual Polish, Surfaces & Backgrounds**:
     - Pervasive hardcoded hex/RGB color literals (over 90 instances in CSS, plus Catppuccin fallbacks in `auth-modal.css`) bypass the token layer established in `docs/DESIGN.md`.
     - `--elev-1` through `--elev-4` rely on a single ambient shadow plus hairline ring, lacking the multi-stop key-light and ambient diffusion characteristic of modern state-of-the-art UI design systems.
     - Nested corner radii suffer from concentric distortion (e.g., inner radius of 13px inside a 16px container with 14px padding in `.contact-primary-link`), and several off-scale radius literals (10px, 11px, 13px, 14px, 18px) exist.

  4. **Motion, Transitions & Micro-Interactions**:
     - The Command Palette (`.cmd-palette`) snaps into and out of existence via `[hidden] { display: none; }` without enter/exit mount transitions.
     - Multiple interactive buttons lack `:active` press scale feedback, and focus indicators are suppressed (`outline: none`) on certain inputs without replacement rings.
     - Raw duration literals and browser-default easing curves (`0.45s`, `ease-out`) bypass `--motion-*` and signature easing tokens.

  **The Remediation Objective**:
  Establish an immaculate, WCAG 2.2 AA compliant, token-consistent UI layer across the entire portfolio and standalone applications, ensuring every interaction feels alive, safe, and exquisitely polished.

---

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules and vanilla CSS. Zero frontend runtime frameworks (no React, Vue, Svelte, or Tailwind).
  - **ADR-016**: Zero third-party asset requests. All icons and fonts must remain local/self-hosted.
  - **ADR-024 / ADR-025**: All colors, elevations, radii, spacings, and motion curves must derive from the `:root` / `body.dark-theme` token architecture in `frontend/styles.css`.
  - **Dark-Ink Accent Invariant**: `--on-accent` is dark ink (`#14100a` on citron at 11.2:1); `#fff` must never be used on accent fills or fallbacks.
  - **Strict Contrast Headroom**: All body text must maintain >= 4.5:1 WCAG AA contrast (headings >= 7:1 AAA) across all themes.
  - **Performance & Asset Budgets**: CSS must remain under the 288 KiB budget in `scripts/build.mjs`.

- **Explicit Non-Goals**:
  - Rewriting standalone application business logic or algorithms (e.g., cron parser, diff compute, crypto implementations).
  - Introducing heavy JavaScript animation libraries (GSAP, Framer Motion) or WebGL runtimes.
  - Altering backend API endpoints, models, or database schemas.

---

## 3. Impacted Layer Matrix & Quality Gates

Determine impacted layers and execute matching quality gates:

- [x] **Frontend**:
  - Stylesheets: `frontend/styles.css`, `frontend/auth-modal.css`, `frontend/app-chrome.css`, `frontend/json.css`, `frontend/diff.css`, `frontend/cron.css`, `frontend/crypto.css`
  - JavaScript: `frontend/js/theme-customizer.js`, `frontend/js/auth-ui.js`, `frontend/js/chat.js`, `frontend/js/activity.js`, `frontend/js/terminal/palette.js`, `frontend/js/json/json-main.js`, `frontend/js/diff/diff-ui.js`
  - Gates: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no API routes, services, or models impacted.
- [ ] **Database**: N/A — no schema migrations.
- [x] **Docs / Hashes / Quality Verification**:
  - `python scripts/check_csp_hashes.py` (verify inline-script hashes)
  - `python scripts/check_docs.py --fix --show-tokens` (synchronize reference and navigation figures)

---

## 4. Risks & Mitigations

- **Risk: Touch Target Layout Shift in Dense Headers**:
  - *Mitigation*: Expand touch target bounding boxes using invisible pseudo-elements (`::before` / `::after` with `min-width: 44px; min-height: 44px; position: absolute; inset: -4px;`) on compact icon buttons (e.g. `.chat-close-btn`, `.nav-menu-close`), preserving visual 34–36px sizing while providing full 44px touch envelopes.
- **Risk: Unmount Animation Race Conditions in Modals & Palette**:
  - *Mitigation*: Leverage CSS transitions with `transitionend` handlers or dual-state classes (`.is-open` / `.is-entering` / `.is-leaving`) before setting `hidden` or `display: none`, identical to the pattern in `modal.js`.
- **Risk: Theme Customizer Palette Variable Bleed**:
  - *Mitigation*: When removing hardcoded hex fallbacks in `auth-modal.css`, ensure tokens are validated against `clearCustomPalette()` in `theme-customizer.js` to prevent lingering CSS custom properties on `body.style`.
