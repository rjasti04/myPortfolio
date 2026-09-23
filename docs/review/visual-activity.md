# Visual & Interaction Review — `#activity`

Read-only. Scope is the Session Activity view only: the `#activity` markup in
`frontend/index.html` (lines 1623–1754) and its styling in `frontend/styles.css`
(the ACTIVITY SECTION region, lines 9416–10863, plus the two shared rules it
depends on). Accessibility and base-level state handling are treated as met
(`docs/review/uiux.md`, tier 2, and PR #220) and are not re-reported; where a
ratio appears below it is there because rule 2 requires every proposal to name
one, not as a finding.

This is a taste review. The question is whether the view is intuitive and
whether it is beautiful — not whether it is correct. Two defects surfaced while
rendering states for it (finding 13 and the first bullet of the last section);
they are reported because a taste review of a panel that never paints would be
empty, not because this document hunts them.

## Status: implemented

All sixteen findings shipped in `frontend/styles.css` as written, including
finding 1's optional colour/edge transition. It is all CSS: no markup, no JS,
no new asset or origin, and `index.html` is untouched. The one other file is a
comment in `frontend/tests/route-semantics.test.js` that quoted the router
selector finding 13 rescoped. The reasoning behind each change is recorded in a
comment beside it, so the next edit does not undo one by accident. That covers
the visit card's 18px top (*What already works* 1) and the filter card's 14px
sides (finding 9).

Verified after the change: `npm run lint` clean, `npm test` 639/639,
`check_csp_hashes.py` green, and `npm run build` puts CSS at **302,197 B = 295.1
of 296 KiB**. That is exactly the +1,063 B this document predicted, and it
leaves 907 B of headroom. The shipped stylesheet was then re-rendered without
any overlay and probed state by state:

- Refresh is an outline at rest and fills on the `/events` 503.
- The wires are 32px at 1440px, and the legend sits 9px under the axis.
- A pressed Navigation chip keeps its orange glyph.
- The error footer collapses to 0px.
- The bar is 118px at 1024px, and the filter row stays on one line there.
- The phone legend is a 2×2.
- All six owner cards paint on `--card-bg`, with a 17px inset, while `#activity`
  stays the only visible view.
- The loading rows show a 46px time bar and a neutral dot, and both placeholders
  run `app-media-loading`.

Still open, because it needs JS and markup rather than a declaration: the
strip's System-as-Navigation fold (the first bullet of the last section). With
it, the note in finding 5 applies: five legend items want
`repeat(3, max-content)`.

## Method

Numbers in this document are measured, not estimated.

- **Rendering** — the view was rendered in the pre-installed Chromium through
  Playwright, with `frontend/` served statically, the service worker blocked,
  and the API answered by a mock: a 14-minute, 22-event visit across seven
  sections (12 Navigation, 7 Interaction, 1 each of Preference, Contact and
  System), its `/summary`, and a seven-row `/funnel`. Error, empty, loading and
  owner states were rendered from the same mock with the relevant endpoint
  failing, empty, delayed by 6s, or answering `/admin/analytics/*`. The live
  pill was set to `connected`, which is what production shows once the
  EventSource opens.
- **Geometry** — `getBoundingClientRect()` at 1920×1080, 1440×900, 1366×768,
  1024×768, 901, 390×844 and 360×800. Glyph ink tops are computed from canvas
  `measureText()` in the page's own font, not from box edges.
- **Contrast** — WCAG relative luminance, compositing alpha layers first:
  `--surface` onto `--bg` to get the card face, then washes onto the card. This
  reproduces the stylesheet's published pairs to within the card/ground
  difference (`--accent-fill` 1.69:1 on the light card against the 1.62:1 it
  publishes on `--bg`; `--accent-text` 5.76 against 5.52), so figures below are
  comparable with the ones already in the comments. They are card-relative,
  because every surface in this view is a card.
- **Budget** — `npm run build` on the current tree: **CSS 301,134 B = 294.1
  KiB of 296 KiB, 1,970 B of headroom**; JS 381.9 of 390 KiB. The brief cites
  300/240 KiB, which is also what `docs/DESIGN.md` §"Enforced by" still says;
  `scripts/build.mjs:177` has been `{ js: 390, css: 296 }` for a while. The
  numbers that bind are 390/296, and 1,970 bytes is what every proposal below
  has to fit inside.
- **Byte costs** — each proposal was applied to a copy of `styles.css` and
  both copies were minified with the repo's own esbuild; the figure is the exact
  difference. With every proposal applied at once the stylesheet still passes
  `stylelint` (exit 0).

---

## Standing visual decisions this review does not reopen

| Decision | Where it is recorded |
| :--- | :--- |
| The circuit schematic is the site's ground, tinted by `--backdrop-tint` and washed by `--backdrop-scrim` | `.claude/intents/2026-09-17-circuit-backdrop-redesign.md`; `docs/DESIGN.md` §Colour |
| Phones lose `.site-backdrop`; the card faces are the only ground there | circuit-backdrop intent §4; `styles.css:8131` |
| The hero glass frame belongs to `#home` alone — one decoration per layout | `.claude/intents/2026-09-20-hero-glass-frame.md` §1. It does not appear on this view, which is why no finding touches it |
| Content sits on opaque card faces, never on the drawing | `.claude/intents/2026-09-16-opaque-stats-and-skills.md`; `.act-card` at `styles.css:9426` |
| Three zones in reading order: who you are right now, the shape of the visit, then the log | `styles.css:9417`; `index.html:1627`, `:1672`, `:1717` |
| Exactly one card elevation (`--elev-1`); hierarchy is carried by size and position | `styles.css:9420`, `:9426–9431` |
| The four pipeline stages are context, drawn as a chain of labelled dots, not a card | `index.html:1627–1630`; `styles.css:9621` |
| The chain's pulse runs only while the Browser stage is passing traffic | `styles.css:9680` |
| Three control tiers — fill, toggle, utility — and the tier is the whole vocabulary | `styles.css:9517`; PR #220 |
| Refresh is the tier-1 control | `styles.css:9517`; PR #220. **Finding 1 argues against half of this — flagged there** |
| The session UUID is shown in full on desktop and truncated to 14ch at ≤640px | `styles.css:9605`, `:10640` |
| Five event-family hues, `sys` the only neutral, each AA on `--surface` | `styles.css:132–149`; `docs/DESIGN.md` §Colour |
| The family chips are the filter and the type breakdown in one surface | `index.html:1717`; `styles.css:10146` |
| The payload toggle is visible at rest, at 0.7 | `styles.css:10393` |
| The session is fetched once and filtered locally, so every strip bar is a filter | ADR-020 |
| The owner panel is set apart by a rule and its own heading, and built only for the owner | `index.html:1740`; `styles.css:10709` |
| An error is not an empty state; failure has its own treatment | `styles.css:10531` |
| 10/14/18/22px are sanctioned activity-region spacing exceptions | `docs/DESIGN.md` §Spacing. **Finding 9 moves four 18px and two 14px insets onto the ramp — flagged there** |
| `.section-title` and `.section-lede` are shared primitives, not this view's | `styles.css:4300`, `:4332` — out of scope |

The circuit backdrop and the hero glass frame are decisions. Nothing below
lowers the scrim, adds a decoration, or puts content back onto the drawing.

---

## What already works

**1. The optical top line of zone 2 is right, and it is right on purpose.**
The two cards in zone 2 carry *different* top padding — `.act-visit` 18px
(`styles.css:9794`), `.act-paths` 16px (`:9992`) — which reads like drift. It is
not. The visit card opens on a 29.6px figure at `line-height: 1`; the paths card
opens on a 16px title with a 25.6px line box. Measured, the ink top of "22" sits
at y=352.7 and the ink top of "Where you went" at y=354.2: **1.5px apart**.
Unify the padding and they move to 3.5px apart. The two numbers compensate for
two leadings, and they should stay exactly as they are.

**2. The stream pulse is gated on real traffic, and its easing tells the truth.**
`act-chain-flow` specifies `transform` only at 0%, 38% and 100%
(`styles.css:9736`), so `--ease-standard` applies across the whole 0→38% run:
the packet leaves fast and decelerates into each node, which is what arriving
looks like. It runs only while `#act-stage-browser` reads `ok`/`warn` — a stream
pouring out of a browser that has captured nothing would be the one invented
signal on a card of measurements. The motion is honest; finding 2 is only about
how little of it can be seen.

**3. Numerals are set for a live page.**
Every figure that changes while the visitor watches — the ticking "14m 23s"
clock, the latency, the path hits and shares, the chip counts, the axis, the
status line — is `tabular-nums`, and the path share sits in a fixed 34px column
(`styles.css:10053`). A counter that re-flows its neighbours every second is the
commonest way a live dashboard looks cheap, and this one does not. The two
places that miss are findings 13 and 15, and neither is on a figure that ticks.

---

## Summary

Ranked by first-impression weight: what a first-time visitor sees before
scrolling, then what a longer look surfaces, then states only some visitors
reach. Cosmetic-only findings are last and marked.

| # | Finding | Axis | Cost |
| ---: | :--- | :--- | :--- |
| 1 | Refresh is the loudest object on a page that refreshes itself | Intuitive (primary action, state) | CSS, +305 B (+99 B optional) |
| 2 | The pipeline — the view's data-engineering claim — is drawn in 12px wires, and its pulse is 1.55:1 on light | Beautiful (hierarchy, motion) + Intuitive | CSS, +72 B |
| 3 | Every chip label is set in its family hue, and pressing one erases it | Beautiful (colour restraint) + Intuitive (state) | CSS, +10 B |
| 4 | The legend is pinned to the card floor, 39px from the axis it keys | Beautiful (rhythm) | CSS, **−17 B** |
| 5 | On a phone the legend breaks 3 + 1, widowing "Contact" under the chat button | Beautiful (type) | CSS, +66 B |
| 6 | Zone 3's internal gap is 12px against 16px between zones, so the grouping cannot be seen | Beautiful (rhythm) | CSS, 0 B |
| 7 | From 641 to 1024px the bar breaks into rows that each hold an orphan | Beautiful (rhythm, viewport) | CSS, +93 B |
| 8 | In the log, the object of every sentence recedes behind its verb | Beautiful (hierarchy) | CSS, **−1 B** |
| 9 | Down the page, content starts at three x positions | Beautiful (optical alignment) | CSS, +26 B |
| 10 | A selected strip bar is a 1.08:1 wash and a 1.69:1 underline on light | Intuitive (state) | CSS, +10 B |
| 11 | Error and empty keep a ruled footer with nothing under it | Beautiful (rhythm) | CSS, +76 B |
| 12 | The loading state's loudest marks are its least true | Intuitive + Beautiful (motion) | CSS, +255 B |
| 13 | The owner panel paints its header and nothing else — and underneath, its cards are glass on the drawing | Beautiful (depth) + a defect | CSS, +133 B |
| 14 | *Cosmetic.* Five selectors that never match, and a rule block that repeats them | Beautiful (hygiene) | CSS, **−271 B** |
| 15 | *Cosmetic.* The relative-time column is set in proportional figures | Beautiful (numerals) | CSS, +34 B |
| 16 | *Cosmetic.* The two tier-2 toggles in zone 2 move differently | Beautiful (motion) | CSS, +173 B |

**Net CSS: +1,063 B** with everything applied, including finding 1's optional
transition — 54% of the 1,970 B of headroom, leaving the stylesheet at 295.1 of
296 KiB. Finding 14 pays for most of findings 2–11. If the budget has to be
defended, finding 12's shimmer (≈190 B of its 255) and finding 16 are the
cheapest to drop for the least visible loss. No markup, no JS, no new asset, no
new origin, no inline script — `index.html` and its CSP hashes are untouched.

---

## The five-second test

The persona is a technical leader, hiring manager or peer engineer landing on
`/#activity` cold — from a shared link, or from the nav out of curiosity.

**Does the page say what it is within one screen?** Yes, and quickly. "Session
Activity" plus a one-line lede — "Everything this page has recorded about your
own visit, live — and nobody else's" — are done by y=212 on desktop and y=205 on
a 390px phone. Nobody has to scroll to learn what the view is for.

**Does the eye register what the owner specialises in?** Not first. This view is
the site's evidence, not its identity card: a real browser → FastAPI → Kafka →
Postgres pipeline, streaming the visitor's own clicks back to them. That is the
most persuasive thing on the site for this persona, and it is the quietest thing
in the bar. Ranking the first screen at 1440×900 by weight (area × contrast), a
cold eye takes:

1. the title — 36.5px gradient, top-left;
2. **Refresh** — the only filled control on the page, 109×44px at top-right,
   11.44:1 ink on a citron field that is itself 10.28:1 against the dark
   card (on light the field is 1.69:1 and the 11.16:1 ink carries it);
3. the strip — up to 48 saturated bars, 147px tall;
4. "22" in the accent;
5. the session pill — 375px, 273 of it a 36-character UUID in `--text`, the
   widest run of ink in the bar.

The chain — the proof — comes after all five: 12.6px `--muted` labels joined by
three 12×1px wires, in a pill whose right-hand neighbour is 141px of empty bar.
Attention is not diffused so much as *misdirected*: it goes to a fallback
button and a random identifier.

**Is the primary action unmistakable?** Something is — the wrong thing. There is
no recruiting CTA here and there should not be; the page's real action is
*explore your own visit*: pick a bar, a chip, a path. What reads as primary is
Refresh, on a page that is live-streamed and so never needs refreshing unless
something has failed. On a phone the effect is larger: at ≤640px Refresh becomes
a 336×48px slab, the largest filled area on the first screen (16,128 px² against
the title's 10,300).

**How does it adapt?** Well at the ends, awkwardly in the middle.

| Viewport | Bar | First screen ends at | First log row |
| :--- | ---: | :--- | :--- |
| 1920×1080, 1440×900 | 70px | inside the log card | fully visible (854–895) |
| 1366×768 | 70px | mid filter card (717–787) | below the fold |
| 1024×768 | **128px** — Refresh alone on row 2 | mid filter card | below the fold |
| 901 | **128px** — identity alone on row 1 | — | — |
| 390×844 | 180px (21% of the screen) | "Where you went" title | 1.66 screens down |
| 360×800 | 180px | lede wraps to 3 lines | 1.85 screens down |

The rhythm never *compresses* — card gaps hold at 16px everywhere — but between
641 and 1024px the bar spends a whole row on one control (finding 7), and on a
phone the first screen is a third controls. Findings 1, 2 and 4 together change
the order above to title → strip → Live pill and pipeline → Refresh, which is
the order the section's own comment asks for.

---

## The first screen

### 1. Refresh is the loudest object on a page that refreshes itself

**`frontend/styles.css:9538`** — `.act-refresh { color: var(--on-accent); background: var(--accent-fill); }` (`:9549–9550`)

**This argues against a standing decision, so it says so.** PR #220 made Refresh
the one tier-1 fill because "the section's own error copy names Refresh three
times as the way out of a failure […] so the styling was arguing with the
words" (`styles.css:9521–9524`). That reasoning is right and this finding keeps it. What it
questions is *always*: the copy names Refresh only when something has failed,
and the fill is there when nothing has.

While the stream is healthy the page updates itself — rows arrive, the clock
ticks, the chain pulses. Pressing Refresh then does nothing a visitor can see
except dim the button to 0.65 for the length of one fetch. So the heaviest
control on the view, and on a phone the heaviest *object*, is a fallback. The
brief also asks whether a state change announces itself. Today, when the stream
dies, a 9px dot changes colour and the label changes text; nothing else moves.

**Proposal** — Refresh wears the outline by default and fills the moment any
surface in the section reports a failure. After `.act-refresh:disabled`
(`styles.css:9563`):

```css
/* At rest Refresh wears the outline. The stream keeps this page current, so
   while nothing has failed the page's one fill would be advertising a
   fallback. It fills again the moment any surface here reports an error -
   which is exactly when that surface's copy says "use Refresh". */
#activity:not(:has(#act-live[data-status="error"], [data-state="error"])) .act-refresh {
  color: var(--accent-text);
  background: transparent;
  border-color: var(--control-accent-border);
}

#activity:not(:has(#act-live[data-status="error"], [data-state="error"])) .act-refresh:hover:not(:disabled) {
  background: var(--accent-soft);
}
```

`[data-state="error"]` is the attribute both failure surfaces already set —
`.act-stream` (`activity.js`, `paintStream`) and `.act-paths-empty`
(`activity-charts.js`, `renderPaths`) — and `#act-live[data-status="error"]` is
the stream giving up. So the fill returns in exactly the three cases whose copy
says "use Refresh", and in no others. It is keyed to *failure*, not to
`connected`, on purpose: keyed to `connected`, every page load would open with a
filled button that fades to an outline a few hundred milliseconds later.

This keeps "exactly one fill on the page" — it becomes "at most one, and only
when it is the way out". The one-fill rule survives its own hover state too,
the way `#home`'s did: the outline's hover takes `--accent-soft`, not
`--accent-hover`, so hovering the resting control never fills it.

*Optional, +99 B:* add `color` and `border-color` to the transition list at
`styles.css:9554`, so the flip from outline to fill cross-fades as one piece
rather than fading its field under an ink that snaps.

- **Tokens** (rule 3): `--accent-text`, `--control-accent-border`,
  `--accent-soft` — all existing, all on `body`, so the customiser carries them.
- **Both themes** (rule 4): `--control-accent-border` is already theme-split —
  `--accent-text` on light (`styles.css:616`), `--accent-fill` on dark (`:504`)
  — which is exactly the pair an outline edge needs.
- **Contrast** (rule 2): at rest, ink goes 11.16 → **5.76:1** light and 11.44 →
  **11.52:1** dark; the edge is **5.76:1** light / **10.28:1** dark (the fill it
  replaces is a 1.69:1 field on the light card); hover ink 5.34 / 7.24. The
  failure-state fill is untouched: 11.16 / 11.44.
- **Motion**: the existing 120ms `background-color` transition carries the
  flip; the blanket `prefers-reduced-motion` rule already reduces it to an
  instant change.
- **Cost**: CSS-only, **+305 B** (+99 B with the optional transition).

Verified in render: outline at rest, connecting and connected; filled with the
stream error, the `/events` 503 and the paths failure; the hover never fills.

---

### 2. The pipeline — the view's data-engineering claim — is drawn in 12px wires, and its pulse is 1.55:1 on light

**`frontend/styles.css:9699`** — `.act-chain-link { width: 12px; height: 1px; }` (`:9701`);
pulse at **`:9712`** — `background: linear-gradient(90deg, transparent, var(--accent-fill), transparent);`

The chain is the one element on the view that says what the owner builds, and
its geometry reads as a separator rather than a pipe. Each link is 12px of 1px
hairline; the "packet" is the link's own width, so it travels 24px in 0.99s —
24px/s, a flicker rather than a movement. And on the light theme the packet is
`--accent-fill` on the chain's `--wash-raise` pill: **1.55:1**, on a 1px line.
The motion praised in *What already works* 2 is, on light, invisible.

Meanwhile the desktop bar has room it does not use: from 1280px up (where
`main` reaches its cap and the bar stops changing width) there are 141–150px of
empty bar between the chain and Refresh — at 1440px the chain ends at x=1036 and
Refresh starts at x=1178.

**Proposal** — two declarations.

```css
/* styles.css:9712 */
  background: linear-gradient(90deg, transparent, var(--control-accent-border), transparent);

/* new, before @keyframes act-chain-flow (styles.css:9736) */
@media (width >= 1280px) {
  .act-chain-link {
    width: var(--space-2xl);
  }
}
```

At 32px (`--space-2xl`, the top rung of the spacing ramp) the chain grows from
370 to 430px and the dead run shrinks to 81px. The packet travels 64px in the
same 0.99s — 65px/s, which reads as something moving *through* the stages.
`Browser ——— API ——— Kafka ——— Postgres` reads as a pipeline at a glance.

**Why ≥1280px and not wider.** Below 1280 the bar's one-line fit is tight:
measured at 1180px, the one-line layout has 45px of slack, and 60 more pixels of
wire would push Refresh onto a row of its own. ≥1280 is measured safe with the
longest live label ("Not live · use Refresh", identity 548px): 1,115px needed of
1,134 available. 1280px is an existing breakpoint (`styles.css`, one use) and
`main`'s own cap, so no new literal.

- **Both themes** (rule 4): the pulse token is the theme-split one from finding
  1 — on dark it resolves to `--accent-fill` exactly as today.
- **Contrast** (rule 2): pulse 1.55 → **5.28:1** light, 8.71:1 dark unchanged.
  The wire itself stays `--border` (1.30 / 1.54) — it is meant to match the
  backdrop's hairlines, and it does.
- **Motion**: duration, delay and easing unchanged (`--act-flow-cycle` 2.6s,
  `--ease-standard`); only the distance grows. Still gated on Browser traffic,
  still capped to one near-instant iteration by `prefers-reduced-motion`, and
  still parked off-track when paused.
- **Cost**: CSS-only, **+72 B**.

---

### 3. Every chip label is set in its family hue, and pressing one erases it

**`frontend/styles.css:10180–10198`** — `.act-fam[data-family="nav"] { color: var(--fam-nav); }` and four siblings

Two things, one fix.

**At rest**, the filter row is the most saturated line of *text* on the view:
five labels in five hues, each with an icon in the same hue, a few inches under
a strip that already uses those hues as its whole vocabulary and a legend that
names them. The legend — swatch plus `--muted` label — is the calmer way this
same page already solves the same problem.

**When pressed**, the hue disappears. `.act-fam[aria-pressed="true"]`
(`styles.css:10208`) sets `color: var(--text)` at the same specificity (0,2,0)
as the `[data-family]` rules, and comes later, so it wins — and the icon
inherits `currentColor`. A pressed Navigation chip is white text and a white
compass on an accent wash: identical to a pressed "All". The comment above the
pressed rule says the opposite — "The family hue stays on the chip's own text
via the [data-family] rules above" — but that is not what renders (confirmed in
both themes).

**Proposal** — move the hue from the label to the glyph. Five selectors gain
` i`:

```css
.act-fam[data-family="nav"] i {
  color: var(--fam-nav);
}
/* ...tap, pref, reach, sys likewise */
```

At rest each chip becomes a hued mark on a `--muted` label, like the legend.
Hover still lifts the label to `--text` (`styles.css:10164`). Pressed still
changes fill, border, ink and weight together — and now the family glyph
survives it, which is what the comment always intended. Correct that comment to
say the hue lives on the icon.

- **Both themes** (rule 4): every `--fam-*` is already theme-split.
- **Contrast** (rule 2): labels go from 4.98–7.55:1 light / 6.26–11.29:1 dark to
  **8.85 / 11.47:1** (`--muted` on the card) — every chip gains. The glyphs keep
  their family ratios on the card (4.98–7.55 / 6.26–11.29) and hold
  **4.61–6.99 / 3.93–7.10:1** on the pressed `--accent-soft` wash, all above the
  3:1 a non-text mark needs.
- **Motion**: none added; the shared pill's 120ms colour transition still runs.
- **Cost**: CSS-only, **+10 B**.

---

### 4. The legend is pinned to the card floor, 39px from the axis it keys

**`frontend/styles.css:9853`** — `.act-timeline-plot { flex: 1; min-height: 92px; max-height: 150px; }` (`:9859`);
**`:9913`** — `.act-key { margin: auto 0 0; }` (`:9917`)

Zone 2's cards stretch to one height, and the paths card sets it. The visit
card's spare height has two places to go: the plot, which is `flex: 1` but
capped at 150px, and the legend's auto top margin. The plot hits its cap, so the
rest lands between the axis and the key. At 1440×900 the plot sits 8px above its
axis labels and the legend **35px below them (39px to the swatches)** — the key
reads as a separate object. The gap is not a design value; it is whatever the
neighbouring card leaves over. A thorough visitor who reaches all eight sections
gets the funnel's full eight rows (`limit` defaults to 8,
`server/controllers/event_controller.py:343`), 44.7px more paths card, and a
**~84px** gap.

**Proposal** — delete one declaration:

```css
/* styles.css:9859 — remove */
  max-height: 150px;
```

The plot then absorbs all of the slack: 150 → **177px** at 1440×900 (≈222px at
eight paths), and the legend sits 9px under its axis at every height — the same
distance the axis keeps from the plot. The strip becomes the dominant figure of
the zone, which is what it is. The height is bounded by the funnel's row limit,
so the cap was guarding a case that cannot occur. At ≤900px, where the cards
stack, the visit card sets its own height and the plot stays at its 92px floor —
unchanged.

- **Both themes** (rule 4): layout only.
- **Contrast** (rule 2): unchanged — the swatches keep their family ratios.
- **Motion**: none.
- **Cost**: CSS-only, **−17 B**.

---

### 5. On a phone the legend breaks 3 + 1, widowing "Contact" under the chat button

**`frontend/styles.css:9913`** — `.act-key { display: flex; flex-wrap: wrap; gap: var(--space-sm) var(--space-lg); }`

At 390px the four items need 354.6px (79.6 + 80.2 + 82.1 + 64.7 + three 16px
gaps) in a 332px row, so "Contact" drops to a line of its own — a typographic
widow in a four-word list. The first row also runs under the chat launcher
(x 310–370). No gap value fixes it robustly: 12px still needs 342.6, and 8px fits
390 by 1.4px and fails at 360.

**Proposal** — inside the existing `@media (width <=640px)` block
(`styles.css:10615`), after `.act-stat-value`:

```css
  .act-key {
    display: grid;
    grid-template-columns: repeat(2, max-content);
  }
```

Two columns of 82.1 and 80.2px plus the existing 16px column gap: **178px**, a
balanced 2×2 at every width from 320px up. The row gap is the existing 8px, so
the block stays **52.4px tall — the same height as today's two ragged lines**.
Its right edge lands at x=207, clear of the chat launcher.

*Forward note:* if the legend ever gains its missing System item (see the last
section), use `repeat(3, max-content)` — 278px, which fits at 360 and above but
not at 320.

- **Both themes** (rule 4): layout only. **Contrast** (rule 2): unchanged.
- **Motion**: none.
- **Cost**: CSS-only, **+66 B**.

---

### 6. Zone 3's internal gap is 12px against 16px between zones, so the grouping cannot be seen

**`frontend/styles.css:10103`** — `.act-filters { margin-bottom: var(--space-md); }`;
**`:10231`** — `.act-active { margin-bottom: var(--space-md); }`

The region comment promises three zones. The stack's gaps are bar → zone 2
**16px**, zone 2 → filters **16px**, filters → log **12px**. A 4px difference
between "a new zone" and "the same zone" is below what proximity can carry, so
the filter card reads as a fourth band rather than as the log's toolbar.

**Proposal** — both to `var(--space-sm)`:

```css
  margin-bottom: var(--space-sm);
```

16 against 8 is a 2:1 ratio, which reads as grouping without a label. It moves
the log *up* 4px, so it costs nothing above the fold — at 1440×900 the first
log row still fits (850–891).

- **Tokens** (rule 3): `--space-sm`, an existing rung. **Both themes**: spacing.
- **Contrast** (rule 2): unchanged. **Motion**: none.
- **Cost**: CSS-only, **0 B** (same-length token).

---

### 7. From 641 to 1024px the bar breaks into rows that each hold an orphan

**`frontend/styles.css:9449`** — `.act-bar { display: flex; flex-wrap: wrap; }` with `.act-refresh { margin-left: auto; }` (`:9543`)

Between the phone layout and the one-line desktop bar, the three items wrap
wherever they happen to run out of room:

- **1024px** — identity and chain on row 1, **Refresh alone on row 2**: a 58px
  row for one 109px button. Bar 128px.
- **901px** — **identity alone on row 1**, chain and Refresh on row 2. Bar 128px.

Neither row means anything; each is an accident of widths.

**Proposal** — in that band, give the chain a row of its own, below the
controls. Before the owner-analytics block (`styles.css:10709`):

```css
@media (641px <= width <= 1024px) {
  .act-chain {
    order: 1;
    flex-basis: 100%;
    justify-content: safe center;
  }
}
```

Row 1 becomes "Live · Session … Refresh" — the controls — and row 2 the whole
pipeline, centred in a full-width pill: the same treatment the phone layout
already gives the chain (`styles.css:10663`), carried up to the width where the
one-line bar starts to fit. The bar goes **128 → 118px** at both 901 and 1024.
`safe center` keeps the phone rule's guarantee that an overflowing chain falls
back to the start rather than stranding "Browser".

641 and 1024px are existing breakpoints (two and four uses), so no new literal.
Between 1025 and ~1070px today's Refresh orphan survives; that 45px band depends
on the live label's length, and no breakpoint can track it.

- **Both themes** (rule 4): layout only. **Contrast** (rule 2): unchanged.
- **Motion**: none; the chain's pulse is unaffected by order.
- **Cost**: CSS-only, **+93 B**.

---

## A longer look

### 8. In the log, the object of every sentence recedes behind its verb

**`frontend/styles.css:10368`** — `.act-ev-code { color: var(--muted); }` (`:10372`)

"Moved to `/#about`", "Ran `skills --all` in the terminal", "Read **75%** of
`/#resume`". The verb is `--text`; the object — the path, the command, the thing
the row is actually about — is `--muted`, and sunken, and boxed, and monospace.
Four differentiators, one of which subtracts. When a reader scans the log for
where they went, the part they are scanning for is the quietest ink in the row,
while the bold figure in "Read **75%**" outranks everything.

**Proposal:**

```css
  color: var(--text);
```

The chip still stands apart — mono face, `--wash-sink` ground, `--border`
hairline — but it now carries the row's information at full strength.

- **Both themes** (rule 4): both tokens are theme-split.
- **Contrast** (rule 2): **8.19 → 16.47:1** light, **12.39 → 16.64:1** dark (on
  the sunken chip face).
- **Motion**: none. **Cost**: CSS-only, **−1 B**.

---

### 9. Down the page, content starts at three x positions

**`frontend/styles.css:9992`**, **`:10269`**, **`:10282`**, **`:10554`** (the `18px` insets); **`:10669`**, **`:10684`** (the `14px` phone insets)

**This moves values `docs/DESIGN.md` §Spacing records as deliberate, so it says
so.** The note says rounding 14/18px to a rung "would move pixels to buy
nothing". Here it buys a single edge.

Down the desktop view, the content of the cards starts at three different x
positions: **151** (filters, 14px inset), **153** (bar and visit card, 16px) and
**155** (the log, 18px) — and ends at three: **1285, 1287, 1289**. Two-pixel
steps are the size that reads as *almost* aligned, which is worse than either
aligned or plainly offset. On a phone it is two edges: 27 (bar, filters, log) and
29 (visit and paths cards, 14px).

**Proposal** — onto the ramp:

```css
/* desktop — styles.css:9992, :10269, :10282, :10554: 18px -> var(--space-lg) */
.act-paths       { padding: var(--space-lg); }
.act-group       { padding: var(--space-lg) var(--space-lg) var(--space-xs); }
.act-ev          { padding: var(--space-sm) var(--space-lg); }
.act-stream-foot { padding: var(--space-md) var(--space-lg) var(--space-3xs); }

/* <=640px — styles.css:10669, :10684: 14px -> var(--space-md) */
  .act-visit { padding: var(--space-lg) var(--space-md); }
  .act-paths { padding: var(--space-md); }
```

Measured after: on desktop the bar, visit card and log share left edge **153**
and the bar, paths card and log share right edge **1287**; on a phone all five
cards start at **27**.

**The one 14px that must stay** is `.act-filters` (`styles.css:10102`). At
1024px the search field (min 190px) and the six chips (764px) have **2px** of
slack inside it; at 16px the chip row wraps to a second line and the card grows
from 70 to 121px. So the filter card remains the single 2px outlier on each
side (151 / 1289) — a control row whose sunken field and pill edges read as
controls, not text — and the reason is now a measurement rather than a memory.

- **Tokens** (rule 3): this *removes* six off-ramp literals.
- **Both themes** (rule 4): spacing. **Contrast** (rule 2): unchanged.
- **Motion**: none. **Cost**: CSS-only, **+26 B**.

---

## States only some visitors reach

### 10. A selected strip bar is a 1.08:1 wash and a 1.69:1 underline on light

**`frontend/styles.css:9889`** — `.act-tl-bar[aria-pressed="true"] { background: var(--accent-soft); box-shadow: inset 0 -2px 0 var(--accent-fill); }`

Selecting a bar is the most "dashboard" thing a visitor can do here, and the
strip barely shows it. On the light card the selected column is a
`--accent-soft` wash at **1.08:1** — also exactly what hover paints — and a 2px
`--accent-fill` underline at **1.69:1**. The selection is announced, but 200px
away, by the "Showing events … around 11:15 PM" banner; on the chart itself
hover and selected are nearly the same picture.

**Proposal** — the underline takes the theme-split edge token:

```css
  box-shadow: inset 0 -2px 0 var(--control-accent-border);
```

- **Both themes** (rule 4): on dark it resolves to `--accent-fill` — unchanged.
- **Contrast** (rule 2): underline **1.69 → 5.76:1** light, 10.28:1 dark
  unchanged. Hover (wash only) and selected (wash plus a legible rule) now
  differ by a mark rather than by nothing.
- **Motion**: none. **Cost**: CSS-only, **+10 B**.

---

### 11. Error and empty keep a ruled footer with nothing under it

**`frontend/styles.css:10549`** — `.act-stream-foot { padding: var(--space-md) 18px var(--space-3xs); margin-top: var(--space-xs); border-top: 1px solid var(--border); }`

In the error state and in "Nothing recorded yet", `#act-stream-status` is empty
and Show more is hidden — but the footer keeps its padding and its top rule. The
log card ends in a hairline with ~25px of nothing below it: a table rule under a
table that is not there, directly beneath the one message the reader needs.

**Proposal** — before `.act-stream-status` (`styles.css:10559`):

```css
/* Nothing to report and nothing to load: no rule under an empty row. The
   live region stays rendered, so its next message is still announced. */
.act-stream-foot:has(> .act-stream-status:empty) {
  margin: 0;
  padding: 0;
  border: 0;
}
```

It collapses rather than hides on purpose. `#act-stream-status` is a
`role="status"` live region; `display: none` would take it out of the
accessibility tree, and a region that reappears already holding its text is not
reliably announced. Zero-height keeps it listening. The footer can only be empty
when Show more is hidden too (Show more implies a non-empty count), so one
condition covers both.

- **Both themes** (rule 4): removes a rule; nothing to pair.
- **Contrast** (rule 2): n/a. **Motion**: none.
- **Cost**: CSS-only, **+76 B**.

---

### 12. The loading state's loudest marks are its least true

**`frontend/styles.css:10084`** — `.act-stats[aria-busy="true"] .act-stat-value { background: var(--wash-sink); animation: skeleton-loading 1.4s var(--ease-standard) infinite; }`;
**`:10505–10513`** (`.act-ev-skeleton`); **`:10320`** (`.act-ev-dot { background: var(--fam-nav); }`)

Every visitor sees this state for the length of a fetch, and anyone arriving
straight on `/#activity` sees it through session creation as well. Rendered with
the events request held back, it says four things, and the loud ones are false:

- **Six family dots, in Navigation orange** (5.12:1 light, 8.04:1 dark) — the
  skeleton rows inherit `.act-ev-dot`'s default, so the placeholder asserts
  six Navigation events before any exist. They are the most visible marks in
  the log card.
- **The placeholder bars are near-invisible on light.** They use the shared
  `.skeleton` gradient on `--skill-bg`: **1.03:1** on the light card.
- **The time column never renders.** `.act-ev-skeleton .act-ev-time
  .skeleton-text { width: 46px; }` sizes an inline `<span>`, and width does not
  apply to inline boxes.
- **The stat blocks' shimmer is a no-op.** `skeleton-loading` animates
  `background-position`, and the rule's background is one flat colour — there
  is nothing to move. The two placeholders on the same screen: one sweeps, one
  is static.

**Proposal** — one placeholder face for both, using the shelf's token-based
sweep (the one shimmer in the file already on `--motion-shimmer`,
`styles.css:8294`); a neutral dot; a time bar that renders:

```css
/* styles.css:10084 - keeps only what is specific to the figures */
.act-stats[aria-busy="true"] .act-stat-value {
  color: transparent;
  border-radius: var(--radius-2xs);
}

.act-stats[aria-busy="true"] .act-stat-value,
.act-ev-skeleton .skeleton-text {
  background: linear-gradient(100deg, transparent 20%, var(--wash-raise) 50%, transparent 80%) 0 0 / 300% 100% var(--wash-sink);
  animation: app-media-loading var(--motion-shimmer) var(--ease-standard) infinite;
}

/* styles.css:10511 */
.act-ev-skeleton .act-ev-time .skeleton-text {
  display: block;
  width: 46px;
}

.act-ev-skeleton .act-ev-dot {
  background: var(--border);
}
```

The gradient stops and size are the shelf's verbatim, so this adds no new
literal; it reuses `@keyframes app-media-loading` rather than adding one.

- **Both themes** (rule 4): `--wash-sink`, `--wash-raise` and `--border` are all
  theme-split.
- **Contrast** (rule 2): placeholders go 1.03 → **1.08:1** light (1.06 → 1.08
  dark) with a sweep peak of 1.09 / 1.16; the dots drop from 5.12 / 8.04:1 to
  **1.31 / 1.52:1** — deliberately: a placeholder should not out-shout content.
- **Motion**: 1400ms (`--motion-shimmer`), `--ease-standard`. It runs only while
  `aria-busy` / the skeleton rows exist, and the blanket `prefers-reduced-motion`
  rule reduces it to a single near-instant pass — a static placeholder.
- **Cost**: CSS-only, **+255 B**. If budget binds, the dot and time-bar fixes
  alone are ≈+60 B, and deleting the dead `animation` declaration is −45 B.

*Also true in this state, but JS:* the family chips render "0" counts while
loading (`paintFamilies`), the same false-measurement PR #220 removed from the
headline figures.

---

### 13. The owner panel paints its header and nothing else — and underneath, its cards are glass on the drawing

**`frontend/styles.css:8627`** — `.js-enabled section { display: none; opacity: 0; transform: … }`;
**`:10770`** — `.act-owner-card { padding: var(--space-lg); border: 1px solid var(--border); border-radius: var(--radius-md); }`

**The defect first, because it gates the rest.** `owner-analytics.js` builds each
panel as a `<section class="act-owner-card">` (lines 183 and 192). The router's
rule hides *every* `<section>` in the document that is not `.active` — not just
the eight views. So a signed-in owner sees "Across every session", the note and
the 7d/30d/90d/365d picker, and then nothing: all six cards compute to
`display: none`, 0×0. Confirmed in render with the owner endpoints answering.

**Proposal, defect** — scope the router rule to the views it exists for:

```css
/* styles.css:8627 */
.js-enabled main > section {
```

All eight views are direct children of `<main>`, `index.html` is the
stylesheet's only consumer, and no other `<section>` exists outside a view. The
higher-specificity `.js-enabled section.active` rules still win. Verified in
render: views route as before; the owner cards appear. The comment at
`frontend/tests/route-semantics.test.js:3` quotes the old selector and should
move with it; no test asserts on it.

**Once visible, four taste findings** (all verified in both themes):

- **The cards are transparent.** No background, so the circuit drawing runs
  behind "1,284", "412,000" and every bar — the thing the opaque-stats intent
  removed from About. The visitor's cards are opaque; the owner's are glass.
  Keep them flat (no elevation — that is how the panel stays set apart), but
  give them the face: `background: var(--card-bg);`.
- **"Where visitors go" is inset twice.** It reuses `.act-paths`, which brings its
  own `var(--space-lg) 18px` padding inside the card's 16px: its rows start
  **35px** in against every other card's **17px**. `.act-owner-card .act-paths
  { padding: 0; }`.
- **The figures are proportional.** `.act-owner-stat-value` (`:10796`) is the
  one numeric display in the section without `tabular-nums`, in a two-column
  grid of numbers: add `font-variant-numeric: tabular-nums;`.
- **The busy fade goes one way.** `transition: opacity var(--motion-fast) ease`
  sits on `[data-busy="true"]` (`:10722`), so the panel fades out on a window
  change and snaps back when the figures land — and `ease` is a keyword where
  the ramp has a token. Move the transition to `.act-owner` with
  `var(--ease-standard)`.

While there: `.act-owner-card-title { letter-spacing: 0.04em; }` (`:10779`) is a
second caps treatment beside the log's `.act-group` at `--tracking-caps`. Use
`var(--tracking-caps)` — one caps voice per section.

- **Both themes** (rule 4): `--card-bg` is theme-split.
- **Contrast** (rule 2): owner labels on the card face are **8.85 / 11.47:1**
  (`--muted`), measured against a face rather than a drawing.
- **Motion**: 120ms both ways, `--ease-standard`; reduced-motion caps it.
- **Cost**: CSS-only, **+133 B** for all of the above.

---

## Cosmetic only

### 14. *Cosmetic.* Five selectors that never match, and a rule block that repeats them

**`frontend/styles.css:9938–9984`**

`[data-fam="nav"] .act-tl-seg` (and four siblings) look for a segment *inside*
an element carrying `data-fam`. None exists — the segment carries the attribute
itself, and its ancestors are `.act-tl-bar` and the plot. The five
`.act-tl-seg[data-fam="…"]` rules below do all the work. Merge the two sets:

```css
.act-tl-seg[data-fam="nav"],
.act-key li[data-fam="nav"] i {
  background: var(--fam-nav);
}
/* ...and delete the five standalone .act-tl-seg[data-fam] rules */
```

No visual change — verified, the segments paint the same five colours. **Cost:
CSS-only, −271 B**, which pays for most of findings 2–11.

---

### 15. *Cosmetic.* The relative-time column is set in proportional figures

**`frontend/styles.css:10386`** — `.act-ev-aside, .act-ev-ago { … }`

"10m ago", "11m ago", "13m ago" stack in a right-aligned column, and with
proportional figures their left edges wobble by up to 4px row to row. Add
`font-variant-numeric: tabular-nums;`. Both themes; no contrast change; no
motion. **Cost: CSS-only, +34 B.**

---

### 16. *Cosmetic.* The two tier-2 toggles in zone 2 move differently

**`frontend/styles.css:10001`** (`.act-path`), **`:10025`** (`.act-path-name`), **`:10461`** (`.act-copy-json:hover`)

The family chips fade hover and pressed over 120ms (the shared pill); the path
rows beside them snap. Give `.act-path` a `background-color`/`border-color`
transition and `.act-path-name` a `color` one, both `var(--motion-fast)
var(--ease-standard)`. While there, `.act-copy-json:hover` is the one tier-3
utility whose hover edge is `--accent-fill` (1.69:1 on light) rather than the
`--border` its siblings use — use `--border`. Both themes; reduced-motion caps
it. **Cost: CSS-only, +173 B.**

*Left alone deliberately:* `actArrive`'s `translateY(-7px)` (`styles.css:10496`)
and the rail's `1.5px` width (`:10311`) are off-ramp, but neither has a
dimension token to move to, and a token for one value would be the
single-caller kind `docs/DESIGN.md` §"Adding to the system" asks to avoid.

---

## Checked and found sound

Measured and *not* reported, so the next pass does not repeat the work:

- **The zone-2 top line** — see *What already works* 1. Unifying the paddings
  would make it worse.
- **Measure in the log.** At 1440px a sentence ends ~670px before its age and
  payload toggle. That is table convention, and the full-width `--wash-raise`
  row hover carries the eye across it. Capping the row at a reading measure
  would leave the right 40% of every row empty under a full-width filter bar.
  Not proposed.
- **Widows elsewhere.** The lede is one line on desktop and two balanced lines
  on a phone (`text-wrap: pretty`); card titles are single-line; the paths
  card's error copy breaks into two full lines in its 262px column.
- **Group labels sit with what they label.** 34px to their first row, 47px from
  the row above.
- **One elevation holds.** No proposal adds a shadow or a second level.
- **Hue collisions, recorded not proposed.** The status colours sit close to
  the family hues: `--color-warning-fill` 37.7° against `--fam-nav` 32–36°,
  `--color-success` 158–163° against `--fam-tap` 172–175°, `--fam-reach` 83–86°
  against the accent at 64°. They are real, but the two vocabularies live in
  different places (the bar vs the strip and chips) and each is labelled.
  Separating them is a sitewide palette pass, not a change to this view.

## Not declaration-level, but worth the owner's attention

These need markup or JS, so they are named rather than proposed.

- **The strip draws System events as Navigation.** `FAMILY_ORDER` in
  `js/activity-charts.js:24` omits `sys`, and `bucketSession` (`:56`) folds
  anything not listed into `nav`. So "Used the AI assistant" is an orange
  Navigation segment in the strip, a slate dot in the log and a count on the
  System chip — and the static legend (`index.html:1702–1707`) has no System
  entry. It is the same fold-to-Navigation defect `activity.js`'s own comment
  records fixing for `familyOf`, one file over.
- **The most technical claims on the page are hover-only.** The stage details —
  "22 events captured in this browser", "FastAPI worker - 12ms server time",
  "Broker bypassed - events go straight to the database", "22 rows written for
  this session" (`activity.js:891`) — and each path's "Most often followed by…"
  (`activity-charts.js:195`) exist only in `title`. That means absent on touch, and
  a tooltip delay away on desktop, for exactly the persona they would persuade.
- **"Select a bar to filter" on a phone.** At 390px the 48 bars are 5.0px wide.
  The hint promises an interaction the device can barely deliver.
- **The duration's units are set at digit size.** "14m 23s" is 29.6px extrabold
  throughout; smaller units would let the figures lead, but `formatElapsed`
  returns a plain string.
- **The filter banner's grammar.** "Showing events Navigation, around 11:15 PM"
  (`activity.js:675`).

For the persona, the one line that matters: this view is the strongest evidence
on the site that its owner builds real-time data systems, and today it spends
its visual weight on a fallback button and an identifier. Findings 1 and 2 —
377 bytes — move the weight onto the proof. The hover-only stage details above
are where the next increment is, and they are a markup decision for the owner,
not a declaration.
