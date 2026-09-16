# Design System

The token layer in `frontend/styles.css` is the contract every rule in the
stylesheet is written against. This document is its specification: what the
tokens are, the rules that govern adding one, and which values are deliberately
*not* on a scale.

Decided in ADR-024 and ADR-025 (`docs/ADR.md`). For where the styles live and
how they build, read `FRONTEND.md#styling` first — this file is about the
vocabulary, not the plumbing.

## Where it lives

| Layer | Location | Role |
| :--- | :--- | :--- |
| Primitives, light theme | `styles.css` `:root` | The scales, and the light palette |
| Dark theme | `styles.css` `body.dark-theme` | Redefines colour and elevation only |
| Accent-derived aliases | `styles.css` `body` | Anything built from `var(--accent-*)` |
| Runtime palettes | `js/theme-customizer.js` | Writes 17 colour tokens onto `body.style` |

The split between `:root` and `body` is not cosmetic. A `var()` inside a custom
property substitutes where the property is **declared**, so an accent-derived
token declared on `:root` freezes at the light accent and ignores both
`body.dark-theme` and the customiser. `--glow-*`, `--focus-ring` and
`--sheen-wash` live on `body` for exactly that reason.

## The four rules

1. **Three-hue separation.** The palette is three hues, no two closer than 60°
   on the wheel — currently citron 64, azure 214, violet 274. Saturation travels
   with the hue, which is why `--accent-sat` is a token and not a literal.
2. **Contrast is measured, not estimated.** Every `-text` variant is chosen
   against a computed ratio and clears WCAG AA for normal text on `--bg`, not
   the 3:1 large-text allowance. Record the measured ratio in a comment.
3. **Every visual dimension is a scale.** A new value joins an existing ramp, or
   becomes a named token with a comment saying what it is for. It does not
   become another literal.
4. **Both themes, always.** A colour or elevation token defined under `:root`
   with no counterpart under `body.dark-theme` is a bug in one of the themes.

## Scales

### Type — Major Second (1.125), anchored at 16px

Eleven rungs, `--text-2xs` (0.703rem) through `--text-6xl` (2.281rem), plus six
fluid `clamp()` steps that interpolate between adjacent rungs so a heading never
lands off-scale at any width. `rem` throughout, so the ramp respects the user's
own font-size setting.

The ratio is a Major Second rather than a Minor Third because this UI needs five
distinct tiers *below* 16px — badges, meta, tags, labels, secondary body — and a
1.2 ratio only affords two.

Six `--text-*` legacy aliases map older names onto the ramp; they are why 71
call sites moved onto the scale without being edited.

### Spacing — 4px base

| Token | Value | Token | Value |
| :--- | ---: | :--- | ---: |
| `--space-3xs` | 2px | `--space-md` | 12px |
| `--space-2xs` | 4px | `--space-lg` | 16px |
| `--space-xs` | 6px | `--space-xl` | 24px |
| `--space-sm` | 8px | `--space-2xl` | 32px |

The eight rungs *are* the eight most-used spacing values in the stylesheet, so
adopting one is a rename and never a reflow.

**Deliberate exceptions.** 10px, 14px, 18px and 22px are not on the ramp and are
not going on it. They live in the hero, activity and chat regions, tuned against
layouts a 28-finding UI review already settled; rounding them to a rung would
move pixels to buy nothing. New CSS uses the ramp.

### Radius, elevation, blur, sheen

- **Radius** — `--radius-sm` 8px through `--radius-xl` 20px, plus
  `--radius-full`.
- **Elevation** — `--elev-1` to `--elev-4`, each one hairline ring plus one
  ambient shadow. `--shadow-ring` and `--shadow-ambient` are redefined in the
  dark theme, so every step adapts with it.
- **Blur** — four steps, `--blur-sm` 8px to `--blur-xl` 24px, down from nine
  ad-hoc radii.
- **Sheen** — the lit edge that makes a floating surface read as glass. White is
  specular only on a *darker* ground, so the rule ("the edge is lighter than the
  surface behind it") holds in both themes but the sign flips; the two themes
  carry different values rather than one.

### Motion

The general ramp is four rungs:

| Token | Value | For |
| :--- | ---: | :--- |
| `--motion-fast` | 120ms | micro-feedback — press, small transforms |
| `--motion-base` | 180ms | the default UI state change |
| `--motion-medium` | 240ms | overlays, panels, anything with distance to cover |
| `--motion-slow` | 320ms | the largest UI transitions |

`--motion-page` (200ms) and `--motion-reveal` (520ms) are **not** general rungs.
Each is named for its one job — the section router's `section-enter`, and the
IntersectionObserver reveal — and reaching for `--motion-page` on a button hover
because the number looked close is the mistake this note exists to prevent.

Three base easings cover ordinary work: `--ease-standard` (the default),
`--ease-enter` (decelerating, for things arriving) and `--ease-press`.

Five **signature easings** — `--ease-overshoot-soft`, `--ease-overshoot`,
`--ease-rollup`, `--ease-flip`, `--ease-ripple` — each belong to exactly one
effect and are tuned against it. They are tokens rather than inline literals so
they are discoverable, but they are not interchangeable: the portrait flip, the
hero title's per-character roll-up and the press ripple each read wrong on
another curve.

**Off the ramp, correctly:** long-running ambient animations. The scale spans
120–320ms and describes UI state changes; a 10s scanline, a 1.4s typing
indicator or a 2.4s pulse has nothing to do with it. The same goes for the three
signature durations — the 0.35s hero panel lift, the 0.45s portrait bounce and
the 760ms portrait flip.

**JS reads this scale, it does not restate it.** `motionMs(name, fallback)` in
`js/config.js` resolves a `--motion-*` token to milliseconds, cached per token,
with a fallback for jsdom and for the window before the stylesheet applies. Any
JS animating alongside CSS goes through it.

## Colour

Three fills and their derived variants, in both themes:

| Family | Fill | Text variant | Role |
| :--- | :--- | :--- | :--- |
| accent | `--accent-fill` | `--accent-text` | primary action, citron |
| secondary | `--secondary-fill` | `--secondary-text` | azure |
| data | `--data-fill` | `--data-text` | violet — **never a text ground** |

Fills are hex and variants are `hsl()`, and that split is deliberate: the
customiser's colour picker reports fills as hex, and "the value the picker shows
is the value the page paints" is either true of every control or it is not a
property anyone can rely on. The variants stay `hsl()` because their whole
content is "the fill's hue and saturation, darker".

`--on-accent` is dark ink (11.2:1 on citron, 4.9:1 on azure) because `#fff`
failed WCAG AA sitewide before the token existed. `--data-fill` is the one fill
dark ink cannot sit on (2.8:1), which is why violet appears only inside
decorative gradients.

Beyond those: five **event-family** hues for the activity log — five rather than
ten, because five are learnable at a glance and ten need a legend — and the
status colours.

Three tokens serve the site backdrop. `--backdrop-tint` is mixed mostly out of
neutral slate with roughly a third of `--accent-text`, and is blended under the
image in `luminosity` mode so the drawing takes the theme's hue at a fraction
of its saturation — related to the accent, clearly subordinate to it, and
carried along by the customiser for free. `--backdrop-flow-ink` is the moving
dash on top of it, brighter than the traces it runs on because motion that
quiet is invisible at the drawing's own weight, and still well under the accent,
which has actions to mark.

`--backdrop-scrim` is the odd one out: not a colour but a *wash of one*,
`color-mix(in srgb, var(--bg) 80%, transparent)` in the light theme and 85% in
the dark. It sits over the site backdrop image and is the only thing standing
between a technical drawing and every piece of body copy on the site, so it is
a contrast control rather than a decorative choice — lower it and the drawing's
hairlines start winning against secondary text. It follows `--bg`, so a rolled
palette takes the wash with it. See
[Static assets](FRONTEND.md#static-assets).

### Renaming a colour token is a two-file change

`clearCustomPalette()` in `js/theme-customizer.js` holds a literal list of the
tokens it removes from `body.style`. Rename a token in the stylesheet without
moving it there and a custom palette will fail to clear — the old property stays
on `body` permanently.

## Accessibility obligations

- Every `-text` variant clears **WCAG AA for normal text** on `--bg`. So does
  every state built from one. `--accent-hover` is a *background* token — 7.98:1
  under `--on-accent` ink, but 2.27:1 as a foreground on the light `--bg`, which
  is how `.link-action:hover` once dropped the resume Download link below AA on
  hover. A hover that needs more emphasis than `--accent-text` gets a non-colour
  affordance (that rule now underlines), not a lighter fill used as ink.
- `--min-touch-target` is 44px, and 48px under 640px. Controls are sized from
  the token under `@media (pointer: coarse)` rather than at a width breakpoint,
  so a touch laptop and a tablet in landscape are covered too.
- Text controls carry a **16px floor under `(pointer: coarse)`**. Below it,
  mobile Safari zooms the viewport on focus and never zooms back out. The rule
  is one blanket selector per stylesheet; dense monospace workbenches keep their
  compact size on a fine pointer.
- **Gradient text needs a `forced-colors` escape.** `background-clip: text` with
  `-webkit-text-fill-color: transparent` renders *invisible* in Windows High
  Contrast Mode: forced colors overrides `color` but not
  `-webkit-text-fill-color`, which wins for text. Any new gradient heading joins
  the `@media (forced-colors: active)` block in the ACCESSIBILITY region.
- `prefers-contrast` queries list **`more` first**, with `high` kept only as the
  legacy Safari alias. `high` alone never matches in Chrome or Firefox, which is
  how two high-contrast blocks sat dead in the stylesheet.
- The blanket `@media (prefers-reduced-motion: reduce)` rule in the
  ACCESSIBILITY region caps every animation and transition, and **overrides
  everything above**. Ten JS modules gate on the same query through `config.js`.
- `color-scheme` on the root element must track the theme, or the viewport
  scrollbars and form controls stay light on a dark page.

## Adding to the system

1. Look for a rung that fits. Most of the time one does.
2. If none does, ask whether the value is *signature* (one effect, tuned, worth
   naming) or *drift* (a rung ±20ms or ±2px). Drift joins the rung.
3. A genuinely new token gets a name that says what it is for, a comment saying
   why it exists, and — for colour — a measured contrast ratio.
4. Colour and elevation tokens need a dark-theme counterpart.

## Enforced by

`scripts/build.mjs` fails the build past `BUDGETS_KIB` — 300 KiB of JS and
240 KiB of CSS, minified, with sourcemaps and images excluded. `npm run lint:css`
runs Stylelint. Neither checks *taste*: rules 1–4 above are reviewed, not linted.
