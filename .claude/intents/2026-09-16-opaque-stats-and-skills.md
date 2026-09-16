# Intent: Opaque Surfaces for Stat Cards and Skill Groups

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: High visual legibility, strong contrast against technical backdrop, professional polish)
  - [x] 2. Portfolio as a Work Sample (Priority: Token consistency with ADR-024/ADR-025, clean CSS architecture, zero framework bloat)
  - [ ] 3. Owner (Priority: Personal pride in aesthetic clarity and design hierarchy)

- **Problem Statement**:
  Following the introduction of the high-contrast circuit board technical backdrop (`site-backdrop.webp`) and animated SVG signal transit layer (`.site-backdrop-flow`), key content cards in the About and Skills sections have visual legibility issues:
  1. The stats cards (`.stat-card.glass-light`) housing `.stat-number` ("8+", "50+", "1M+", "30%", "40%", "99.9%") and `.stat-label` utilize `--glass-light-bg` (`rgba(255, 255, 255, 0.22)` in light theme and `rgba(30, 41, 59, 0.45)` in dark theme).
  2. The technical skills cards (`.skill-group.glass-light.reveal.active`) also rely on `--glass-light-bg`.
  3. Because both containers are heavily translucent (78% transparent in light mode, 55% transparent in dark mode), bright copper traces, vias, and animated circuit pulse lines pass directly behind numbers, labels, and skill chips. This causes visual noise, interferes with typography readability, and distracts from the core metrics and skill taxonomy.
  4. On hover, both card classes transition to translucent washes (`--sheen-wash` in light mode and `rgba(30, 41, 59, 0.65)` in dark mode), failing to maintain opacity.
  5. The user explicitly requested to make `.stat-number` / `.stat-card` and `.skill-group.glass-light` opaque so the background is not visible through them.

---

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules; zero UI frameworks or external CSS component libraries.
  - **ADR-016**: Zero third-party asset requests. All stylesheets and fonts remain self-hosted.
  - **ADR-024 / ADR-025 (DESIGN.md)**: All surface colors and elevation must respect the design token system, providing calibrated light-theme (`:root`) and dark-theme (`body.dark-theme`) pairs with verified WCAG AA contrast.
  - **Parity with Fallbacks**: Align with the existing `@supports not (backdrop-filter: ...)` rule (`#ffffff` for light theme, `#1e293b` for dark theme) to maintain visual consistency across all rendering engines.

- **Explicit Non-Goals**:
  - Do **NOT** remove or disable the site-wide circuit board backdrop (`site-backdrop.webp`) or animated transit flow (`.site-backdrop-flow`).
  - Do **NOT** modify other unrelated card surfaces such as the terminal panel (`.terminal-panel.glass-dark`), `#resume .item`, or hobby cards (`.hobby-card`).
  - Do **NOT** alter the animated numeric counting logic in `frontend/js/animations.js` or terminal introspection in `frontend/js/terminal/index.js`.
  - Do **NOT** modify the standalone predictors (`/ucl`, `/worldcup`).

---

## 3. Impacted Layer Matrix & Quality Gates

- [x] **Frontend**:
  - `frontend/styles.css` (tokens `--glass-light-bg`, `.stat-card`, `.skill-group`, and hover states)
  - `frontend/index.html` (verified DOM attributes)
  - Quality gates: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no backend changes.
- [ ] **Database**: N/A — no database changes.
- [x] **Docs / Hashes**:
  - `python scripts/check_csp_hashes.py` (ensure inline script hashes remain untouched)
  - `python scripts/check_docs.py --fix --show-tokens` (ensure token counts and line counts remain synchronized)

---

## 4. Risks & Mitigations

- **Risk: Loss of Glassmorphism Aesthetic Depth**:
  - *Analysis*: Fully opaque surfaces could risk looking flat if borders and shadows are not properly calibrated.
  - *Mitigation*: Leverage `--radius-lg`, `--elev-1` / `--elev-2` elevation shadows, and subtle border definitions (`--border` / `--glass-light-border`), preserving the signature top-edge gradient rule (`.stat-card::before`) and hover radial glow bloom (`.stat-card::after` and `.skill-group::before`).
- **Risk: Contrast of `.stat-number` Gradient Text**:
  - *Analysis*: `.stat-number` uses `linear-gradient(135deg, var(--accent-text), var(--secondary-text))` with `background-clip: text`. On an opaque surface, both `--accent-text` and `--secondary-text` must clear WCAG AA.
  - *Mitigation*: Both `--accent-text` and `--secondary-text` are already calibrated against `--bg` and `--surface` (e.g., citron/azure in dark mode at >7:1 contrast). Against a solid `#ffffff` or `#1e293b` card surface, legibility will substantially improve compared to the translucent backdrop.
- **Risk: Hover State Translucency Regression**:
  - *Mitigation*: Explicitly update `.stat-card:hover` and `.skill-group:hover` to preserve solid opaque backgrounds with subtle tone lifts rather than setting semi-transparent RGBA values.
