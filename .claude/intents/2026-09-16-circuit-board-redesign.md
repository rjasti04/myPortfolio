# Intent: Circuit Board Backdrop Redesign & Harmonious Visual Blending

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: Immersive engineering aesthetic, zero visual clutter, flawless text contrast, intuitive data-engineering thematic coherence)
  - [x] 2. Portfolio as a Work Sample (Priority: High-craft bespoke SVG/CSS/asset architecture, adherence to ADR-001, ADR-016, and DESIGN.md token contracts)
  - [ ] 3. Owner (Priority: Authentic representation of Principal Data Engineering infrastructure without stock-image artifacts or typos)

- **Problem Statement**:
  The existing site backdrop (`assets/site-backdrop-master.jpg`, emitted to `frontend/site-backdrop.webp` and `frontend/site-backdrop.jpg`) was recently deployed across all SPA pages, but suffers from several severe visual, thematic, and architectural flaws:

  1. **Nonsensical Ruler Markings & Stock Clipart Hallmarks**:
     The outer perimeter features arbitrary, broken measurement rulers with repeated and scrambled numbers (`170 170`, `260 260 280 270`, `160 160 300 200 100`, `min min`). These create an amateur "stock vector download" impression that directly undermines Rajeev's credibility as a Principal Engineer.
  2. **Obtrusive Center-Bottom Block Clump**:
     A dense cluster of 5 hard-bordered rectangular boxes (`COMPUTE MODULE 04`, `DATA PROCESE MODULE 05`, `API GATEWAY`, `DATA PIPELINE`, `INFRASTRUCTURE LOGGIC`) sits directly in the bottom-center of the viewport. This is precisely where card layouts, terminal windows, and hero content land, causing jarring visual collisions.
  3. **Blatant Spelling Typos**:
     The master graphic contains glaring misspellings: `"DATA PROCESE MODULE 05"` (*PROCESE*) and `"INFRASTRUCTURE LOGGIC"` (*LOGGIC*). A portfolio claiming rigorous data quality and engineering precision cannot display spelling errors on its primary backdrop.
  4. **Muddy Light Theme Inversion**:
     In the light theme, the CSS inversion filter (`filter: invert(1) hue-rotate(180deg)...`) turns the glowing blue boxes and dots into heavy, dirty charcoal/grey smudges and solid rectangles beneath clean white cards.
  5. **Lack of Central Breathing Room (Content Occlusion)**:
     The trace lines cut indiscriminately across the viewport without attenuation in the primary reading zones. This forced recent compromises like making stats and skill cards completely opaque to block distracting background lines.
  6. **Garbled Micro-Text & AI/OCR Artifacts**:
     The upper-right quadrant contains smudgy, illegible pseudo-text (`cpx ADG104442...`) and a misplaced targeting crosshair that lacks context or relevance.

---

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules and CSS. Zero framework dependencies (no React, Three.js, or external canvas runtimes).
  - **ADR-016**: Zero third-party asset requests. All backdrop assets must remain local, self-hosted, and content-hashed by esbuild.
  - **CSS Size Budget**: The production stylesheet must remain strictly under the 288 KiB ceiling enforced by `scripts/build.mjs`.
  - **Zero Standalone App Pollution**: Standalone tools and games (`arcade`, `cron`, `crypto`, `json`, `diff`, `ucl`, `worldcup`) must remain strictly untouched and free of the SPA backdrop.
  - **WCAG 2.2 AA Contrast Compliance**: All body text, secondary copy, and interactive components must clear 4.5:1 contrast against the backdrop across all themes.
  - **Automated Trace Verification**: Any animated vector pulses in `.site-backdrop-flow` must pass `python scripts/check_backdrop_traces.py` with >= 95% on-trace luminance.

- **Explicit Non-Goals**:
  - Replacing the backdrop with an active, CPU-heavy canvas animation (e.g., re-enabling Three.js or heavy rAF particle simulations).
  - Modifying the content, layout, or copy of the SPA's 8 sections (`#home`, `#about`, `#resume`, `#hobbies`, `#apps`, `#activity`, `#contact`, `#ai`).
  - Touching standalone applications or backend services.

---

## 3. Impacted Layer Matrix & Quality Gates

Determine impacted layers and execute matching quality gates:

- [x] **Frontend**:
  - Assets: `assets/site-backdrop-master.jpg` (redesigned master), `frontend/site-backdrop.webp`, `frontend/site-backdrop.jpg`
  - Markup: `frontend/index.html` (updated vector flow paths in `.site-backdrop-flow` if routes change)
  - Styles: `frontend/styles.css` (tokens `--backdrop-scrim`, `--backdrop-tint`, radial mask/vignette gradient, light/dark theme filters)
  - Scripts: `scripts/generate_backdrop.py`, `scripts/check_backdrop_traces.py`
  - Quality gates: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no backend routes or schemas modified.
- [ ] **Database**: N/A — no database models or migrations.
- [x] **Docs / Hashes**:
  - `python scripts/check_csp_hashes.py` (ensure inline script hashes remain untouched)
  - `python scripts/check_backdrop_traces.py` (ensure 100% on-trace luminance for animated pulses)
  - `python scripts/check_docs.py --fix --show-tokens` (synchronize reference and navigation docs)

---

## 4. Risks & Mitigations

- **Risk: Disconnect between Raster Backdrop and SVG Flow Animation**:
  - *Mitigation*: The coordinate system remains pegged at 1920x1191 with `preserveAspectRatio="xMidYMid slice"` matching `background-size: cover; background-position: center;`. Any redesigned vector pulse paths will be extracted directly from the new master geometry and validated via `scripts/check_backdrop_traces.py`.
- **Risk: Content Readability vs. Backdrop Visibility**:
  - *Mitigation*: Introduce a radial luminance falloff (vignette mask) that gently attenuates traces by 40–60% in the central reading zone while allowing crisp, elegant circuit traces to frame the viewport periphery.
- **Risk: Light Theme Visual Degradation**:
  - *Mitigation*: Design the new master graphic with uniform line weights, no heavy solid dark fills, and clean negative space. Inversion will cleanly produce a crisp architectural blueprint with zero muddy rectangles.
