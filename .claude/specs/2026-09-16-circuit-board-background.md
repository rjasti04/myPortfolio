# Technical Specification: Circuit Board Background Across All SPA Pages

**Related Intent**: [.claude/intents/2026-09-16-circuit-board-background.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-16-circuit-board-background.md)  
**Target Audience**: Visitor / Recruiter (visual polish & cohesive theme), Work Sample (clean vanilla CSS/SVG architecture, zero framework overhead)

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA (`frontend/index.html`, `frontend/styles.css`, `frontend/site-backdrop.webp`, `frontend/site-backdrop.jpg`)
  - [x] Verification Scripts (`scripts/check_backdrop_traces.py`, `scripts/generate_backdrop.py`)
  - [ ] Standalone App Pages (`frontend/arcade.*`, `cron.*`, `crypto.*`, `json.*`, `diff.*`, `ucl.html`, `worldcup.html`) — **Untouched by design**
  - [ ] Backend API — N/A
  - [ ] Database Schema — N/A
  - [ ] CI/CD & Deploy (`.github/workflows/deploy.yml` — adds automated backdrop trace gate)

### Architecture Model

```
+-------------------------------------------------------------------------------+
| Window / Viewport                                                             |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | .site-backdrop (position: fixed; inset: 0; z-index: -1)                 |  |
|  |                                                                         |  |
|  |  +-------------------------------------------------------------------+  |  |
|  |  | ::before -> site-backdrop.webp (cover, blend: luminosity)         |  |  |
|  |  +-------------------------------------------------------------------+  |  |
|  |  | ::after  -> --backdrop-scrim (80-85% wash of --bg for WCAG AA)   |  |  |
|  |  +-------------------------------------------------------------------+  |  |
|  |  | <svg class="site-backdrop-flow" viewBox="0 0 1920 1191">          |  |  |
|  |  |   5x Computer-Vision Verified Copper Routes with CSS transit dash  |  |  |
|  |  +-------------------------------------------------------------------+  |  |
|  +-------------------------------------------------------------------------+  |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | .noise-overlay (CRT film grain)                                         |  |
|  +-------------------------------------------------------------------------+  |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | .layout (position: relative; z-index: 1)                                |  |
|  |                                                                         |  |
|  |  [Header & Nav]                                                         |  |
|  |                                                                         |  |
|  |  [Active Section Container]                                             |  |
|  |   ├── #home       (Landing View - Hero & Portrait)                      |  |
|  |   ├── #about      (Bio, Values, Philosophy)                             |  |
|  |   ├── #resume     (Skills Matrix & Experience Timeline)                 |  |
|  |   ├── #hobbies    (Personal Interests & Projects)                       |  |
|  |   ├── #apps       (SPA App Directory - INCLUDED) ───+                   |  |
|  |   ├── #activity   (Live Telemetry & Ingest Pipeline)    |                   |  |
|  |   ├── #contact    (Communication Form & Channels)       |                   |  |
|  |   └── #ai         (Autonomous Agent Chat Session)       |                   |  |
|  +---------------------------------------------------------|---------------+  |
+------------------------------------------------------------|------------------+
                                                             |
                     Launched Independently (target="_blank") |
                                                             v
              +--------------------------------------------------------------+
              | Standalone Independent Pages (EXCLUDED - Separate Documents) |
              |  • /arcade   (arcade.html, arcade.css)                       |
              |  • /cron     (cron.html, cron.css)                           |
              |  • /crypto   (crypto.html, crypto.css)                       |
              |  • /json     (json.html, json.css)                           |
              |  • /diff     (diff.html, diff.css)                           |
              |  • /ucl      (ucl.html - Standalone Predictor)               |
              |  • /worldcup (worldcup.html - Standalone Predictor)          |
              |                                                              |
              |  => Do NOT load styles.css or contain .site-backdrop.       |
              +--------------------------------------------------------------+
```

---

## 2. API Contract & Schemas

**N/A.** No backend routes, schemas, or API endpoints are modified.

---

## 3. Database Schema & Migration Plan

**N/A.** No database models or Alembic migrations are required.

---

## 4. Frontend Implementation & DOM Contract

### 4.1 Root Mounting in `frontend/index.html`

Directly preceding `.noise-overlay` and `.layout`, mount the static technical drawing and SVG flow layer:

```html
<!-- The site's ground: a static technical drawing behind every section.
     Deliberately NOT `.js-only`, unlike the animated canvas it replaces -
     this paints with no script running, so hiding it until `.js-enabled`
     lands would blank the page's background for the whole boot. -->
<div class="site-backdrop" aria-hidden="true">
  <!-- Directed transit overlay. Five verified routes conducting electric pulses
       along genuine copper traces, scaled in lockstep with the raster graphic. -->
  <svg class="site-backdrop-flow" viewBox="0 0 1920 1191"
    preserveAspectRatio="xMidYMid slice" focusable="false">
    <path class="backdrop-flow" pathLength="1000" d="M 189 58 V 216 H 296 V 304" />
    <path class="backdrop-flow" pathLength="1000" d="M 510 404 V 481 H 796" />
    <path class="backdrop-flow" pathLength="1000" d="M 55 759 H 381 V 956" />
    <path class="backdrop-flow" pathLength="1000" d="M 1240 870 H 1410 V 567 H 1695" />
    <path class="backdrop-flow" pathLength="1000" d="M 1704 481 H 1875 V 137" />
  </svg>
</div>
```

### 4.2 Retirement of Legacy `#home` Schematic

- Remove the 260-line `<div class="home-schematic">...</div>` markup block nested inside `#home`.
- Remove corresponding `.home-schematic*` CSS rules in `frontend/styles.css`.
- Reclaims ~350 lines of CSS and ~260 lines of HTML, ensuring the global backdrop addition stays strictly under the 288 KiB CSS budget.

### 4.3 Design Tokens & CSS Architecture in `frontend/styles.css`

#### 1. Light & Dark Theme Tokens:
```css
:root {
  /* 80% wash of --bg preserves text contrast > 4.5:1 across content-heavy sections */
  --backdrop-scrim: color-mix(in srgb, var(--bg) 80%, transparent);
  --backdrop-tint: color-mix(in srgb, var(--accent-text) 32%, #79899a);
  --backdrop-flow-ink: color-mix(in srgb, var(--accent-text) 62%, transparent);
}

body.dark-theme {
  /* 85% wash over luminous cyan traces on near-black ground */
  --backdrop-scrim: color-mix(in srgb, var(--bg) 85%, transparent);
  --backdrop-tint: color-mix(in srgb, var(--accent-text) 30%, #66768a);
  --backdrop-flow-ink: color-mix(in srgb, var(--accent-text) 78%, transparent);
}
```

#### 2. Fixed Composition Container:
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
    url("site-backdrop.jpg") type("image/jpeg"));
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  background-color: var(--backdrop-tint);
  background-blend-mode: luminosity;
}

.site-backdrop::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--backdrop-scrim);
}

/* Invert dark PCB into crisp technical drawing on light paper */
body:not(.dark-theme) .site-backdrop::before {
  filter: invert(1) hue-rotate(180deg) saturate(0.55) brightness(1.04);
}
```

#### 3. Vector Flow Animation Layer:
```css
.site-backdrop-flow {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: none;
  color: var(--backdrop-flow-ink);
}

.backdrop-flow {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-dasharray: 26 974;
  animation: backdrop-flow 11s linear infinite;
}

.backdrop-flow:nth-of-type(2) { animation-delay: -2.3s; animation-duration: 13s; }
.backdrop-flow:nth-of-type(3) { animation-delay: -5.1s; animation-duration: 9.5s; }
.backdrop-flow:nth-of-type(4) { animation-delay: -7.4s; animation-duration: 14.5s; }
.backdrop-flow:nth-of-type(5) { animation-delay: -9.2s; animation-duration: 12s; }

@keyframes backdrop-flow {
  from { stroke-dashoffset: 1000; }
  to { stroke-dashoffset: 0; }
}

@media (width >= 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .site-backdrop-flow {
    display: block;
  }
}

@media (pointer: coarse) and (width <= 768px) {
  .site-backdrop {
    display: none;
  }
}

@media print {
  .site-backdrop {
    display: none;
  }
}
```

### 4.4 Exclusion Verification for Standalone Apps

To ensure standalone pages remain strictly excluded:
- Inspect `frontend/arcade.html`, `cron.html`, `crypto.html`, `json.html`, `diff.html`, `ucl.html`, and `worldcup.html`.
- Confirm that none contains `<div class="site-backdrop">`.
- Confirm that none links to `styles.css`.
- Ensure each app's independent theme and background styling remain entirely autonomous.

---

## 5. Security & Rate Limiting Review

- [x] **No Inline Script Hash Invalidation**: Modifying HTML template markup does not touch any `<script>` tags, leaving all 3 pinned inline CSP hashes in `scripts/check_csp_hashes.py` strictly intact.
- [x] **Zero Third-Party Assets (ADR-016)**: All backdrop image assets (`site-backdrop.webp`, `site-backdrop.jpg`) are hosted locally within `frontend/` and bundled via esbuild.
- [x] **Zero Dynamic Code Execution**: Background rendering and flow transit are driven 100% declaratively by CSS and SVG vector engines without `eval()` or unsanitized DOM injections.

---

## 6. Verification & Test Plan

### Automated Quality Gates
Execute the canonical test sequence:

```bash
# 1. Verify 100% on-trace luminance for all 5 SVG flow paths
python3 scripts/check_backdrop_traces.py

# 2. Verify CSP inline script hashes remain untouched
python3 scripts/check_csp_hashes.py

# 3. Synchronize documentation token figures and line counts
python3 scripts/check_docs.py --fix --show-tokens

# 4. Frontend linting and test suite
npm run lint
npm test

# 5. Production build and size budget verification (CSS <= 288 KiB)
npm run build
```

### Manual Visual Verification
- Open local server: `python -m http.server 1991 -d ./frontend -b 127.0.0.1`
- Verify `.site-backdrop` renders seamlessly behind all 8 sections:
  1. `#home` (Landing hero & portrait mask)
  2. `#about` (About text & philosophy cards)
  3. `#resume` (Skills & experience cards)
  4. `#hobbies` (Hobbies grid)
  5. `#apps` (Apps directory cards — verify circuit board background renders clearly behind grid)
  6. `#activity` (Activity pipeline telemetry charts)
  7. `#contact` (Contact form)
  8. `#ai` (AI conversation view)
- Click each standalone app launch card in `#apps`:
  - `/arcade`, `/cron`, `/crypto`, `/json`, `/diff`, `/ucl`, `/worldcup`
  - Verify each launches in a new tab with its clean, independent styling **free of the SPA circuit board background**.
- Verify light and dark theme transitions via theme toggle.
- Verify mobile viewport behavior (coarse pointer / `<= 768px`) hides `.site-backdrop`.
