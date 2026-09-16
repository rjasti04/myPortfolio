# Technical Specification: Circuit Board Backdrop Redesign & Harmonious Visual Blending

**Related Intent**: [.claude/intents/2026-09-16-circuit-board-redesign.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-16-circuit-board-redesign.md)  
**Target Audience**: Visitor / Recruiter (bespoke visual polish & engineering credibility), Work Sample (clean vanilla CSS/SVG architecture, zero framework overhead)

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Assets (`assets/site-backdrop-master.jpg`, `frontend/site-backdrop.webp`, `frontend/site-backdrop.jpg`)
  - [x] Frontend Markup (`frontend/index.html` — `.site-backdrop-flow` SVG pulse paths)
  - [x] Frontend Styles (`frontend/styles.css` — `.site-backdrop` blend modes, radial vignette scrim, theme filters)
  - [x] Verification Scripts (`scripts/check_backdrop_traces.py`, `scripts/generate_backdrop.py`)
  - [ ] Standalone App Pages (`frontend/arcade.*`, `cron.*`, `crypto.*`, `json.*`, `diff.*`, `ucl.html`, `worldcup.html`) — **Untouched by design**
  - [ ] Backend API — N/A
  - [ ] Database Schema — N/A

---

## 2. Graphic Redesign & Visual Composition Strategy

### 2.1 The Visual Deficiencies in the Current Master (`assets/site-backdrop-master.jpg`)

| Flaw | Location | Impact | Architectural Resolution |
| :--- | :--- | :--- | :--- |
| **Fake Ruler Borders** | Top, left, bottom perimeter | Broken sequences (`170 170`, `260 260 280 270`, `min min`) look like stock template clipart | **Remove all perimeter rulers and numeric scales entirely.** Replace with clean edge boundaries and subtle via guide ticks. |
| **Spelling Errors** | Bottom-center boxes | `"DATA PROCESE"` and `"LOGGIC"` damage professional credibility | **Eliminate or replace text boxes.** If technical callouts remain, use verified terms (`PIPELINE`, `RUNTIME`, `GATEWAY`, `STREAM`) with zero typos. |
| **Solid Rectangular Clump** | Lower-middle viewport | 5 solid-bordered boxes sit directly behind content cards and portrait, creating visual collisions | **Clear the central reading zone.** Move circuit architecture to the periphery (left, right, top-right, bottom-left) leaving a clean aperture in the center. |
| **Garbled Pseudo-Text** | Upper-right quadrant | Unreadable OCR noise (`cpx ADG104442...`) and disconnected crosshairs | **Replace with clean vector-style IC pinouts, memory bus tracks, or clean bus labels.** |
| **Muddy Inversion in Light Mode** | Sitewide in light theme | Solid dark box fills invert into heavy grey rectangles under white cards | **Use hairline trace geometry with transparent/flat negative space.** Inversion becomes an elegant blueprint on clean technical paper. |

### 2.2 New Composition Layout (1920 x 1191 Standard)

```
0,0 ───────────────────────────────────────────────────────────── 1920,0
│  [BUS CORRIDOR A]                               [BUS CORRIDOR B]     │
│  - Micro-via matrix                             - Memory bus ribbon  │
│  - Clock trace routing                          - Distributed nodes  │
│  - High-density signal tracks                   - Probe test pads    │
│                                                                      │
│          ┌───────────────────────────────────────────────┐           │
│          │                                               │           │
│          │         CENTRAL CONTENT APERTURE              │           │
│          │                                               │           │
│          │   - Soft radial attenuation / vignette        │           │
│          │   - Open breathing room for Hero portrait,    │           │
│          │     About cards, Resume matrix, App cards     │           │
│          │   - No hard boxes, no text collisions         │           │
│          │                                               │           │
│          └───────────────────────────────────────────────┘           │
│                                                                      │
│  [DATA PIPELINE RUNTIME]                        [STREAM INGEST NODE] │
│  - Bus breakout fan-out                         - Bus routing trunks │
│  - Logic node junctions                         - Orthogonal traces  │
0,1191 ───────────────────────────────────────────────────────── 1920,1191
```

- **Peripheral Framing**: The engineering schematic lines originate from the screen margins and route inward with strict 45° and 90° PCB orthogonal traces, framing the viewport like a high-tech instrument console.
- **Central Aperture**: The center 60% of the graphic contains minimal, soft trace pass-throughs, preventing any conflict with the site's typography or glass cards.

---

## 3. Frontend Implementation & CSS Blending Contract

### 3.1 CSS Tokens in `frontend/styles.css`

Update the backdrop tokens under `:root` and `body.dark-theme`:

```css
:root {
  /* Radial scrim: 75% wash in corners blending to 92% wash in center,
     ensuring complete contrast headroom for cards and hero copy */
  --backdrop-scrim: radial-gradient(
    ellipse 70% 60% at 50% 50%,
    color-mix(in srgb, var(--bg) 92%, transparent) 0%,
    color-mix(in srgb, var(--bg) 78%, transparent) 100%
  );
  --backdrop-tint: color-mix(in srgb, var(--accent-text) 28%, #8292a4);
  --backdrop-flow-ink: color-mix(in srgb, var(--accent-text) 55%, transparent);
}

body.dark-theme {
  --backdrop-scrim: radial-gradient(
    ellipse 70% 60% at 50% 50%,
    color-mix(in srgb, var(--bg) 88%, transparent) 0%,
    color-mix(in srgb, var(--bg) 74%, transparent) 100%
  );
  --backdrop-tint: color-mix(in srgb, var(--accent-text) 32%, #5a6e88);
  --backdrop-flow-ink: color-mix(in srgb, var(--accent-text) 80%, transparent);
}
```

### 3.2 Container Architecture & Blending

```css
.site-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}

.site-backdrop::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: image-set(
    url("site-backdrop.webp") type("image/webp"),
    url("site-backdrop.jpg") type("image/jpeg")
  );
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  background-color: var(--backdrop-tint);
  background-blend-mode: luminosity;
  opacity: 0.85; /* Softens overall harshness */
}

/* Layered scrim: Combines the theme tint with the radial content aperture */
.site-backdrop::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--backdrop-scrim);
}

/* Crisp drafting-blueprint inversion for light theme */
body:not(.dark-theme) .site-backdrop::before {
  filter: invert(1) hue-rotate(180deg) saturate(0.40) brightness(1.06);
  opacity: 0.70;
}
```

---

## 4. Vector Flow Transit Layer (`.site-backdrop-flow`)

The 5 animated transit paths in `frontend/index.html` will be calibrated to follow the redesigned primary copper bus routes:

```html
<svg class="site-backdrop-flow" viewBox="0 0 1920 1191" preserveAspectRatio="xMidYMid slice" focusable="false">
  <!-- Route 1: Top-left bus feed -->
  <path class="backdrop-flow" pathLength="1000" d="..." />
  <!-- Route 2: Mid-left pipeline route -->
  <path class="backdrop-flow" pathLength="1000" d="..." />
  <!-- Route 3: Bottom-left ground trunk -->
  <path class="backdrop-flow" pathLength="1000" d="..." />
  <!-- Route 4: Right-side memory bus corridor -->
  <path class="backdrop-flow" pathLength="1000" d="..." />
  <!-- Route 5: Top-right node connector -->
  <path class="backdrop-flow" pathLength="1000" d="..." />
</svg>
```

Each path must be validated by running:
`python scripts/check_backdrop_traces.py`
Ensuring 100% of tested sample points lie on valid copper traces with luminance >= 100.

---

## 5. Security & Performance Verification

1. **Zero Third-Party Assets (ADR-016)**:
   All assets (`site-backdrop.webp`, `site-backdrop.jpg`) remain self-hosted under `frontend/` and are content-hashed by esbuild.
2. **CSS Size Budget**:
   Changes to `styles.css` are replacement of existing rules, keeping total bundle size under the 288 KiB budget.
3. **No Inline Script Hash Drift**:
   Modifications to SVG paths do not touch inline `<script>` tags, keeping CSP hashes in `scripts/check_csp_hashes.py` unchanged.
4. **Performance**:
   WebP derivative target weight < 80 KB; JPEG fallback < 200 KB. Static raster + GPU CSS transform ensures 60fps scrolling with zero CPU overhead.

---

## 6. Verification & Test Plan

```bash
# 1. Generate optimized WebP and JPEG derivatives from redesigned master
python scripts/generate_backdrop.py

# 2. Verify all SVG vector transit pulses match genuine copper routes
python scripts/check_backdrop_traces.py

# 3. Verify CSP script hashes
python scripts/check_csp_hashes.py

# 4. Run frontend tests and linter
npm run lint
npm test

# 5. Verify production bundle build and size budgets
npm run build

# 6. Synchronize reference documentation
python scripts/check_docs.py --fix --show-tokens
```
