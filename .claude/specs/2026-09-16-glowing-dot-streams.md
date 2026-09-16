# Technical Specification: Circuit Board Backdrop Glowing Dot Stream Animation

**Related Intent**: [`.claude/intents/2026-09-16-glowing-dot-streams.md`](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-16-glowing-dot-streams.md)  
**Target Audience**: Visitor / Recruiter (primary), Work Sample (secondary)

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend Stylesheet: `frontend/styles.css`
    - Token additions for dual-corona glow (`--backdrop-flow-glow-core`, `--backdrop-flow-glow-halo`).
    - Revision of `.backdrop-flow` rules: `stroke-width`, `stroke-linecap: round`, zero-length dot packet dasharrays, and `filter: drop-shadow(...)`.
    - Per-path stream differentiation (`:nth-of-type(1..5)` cadence, durations, and multi-packet dasharrays).
  - [x] Frontend Markup: `frontend/index.html`
    - Preserves existing SVG coordinate geometry (`viewBox="0 0 1920 1080"`, `d="..."` attributes).
    - Code comments updated to reflect dot packet mechanics.
  - [ ] Backend API: None
  - [ ] Database Schema: None
  - [x] Automated Gates & Tooling:
    - `scripts/check_backdrop_traces.py`: Asserts 100% on-trace compliance is maintained.
    - `scripts/check_csp_hashes.py`: Verifies zero inline script hash drift.
    - `scripts/check_docs.py`: Synchronizes documentation counts and tokens.

---

## 2. Visual & Geometric Mechanics of Glowing Dot Streams

### 2.1 The Mathematics of Zero-Length SVG Dashes
In the SVG 2 specification (§11.4 "Stroke Properties"):
> "If the `stroke-linecap` property has the value `round`, then a zero-length subpath must be rendered as a circle with diameter equal to the `stroke-width`."

Currently, the animation in `frontend/styles.css` declares:
```css
stroke-width: 2.5;
stroke-linecap: round;
stroke-dasharray: 26 974; /* 26px solid dash + 2 * (1.25px cap) = 28.5px elongated pill */
```
This produces a monolithic continuous bar/pill traveling down the line.

To transform this into a **stream of discrete dots**, we configure the dash segment length to `0` (or `0.01` for universal renderer fallback) with `stroke-linecap: round`. A single dot with `stroke-width: 3.0` renders as an exact circle with radius $r = 1.5\text{px}$.

### 2.2 Packet Stream Structuring
Rather than an endless repeating dotted line (which appears static or conveyor-like), a **dot stream** is modeled as a rhythmic data packet: a train of $N$ dots separated by inter-dot spacing $s_i$, followed by a resting deadband $G$ before the next packet arrives:

$$\sum_{i=1}^{N} (0 + s_i) + G = L_{\text{synthetic}} = 1000$$

For example, a 5-dot packet with uniform 14-unit pitch:
$$\text{dasharray} = \underbrace{0\ 14\ 0\ 14\ 0\ 14\ 0\ 14\ 0}_{\text{5 dots covering 56 units}}\ 944$$

### 2.3 Improvised Per-Path Stream Cadence
To prevent uniform mechanical repetition across the circuit board, each of the 5 routes is assigned an electronic packet personality matching its physical layout:

| Path | Layout & Role | Length | Packet Architecture | SVG `stroke-dasharray` | Duration | Stagger |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Path 1** | Top-Right Vertical Bus (`M 1740 60 V 350`) | 291px | **High-Speed Burst**: 4 energetic, tight pulses | `0 13 0 13 0 13 0 961` | 9.0s | 0.0s |
| **Path 2** | Right Branching Bus (`M 1648 60 V 598 L 1599 647`) | 609px | **Dual-Packet Pipeline**: Two 4-dot trains separated by half-cycle | `0 12 0 12 0 12 0 464 0 12 0 12 0 12 0 464` | 13.5s | -3.2s |
| **Path 3** | Bottom Horizontal Backbone (`M 700 940 H 1300`) | 601px | **Dense Data Stream**: 6-dot extended payload | `0 11 0 11 0 11 0 11 0 11 0 945` | 10.5s | -6.1s |
| **Path 4** | Left Primary Data Lane (`M 256 600 V 1000`) | 401px | **Clock Pulse Train**: 3-dot spaced packet | `0 16 0 16 0 968` | 12.0s | -8.4s |
| **Path 5** | Left Secondary Parallel Lane (`M 288 600 V 1000`) | 401px | **Twin Phase-Shifted Train**: 3-dot packet running in parallel | `0 16 0 16 0 968` | 12.0s | -2.4s |

---

## 3. Optical Luminescence Architecture (Dual-Corona Glow)

### 3.1 CSS Hardware-Accelerated Drop-Shadow Stacking
To impart an authentic emissive radiance without requiring expensive SVG Gaussian blur filter graphs, we implement a dual-corona CSS filter stack directly on `.backdrop-flow`:

```css
.backdrop-flow {
  filter: 
    drop-shadow(0 0 2px var(--backdrop-flow-glow-core))
    drop-shadow(0 0 5px var(--backdrop-flow-glow-halo));
}
```

1. **Inner Core Corona (`0 0 2px`)**:
   Provides immediate optical blooming at the edge of each circular dot, creating the appearance of intense incandescence (a "white-hot" or high-energy core).
2. **Outer Ambient Halo (`0 0 5px`)**:
   Projects an ethereal, diffuse photon aura onto the adjacent copper trace and dark substrate, producing the illusion of light reflecting off the circuit board.

### 3.2 Calibrated Theme Tokens

#### Dark Theme (`styles.css` `:root[data-theme="dark"]`)
In dark mode, high visual punch is desirable without compromising body copy legibility:
```css
/* Luminous citron/cyan particle body */
--backdrop-flow-ink: hsl(64, 85%, 72%);

/* Intense inner core incandescence */
--backdrop-flow-glow-core: rgba(255, 255, 255, 0.90);

/* Ambient phosphorescent halo matching theme accent */
--backdrop-flow-glow-halo: color-mix(in srgb, var(--accent-fill) 85%, transparent);
```

#### Light Theme (`styles.css` `:root`)
In light mode, the technical schematic is rendered in clean inverted tones. Overly bright white glows would be invisible against the `#f8fafb` ground, while dark shadows read as dirt. The light tokens use deep energetic slate-citron ink with an azure/citron aura:
```css
/* Deep energetic slate-citron particle body */
--backdrop-flow-ink: color-mix(in srgb, var(--accent-text) 80%, #0f172a);

/* Sharp focused core aura */
--backdrop-flow-glow-core: color-mix(in srgb, var(--accent-text) 65%, transparent);

/* Gentle diffuse atmospheric halo */
--backdrop-flow-glow-halo: color-mix(in srgb, var(--secondary-fill) 40%, transparent);
```

---

## 4. Frontend CSS Specification

```css
/* ── Directed transit over circuit board traces ── */
.site-backdrop-flow {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: none;
  color: var(--backdrop-flow-ink);
  pointer-events: none;
}

.backdrop-flow {
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
  filter: 
    drop-shadow(0 0 2px var(--backdrop-flow-glow-core))
    drop-shadow(0 0 5px var(--backdrop-flow-glow-halo));
  animation: backdrop-flow 11s linear infinite;
  will-change: stroke-dashoffset;
}

/* Path 1: Top-Right High Speed Burst */
.backdrop-flow:nth-of-type(1) {
  stroke-dasharray: 0 13 0 13 0 13 0 961;
  animation-duration: 9.0s;
  animation-delay: 0s;
}

/* Path 2: Right Branching Dual-Packet Pipeline */
.backdrop-flow:nth-of-type(2) {
  stroke-dasharray: 0 12 0 12 0 12 0 464 0 12 0 12 0 12 0 464;
  animation-duration: 13.5s;
  animation-delay: -3.2s;
}

/* Path 3: Bottom Horizontal Backbone Stream */
.backdrop-flow:nth-of-type(3) {
  stroke-dasharray: 0 11 0 11 0 11 0 11 0 11 0 945;
  animation-duration: 10.5s;
  animation-delay: -6.1s;
}

/* Path 4: Left Primary Lane Clock Pulse */
.backdrop-flow:nth-of-type(4) {
  stroke-dasharray: 0 16 0 16 0 968;
  animation-duration: 12.0s;
  animation-delay: -8.4s;
}

/* Path 5: Left Secondary Parallel Lane Pulse */
.backdrop-flow:nth-of-type(5) {
  stroke-dasharray: 0 16 0 16 0 968;
  animation-duration: 12.0s;
  animation-delay: -2.4s;
}

@keyframes backdrop-flow {
  from {
    stroke-dashoffset: 1000;
  }
  to {
    stroke-dashoffset: 0;
  }
}

@media (width >= 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .site-backdrop-flow {
    display: block;
  }
}
```

---

## 5. Performance, Accessibility & Security Analysis

1. **Zero Runtime Overhead**:
   - Driven entirely by browser compositor-supported CSS transitions on `stroke-dashoffset`.
   - 0 requestAnimationFrame calls, 0 JavaScript ticks, 0 garbage collection allocations.
2. **Accessibility & Battery Protection**:
   - Hidden by default; explicitly enabled only for desktop viewports (`>= 1024px`) with fine pointer input and reduced motion disabled.
   - Phones (`width <= 768px`) and touch tablets bypass rendering completely.
3. **CSP Compliance**:
   - All styling resides in `frontend/styles.css` (`style-src 'self'`).
   - Zero inline script or inline style additions; `scripts/check_csp_hashes.py` remains 100% compliant.
4. **Trace Geometry Integrity**:
   - Because SVG coordinates (`d="..."`) remain unchanged, `scripts/check_backdrop_traces.py` reports 100% alignment against `site-backdrop.webp`.

---

## 6. Verification & Test Plan

Execute the standard validation gates:

```bash
# 1. Verify circuit trace alignment (must remain >= 95% across all paths)
python scripts/check_backdrop_traces.py

# 2. Verify CSP inline script hashes
python scripts/check_csp_hashes.py

# 3. Synchronize documentation token estimates and line counts
python scripts/check_docs.py --fix --show-tokens

# 4. Frontend syntax and unit test suites
npm run lint
npm test
npm run build
```
