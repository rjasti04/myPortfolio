# Intent: Bespoke Data-Engineering Circuit Schematic Backdrop Redesign

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: First impression visual excellence, instantaneous engineering credibility, distraction-free reading, 4.5:1+ WCAG AA text contrast)
  - [x] 2. Portfolio as a Work Sample (Priority: High-craft architectural discipline, zero framework dependencies, pure CSS/SVG asset integration, strict CSS size budget)
  - [ ] 3. Owner (Priority: Authentic representation of Principal Data Engineering systems — Kafka streams, distributed pipelines, consensus rings — rather than generic stock hardware clipart)

- **Problem Statement**:
  The current portfolio background (`frontend/site-backdrop.webp`, derived from `assets/site-backdrop-master.jpg`) was introduced to replace the retired Three.js canvas across all 8 SPA sections. However, from the perspective of elite UI/UX engineering and graphic design, the asset has critical visual and thematic flaws:
  
  1. **Stock Clipart Artifacts & Broken Scales**: The perimeter features nonsensical measurement rulers with repeating, corrupted numbers (`170 170`, `260 260 280 270`, `min min`) and OCR noise. These hallmarks of cheap stock vectors degrade the portfolio's credibility for a Principal Engineer.
  2. **Severe Spelling Errors**: The center graphic contains glaring typographical errors (`"DATA PROCESE MODULE 05"` and `"INFRASTRUCTURE LOGGIC"`). A portfolio highlighting data quality and precision cannot feature misspellings in its primary aesthetic ground.
  3. **Content Clutter & Anti-Content Focus**: Five dense, solid rectangular boxes are clustered in the lower-middle viewport. This directly collides with the hero console, profile card, terminal, and section cards, creating visual friction and muddying typography.
  4. **Muddy Light-Theme Inversion**: In light mode, CSS `filter: invert(1)` turns solid dark boxes and blue nodes into murky charcoal/grey smudges beneath clean white cards.
  5. **Thematic Disconnect**: The imagery depicts vintage electronic hardware (resistors, solder pads, IC sockets) rather than modern distributed data architecture (streaming event buses, partition trees, sharded clusters, DAG pipelines).

  **The Redesign Objective**:
  Create a bespoke, museum-grade technical schematic backdrop titled **"The Silicon Pipeline" (Distributed Neural Bus)**. It will frame the viewport with delicate 45°/90° multi-lane data bus corridors, partition streams, and precision registration marks around the margins while preserving an open, tranquil **Central Content Aperture** (65% width) that ensures flawless typography readability in both dark and light themes.

---

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules and vanilla CSS. Zero third-party runtime frameworks (no React, Three.js, PixiJS, or WebGL).
  - **ADR-016**: Zero third-party asset requests. All background images (`site-backdrop.webp`, `site-backdrop.jpg`) must remain self-hosted, local, and content-hashed by esbuild.
  - **ADR-024 / ADR-025**: Must integrate seamlessly with the design token architecture in `frontend/styles.css` (`--backdrop-tint`, `--backdrop-scrim`, `--bg`, `--surface`, `--accent-fill`).
  - **Theme Invertibility**: The master graphic must be designed with clean hairline stroke weights and zero solid opaque block fills, allowing light theme CSS inversion (`filter: invert(1) hue-rotate(180deg)...`) to render as an authentic, crisp architectural drafting blueprint.
  - **Strict Contrast Headroom**: All section content, cards, and body text must maintain >= 4.5:1 WCAG AA contrast (with headings >= 7:1 AAA) across all themes.
  - **CSS Size Budget**: Final CSS bundle must remain strictly under the 288 KiB ceiling enforced by `scripts/build.mjs`.
  - **Standalone App Isolation**: Standalone tools and games (`arcade`, `cron`, `crypto`, `json`, `diff`, `ucl`, `worldcup`) must remain strictly excluded from the SPA backdrop.

- **Explicit Non-Goals**:
  - Replacing the backdrop with a continuous JavaScript rAF rendering loop or heavy canvas animation that burns battery or GPU cycles.
  - Introducing heavy glowing drop-shadow filters or blurred duplicate raster planes in CSS that cause compositor lag.
  - Modifying the underlying content, routing, or structure of the 8 SPA sections.

---

## 3. Impacted Layer Matrix & Quality Gates

Determine impacted layers and execute matching quality gates:

- [x] **Frontend**:
  - Assets: `assets/site-backdrop-master.jpg` (new high-resolution 1920x1080 master), `frontend/site-backdrop.webp`, `frontend/site-backdrop.jpg`
  - Styles: `frontend/styles.css` (refine `--backdrop-scrim`, `--backdrop-tint`, `.site-backdrop` blend rules)
  - Scripts: `scripts/generate_backdrop.py` (process and optimize WebP/JPEG derivatives)
  - Gates: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no backend services, models, or endpoints impacted.
- [ ] **Database**: N/A — no schema migrations.
- [x] **Docs / Hashes / Quality Verification**:
  - `python scripts/check_csp_hashes.py` (verify CSP script hashes remain intact)
  - `python scripts/check_docs.py --fix --show-tokens` (synchronize reference and navigation line counts and token estimates)

---

## 4. Risks & Mitigations

- **Risk: Content Readability Conflicts on Low-Contrast Displays**:
  - *Mitigation*: Implement an engineered **Radial Content Aperture** in `--backdrop-scrim`. The central 65% reading zone applies a 90–94% wash of `--bg`, gracefully opening to 75–80% along the peripheral margins where the high-density streaming buses frame the screen.
- **Risk: Light Theme Visual Mud & Dirty Grays**:
  - *Mitigation*: The new master graphic will eliminate all solid filled rectangular boxes and gradient drop shadows. With only clean 1px–2px hairline traces and micro-vias, CSS inversion transforms the asset into a crisp engineering cyanotype/vellum blueprint with zero muddy rectangles.
- **Risk: Mobile Performance & Clutter**:
  - *Mitigation*: Preserve the established `@media (pointer: coarse) and (width <= 768px)` gate in `styles.css` that hides `.site-backdrop` on phones, ensuring zero battery drain and maximum readability on handheld screens.
