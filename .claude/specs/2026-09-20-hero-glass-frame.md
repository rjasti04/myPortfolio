# Technical Specification: Landing Hero — Desktop Glass Frame, Mobile-Only Paint

> **Revision, same day.** §4.4 and §4.5 originally specified a redesign of the
> paint from an upright panel into a diagonal swash. It was built and then
> **reverted at the owner's direction**; the panel ships unchanged. Both
> sections are rewritten below to match what shipped, and §4.1 carries the
> thinner frame fill that replaced the first pass.

**Related Intent**: `.claude/intents/2026-09-20-hero-glass-frame.md`
**Target Audience**: Visitor / Recruiter (LCP view), Work Sample

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA — `frontend/styles.css` only. **`frontend/index.html` is not
        touched**, so the three pinned CSP `sha256-` hashes cannot drift.
  - [ ] Generated asset — none. `frontend/brush-backdrop.webp` and
        `scripts/generate_brush_backdrop.py` are untouched.
  - [ ] Backend API — none.
  - [ ] Database Schema — none.
  - [x] CI/CD & Deploy — `scripts/build.mjs` only, and only `BUDGETS_KIB.css`
        plus the note above it. Nothing about the emit changes.

- **The breakpoint is 901px, and it is the one the view already has.**
  `@media (width <= 900px)` is where `.home-hero` drops from two columns to a stack;
  `@media (width >= 901px)` is where `.home-intro` left-aligns. The frame joins the
  second and the paint joins the first. No third tier is introduced, so a tablet in
  portrait keeps the stacked layout *and* the paint, which is the layout the paint
  was measured against in the first place.

---

## 2. API Contract & Schemas

N/A — no route, request or response is added, changed or removed.

---

## 3. Database Schema & Migration Plan

N/A — no model, no `server/alembic/versions/` entry, no `alembic check` impact.

---

## 4. Frontend Implementation & DOM Contract

- **Module Structure**: no JavaScript. No module is added, imported or edited.
- **State Management**: none.
- **DOM Sanitization**: N/A — nothing is injected.
- **DOM Contract**: unchanged. The frame is `.home-hero` itself plus a single
  `::before`; the swash stays `.home-portrait::before`.
  - That pseudo-element is `position: absolute`, which is load-bearing and not
    stylistic: `.home-hero` is a **grid container**, and a static-position `::before`
    on a grid container becomes a *grid item* and is placed into the track flow.
    Absolutely-positioned children are not grid items.

### 4.1 Tokens (DESIGN TOKENS & THEMES region)

| Token | Where declared | Light | Dark | Why |
| :--- | :--- | :--- | :--- | :--- |
| `--radius-2xl` | `:root` | `28px` | inherits | The rung above `--radius-xl` (20px). The frame is ~1050×560; 20px on a box that size reads as a square with the corners filed off. |
| `--hero-frame-bg` | `body` | `color-mix(in srgb, var(--surface) 40%, transparent)` | `color-mix(in srgb, var(--surface) 20%, transparent)` | The glass fill. `--surface` is already 0.92/0.90 alpha, so the effective alphas are ~0.37 and ~0.18. Thin on purpose: the blur is what makes the frame a surface, and past ~0.4 the fill starts hiding the drawing the blur exists to soften. It is **not** what holds contrast — `--backdrop-scrim`'s 80% of `--bg` is — which the ratios in §4.7 measure rather than assume. |
| `--hero-frame-edge` | `body` | `var(--accent-mild)` | `var(--accent-fill)` | The hairline. It is also the *only* edge that survives `forced-colors`, which is why it is a real `border` and not part of the rim gradient. |
| `--hero-frame-rim` | `body` | a `linear-gradient` of `--accent-mild` → `--accent-soft` → `--accent-mild` | the same ramp with `--accent-fill` at the two ends | The illuminated edge. Directional rather than uniform so the frame reads as *lit* from the upper left rather than outlined. |
| `--hero-frame-glow` | `body` | `var(--elev-4), 0 0 34px -14px var(--accent-mild)` | `var(--elev-4)` + three `--accent-mild` blooms at increasing spread and increasing negative spread | The bloom outside the rim. Two values because the sign of "lighter than the ground" flips between themes — the same rule `--sheen-edge` is two values for. |
| `--hero-frame-sheen` | `body` | `radial-gradient(120% 78% at 16% -8%, var(--sheen-wash) 0%, transparent 62%)` | inherits (`--sheen-wash` is itself per-theme) | The specular pass. A background **layer** on the frame rather than a second pseudo-element: same paint order, one fewer rule, and the CSS budget has none to spare. |

Every accent-derived value is a `var()` on the existing ramp rather than a
`color-mix()` per stop. That started as a byte trim and is the better code
anyway — a custom palette reaches these through `--accent-fill`,
`--accent-soft` and `--accent-mild` with nothing threaded through by hand.

All five frame tokens are declared on **`body`**, not `:root`. A `var()` inside a
custom property substitutes where the property is *declared*: on `:root` these would
freeze at the light accent and ignore both `body.dark-theme` and the theme customiser,
which writes `--accent-fill`, `--accent-soft` and `--accent-mild` onto `body.style`.
This is the same trap already documented on `--glow-*`, `--sheen-wash` and
`--focus-ring`. They are **not** added to `clearCustomPalette()`'s list in
`js/theme-customizer.js` — that list is the set of properties the customiser *writes*,
and these are derived, not written.

`docs/DESIGN.md` §"Radius, elevation, blur, sheen" states the radius ramp as
"`--radius-sm` 8px through `--radius-xl` 20px"; it gains the new rung.

### 4.2 Desktop frame — `@media (width >= 901px)`, HOME HERO region

Added to the existing `(width >= 901px)` block (the one that left-aligns `.home-intro`).

```
.home-hero                          position: relative
                                    isolation: isolate
                                    border-radius: var(--radius-2xl)
                                    background: var(--hero-frame-bg)
                                    backdrop-filter: blur(var(--blur-lg)) saturate(var(--glass-saturate))
                                    border: 1px solid var(--hero-frame-edge)
                                    box-shadow: var(--hero-frame-glow)

.home-hero::before                  the illuminated rim: inset 0, z-index -1,
                                    border-radius inherit, padding 1.5px,
                                    background var(--hero-frame-rim),
                                    masked to the border ring with the
                                    content-box/border-box `mask-composite: exclude`
                                    trick already used by `.btn::after`

```

The specular sheen is **not** a second pseudo-element: it is
`background: var(--hero-frame-sheen) var(--hero-frame-bg)` on the frame, a
layer over the fill. A pseudo at `z-index: -1` and a background layer paint in
the same order here, so the two are visually identical and the layer is one
rule cheaper.

`isolation: isolate` is what makes `z-index: -1` mean "above the frame's own background,
below the grid items" instead of "behind everything in `.layout`". `backdrop-filter`
already establishes a stacking context, but the `@supports not` fallback removes it,
and without `isolation` the rim would disappear behind the fill exactly there.

**Sizing.** `.js-enabled #home.active .home-hero` sets `width: 100%` and
`padding-block: 0` at specificity (0,3,1); a bare `.home-hero` inside a media query
loses to it (media queries add no specificity). The frame's box rule therefore carries
both selectors:

```
.home-hero,
.js-enabled #home.active .home-hero {
  --hero-frame-pad-block:  clamp(24px, 3.2vh, 44px);
  --hero-frame-pad-inline: clamp(28px, 3.4vw, 60px);
  width: fit-content;
  max-width: 100%;
  margin-inline: auto;
  padding: var(--hero-frame-pad-block) var(--hero-frame-pad-inline);
}
```

`width: fit-content` replaces `width: 100%` so the frame hugs the pair rather than
spanning `main`'s full 1280px — the grid's `justify-content: center` becomes moot and
`margin-inline: auto` does the centring instead.

### 4.3 The portrait height bound has to absorb the frame's padding

The existing bound is derived, not chosen, and its derivation assumes a hero with **no
block padding**:

```
available = 100dvh - 72px (header flow box) - (16px + g) - g      g = clamp(16px, 3vh, 36px)
          = 100dvh - 88px - 2g
          = 0.94 x 100dvh - 88px            (while g is unsaturated)
width     = 0.9656 x available              (the cutout's 1:1.0356 aspect)
          = 90.7dvh - 85px        ->        min(..., calc(90dvh - 85px))
```

With the frame, `available` loses the frame's own block padding `P = 2 x pad`:

```
width = 0.9656 x (0.94 x 100dvh - 88px - P)
      = 90dvh - 85px - 1.93 x pad
```

so inside the `(width >= 901px)` block:

```
.home-portrait {
  width: min(clamp(375px, 40.5vw, 450px),
             calc(90dvh - 88px - 1.93 * var(--hero-frame-pad-block)));
}
```

88px rather than 85px: the extra 3px is the frame's 1px border top and bottom plus a
pixel of slack for the rim. Worked example at **1440×568**, the worst case the existing
note names — `g` = 17.04px, `pad` = 24px (the clamp floor), bound = 511.2 − 88 − 46.3 =
**376.9px** wide → 390.2px tall, against 445.9 − 48 − 2 = **395.9px** of room. Fits.
At 1280×800 the 450px cap wins and nothing changes.

The mobile `82dvh` ramp (`<=900px`, `<=600px`, `<=430px`) is **untouched** — there is no
frame at those widths, so its constants still hold.

### 4.4 Mobile paint — `@media (width <= 900px)`

The whole of `.home-portrait::before` and its `body.dark-theme` opacity override
move inside `@media (width <= 900px)`. That is the entire change to the paint: the
rule's declarations are **byte-for-byte what they were**, one indent level deeper.
Above 900px the pseudo-element is never generated, so the mask image is not fetched
on desktop at all.

| Property | Value | Unchanged because |
| :--- | :--- | :--- |
| `width` | `88%` | The cutout's box is mostly air; at 88% the paint ends just outside the shoulders, where a flat behind a sitter ends. |
| `aspect-ratio` | `1060 / 1120` | The generator's canvas. |
| `top` | `-6%` | Mirrored in `generate_brush_backdrop.py`, which computes the bottom fade from it. |
| `left` | `46%` | Centred on the *figure*, not the box, and a measured compromise between the flip card's two silhouettes (alpha-weighted centroids 0.337 vs 0.363). |
| `transform` | `translateX(-50%) rotate(-2deg)` | Hung by hand, not printed. |
| `opacity` | `0.72` / `0.48` dark | Tuned against the ground phones actually show. |

The four constants mirrored in the generator (`PANEL_WIDTH_OF_BOX`,
`PANEL_TOP_OF_BOX`, the box aspect, `PORTRAIT_FADE_START`) are therefore still
correct, and the fade band it prints is still `39% -> 66% of the portrait box;
the figure starts dissolving at 68%`. Nothing needs regenerating.

### 4.5 `scripts/generate_brush_backdrop.py`

**No change.** An earlier pass rewrote its stroke table for a diagonal swash and
that was reverted; the file and `frontend/brush-backdrop.webp` are both back to
what they were.

### 4.6 Accessibility and fallback blocks

| Block | Change |
| :--- | :--- |
| `@supports not (backdrop-filter …)` (BACKDROP-FILTER FALLBACKS) | A nested `@media (width >= 901px)` gives `.home-hero` `background: var(--surface); border-color: var(--border)`, matching how `.glass-light` degrades. Scoped, or the phone layout gains a card it never had. |
| `@media (forced-colors: active)` | `.home-hero::before { display: none }`. The rim is painted with a `background` image, which HCM blanks — leaving a rounded gap where an edge was, the same failure the block already fixes for `.section-title::after`. The frame's real `border` is forced to a system colour and is what remains. |
| `@media (prefers-contrast: more), (prefers-contrast: high)` | `.home-hero { background: var(--surface); backdrop-filter: none; }` — an opaque surface under the type. Unscoped is safe: below 901px `.home-hero` has no frame background to override. `more` first, `high` only as the legacy Safari alias. |
| `@media print` | `.home-hero { background: none; border: 0; box-shadow: none; }`, with the rim and the paint panel dropped. `backdrop-filter` does not print and a bloom wastes toner. |

No `prefers-reduced-motion` rule is needed: nothing added here transitions or animates.

### 4.7 Contrast obligations — measured, not argued

The frame goes under every line on the LCP view, so the ratios are sampled from the
rendered page rather than reasoned about: Chromium at 1440×900, the hero text hidden
so the ground behind it can be read directly, per pixel over each line's own box,
quoting the worse of *mean ground* and *worst single pixel*. The ink is unchanged in
both themes; only the ground moved.

| Line | Token | Light | Dark |
| :--- | :--- | ---: | ---: |
| `.home-greeting` | `--muted` | 7.98:1 | 10.56:1 |
| `.home-name` | `--text` | 15.97:1 | 14.56:1 |
| `.hero-kicker.home-kicker` | `--secondary-text` | **5.51:1** | 7.06:1 |

All clear WCAG AA for normal text (4.5:1). The disciplines line binds, and it binds
in the **light** theme, so that is the number to re-measure before thinning
`--hero-frame-bg` further — and it is `--hero-frame-bg` that moves, never the type.

The counter-intuitive result is worth recording: **thinning the fill improved every
ratio.** `--backdrop-scrim` already lays 80% of `--bg` over the backdrop and that is
the layer holding contrast; a thinner frame leaves the ground closer to the bare
`--bg` the ink was originally measured against.

---

## 5. Security & Rate Limiting Review

- [x] No endpoint added or changed — nothing to rate-limit.
- [x] No secret read, logged or returned.
- [x] **No inline `<script>` touched.** `frontend/index.html` is not edited, so the
      three pinned `sha256-` hashes in its CSP `script-src` are unchanged.
      `scripts/check_csp_hashes.py` is run as a regression check.
- [x] CSP unaffected otherwise: `brush-backdrop.webp` is a same-origin image already
      covered by `img-src 'self'`, referenced from `styles.css` as it is today. No new
      origin, no `data:` URI, no `style-src` change.
- [x] No user-controlled string reaches the DOM; `DOMPurify` is not in the path.

---

## 6. Verification & Test Plan

```bash
# Frontend
npm run lint          # ESLint + Stylelint
npm test              # Node test runner + jsdom
npm run build         # esbuild; fails past BUDGETS_KIB.css, now 291 KiB

# Docs / hashes
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py --fix --show-tokens
```

The mask is not regenerated: `generate_brush_backdrop.py` and its output are
untouched, so `python3 scripts/generate_brush_backdrop.py` is a no-op here.

**Visual verification** (Chromium via Playwright, both themes):

| Viewport | Expect |
| :--- | :--- |
| 1440×900 | Frame around the whole hero, lit rim, no paint anywhere. |
| 1280×800 | Same; portrait still at the 450px cap. |
| 1440×568 | Same; **no scrollbar** — the `§4.3` bound is what this checks. |
| 1920×1080 | Frame hugs the pair rather than spanning `main`. |
| 901 / 900px | The swap point: frame off → paint on, in one pixel, with neither layout broken. |
| 390×844, 430×932 | The paint panel behind the portrait, unchanged, no frame, no horizontal overflow. |
| 768×1024 | Tablet keeps the stacked layout, the panel *and* the site backdrop. |
| 320×568 | Worst case for the "never scrolls" promise; disciplines line still on one row. |

**Media emulation** (also Chromium): `prefers-contrast: more` (opaque surface, blur
off), `forced-colors: active` (rim dropped, real border carries the edge),
`prefers-reduced-motion: reduce` (nothing to clamp) and `print`.

**Backend / database**: not run — no Python under `server/`, no model and no migration
is touched by this change. `PYTHONPATH=. pytest` and `alembic check` are out of scope
and that is stated rather than skipped silently.

---

## 7. Assumptions

1. **"Desktop and wider" means ≥ 901px**, reusing the view's existing two-column
   boundary. Tablets in portrait (768px) keep the stacked layout and the swash.
2. **"Mobile" for the paint means ≤ 900px**, i.e. the stacked layout, not the narrower
   `(pointer: coarse) and (width <= 768px)` definition `js/config.js` uses for
   `mobileDevice`. A narrow desktop window gets the swash too, because what the paint
   is compensating for is the *stacked layout*, not the input device.
3. "Add transparency to it" is read as *thinner fill*, not a weaker rim or bloom:
   the frame reads as glass because of the blur and the lit edge, and dropping
   those to make it see-through would remove the effect rather than lighten it.
   The fill went 62%→40% light and 34%→20% dark, bounded by the measured
   contrast in §4.7 rather than by eye.
4. The mock's neon rim is read as the **dark theme**'s treatment. The light theme gets
   the same structure at a restrained strength, per `docs/DESIGN.md` rule 4 and the
   `--sheen-edge` note ("the edge is lighter than the surface behind it" holds in both
   themes, but the sign flips).
5. The rim is **static**. The mock is a still; a pulsing glow on the landing view is a
   SC 2.2.2 liability and the site already plays `.home-role`'s gradient exactly once.
