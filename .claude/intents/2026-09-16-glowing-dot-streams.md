# Intent: Circuit Board Backdrop — Glowing Dot Stream Particle Animation

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: Visual polish, futuristic data-engineering aesthetic — replacing monolithic bar/pill dashes with luminous, flowing packet streams of glowing dots conducting through circuit traces)
  - [x] 2. Portfolio as a Work Sample (Priority: Pure CSS/SVG vector mechanics, zero runtime JS, zero third-party dependencies, sub-millisecond render efficiency)
  - [ ] 3. Owner (Priority: Personal pride in an elegant, state-of-the-art visual signature that symbolizes high-throughput data pipelines)

- **Problem Statement**:
  The directed transit overlay (`.site-backdrop-flow`) over the technical schematic backdrop (`site-backdrop.webp`) currently renders signal pulses as elongated solid bars/pills (`stroke-dasharray: 26 974; stroke-linecap: round`).
  
  While geometrically aligned to the underlying copper traces, these solid dashes read visually as generic sliding line segments rather than discrete data packets or streaming electrical pulses. Furthermore, the strokes lack luminescence, appearing as flat foreground lines rather than emissive signals conducting through circuit infrastructure.

  The user requested converting these line/bar particles into **glowing dot streams**, with freedom to improvise on visual rhythm, luminescence, and stream cadence.

---

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules and standard web standards. No animation libraries (GSAP, Anime.js, PixiJS, Three.js).
  - **ADR-016**: Zero third-party asset requests. All filters and styles must remain native CSS and self-hosted SVG.
  - **Zero-JS Runtime**: The animation must execute purely via declarative CSS keyframes (`stroke-dashoffset`) on hardware-accelerated compositor threads, without requestAnimationFrame loops or main-thread script evaluation.
  - **Battery & Accessibility Protection**: Retain strict gating via `@media (width >= 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)`. On mobile phones or when reduced motion is preferred, the flow layer must remain completely hidden (`display: none;`).
  - **Coordinate Preservation**: Preserve the verified SVG path coordinates (`d="..."`) in `frontend/index.html` so that `scripts/check_backdrop_traces.py` continues to pass with 100% trace alignment.

- **Explicit Non-Goals**:
  - Do **NOT** reintroduce the retired 2D/3D canvas particle field (`three-bg.js`).
  - Do **NOT** modify or regenerate the background raster image (`site-backdrop.webp`).
  - Do **NOT** add heavy SVG filter trees that cause software rasterization on low-power devices.
  - Do **NOT** modify standalone predictor tools (`/ucl`, `/worldcup`).

---

## 3. Impacted Layer Matrix & Quality Gates

Determine impacted layers and execute matching quality gates:

- [x] **Frontend**:
  - `frontend/styles.css` (Update `.backdrop-flow` dasharray to zero-length rounded dot trains, define glow tokens, add dual-corona `drop-shadow` filters, and tune per-path pulse cadence)
  - `frontend/index.html` (Retain or annotate SVG path definitions; ensure zero inline script hash invalidation)
  - Quality gates: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no backend API changes
- [ ] **Database**: N/A — no schema changes
- [x] **Docs / Hashes**:
  - `python scripts/check_csp_hashes.py` (Verify no inline script hash violations)
  - `python scripts/check_backdrop_traces.py` (Verify 100% on-trace compliance)
  - `python scripts/check_docs.py --fix --show-tokens` (Maintain documentation and token synchrony)

---

## 4. Risks & Mitigations

- **Risk: Filter Performance & Compositor Load**:
  - *Analysis*: Applying CSS `filter: drop-shadow()` to actively animating SVG paths could potentially trigger expensive raster repaints if unconstrained.
  - *Mitigation*: 
    1. Restrict filter radii to tight, efficient blurs (2px core, 4–6px halo).
    2. Limit total animating elements to the 5 designated paths.
    3. Retain desktop-only fine-pointer gating (`width >= 1024px`, `pointer: fine`).
    4. Validate 60fps smoothness and low GPU memory utilization.
- **Risk: Contrast & Visual Clutter**:
  - *Analysis*: Overly bright glowing dots could distract from foreground hero typography and interactive cards.
  - *Mitigation*: Calibrate opacity tokens (`--backdrop-flow-ink` and `--backdrop-flow-glow`) to sit subordinate to primary interactive buttons, and let the `--backdrop-scrim` radial gradient maintain content aperture contrast (> 4.5:1).
- **Risk: Subpixel Dot Distortion on Varied Viewports**:
  - *Analysis*: Zero-length SVG dashes with `stroke-linecap: round` rely on SVG standard dot expansion ($d = \text{stroke-width}$). On fractional device pixel ratios, non-integer stroke widths could produce jitter.
  - *Mitigation*: Use crisp integer or half-integer stroke width (`3.0px`) with high-resolution synthetic path coordinate space (`pathLength="1000"`).
