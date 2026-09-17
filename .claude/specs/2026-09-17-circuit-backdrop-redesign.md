# Technical Specification: Bespoke Data-Engineering Circuit Schematic Backdrop Redesign

**Related Intent**: [.claude/intents/2026-09-17-circuit-backdrop-redesign.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-17-circuit-backdrop-redesign.md)  
**Target Audience**: Visitor / Recruiter (uncompromising aesthetic beauty, instant engineering authority), Work Sample (clean vanilla CSS architecture, zero framework bloat)

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Graphic Assets (`assets/site-backdrop-master.jpg`, `frontend/site-backdrop.webp`, `frontend/site-backdrop.jpg`)
  - [x] Frontend Stylesheet (`frontend/styles.css` — tokens `--backdrop-scrim`, `--backdrop-tint`, `.site-backdrop` blend rules)
  - [x] Asset Build Pipeline (`scripts/generate_backdrop.py`)
  - [ ] Standalone App Pages (`frontend/arcade.*`, `cron.*`, `crypto.*`, `json.*`, `diff.*`, `ucl.html`, `worldcup.html`) — **Strictly untouched by design**
  - [ ] Backend API & Services — N/A
  - [ ] Database Schema & Migrations — N/A

---

## 2. Artistic & UI/UX Composition Blueprint: "The Silicon Pipeline"

### 2.1 Thematic Translation: Hardware Clipart vs. Distributed Data Architecture

A principal data engineer's portfolio requires a visual identity rooted in **data streams, partitioned buses, pipeline DAGs, and distributed state**, not generic electronic solder pads or broken stock clipart rulers.

| Graphic Element | Legacy Backdrop (The Problem) | Redesigned "Silicon Pipeline" (The Solution) |
| :--- | :--- | :--- |
| **Perimeter Frame** | Garbled stock ruler markings (`170 170`, `260 260 280 270`, `min min`, OCR artifacts). | Clean calibration ticks, subtle coordinate registers (`SYS_X`, `SYS_Y`), and precision alignment reticles (+). |
| **Center Viewport** | 5 solid-bordered rectangular boxes (`COMPUTE MODULE 04`, `DATA PROCESE`, `LOGGIC`) with misspellings directly occluding content. | **Open Central Content Aperture (65% width)** with zero solid boxes. Traces attenuate cleanly before entering the reading zone. |
| **Trace Topology** | Random, chaotic circuit lines intersecting indiscriminately without clear hierarchy. | **Multi-lane orthogonal data bus ribbons** (45° and 90° PCB-grade traces) mirroring distributed Kafka pipelines, partition fan-outs, and consensus trees. |
| **Micro-Annotations** | Illegible gibberish, blurry AI artifacts, and misspelled English. | Razor-sharp technical monospace micro-labels: `INGEST_BUS_01`, `SHARD_PARTITION[0..15]`, `STREAM_SYNC_OK`, `DAG_NODE_ALPHA`, `BUFFER_POOL`. |
| **Light Theme Inversion** | Solid dark rectangles invert to dirty, muddy grey blocks under cards. | Fine hairline strokes (1px–2px) on pure dark ground invert cleanly into a **crisp architectural blueprint / technical drafting vellum**. |

---

### 2.2 Spatial Layout & Coordinate Architecture (1920 × 1080 Native Frame)

The composition follows an **orchestrated framing hierarchy**:

```
(0,0) ───────────────────────────────────────────────────────────────── (1920,0)
│  [TOP-LEFT: INGEST CLUSTER]                     [TOP-RIGHT: TELEMETRY NODES] │
│  - 8-lane parallel partition bus                 - Circular via constellation│
│  - Clock trace & sync reticles                   - Monospace status registers│
│  - Stream intake fan-in                          - High-frequency trace tree │
│                                                                              │
│             ┌───────────────────────────────────────────────┐                │
│             │                                               │                │
│  [LEFT BUS] │           CENTRAL CONTENT APERTURE            │ [RIGHT BUS]    │
│  - Vertical │                                               │ - Multi-stage  │
│    spine    │   - 65% width quiet negative space            │   DAG fan-out  │
│  - Breakout │   - Attenuated hairline traces (<15% opacity) │ - Shard split  │
│    doglegs  │   - Zero solid boxes or visual collisions     │   buses        │
│  - Micro-via│   - Perfect backdrop for Hero, About, Resume, │ - Alignment    │
│    matrix   │     Apps, Activity telemetry, and Terminal    │   fiducials    │
│             │                                               │                │
│             └───────────────────────────────────────────────┘                │
│                                                                              │
│  [BOTTOM-LEFT: STORAGE FABRIC]               [BOTTOM-RIGHT: CONSENSUS RING]  │
│  - Horizontal trunk routing                  - Concentric orbital micro-paths│
│  - Low-profile baseline bus                  - State machine logic vias      │
(0,1080) ───────────────────────────────────────────────────────────── (1920,1080)
```

#### Detailed Zone Definitions:
1. **The Left Pipeline Corridor (X: 0 → 320, Y: 0 → 1080)**:
   - Primary high-throughput data intake trunk.
   - Features 8 to 16 parallel micro-traces running vertically, branching into 45° doglegs toward the center before terminating in clean via matrices.
2. **The Right Pipeline Corridor (X: 1600 → 1920, Y: 0 → 1080)**:
   - Analytical egress and distributed processing bus.
   - Interconnected logic gate symbols, memory addressing tracks, and stream aggregation nodes.
3. **The Upper & Lower Horizons (Y: 0 → 140, Y: 940 → 1080)**:
   - Perimeter structural bus running horizontally to frame the viewport top and bottom without obstructing navigation bars or footers.
4. **The Central Content Aperture (X: 320 → 1600, Y: 120 → 960)**:
   - 90% cleared of high-frequency geometry. Only faint, elegant connective pass-through traces with low opacity survive here, providing continuity between the left and right corridors without interfering with text.

---

## 3. Color Science, Blend Modes & Dual-Theme Contract

The backdrop is rendered as a single dual-mode asset leveraging CSS blend modes and mathematical color mixing:

### 3.1 Dark Theme Contract (Default Presentation)
- **Asset Ground**: Deep void slate (`#0b0f19` to `#0e1422`).
- **Trace Coloration**: Precision cool cyan-slate (`#38bdf8` at 60–85% lightness) on the master asset.
- **Blending Pipeline**:
  ```css
  .site-backdrop::before {
    background-color: var(--backdrop-tint);
    background-blend-mode: luminosity;
  }
  ```
  - `luminosity` extracts the luminance from the master drawing and adopts the exact hue and saturation of `--backdrop-tint`.
  - Because `--backdrop-tint` is derived from `color-mix(in srgb, var(--accent-text) 32%, #79899a)`, the circuit traces dynamically harmonize with whichever accent color the visitor chooses in the theme customizer (citron, azure, violet, emerald, amber).

### 3.2 Light Theme Inversion Contract
- In light mode, the single dark asset is inverted without downloading a second file:
  ```css
  body:not(.dark-theme) .site-backdrop::before {
    filter: invert(1) hue-rotate(180deg) saturate(0.45) brightness(1.04);
  }
  ```
- **Inversion Mechanics**:
  - `invert(1)` flips `#0e1422` (near-black ground) into `#f1ebdd` (pale blueprint background) and flips the cyan lines into warm tones.
  - `hue-rotate(180deg)` restores the cool architectural cyan/slate tint.
  - `saturate(0.45)` and `brightness(1.04)` tone the lines down to a subtle drafting pencil grey-slate (`#94a3b8`).
  - Because the redesigned master contains **no solid dark fills**, light mode produces an immaculate technical blueprint on drafting paper with zero dirty grey blocks.

### 3.3 Contrast Scrim Token Calibration
The overlay scrim (`.site-backdrop::after`) ensures that text legibility always surpasses WCAG 2.2 AA (>= 4.5:1) sitewide:
```css
:root {
  --backdrop-scrim: radial-gradient(
    ellipse 75% 65% at 50% 50%,
    color-mix(in srgb, var(--bg) 92%, transparent) 0%,
    color-mix(in srgb, var(--bg) 78%, transparent) 100%
  );
  --backdrop-tint: color-mix(in srgb, var(--accent-text) 32%, #79899a);
}

body.dark-theme {
  --backdrop-scrim: radial-gradient(
    ellipse 75% 65% at 50% 50%,
    color-mix(in srgb, var(--bg) 88%, transparent) 0%,
    color-mix(in srgb, var(--bg) 75%, transparent) 100%
  );
  --backdrop-tint: color-mix(in srgb, var(--accent-text) 35%, #475569);
}
```

---

## 4. Asset Generation & Compression Pipeline

1. **Master Graphic Creation**:
   - Master source file: `assets/site-backdrop-master.jpg` (or `.png`).
   - Dimensions: 1920 × 1080 (16:9 standard viewport ratio).
   - Format: RGB lossless PNG or high-quality progressive JPEG (>95 quality).
2. **Build Transformation via `scripts/generate_backdrop.py`**:
   - WebP Derivative: `frontend/site-backdrop.webp`
     - Quality: 82 (tuned to eliminate DCT ringing around 1px hairlines).
     - Method: 6 (libwebp slowest, optimal compression).
     - Expected size: ~70–90 KB.
   - JPEG Fallback: `frontend/site-backdrop.jpg`
     - Quality: 86 with Huffman optimization and progressive scans.
     - Expected size: ~180–220 KB.
3. **Build Bundling**:
   - `scripts/build.mjs` (esbuild) reads `site-backdrop.webp` and `site-backdrop.jpg` through `image-set()` in `styles.css`, content-hashes them into `dist/assets/`, and rewrites references.

---

## 5. Implementation & Rollout Steps

### Step 1: Design & Render New Master Asset
- Compose the vector/raster master asset adhering to the 1920×1080 coordinate layout in §2.2.
- Ensure 0% solid block fills and verify all micro-labels are spelled accurately.
- Save to `assets/site-backdrop-master.jpg`.

### Step 2: Generate WebP and JPEG Derivatives
- Run:
  ```bash
  python scripts/generate_backdrop.py
  ```
- Verify output sizes: WebP <= 120 KB, JPEG <= 300 KB.

### Step 3: Calibrate CSS Blending & Tokens
- Confirm `.site-backdrop` in `frontend/styles.css` handles the new asset with the specified radial aperture scrim.
- Verify light theme inversion produces a clean drafting paper schematic.

### Step 4: Verification & Quality Gates
- Run complete test suite and linters to ensure zero regressions.

---

## 6. Verification & Test Plan

Execute canonical verification commands:

```bash
# 1. Verify CSS and JS linting passes without errors
npm run lint

# 2. Execute full automated frontend test suite (510+ tests)
npm test

# 3. Verify production build and budget limits (CSS <= 288 KiB)
npm run build

# 4. Verify CSP inline-script hashes
python scripts/check_csp_hashes.py

# 5. Synchronize documentation token figures and line counts
python scripts/check_docs.py --fix --show-tokens
```

### Visual Inspection Checklist:
1. **Aperture Clarity**: Central 65% viewport allows hero title, intro copy, and section cards to be read effortlessly.
2. **Perimeter Framing**: Left and right margins showcase crisp, high-density data pipeline buses.
3. **Typographic Integrity**: Monospace annotations contain zero misspellings, nonsense numbers, or OCR glitches.
4. **Theme Parity**: Light theme renders as a crisp architectural blueprint; dark theme renders as an illuminated deep-slate engineering console.
5. **Dynamic Theme Customizer**: Switching palettes (citron, azure, violet) smoothly re-tints the backdrop traces via `--backdrop-tint`.
6. **Mobile Gate**: Coarse pointer devices (`<= 768px`) hide the backdrop cleanly, preserving battery and mobile readability.
