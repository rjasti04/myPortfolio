# Intent: Circuit Board Backdrop — High-Fidelity Data Particle Streaming Alignment

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: First paint, visual polish, seamless immersion — glowing data pulses conducting along realistic circuit traces without floating into empty space)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, pixel precision, deterministic verification, zero framework bloat)
  - [ ] 3. Owner (Priority: Personal pride in aesthetic excellence and visual fidelity)

- **Problem Statement**:
  In commit `2b3d3f9`, a directed transit layer (`.site-backdrop-flow`) was introduced over the static technical drawing backdrop (`site-backdrop.webp`). The implementation uses an SVG overlay with 5 paths and animated CSS `stroke-dasharray` / `stroke-dashoffset` to simulate electric pulses/data packets moving through the circuit board.

  However, inspection and user testing reveal that **the data particle streaming does not consistently happen on the circuit board lines, and frequently travels completely outside of them**:
  1. **Phantom routes traversing empty dark space**:
     - **Path 4** (`d="M 1238 826 H 1330 V 560 L 1470 420 L 1600 290"`): After an initial 92px horizontal start, Path 4 travels 266px vertically upward (`V 560`), then 140px diagonally, then 130px diagonally. **Over 75% of Path 4 passes through pitch-black space where NO copper trace exists** (measured mean pixel brightness along these segments is ~19–22 / 255).
     - **Path 5** (`d="M 1238 942 H 1460 V 845 H 1850"`): The horizontal trace ends abruptly at `x = 1443`. The path jumps 17px past the trace end to `1460`, executes a 97px vertical jump (`V 845`) across empty space (mean brightness 14.2), and then travels 100px through black space before encountering another line at `x ≈ 1560`.
     - **Path 1** (`d="M 185 55 V 213 H 298 L 470 352 V 481 H 800"`): The diagonal `L 470 352` (dx=172, dy=139, angle 38.9°) cuts arbitrarily across empty dark space instead of following the circuit's 45° traces or downward routing at `x = 296`. Then at `x = 470`, it drops vertically through dark space (`V 481`), missing copper traces entirely for over 60% of its run.
     - **Path 3** (`d="M 55 786 H 400 L 560 946 H 830"`): The final segment `H 830` at `y = 946` runs parallel to, but detached from, the real trace at `y = 942` (brightness 22, near zero).
  2. **Hairline coordinate offsets**:
     - Circuit board hairlines in `site-backdrop.webp` are fine (1.5px to 2.5px wide).
     - An offset of only 3–4px (such as Path 1's vertical line at `x = 185` vs the real trace at `x = 189`, or horizontal `y = 213` vs real `y = 216`) causes the 2.5px wide stroke to paint entirely in the black background alongside the trace.
     - The particles appear as unmoored, drifting sparks detached from the board infrastructure rather than electrical signals traveling within copper pathways.
  3. **Root Cause**:
     - The previous fitting process relied on loose local brightness sampling with wide radii, accepting segments that merely passed near bright pixels rather than validating contiguous, unbroken connectivity along genuine copper traces from origin to terminus.

---

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules. No frameworks (Three.js, PixiJS, React, etc.).
  - **ADR-016**: Zero third-party asset requests. All assets, scripts, and stylesheets remain local.
  - **Lightweight & Battery-Friendly**: Maintain the zero-JS-runtime CSS dashoffset animation technique or a highly optimized canvas that respects `@media (prefers-reduced-motion: no-preference)`. Never run heavy continuous rAF particle engines on idle screens.
  - **Responsive Synchrony**: SVG `preserveAspectRatio="xMidYMid slice"` with viewBox `0 0 1920 1191` scales in identical ratio to the backdrop's CSS `background-size: cover; background-position: center;`. Any revised SVG path coordinates must strictly align to the 1920x1191 master derivative grid.
  - **Zero Regressions on Mobile**: Preserve the existing `@media (pointer: coarse) and (width <= 768px)` rule that hides `.site-backdrop` and `.site-backdrop-flow` on mobile phones to conserve battery and viewport clarity.

- **Explicit Non-Goals**:
  - Do **NOT** un-retire or re-introduce `three-bg.js` (the retired plexus background).
  - Do **NOT** generate a new raster backdrop graphic unless necessary; `site-backdrop.webp` is already optimized (66 KB, high quality, theme-tinted via `luminosity`).
  - Do **NOT** modify the light/dark theme luminosity tinting logic in `styles.css`.
  - Do **NOT** alter the standalone predictors (`/ucl`, `/worldcup`) or developer apps.

---

## 3. Impacted Layer Matrix & Quality Gates

- [x] **Frontend**:
  - `frontend/index.html` (SVG flow paths updated with verified coordinates)
  - `frontend/styles.css` (flow stroke widths, dash arrays, and animation delays)
  - Quality gates: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no backend API changes
- [ ] **Database**: N/A — no schema changes
- [x] **Docs / Hashes / Verification**:
  - `python3 scripts/check_csp_hashes.py` (ensure no inline scripts broken)
  - `python3 scripts/check_docs.py` (ensure token counts and line counts remain synchronized)
  - **New Automated Gate**: `python3 scripts/check_backdrop_traces.py` (asserts 100% on-trace luminance >= 120 along all flow paths)

---

## 4. Risks & Mitigations

- **Risk: Viewport Resizing / Aspect Ratio Drift**:
  - *Analysis*: Because `background-size: cover; background-position: center;` and SVG `preserveAspectRatio="xMidYMid slice"` share the exact same 1920:1191 aspect ratio, uniform scale factor `max(w/1920, h/1191)` and center point offset `((w - 1920*s)/2, (h - 1191*s)/2)` are mathematically identical.
  - *Mitigation*: Subpixel rasterization differences (at most ±0.5px on odd viewport dimensions) are absorbed by centering the SVG stroke (width 2.0–2.5px) directly on the physical center of the copper traces (which are 2.0–3.0px wide in the derivative).
- **Risk: Over-fitting to Single Trace Segments**:
  - *Mitigation*: Trace extraction algorithm selects continuous electrical routes that follow real 90° bends and 45° chamfers originating at IC pins or circular vias and terminating at major bus rails or chip pads, providing intuitive visual context for signal propagation.
