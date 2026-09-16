# Intent: Circuit Board Backdrop & Glowing Signal Flow on Mobile Devices

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: 50%+ of recruiting and portfolio visits occur on mobile viewports; immersive engineering identity, impeccable text contrast, zero jank or battery drain)
  - [x] 2. Portfolio as a Work Sample (Priority: High-craft responsive SVG/CSS architecture, adherence to ADR-001, ADR-016, and DESIGN.md token contracts)
  - [ ] 3. Owner (Priority: Authentic, consistent presentation of Principal Data Engineer brand across both handheld and desktop devices)

- **Problem Statement**:
  The circuit board backdrop (`assets/site-backdrop-master.jpg`, emitted to `frontend/site-backdrop.webp`) and animated glowing signal flows (`.site-backdrop-flow` in `frontend/index.html`) were recently redesigned and deployed for desktop viewports. However, they remain completely suppressed on mobile devices:
  
  1. **Wholesale Mobile Suppression**:
     `frontend/styles.css` explicitly hides the backdrop on mobile devices via `@media (pointer: coarse) and (width <= 768px) { .site-backdrop { display: none; } }`, leaving mobile visitors with a flat, generic background gradient.
  2. **Animation Desktop-Only Gate**:
     `.site-backdrop-flow` is restricted to `@media (width >= 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)`, preventing mobile browsers from rendering the active signal packets.
  3. **Visual Inequity Between Form Factors**:
     Mobile visitors—including recruiters reviewing resumes on smartphones—miss the entire bespoke hardware/infrastructure visual identity that sets this portfolio apart.
  4. **Aspect Ratio & Path Clipping Dynamics**:
     Our live mobile visual preview revealed that while the background graphic looks exceptional behind mobile elements and maintains > 7:1 text contrast, the narrow portrait viewport (aspect ratio ~0.46 vs. 1.78) center-crops the outer 60% of the 1920×1080 canvas. Consequently, 4 of the 5 desktop vector animation paths (`X=1740, 1648, 256, 288`) are cropped off-screen in portrait orientation, leaving only Path 3 (`M 700 940 H 1300`) visible. In mobile landscape (e.g., 844×390), all 5 paths and side bus corridors display properly.

  This initiative establishes a deliberate, performant, and battery-conscious mobile implementation of the circuit board backdrop and glowing dot streams.

---

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules and CSS. No UI frameworks, canvas runtimes, or external animation libraries.
  - **ADR-016**: Zero third-party asset requests. All derivative images (`site-backdrop.webp`, `site-backdrop.jpg`) remain local, self-hosted, and content-hashed.
  - **Single Asset Derivative**: Mobile must consume the existing 1920×1080 derivative asset rather than introducing an additional image download, preserving bandwidth and cache efficiency.
  - **WCAG 2.2 AA/AAA Contrast Compliance**: Hero copy, body text, and interactive buttons must maintain >= 4.5:1 (AA) and >= 7:1 (AAA) contrast against the backdrop across all themes on mobile screens.
  - **Strict Accessibility & Battery Respect**: `prefers-reduced-motion: reduce` must immediately hide `.site-backdrop-flow` on mobile. The animation must be zero-cost when motion is disabled or when the tab is backgrounded.
  - **Zero Standalone App Pollution**: Standalone apps and predictors (`arcade`, `cron`, `crypto`, `json`, `diff`, `ucl`, `worldcup`) must remain untouched.
  - **Automated Trace Verification**: Any vector path added or modified in `.site-backdrop-flow` must pass `python scripts/check_backdrop_traces.py` with >= 95% on-trace luminance.

- **Explicit Non-Goals**:
  - Introducing a separate mobile-specific raster image asset or art-directed crop that increases bundle size.
  - Using requestAnimationFrame (rAF) JavaScript particle engines on mobile.
  - Modifying the typography, navigation layout, or section structure of the mobile SPA.
  - Altering the desktop appearance or desktop trace routes.

---

## 3. Impacted Layer Matrix & Quality Gates

Determine impacted layers and execute matching quality gates:

- [x] **Frontend**:
  - Styles: `frontend/styles.css` (media queries for `.site-backdrop` and `.site-backdrop-flow`, mobile performance tuning).
  - Markup: `frontend/index.html` (SVG paths in `.site-backdrop-flow` evaluated for responsive portrait framing).
  - Quality gates: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no backend API endpoints or models affected.
- [ ] **Database**: N/A — no database schemas or migrations.
- [x] **Docs / Hashes**:
  - `python scripts/check_csp_hashes.py` (verify inline script hashes remain untouched)
  - `python scripts/check_backdrop_traces.py` (verify 100% on-trace alignment against `site-backdrop.webp`)
  - `python scripts/check_docs.py --fix --show-tokens` (keep navigation and reference documentation counts synchronized)

---

## 4. Risks & Mitigations

- **Risk: Mobile Battery Drain from Continuous SVG Stroke Animation**:
  - *Mitigation*: The animation relies on CSS `@keyframes` manipulating `stroke-dashoffset` on 5 lightweight vector paths. Modern mobile browsers isolate this onto paint layers with `will-change: stroke-dashoffset` and automatically suspend animation execution when the tab is inactive or hidden. Furthermore, users with battery-saver modes or reduced-motion preferences are fully protected via `@media (prefers-reduced-motion: no-preference)`.
- **Risk: Content Illegibility on Small Mobile Displays**:
  - *Mitigation*: The calibrated radial gradient mask (`--backdrop-scrim`) ensures that the upper-middle aperture (where the hero portrait, name, and subtitle render) receives 88–92% wash, preventing any trace lines from clashing with text. Visual testing confirms contrast exceeds 7:1 across all mobile sections.
- **Risk: Asymmetrical Path Cropping in Narrow Portrait Viewports**:
  - *Mitigation*: The SVG uses `preserveAspectRatio="xMidYMid slice"`, locking vector coordinates directly to the background image's center-crop. Path 3 (`M 700 940 H 1300`) naturally runs across the bottom margin behind the social buttons. In landscape orientation, all 5 paths display uncropped.
