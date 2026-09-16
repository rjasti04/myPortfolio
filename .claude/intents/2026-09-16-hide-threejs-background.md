# Intent: Hide Background Canvas Animation (Retain Implementation)

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX, reduced visual distraction)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code, reversibility)
  - [ ] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)

- **Problem Statement**:
  The animated background canvas (`#webgl-canvas`, driven by `frontend/three-bg.js`) displays a floating plexus / particle node network across desktop views outside of `#home`. The user requested to visually hide this background animation across the site while explicitly retaining the entire codebase and simulation architecture intact (i.e. do not delete `three-bg.js`, the particle physics, spatial grid, or DOM mounting code).

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **Do NOT delete the implementation**: The full particle simulation, collision/proximity math, spatial grid, theme reactivity, and lifecycle methods in `frontend/three-bg.js` must remain completely intact.
  - **ADR-001**: Pure vanilla ES modules. No external framework dependencies.
  - **ADR-016**: Zero third-party asset origins. All assets remain local and self-hosted.
  - **Performance & Lifecycle Integrity**: A hidden canvas must not continue to burn a `requestAnimationFrame` loop or event listener cycles. Disabling must halt the rendering loop gracefully.
  - **Reversibility**: The animation must be trivial to re-enable in the future via a single configuration flag or CSS rule without code restoration from version control.

- **Explicit Non-Goals**:
  - Deleting `frontend/three-bg.js` or removing it from build bundling.
  - Removing `<canvas id="webgl-canvas">` from the DOM entirely.
  - Modifying the `#home` section's SVG schematic backdrop (which is an independent vector drawing, not a canvas animation).
  - Refactoring unrelated canvas systems (e.g. arcade games, celebration confetti).

## 3. Impacted Layer Matrix & Quality Gates

Determine impacted layers and execute matching quality gates:

- [x] **Frontend**: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A
- [ ] **Database**: N/A
- [x] **Docs / Hashes**: `python scripts/check_csp_hashes.py` && `python scripts/check_docs.py --fix --show-tokens`

## 4. Risks & Mitigations

- **Performance / Battery Impact**: Positive mitigation. Halting the plexus `requestAnimationFrame` loop saves CPU and GPU cycles on desktop viewports.
- **Visual Flash on Initial Paint**: Adding `hidden` to `<canvas id="webgl-canvas">` in `frontend/index.html` and setting `display: none !important;` on `.webgl-canvas` in `frontend/styles.css` ensures zero visual flash before JavaScript execution.
- **CSP Integrity**: Modifying HTML canvas attributes does not alter inline `<script>` contents, preserving pinned inline CSP hashes.
