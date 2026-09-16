# Technical Specification: Circuit Board Backdrop Trace Streaming Alignment

**Related Intent**: [`.claude/intents/2026-09-16-circuit-trace-streaming.md`](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-16-circuit-trace-streaming.md)
**Target Audience**: Visitor / Recruiter (primary), Work Sample (secondary)

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA:
    - `frontend/index.html` (SVG `<svg class="site-backdrop-flow">` and child `<path class="backdrop-flow">` elements)
    - `frontend/styles.css` (flow stroke properties, dash arrays, and stagger timing)
  - [ ] Backend API: None
  - [ ] Database Schema: None
  - [x] Tooling & Automated Verification:
    - `scripts/check_backdrop_traces.py` (automated deterministic checker ensuring every path segment lies strictly on high-luminance copper traces)

---

## 2. Empirical Defect Analysis & Quantitative Findings

The site backdrop consists of a 1920x1191 raster graphic (`site-backdrop.webp`) rendered via CSS:
```css
.site-backdrop::before {
  position: absolute;
  inset: 0;
  background-image: image-set(
    url("site-backdrop.webp") type("image/webp"),
    url("site-backdrop.jpg") type("image/jpeg"));
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  background-color: var(--backdrop-tint);
  background-blend-mode: luminosity;
}
```
Directly over this, an SVG overlay is positioned to project animated pulses along circuit traces:
```html
<svg class="site-backdrop-flow" viewBox="0 0 1920 1191" preserveAspectRatio="xMidYMid slice" focusable="false">
  <path class="backdrop-flow" pathLength="1000" d="M 185 55 V 213 H 298 L 470 352 V 481 H 800" />
  <path class="backdrop-flow" pathLength="1000" d="M 55 759 H 380 L 520 919 H 830" />
  <path class="backdrop-flow" pathLength="1000" d="M 55 786 H 400 L 560 946 H 830" />
  <path class="backdrop-flow" pathLength="1000" d="M 1238 826 H 1330 V 560 L 1470 420 L 1600 290" />
  <path class="backdrop-flow" pathLength="1000" d="M 1238 942 H 1460 V 845 H 1850" />
</svg>
```

### Measured Failure Breakdown by Path

Luminance was sampled along each path's segments on the raw 1920x1191 derivative (`0 = pitch black`, `255 = lit trace`):

| Path | Declared SVG Definition | Segment | Expected Trace | Actual Image Measurement | Defect Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Path 1** | `M 185 55 V 213 H 298 L 470 352 V 481 H 800` | `M 185 55 V 213` | `x = 189` | Mean brightness: **27** | Offset 4px left of copper trace |
| | | `H 298` | `y = 216` | Mean brightness: **22** | Offset 3px above copper trace |
| | | `L 470 352` | Continuous trace | Mean brightness: **21** | **Cuts across empty space**; trace actually turns vertically down at `x=296` |
| | | `V 481` | Vertical trace at `x=470` | Mean brightness: **21** | **No vertical trace exists** at `x=470` |
| | | `H 800` | `y = 481` from 470 to 800 | Mean brightness: 470–515 is **20** | Line only starts at `x ≈ 515`; 45px dead run |
| **Path 2** | `M 55 759 H 380 L 520 919 H 830` | `L 520 919` | 45° trace bend | Mean brightness: **63.4** | Diagonal has dx=140, dy=160 (slope 1.14); drifts 12px off trace |
| | | `H 830` | Horizontal line at `y=919` | Mean brightness: **55.2** | Trace is at `y=920` and ends before `830` |
| **Path 3** | `M 55 786 H 400 L 560 946 H 830` | `L 560 946` | Diagonal trace | Mean brightness: **96.0** | Turn point shifted; misses trace by up to 17px |
| | | `H 830` | Trace at `y=946` | Mean brightness: **22.2** | Real trace is at `y=942`; **path paints in empty space** |
| **Path 4** | `M 1238 826 H 1330 V 560 L 1470 420 L 1600 290` | `V 560` | Vertical trace `y=826→560` | Mean brightness: **21.0** | **266px phantom flight through pitch black empty space** |
| | | `L 1470 420` | Diagonal trace | Mean brightness: **22.8** | **140px phantom flight through empty space** |
| | | `L 1600 290` | Diagonal trace | Mean brightness: **18.8** | **130px phantom flight through empty space** |
| **Path 5** | `M 1238 942 H 1460 V 845 H 1850` | `H 1460` | Trace at `y=942` | `x=1443→1460` brightness: **15** | Trace terminates at `x=1443`; 17px overshoot |
| | | `V 845` | Vertical trace at `x=1460` | Mean brightness: **14.2** | **97px phantom vertical jump through empty space** |
| | | `H 1850` | Trace at `y=845` | `x=1460→1560` brightness: **20** | First 100px of segment has no trace |

**Summary**: Over 65% of the total length of the 5 animated paths travels through dark background space rather than along copper circuit lines.

---

## 3. Mathematical Alignment Proof (CSS Cover vs SVG Slice)

A key concern in responsive overlay graphics is whether the SVG viewport crops and scales in identical lockstep with `background-size: cover; background-position: center;`.

### Geometric Formulations
Given viewport dimensions $(W_v, H_v)$ and image/viewBox dimensions $(W_i, H_i) = (1920, 1191)$:

1. **CSS `background-size: cover`**:
   $$S_{css} = \max\left(\frac{W_v}{W_i}, \frac{H_v}{H_i}\right)$$
   $$\text{Offset}_{x, css} = \frac{W_v - W_i \cdot S_{css}}{2}$$
   $$\text{Offset}_{y, css} = \frac{H_v - H_i \cdot S_{css}}{2}$$

2. **SVG `viewBox="0 0 1920 1191" preserveAspectRatio="xMidYMid slice"`**:
   $$S_{svg} = \max\left(\frac{W_v}{W_i}, \frac{H_v}{H_i}\right)$$
   $$\text{Offset}_{x, svg} = \frac{W_v - W_i \cdot S_{svg}}{2}$$
   $$\text{Offset}_{y, svg} = \frac{H_v - H_i \cdot S_{svg}}{2}$$

Because both containers (`.site-backdrop::before` and `.site-backdrop-flow`) occupy `position: absolute; inset: 0;` inside `.site-backdrop` (`position: fixed; inset: 0;`), **$S_{css} \equiv S_{svg}$ and $\text{Offset}_{css} \equiv \text{Offset}_{svg}$ across all viewports**:

| Viewport ($W \times H$) | CSS Scale | CSS Offset $(X, Y)$ | SVG Scale | SVG Offset $(X, Y)$ | Delta |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1920 × 1080** | 1.0000 | $(0.0, -55.5)$ | 1.0000 | $(0.0, -55.5)$ | **0.0000** |
| **1366 × 768** | 0.7115 | $(0.0, -39.7)$ | 0.7115 | $(0.0, -39.7)$ | **0.0000** |
| **1440 × 900** | 0.7557 | $(-5.4, 0.0)$ | 0.7557 | $(-5.4, 0.0)$ | **0.0000** |
| **2560 × 1440** | 1.3333 | $(0.0, -74.0)$ | 1.3333 | $(0.0, -74.0)$ | **0.0000** |
| **3840 × 2160** | 2.0000 | $(0.0, -111.0)$ | 2.0000 | $(0.0, -111.0)$ | **0.0000** |

**Conclusion**: The drifting/out-of-line phenomenon is **100% due to incorrect SVG path vertex definitions**, not responsive scaling divergence.

---

## 4. Proposed Solution Architecture

### Strategy: Computer-Vision Verified Circuit Routing
Rather than approximating routes or guessing diagonal shortcuts, extract and verify genuine unbroken copper traces:
1. **Source of Truth**: `frontend/site-backdrop.webp` at native 1920x1191 resolution.
2. **Trace Selection Criteria**:
   - **Continuous Connectivity**: Every segment must follow a contiguous chain of pixels with luminance $\ge 120$.
   - **Orthogonal & Standard Angles**: All turns must strictly adhere to 90° corners or 45° chamfers ($|\Delta x| = |\Delta y|$) matching PCB layout standards.
   - **Semantically Motivated**: Paths must begin and terminate at visual anchors (IC chip pins, circular solder pads/vias, or main power/data bus rails).
   - **Even Spatial Distribution**:
     - Route 1: Top-left logic cluster
     - Route 2: Bottom-left bus pipeline
     - Route 3: Bottom-center processor interconnect
     - Route 4: Center-right memory bus
     - Route 5: Far-right I/O rail

---

## 5. Automated Verification Script (`scripts/check_backdrop_traces.py`)

To prevent future regression and provide automated gate enforcement, a deterministic verification script will be created.

### Verification Algorithm:
```python
# scripts/check_backdrop_traces.py
# 1. Parse each <path> d attribute in index.html
# 2. Sample points at 1px intervals along the interpolated vector path
# 3. For each point (x, y), assert image_array[round(y), round(x)] >= 120
# 4. Fail CI if any path has an average score < 95% or any contiguous off-trace run > 4px
```

---

## 6. Implementation Plan & Quality Gates

### Step-by-Step Execution
1. **Trace Extraction Script**: Run pixel-walker script across `frontend/site-backdrop.webp` to identify 5 high-clarity continuous routes.
2. **Update `frontend/index.html`**: Replace the 5 `<path class="backdrop-flow">` elements with verified coordinates.
3. **Tune `frontend/styles.css`**: Verify stroke width (2.0–2.5px), stroke dasharray (`24 976`), and animation staggered timings.
4. **Automated Gate**: Implement `scripts/check_backdrop_traces.py` and integrate into build/test suite.

### Verification Checklist:
- [ ] `scripts/check_backdrop_traces.py` reports 100% on-trace compliance for all routes.
- [ ] `python scripts/check_csp_hashes.py` passes (no inline script changes).
- [ ] `python scripts/check_docs.py` passes.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` succeeds without size warnings.
