# Visual & Interaction Review — `#home`

Read-only. Scope is the landing view only: the `#home` markup in
`frontend/index.html`, its styling in `frontend/styles.css`, and the two hero
scripts (`js/hero-title.js`, `js/home-portrait.js`). Accessibility and
base-level state handling are treated as met (`docs/review/uiux.md`, tier 2) and
are not re-reported; where a ratio appears below it is there because rule 2
requires every proposal to name one, not as a finding.

This is a taste review. The question is whether the view is intuitive and
whether it is beautiful — not whether it is correct.

## Status: implemented

Findings 1–9 and 11 shipped in `frontend/styles.css`, as written — ten of
eleven, all CSS, no markup, no JS, no new asset or origin. Finding 10 (the
wand glyph) is the exception and stays open: it has no declaration-level fix,
and the label version needs markup plus a re-measured collapse band.

Verified after the change: `npm run lint` clean, `npm test` 639/639,
`check_csp_hashes.py` green (`index.html` untouched), and `npm run build` puts
CSS at **294.1 KiB of 296** — the +0.09 KiB this document predicted, against
294.0 before.

One stale comment the change falsified was corrected with it: the glass frame's
note claimed "this page deliberately plays even `.home-role`'s gradient once,"
which finding 2 makes untrue.

Two consequences worth recording for whoever edits this region next:

- The portrait ramp's `C` constants (285/300/331) are now **conservative by
  4.9–7.0px** on mobile — findings 3 and 6 shrink the non-portrait stack, so
  the view has more slack than the constants assume. That is the safe
  direction and nothing is broken; re-deriving them is a separate measured
  exercise, not part of this.
- `@keyframes gradient-shift` keeps its one remaining caller, `.section-title`,
  so finding 2 orphaned nothing.

## Method

Numbers in this document are measured, not estimated.

- **Contrast** — computed from the token values through the WCAG relative-luminance
  formula, compositing alpha layers onto the theme's `--bg` first. The method
  reproduces the stylesheet's own published figures to two decimal places
  (`--border` 1.31 light / 1.44 dark, `--control-border` 4.55 / 4.00,
  `--accent-text` ring 5.52, `--accent-fill` 1.62), so figures below are
  comparable with the ones already in the comments.
- **Text advances** — from `frontend/fonts/plus-jakarta-sans-latin-153fc85b.woff2`
  instanced at the shipped weights, plus the element's `letter-spacing` and, for
  the name, the `0.26em` `.hero-word-space`.
- **Portrait geometry** — alpha-mass centroids and extents of
  `profile-cutout.png` / `profile-cutout-back.png` with
  `mask-image: linear-gradient(to bottom, #000 68%, transparent 97%)` applied.
- **Budget** — `npm run build` on the current tree: **CSS 294.0 KiB of 296 KiB
  (99%)**, JS 381.9 of 390 KiB. Note that the ceilings are 390/296, not the
  300/240 the brief cites — which matters here, because 2.0 KiB of CSS headroom
  is what every proposal below has to fit inside.

---

## Standing visual decisions this review does not reopen

| Decision | Where it is recorded |
| :--- | :--- |
| The circuit schematic is the site's ground, tinted by `--backdrop-tint` and washed by `--backdrop-scrim` | `.claude/intents/2026-09-17-circuit-backdrop-redesign.md` |
| One decoration per layout: the glass frame above 900px, the painted panel at or below it, never both | `.claude/intents/2026-09-20-hero-glass-frame.md` §1; `styles.css:3096` |
| 901px is the hero's only breakpoint — no third tablet tier | hero-glass-frame intent §2 |
| The frame does not animate (WCAG 2.2 SC 2.2.2); the rim is static | hero-glass-frame intent §2; `styles.css:3788` |
| The portrait flip has no affordance at all — no pointer cursor, no hover, no glyph | `styles.css:2976`, `styles.css:3301` |
| About is the filled primary, Experience the outline secondary; exactly one fill on the view | `index.html:828`; `styles.css:3519` |
| Exactly one line on the view is in accent — the greeting was demoted to muted ink for it | `styles.css:3368` |
| `--radius-2xl` 28px and `--hero-frame-blur` 2px are signature values, deliberately off their ramps | `docs/DESIGN.md` §"Radius, elevation, blur, sheen" |
| 10/14/18/22px are sanctioned hero/activity/chat spacing exceptions | `docs/DESIGN.md` §Spacing |
| The portrait caps at 450px for source-resolution reasons, not layout ones | `styles.css:2992` |
| Phones lose `.site-backdrop` entirely; the paint panel is the only ground there | `styles.css:7952` |

The circuit backdrop and the hero glass frame are decisions. Findings 8 and 9
tune how the frame is lit; neither questions that it is there.

---

## What already works

**1. The frame's vertical balance is measurably right, and it could easily not have been.**
The portrait's bottom third is dissolved by a mask, so the box is taller than the
figure — a classic way to end up with a photograph floating high in a panel.
Measured with the mask applied, the figure's optical centre sits at y=0.526 of
its box (front face) and 0.533 (back). At 1440×900 that leaves the frame with
97px of air above the first painted pixel and 113px below the last: an 8px
optical offset on a 560px panel, below anything a viewer perceives.
`align-items: center` on the grid plus a bottom-flush cutout happens to land
correctly, and nothing in the region claims credit for it.

**2. The one-fill rule survives its own hover state.**
`.home-btn--solid` (`styles.css:3532`) ranks About over Experience, and
`.home-btn--outline:hover` (`styles.css:3564`) is the part most one-primary rules
quietly break: the base `:hover` moved *both* pills to `--accent-hover`, which is
darker than the fill the primary wears at rest, so a pointer resting on the
secondary made it outrank the primary. The outline pill now takes an
`--accent-soft` wash instead — acknowledging the pointer without claiming the
rank. That is the harder half of the rule, and it is done.

**3. `--hero-frame-blur: 2px`.**
Every instinct says a glass panel wants `--blur-lg`. The note at `styles.css:713`
records that 16px, 8px and even a bare 3px all flatten a 1px hairline to an even
wash, and that 2px is the largest radius leaving a trace legible *as a trace*.
That single number is the difference between looking *through* glass at a
drawing and looking *at* a frosted card, and it is why the persona's question —
does the backdrop serve the frame or compete with the type? — answers in the
frame's favour. The competition, where it exists, is a lighting problem (8, 9),
not a blur problem.

---

## Summary

`#home` never scrolls, so "before scrolling" is the whole view. The ranking below
is therefore: what a first-time visitor registers in the first five seconds, then
what a longer look surfaces, then states only some visitors reach.

| # | Finding | Axis | Cost |
| ---: | :--- | :--- | :--- |
| 1 | The role line is undersized and is the one row that misses the column's right edge | Intuitive + Beautiful (hierarchy) | CSS, +42 B |
| 2 | The view's first motion is a shimmer on the subtitle, under a blank space where the `<h1>` will be | Beautiful (motion) | CSS, **−40 B** |
| 3 | The largest type on the site is the one heading set off the leading ramp's own annotation | Beautiful (rhythm, type) | CSS, 0 B |
| 4 | The name's rest glow is a bloom on dark and a 1.04:1 stain on light | Beautiful (depth, colour restraint) | CSS, +68 B |
| 5 | The action row floats between two gaps that differ by 3.5px | Beautiful (rhythm) | CSS, 0 B |
| 6 | The greeting outranks the line that carries the information | Beautiful (hierarchy) | CSS, +59 B |
| 7 | The icon row's grouping is argued at length and painted at 1.31:1 | Intuitive | CSS, +8 B |
| 8 | The frame's specular falloff dies 40% of the way down the panel | Beautiful (depth) | CSS, +1 B |
| 9 | The frame's lit edge is symmetric, so it cannot read as directional | Beautiful (depth) | CSS, **−60 B** |
| 10 | The wand's meaning is hover-only and its reversibility is invisible | Intuitive | *no in-remit fix — flagged* |
| 11 | *Cosmetic.* A `6px` literal where the ramp has the rung | Beautiful (hygiene) | CSS, +13 B |

**Net CSS: +91 bytes** (0.09 KiB), 4.5% of the 2.0 KiB remaining. Findings 2 and
9 pay for most of the rest. No markup, no JS, no new asset, no new origin.

---

## The first five seconds

### 1. The role line is undersized, and it is the one row that misses the column's right edge

**`frontend/styles.css:3421`** — `font-size: var(--text-fluid-lg);`

For the persona — a hiring manager landing cold — "Principal Data Engineer" is
the most valuable string on the page. The name is an unsearchable proper noun;
the title is the qualifying fact. It currently renders at 20.26px against the
name's 64.8px, a 3.2× drop, which is roughly ten rungs on a Major Second ramp.
The eye registers the photograph, then the name, and then has to step down two
full tiers to reach the answer.

The composition says the same thing independently. At ≥901px the column is
left-aligned, and its six rows measure:

| Row | Rendered width |
| :--- | ---: |
| `.home-greeting` | 78.5px |
| `.home-name` | 372.5px |
| **`.home-role`** | **314.6px** |
| `.home-kicker` | 351.8px |
| `.home-actions` | 356.0px |
| `.home-socials` | 371.6px |

Five of the six sit inside a 351.8–372.5px band — the column already has an
implicit right edge at ~372px. The role is the single outlier, 37–58px short of
it, and it is the row that matters most.

**Proposal** — inside the existing `@media (width >= 901px)` block
(`styles.css:3741`), add:

```css
  .home-role {
    font-size: var(--text-fluid-xl);
  }
```

`--text-fluid-xl` is the adjacent rung on the fluid ramp (rule 3 satisfied by
adopting a rung, not by adding a value). At its 1.502rem cap — reached at 901px,
so constant across the whole desktop band — "PRINCIPAL DATA ENGINEER" at
`--tracking-caps` measures **373.1px against the name's 372.5px**: a 0.6px
difference, 0.16%. The column gains a flush right edge, and it gains it on the
line that most needs to be read.

- **Both themes** (rule 4): font-size only. The ink is the unchanged
  `--accent-text → --secondary-text` gradient (`styles.css:3427`).
- **Contrast** (rule 2): unchanged — 5.13:1 light / 11.45:1 dark, the figures at
  `styles.css:705`. Moving *up* the size ramp only relaxes the AA bar.
- **Motion**: none; no `prefers-reduced-motion` fallback needed.
- **Cost**: CSS-only, one declaration, ~+42 B.

**Why it must be scoped to ≥901px, and this is the part worth reading.** At the
fluid floor (1.266rem = 20.25px, in force at 320px) the same string measures
**314.4px against the 292px the column has at 320px** — it would wrap, and the
`<=430px` portrait ramp's `C` constant of 285 (`styles.css:3995`) is measured
against a one-line role. The current `--text-fluid-lg` floor gives 279.5px and
fits with 12px to spare. So the bump lives in the desktop block only; extending
it below 901px means re-measuring all three ramp tiers, which is not worth it.

Height on desktop: the role's line box goes 26.3 → 31.2px (+4.9px). The intro
column totals ~331px against a 466px portrait at the 450px cap, so the frame's
height is set by the portrait and does not move. No scroll risk.

*Side note, not a proposal:* between 901px and 1150px the shared `.hero-kicker`
rule (`styles.css:13319`) steps the disciplines line down to `--text-xs`, taking
it to 304.9px — also outside the band. That rule serves the `#about` hero too, so
correcting it is outside this review's scope.

---

### 2. The view's first motion is a shimmer on the subtitle, under a blank space where the `<h1>` will be

**`frontend/styles.css:3433`** — `animation: gradient-shift var(--motion-reveal) var(--ease-enter) 1 both;`

Read the timings off the code:

- `.home-role`'s 520ms sweep starts at first style application — no delay, no
  `.reveal` class on this section.
- `.hero-char`'s roll-up starts at `Promise.race([document.fonts.ready, 300ms])`
  plus 100ms (`js/hero-title.js:104–110`), and its last character settles at
  start + 42ms × 10 + 780ms = **+1200ms**.
- The characters sit at `opacity: 0` until then (`styles.css:2376`).

So the subordinate line completes its entrance **780–1080ms before the headline
finishes arriving**, and it plays while the name is still invisible. The literal
first thing that moves on the landing view is a shimmer on the job title, beneath
a gap.

The view already settled this argument once, in colour: the greeting was demoted
from a gradient to muted ink so that "exactly one line on the page is in accent"
(`styles.css:3368`). The same argument in motion has not been applied — two
things announce themselves, and the less important one goes first.

**Proposal** — replace the animation with its own rest state:

```css
  background-position: 0% 50%;
```

This is **pixel-identical** to what ships. `gradient-shift`'s 0% and 100%
keyframes are both `background-position: 0% 50%` (`styles.css:2295–2307`) and the
fill is `both`, so the element already paints at `0% 50%` at every moment except
during the sweep. The sweep communicates nothing about arrival — it returns to
where it started. It is a shimmer, not a reveal.

- **Both themes** (rule 4): the gradient's stops do not move.
- **Contrast** (rule 2): unchanged, because the painted colour at rest is
  unchanged — 5.13:1 light / 11.45:1 dark.
- **Reduced motion**: the blanket rule already clamps this animation to 0.001ms,
  so today's reduced-motion visitor *already sees exactly the proposed result*.
  The change makes the default path and the reduced-motion path identical, which
  is the stronger position: the fallback stops being a different page.
- **Cost**: CSS-only, one declaration swapped for one, **−40 B**.
  `@keyframes gradient-shift` stays alive for `.section-title`
  (`styles.css:4136`), so nothing is orphaned.

*The alternative, named and declined:* delaying the sweep so it lands after the
name settles. That needs a delay past 1300ms, and `--motion-*` are durations —
`docs/DESIGN.md` §Motion is explicit that reaching for `--motion-page` or
`--motion-reveal` "because the number looked close is the mistake this note
exists to prevent." It would cost a sixth named-for-one-job token. Removal costs
nothing and needs none.

---

### 3. The largest type on the site is the one heading set off the leading ramp's own annotation

**`frontend/styles.css:3399`** — `line-height: var(--leading-snug);`

The tokens carry their own assignment:

```
--leading-tight: 1.15;   /* >= --text-4xl */      styles.css:237
--leading-snug:  1.3;    /* --text-lg .. --text-3xl */   styles.css:239
```

`.home-name` is `--text-hero`, which spans 32.44px (`--text-5xl`) to 64.8px — it
is **above `--text-4xl` at every viewport width**, and it is on `--leading-snug`
at all of them. The precedent is already in the file: `.contact-title` at
`--text-fluid-4xl` (46.1px) uses `--leading-tight` (`styles.css:4852`). The name
is 40% larger than that and set looser.

On a one-line heading the excess leading is not rhythm, it is box height: 19.4px
of it, pushing every row below the name down.

**Proposal** — `styles.css:3399`:

```css
  line-height: var(--leading-tight);
```

- **Payoff is negative height**: 64.8 × 0.15 = **9.7px reclaimed on desktop**,
  4.9px at the 320px floor — given back to the no-scroll budget at exactly the
  widths where it binds.
- **Nothing clips.** The face's natural content box is 1.26em (hhea 1038/−222 at
  1000 upm), so 1.15 gives −0.055em of half-leading per side. `.home-name`
  carries `padding: 0.22em 0.1em` — 14.3px at 64.8px — with `overflow: visible`,
  and `.hero-char` is `overflow: visible` with its padding and negative margin
  cancelling. The roll-up's `translateY(115%)` / `−8%` travel is unaffected.
- **Both themes** (rule 4): a metric, not a colour.
- **Contrast** (rule 2): unchanged — `--text` on `--bg` measures 17.05:1 flat,
  15.31:1 as the stylesheet measures it over the frame (`styles.css:690`).
- **Motion**: none.
- **Cost**: CSS-only, one token swapped for another of the same length, **0 B**.

**Declined in the same breath:** `--tracking-tight` (−0.02em) is the conventional
move at 64.8px and this review argues *against* it here. It would pull the name
from 372.5px to ~358px and break the ~372px right edge finding 1 is buying. The
name stays on `--tracking-normal`.

---

### 4. The name's rest glow is a bloom on dark and a 1.04:1 stain on light

**`frontend/styles.css:2356`** and **`frontend/styles.css:2399`** —
`filter: drop-shadow(0 0 18px var(--accent-soft));` on `.hero-char`, and again on
`.hero-char.kinetic-settled`.

The theme bootstrap follows `prefers-color-scheme` (`index.html:247`), so this is
not a state some visitors reach — it is the state roughly half of them arrive in,
on the LCP element, at first paint.

`--accent-soft` is `hsla(64,60%,53%,0.15)` light and `hsla(64,60%,55%,0.20)` dark.
At the shadow's densest — immediately beside a stem, ~50% of source alpha through
an 18px Gaussian — the halo composites against each theme's `--bg` as:

| Theme | Halo vs `--bg` | Reads as |
| :--- | ---: | :--- |
| light | **1.04:1** | a 3.5% luminance drop in a citron hue, around near-black glyphs on near-white |
| dark | **1.19:1** | five times the effect, in the direction that reads as emitted light |

On dark the comment's claim holds — it is what lifts the name off the ground. On
light it is not light at all; it is a warm ring in the whitespace. One declaration
is serving two themes that need opposite treatment, which is rule 4 unresolved.

The stylesheet has already made exactly this correction once, with the themes
swapped: `body.dark-theme .home-portrait picture { filter: none; }`
(`styles.css:3233`), because the warm drop-shadow tuned to the cream ground is
"invisible-to-muddy on near-black." And this is the surviving instance of a
failure the region diagnosed and removed twice — the portrait's radial wash went
because "it read as a warm stain sitting behind him rather than as light"
(`styles.css:3039`).

**Proposal** — one rule, added beside the portrait's counterpart:

```css
body:not(.dark-theme) .home-name .hero-char:not(.is-hovered) {
  filter: none;
}
```

Specificity (0,4,1), which clears both the base `.hero-char` (0,1,0) and
`.kinetic-settled` (0,2,0), while `:not(.is-hovered)` leaves the hover glow at
`styles.css:2403` untouched — the pointer feedback survives intact.

- **Both themes** (rule 4): this *is* the rule-4 repair. Dark is unchanged.
- **Contrast** (rule 2): removing a decorative halo from around `--text` on
  `--bg` cannot lower a ratio. 17.05:1 flat / 15.31:1 over the frame, unchanged;
  local contrast at the glyph edge only rises.
- **Motion**: not a motion change, and consistent with what the reduced-motion
  visitor already sees — the blanket rule sets `.hero-char { filter: none
  !important }` (`styles.css:7371`).
- **Cost**: CSS-only, one rule, ~+68 B. Also drops eleven per-character
  drop-shadow paint passes from the light theme's LCP view.

---

## A longer look

### 5. The action row floats between two gaps that differ by 3.5px

**`frontend/styles.css:3456`** — `.home-kicker { margin-bottom: clamp(12px, 2.5vh, 24px); }`
**`frontend/styles.css:3585`** — `.home-socials { margin-top: clamp(16px, 3vh, 26px); }`

At 1440×900 those resolve to 22.5px above the pills and 26px below them. The
column's gap sequence reads **6 / 14.3 / 10.8 / 22.5 / 26** — the two largest
gaps are adjacent and 3.5px apart, which is below the threshold at which a
difference reads as intentional. The CTA row gets no more lead-in than the
disciplines line above it, and the icon row is not tucked under it as a
subordinate cluster; both float at the same distance. The row that is the
column's destination is the row with no grouping.

Separately, `26px` is not on the 4px ramp (2/4/6/8/12/16/24/32) and is not one of
the four sanctioned hero exceptions (10/14/18/22, `docs/DESIGN.md` §Spacing). It
is a literal outside both.

**Proposal** — two declarations, all four endpoints on the ramp:

```css
  .home-kicker  { margin-bottom: clamp(16px, 3.4vh, 32px); }  /* --space-lg → --space-2xl */
  .home-socials { margin-top:    clamp(12px, 2vh,  16px); }   /* --space-md → --space-lg  */
```

The sequence becomes 6 / 14.3 / 10.8 / **30.6** / **16** at 1440×900 — a 1.9:1
ratio around the action row, which is legible as grouping. The pills get the
column's largest gap; the icon row tucks under them at 16px against the row's own
14px internal gap, so it reads as their satellite rather than as a fourth rank.

- **Height is neutral to negative at every viewport**, which is what makes this
  safe against the no-scroll promise:

  | Viewport | Net change |
  | :--- | ---: |
  | 320×568 (the binding case) | **+0.06px** |
  | 390×844 | −1.7px |
  | 1440×900 | −1.9px |
  | 1920×1080 | −2.0px |

  The three mobile ramp constants (`calc(82dvh - 285/300/331px)`,
  `styles.css:3995–4011`) do not move: the binding case changes by 0.06px, and
  each tier is measured at its widest member as worst case, so every viewport
  inside it has slack.
- **Rule 3**: four ramp rungs replacing two rungs and one off-ramp literal.
- **Both themes** (rule 4) and **contrast** (rule 2): metrics only, no colour
  touched.
- **Motion**: none.
- **Cost**: CSS-only, two declarations of identical length, **0 B**.

---

### 6. The greeting outranks the line that carries the information

**`frontend/styles.css:3377`** — `font-weight: 700;`

"Hello, I'm" is 78.5px of the column's first row, set uppercase at
`--tracking-caps` in weight 700 — the same eyebrow treatment
`.skill-group-label` and the section labels use for real labels
(`styles.css:5937`). A content-free pleasantry is dressed as a label, so the
eye's first stop in the reading column resolves to nothing.

It gets worse at the bottom of the range. In the `@media (width <= 380px)` block
(`styles.css:4033`) the disciplines line drops two rungs to `--text-2xs`
(11.25px) to stay on one line — the ramp's bottom rung, annotated "counters, dot
labels." The greeting stays at `--text-xs` (12.64px). So on the smallest phones
**the pleasantry is set larger than the line naming the four disciplines**, at
exactly the width where space is scarcest.

**Proposal** — two declarations:

```css
/* styles.css:3377 */
  font-weight: var(--weight-semibold);

/* inside @media (width <= 380px), styles.css:4033 */
  .home-greeting {
    font-size: var(--text-2xs);
  }
```

`--weight-semibold` (600) is an existing rung and also retires a `700` literal
where `--weight-bold` is the token. `--text-2xs` puts the greeting level with the
kicker rather than above it, restoring the order.

- **Height**: the ≤380px rule takes the greeting's line box from 20.2px to 18.0px
  (inherited `--leading-body` 1.6), giving back **2.2px** at the tightest widths.
- **Both themes** (rule 4): weight and size, not colour.
- **Contrast** (rule 2): `--muted` on `--bg` measures 8.48:1 flat / 7.81:1 over
  the frame (`styles.css:689`). Neither weight nor a step down the ramp moves a
  ratio, and 11.25px is below the large-text threshold either way, so the 4.5
  bar applies before and after with 1.7× of headroom.
- **Motion**: none.
- **Cost**: CSS-only, two declarations, ~+59 B.

---

### 7. The icon row's grouping is argued at length and painted at 1.31:1

**`frontend/styles.css:3715`** — `.home-socials-divider { background: var(--border); }`

The row's entire structure — in-site routes, then outbound profiles, then the
shuffle, which is not a destination at all — rests on two 1px × 24px marks. I
measure `--border` composited over `--bg` at **1.31:1 light and 1.44:1 dark**.

Those are the stylesheet's own two figures, published forty lines above, in the
note that *rejects* `--border` for exactly this job: "a hairline meant for the
edge between two surfaces, not for the outline of a control" (`styles.css:3655`).
The argument was made about `.home-social--action`'s ring and not carried across
to the dividers beside it.

The result is that seven controls read as one undifferentiated run, and
`index.html:841` and `index.html:873` carry fourteen lines of comment explaining
a grouping the eye cannot see. A divider that groups controls is closer to a
control's boundary than to a surface edge.

**Proposal** — `styles.css:3715`:

```css
  background: var(--control-border);
```

- **Contrast** (rule 2): measured **4.55:1 light / 4.00:1 dark** — matching the
  figures at `styles.css:3678`, up from 1.31 / 1.44. It stays the quietest mark
  in the row: the accent rings beside it measure 5.52:1 light / 13.05:1 dark, and
  the shuffle's own ring 4.89:1 / 6.12:1. Nothing here is required to clear a
  bar — a divider is decorative — but a grouping device below 3:1 is a grouping
  device that does not exist.
- **Both themes** (rule 4): `--control-border` is defined in both
  (`styles.css:92`, `styles.css:489`).
- **Motion**: none.
- **Cost**: CSS-only, one token swapped, **+8 B**.

---

### 8. The frame's specular falloff dies 40% of the way down the panel

**`frontend/styles.css:755`** — `--hero-frame-sheen: radial-gradient(120% 78% at 16% -8%, var(--sheen-wash) 0%, transparent 62%);`

Worked at 1440×900 with the frame at roughly 1170×560: the vertical radius is
0.78 × 560 = 437px, measured from an anchor 45px *above* the panel's top edge, so
the `62%` stop lands **226px into a 560px panel**. Everything below the name —
the role, the disciplines line, both pills and the whole icon row — falls outside
the ellipse. Computed exposure at the icon row is **zero**. The panel has a
specular highlight across its top third and is a flat tint below that.

This matters more than it would on a card, because it compounds with where the
ground is thinnest. `--backdrop-scrim` is a radial aperture, 92% `--bg` at centre
falling to 78% at the margins (`styles.css:78–82`), and it is centred on the
**viewport** — `.site-backdrop` is `position: fixed`. The reading column sits on
the frame's *right* half. At 1440×900 the wash under the name works out at ~87%
and under the icon row ~85.5%, not the 92% the `--hero-frame-bg` note measures at
(`styles.css:678`). So the right half of the frame is simultaneously the thinnest
wash, no sheen, and all of the type — while the left half, which has a
photograph on it and needs no protection, gets both.

**Proposal** — extend the vertical radius only:

```css
  --hero-frame-sheen: radial-gradient(120% 128% at 16% -8%, var(--sheen-wash) 0%, transparent 62%);
```

The radius becomes 717px, so the `62%` stop lands 400px into the panel —
**71% of the way down** rather than 40%. The falloff now crosses the surface,
which is what the comment at `styles.css:749` claims it does, and still stops
short of the icon row. The upper-left anchor and the directional story are
untouched.

- **Rule 3**: one geometry value on an existing gradient. No token added and no
  literal placed on a design scale — this stylesheet already treats gradient
  geometry as geometry (`top: -6%`, `width: 88%` on the paint panel; the scrim's
  own `75% 65%`).
- **Both themes** (rule 4): `--hero-frame-sheen` is declared once on `body` and
  `--sheen-wash` carries the theme difference — `--accent-soft` light,
  `rgba(255,255,255,0.10)` dark — so one edit covers both.
- **Contrast** (rule 2) — **this is the one proposal in the set with a contrast
  cost, and it is measured.** The binding line is `.home-kicker` at 5.13:1 light,
  the figure `styles.css:705` names as the one to re-measure against. At the
  kicker's position the change adds at most 0.0165 alpha of `hsl(64,60%,53%)`,
  taking it to **5.10:1** — AA holds with 13% headroom against 14% today. The
  name goes 15.31 → ~15.2:1. Dark: 11.45 → ~11.27:1, against enormous headroom.
- **Declined:** the more obvious fix — pushing the stop to `transparent 100%` as
  well — costs the kicker **5.13 → 5.01:1**. That spends most of the headroom the
  stylesheet explicitly flagged, for a wash you would struggle to see. Not worth
  it.
- **Motion**: static, as the intent requires.
- **Cost**: CSS-only, one value, **+1 B**.

---

### 9. The frame's lit edge is symmetric, so it cannot read as directional

**`frontend/styles.css:738–743`** (light, on `body`) and **`frontend/styles.css:567–571`** (dark) —
`--hero-frame-rim: linear-gradient(150deg, var(--accent-mild) 0%, var(--accent-soft) 38%, var(--accent-soft) 62%, var(--accent-mild) 100%);`

The comment at `styles.css:3841` says the ramp is "brightest at the two ends and
dimmest across the middle, so the frame reads as catching light from the upper
left." A ramp equally bright at 0% and 100% is a **specular rim** — light
wrapping both edges — not a directional one. Lighting from the upper left makes
the lower right the shadow side. The declaration and its own stated intent
disagree.

And the sheen *is* directional from the upper left
(`radial-gradient(... at 16% -8% ...)`, `styles.css:755`), so the rim's bright
lower-right corner puts a highlight exactly where the sheen says shadow. The two
lighting cues on the same surface point in different directions.

**Proposal** — make both ramps monotonic:

```css
/* styles.css:738 — light, on body */
  --hero-frame-rim: linear-gradient(150deg,
      var(--accent-mild) 0%,
      var(--accent-soft) 62%,
      transparent 100%);

/* styles.css:567 — dark, on body.dark-theme */
  --hero-frame-rim: linear-gradient(150deg,
      var(--accent-fill) 0%,
      var(--accent-soft) 60%,
      transparent 100%);
```

Top-left corner brightest, bottom-right falling away, top and left edges above
mid, bottom and right below — which is what upper-left lighting looks like, and
what the sheen is already doing.

- **Rule 3**: two existing accent-ramp tokens and one keyword. One stop removed
  from each gradient, so bytes go down. (`transparent` interpolates in
  premultiplied alpha, so the ramp does not grey out toward the corner.)
- **Both themes** (rule 4): both token blocks carry the same symmetry today and
  both are edited. The dark theme keeps its brighter `--accent-fill` start, per
  the note at `styles.css:546` about the dark ground carrying a real rim where
  the cream ground carries a hairline.
- **Contrast** (rule 2): the rim is decorative and is *not* the frame's control
  boundary. That is the real `border: 1px solid var(--hero-frame-edge)`
  (`styles.css:3803`), which stays at `--accent-mild` in both themes and is
  untouched — so nothing carrying a ratio changes, and the frame's outline
  survives all the way round at unchanged strength.
- **Motion**: static, as the intent requires. `forced-colors: active` already
  drops `.home-hero::before` entirely (`styles.css:7463`), so that fallback is
  unaffected.
- **Cost**: CSS-only, two token edits, **−60 B**.

---

## States only some visitors reach

### 10. The wand's meaning is hover-only, and its reversibility is invisible

**`frontend/index.html:885–888`**; styling **`frontend/styles.css:3685`**.

The icon row's other six controls are self-describing to a sighted pointer user:
an envelope, a labelled "Ask AI" pill, and the LinkedIn and GitHub brand marks.
`fa-wand-magic-sparkles` is not. Its meaning lives in `title` — hover-only, and
absent entirely on touch — and in `aria-label`, which reaches assistive
technology. And the fact that a palette roll undoes itself on reload lives only
in the `sr-only` status line. The markup says so outright: "the fact that it
undoes itself on reload is not discoverable at all" (`index.html:893`).

So the assistive path carries information the visual path does not. The person
who pays is the sighted visitor who presses it out of curiosity, gets a palette
they did not want, and has to find Reset inside the header dropdown.

**No in-remit fix; flagged.** Finding 7 does most of the available work — making
the second divider visible at 4.55:1 puts the control in a group of its own, so
it reads as a utility rather than as a fourth route, which is what the row's
comment intends. Beyond that, giving it a visible label the way
`.home-social--labeled` gives one to Ask AI is a markup change *plus* a
re-measured collapse band: the row is already within 2px of the viewport at
381px, and `styles.css:4088` records the full measurement across 380–412px. That
is a decision for the owner, not for a read-only review, so it is named here
rather than proposed.

---

## Cosmetic only

### 11. A `6px` literal where the ramp has the rung

**`frontend/styles.css:3375`** — `.home-greeting { margin: 0 0 6px; }`

6px is `--space-xs` exactly (`styles.css:366`). Rule 3.

```css
  margin: 0 0 var(--space-xs);
```

No visual change whatsoever — it is the same six pixels. Both themes, no
contrast, no motion. **Cost: CSS-only, +13 B.**

*Left alone deliberately:* `.home-socials { gap: 14px; }` (`styles.css:3584`) and
`.home-hero { gap: clamp(18px, 3vh, 30px); }` (`styles.css:3929`). 14px and 18px
are two of the four sanctioned hero exceptions in `docs/DESIGN.md` §Spacing.
Noted only so the next reader does not "fix" them.

---

## Checked and found sound

Things this review measured and is *not* reporting, so the next pass does not
repeat the work:

- **Typographic detail the brief asks about, where it does not apply.** There are
  **no numerals anywhere in `#home`**, so numeral alignment is moot. **Widows
  cannot occur**: the name is one unbreakable line (`.hero-word-space` is a
  non-breaking span), the role carries `text-wrap: balance`, and the disciplines
  line is held to one row by breakpoint. **Measure is not binding**:
  `.home-intro { max-width: 34rem }` is 544px against a longest line of 372.5px.
- **The pill row and the circle row share an optical left edge.** `.home-btn` is
  `--radius-full` and `.home-social` is `border-radius: 50%`, so both present an
  identical 22px cap at the alignment line on the desktop left-aligned column. A
  flat-edged pill above a circle row would have read as a 6–8px indent. It does
  not.
- **The portrait's horizontal centring is not actionable.** Three reasonable
  measures of "where the figure is" disagree: full alpha extent puts its midpoint
  at 0.4995 of the box (dead centre), the 90%-of-masked-mass extent at 0.4535,
  and the alpha-mass centroid at 0.422. Any correction tuned to one overcorrects
  against another, so there is no confident proposal here — and the stylesheet's
  own `left: 46%` on the paint panel (`styles.css:3141`) already records a
  deliberate refusal to split this difference for the same reason.
- **The disciplines line's two-rung drop at ≤380px is the right call.** Letting
  it wrap costs 26px of overflow (`styles.css:4043`). Findings 3 and 6 give back
  4.9 + 2.2 = 7.1px at that width, which is not enough to change the answer.

## Not a declaration-level finding, but the one thing a hiring manager will notice

The view says *who* (a name), *what* (a title), and *what domains* (four chips).
It does not say what has been built, at what scale, or with what result. For the
persona named in the brief — a technical leader reading cold for five seconds —
the hero is a correctly-ranked, well-set identity card with no claim on it.
Fixing that is copy, and copy is more than this review's own markup, so it is
recorded here rather than proposed. Finding 1 is the cheapest partial answer:
making "Principal Data Engineer" the second-largest thing on the page instead of
the fifth is most of what a five-second read has to work with today.
