# Visual & Interaction Review — the header

Read-only. Scope is the site header only: the `<header id="header">` markup in
`frontend/index.html` (lines 451–704), the HEADER & NAVIGATION region of
`frontend/styles.css` (1045–1510) plus the header rules that live outside it
(the wordmark at 6005, `.header-icon-btn` at 8543, the ≤1150px header and menu
panel at 7005–7300, the customizer rules at 1780–2100, `.nav-shortcut` at 9400),
the signed-in controls in `frontend/auth-modal.css` (196–290), and the scripts
that drive the bar — `js/navigation.js`, `js/theme.js`, `js/theme-customizer.js`
and the avatar template in `js/auth-ui.js`. Accessibility and base-level state
handling are treated as met (`docs/review/uiux.md`, including #15, the phone
menu's focus management) and are not re-reported; where a ratio appears below
it is there because rule 2 requires every proposal to name one, not as a
finding.

This is a taste review. The question is whether the header is intuitive and
whether it is beautiful — not whether it is correct. Three defects surfaced
while rendering it (findings 1, 2 and 8); they are reported because each is the
most visible thing about the bar in the state where it happens, not because
this document hunts them.

## Status: implemented

All sixteen findings shipped as written, with one deviation: finding 14's
chevron is deleted from the avatar template (`js/auth-ui.js`) rather than
hidden with CSS — the variant that finding named as cleaner. The changes are in
`styles.css`, `auth-modal.css`, `js/theme.js`, `js/theme-customizer.js` and one
line of `js/auth-ui.js`. `index.html` changed only in the theme button's HTML
comment; no inline script was touched. The reasoning behind each change is
recorded in a comment beside it, so the next edit does not undo one by accident.

Verified after the change: `npm run lint` clean, `npm test` 639/639,
`check_csp_hashes.py` green, and `npm run build` puts **CSS at 302,392 B = 295.3
of 296 KiB (+195 B, 712 B left)** and **JS at 391,340 B = 382.2 of 390 KiB
(+233 B)**. Both come in under this document's +243 / +347 because deleting the
chevron from the template removes the JS for it and needs no CSS rule. The
shipped tree was then re-rendered without any overlay and probed state by state:

- Swept from 1151 to 1240px, no link passes the nav's box, and the nearest
  approach to the action row is 36.8px. The nav is centred to within 0.1px from
  1151 to 1920.
- Hovering a link moves nothing (0.0px), and Tab reveals the focused link's
  number.
- The nav has no fill, border, blur or shadow. The scrolled bar is white at 0.92
  on `--elev-3`, and the darkest face under its labels measures luma 235.3,
  which puts the active label at 4.60:1.
- The wordmark keeps its colour on hover in both themes.
- Theme, on a light OS: light/display → dark/moon → light/sun → light/display.
  On a dark OS: dark/display → light/sun → dark/moon → dark/display.
- On a phone, the hamburger is a centred 54.4px capsule from 1150 down to 376px
  and a 44px disc at ≤375; 320px stays at −19.0px.
- The phone menu's heading sits flush with its tiles at 390 and 1024, with the
  rule full width, and its icons are `--accent-text`.
- With the customizer open, the login and theme icons both dim to 0.35, and the
  panel hangs 12px under the bar at rest and when scrolled.
- The preset chips show their swatches in Plus Jakarta Sans. The hex codes are
  in `ui-monospace`, and "Save" / "Randomize" are in sentence case.
- Signed in, the avatar is 44×44 with no chevron, and the hamburger is back at
  0.0px on a phone. The user menu hangs 12px under the bar in Plus Jakarta Sans,
  with every row at 38px (none wraps).

Still open: the four items under "Not declaration-level", none of which a
declaration can close.

The "after" figures in the findings below come from a scratch-copy render made
before the change; the shipped tree reproduces every one of them.

## Method

Numbers in this document are measured, not estimated.

- **Rendering** — `frontend/` served statically and driven through Playwright in
  the pre-installed Chromium, service worker blocked, every API call answered
  503 except in the signed-in state, where `/health` and `/auth/me` were mocked.
  Widths 1920, 1440, 1366, 1280, 1200, 1151, 1150, 1024, 768, 390, 360 and 320,
  plus a 1px sweep from 1151 to 1240; both themes through `colorScheme`; rest,
  scrolled, hover, keyboard focus, phone menu open, customizer open, signed in
  and user menu open.
- **Geometry** — `getBoundingClientRect()` on the live page. Glyph-to-glyph
  gaps are measured between the `<i>` elements, not their 44px buttons.
- **Contrast** — WCAG relative luminance, compositing alpha layers onto the
  theme's `--bg` first. The method reproduces the stylesheet's published pairs
  exactly (`--accent-text` 5.52:1 and `--accent-fill` 1.62:1 on light `--bg`),
  so figures here are comparable with the ones in its comments.
- **Face under the scrolled bar** — finding 3 changes what the nav labels sit
  on, so the bar's face was sampled rather than modelled: `#resume` scrolled
  from 100 to 2400px in 11px steps, the darkest luma recorded in the pixel rows
  just clear of the labels, after the scrolled-state colour transition settled.
- **Budget** — `npm run build` on the current tree: **CSS 302,197 B = 295.1 of
  296 KiB, 907 B of headroom**; **JS 391,107 B = 381.9 of 390 KiB, 8,253 B of
  headroom**. The ceilings are `scripts/build.mjs:177`, not the 300/240 in the
  brief.
- **Byte costs** — each proposal applied on its own to a copy, both copies
  minified with the repo's esbuild (`styles.css` + `auth-modal.css` for CSS,
  `theme.js` + `theme-customizer.js` for JS), and the figure is the exact
  difference. All sixteen applied together: **CSS +243 B, JS +347 B**, which
  leaves 664 B and 7,906 B. With every proposal applied, `stylelint` reports 0
  problems and `eslint` is clean on both scripts.

---

## Standing visual decisions this review does not reopen

| Decision | Where it is recorded |
| :--- | :--- |
| The circuit schematic is the site's ground; the glass frame belongs to `#home` alone | `.claude/intents/2026-09-17-circuit-backdrop-redesign.md`; `.claude/intents/2026-09-20-hero-glass-frame.md` §1 |
| The header is a floating pill, sticky `--header-sticky-offset` below the scrollport (16px, 10px at ≤1150), with the safe-area inset folded in | `styles.css:108`, `:6927` |
| Its edges are `main`'s content column, not percentage margins | `styles.css:1093` |
| It condenses 72→56px past `scrollY` 32; the shrink is instant and only paint properties animate | `styles.css:1116`, `:1131`; `navigation.js:450` |
| The wordmark condenses by `scale`, not `font-size`, and its hover lift stays above the scrolled rest | `styles.css:6029–6045` |
| The action group carries no pill chrome of its own | `styles.css:1165`. **Finding 3 extends this same argument to the nav** |
| At ≤1150px the nav collapses to a hamburger in the centre slot of a `1fr auto 1fr` grid | `index.html:511`; `styles.css:7005`. **Finding 7 keeps the slot and changes how it reads** |
| Header action icons are pinned at 44px at ≤1150, not the 48px body token | `styles.css:8734` |
| The mobile bottom bar is built but hidden; the hamburger is phone navigation | `styles.css:13448` |
| The World Cup and UCL links are hidden, not deleted | `styles.css:8586` |
| Theme is a three-state control — light, dark, system — with no `aria-pressed` | `index.html:693`; `theme.js:73`. **Finding 6 argues the order of the cycle, not the three states** |
| Built-in and saved themes share one chip row; naming a theme is inline, not `prompt()` | `index.html:540`, `:557` |
| The phone menu, the header dropdowns and the chat share one scrim | `styles.css:992` |
| In dark, the bar and its panels are `--glass-dark-bg` navy — the terminal panel's material | `styles.css:285`, `:1141` |
| Number keys 1–8 navigate, and the hint is injected only where hover exists | `navigation.js:512`. **Finding 2 moves the hint; it does not remove it** |

The circuit backdrop and the hero glass frame are decisions. Nothing below adds
a decoration to the bar, changes its material, or touches the ground behind it.

---

## What already works

**1. The bar is the page's column, to the pixel.**
At 1440px the header spans 136→1304 and `main`'s content box spans 136→1304; at
1920 both start at 376. The note at `styles.css:1093` records that percentage
margins used to leave the header 325px wider than the content on each side. A
floating bar that is exactly as wide as the text under it reads as part of the
page rather than as browser chrome, and it is the reason the pill can float
16px below the edge without looking detached.

**2. Changing section moves nothing.**
The active link is 700 and the rest 600, and the inactive links reserve the
active pill's 1px border (`styles.css:1259`). Measured, "Home" is 102.27px wide
active and 102.23px inactive: a 0.04px change, so a navigation never nudges a
neighbour. The condense-on-scroll is equally clean — the height moves through
the token and the wordmark through `scale`. The one thing that still reflows
the bar is not a state change at all; it is finding 2.

**3. The phone menu says "you are here" with one fill.**
Every tile carries the same bordered icon square except the current section,
whose square alone is filled `--accent-fill` (`styles.css:7264`) — the same
one-fill grammar the hero's action row uses. Behind the panel the action icons
drop to 0.35 (`styles.css:1055`) and the hamburger turns into × where it stood,
so both where you are and where the panel came from are legible without a word.
At 390×844 the panel is 592px tall and never scrolls.

---

## Summary

The header is the one surface on every page, so "before scrolling" is
everything a visitor sees of it at rest. The ranking below is therefore: what
every desktop visitor meets, then the phone bar, then states only some visitors
open.

| # | Finding | Axis | Cost |
| ---: | :--- | :--- | :--- |
| 1 | From 1151 to 1227px the nav overflows its pill, and to 1205px "Contact" runs under the palette icon | Beautiful (layout) + a defect | CSS, **−86 B** |
| 2 | Hovering a link widens it 33.5px and slides the whole row ~16.5px; the shortcut it reveals is hover-only | Intuitive + Beautiful (motion) + a defect | CSS, +143 B |
| 3 | The nav is a pill inside a pill, and the inner pill is drawn only by its outline | Beautiful (depth, restraint) | CSS, **−276 B** |
| 4 | The nav sits 51.7px left of the page axis at every desktop width | Beautiful (alignment) | CSS, **−56 B** |
| 5 | Hovering the wordmark fades it from 5.69:1 to 1.67:1 on light | Beautiful (colour) + Intuitive | CSS, **−25 B** |
| 6 | On a light-OS machine, the theme button's first press changes nothing on the page | Intuitive | JS, +115 B |
| 7 | On a phone, the centred hamburger reads as a fourth icon | Intuitive | CSS, +90 B |
| 8 | The phone menu's heading is shrink-wrapped and centred, 57px in from its own tiles | Beautiful (alignment) + a defect | CSS, +20 B |
| 9 | The phone menu's icons are 1.69:1 on light and 8.60:1 on dark | Beautiful (colour, rule 4) | CSS, 0 B |
| 10 | Opening the customizer dims the theme toggle but leaves the login icon lit | Intuitive | CSS, **−25 B** |
| 11 | The header's panels hang from the icon, not the bar — one overlaps it by 8.2px | Beautiful (rhythm, depth) | CSS, +74 B |
| 12 | Theme presets are names, not colours | Intuitive | CSS +230 B, JS +232 B |
| 13 | Two header surfaces are set in Arial, and the hex codes in the UA's monospace | Beautiful (type) | CSS, +118 B |
| 14 | The signed-in avatar is a 72.8×35.6 lozenge in a row of 44px glyphs | Beautiful (hierarchy) + Intuitive | CSS, +97 B |
| 15 | *Cosmetic.* The light bar does not deepen on scroll; the dark one does | Beautiful (depth, rule 4) | CSS, 0 B |
| 16 | *Cosmetic.* The customizer's action buttons are dressed as its group labels | Beautiful (hierarchy) | CSS, **−61 B** |

**Net: CSS +243 B, JS +347 B.** Findings 1, 3 and 4 remove more than 400 bytes
between them, which is what pays for 12. No new asset, no new origin, no inline
script, and `index.html` needs no change for any of them.

---

## The first screen, on a desktop

### 1. From 1151 to 1227px the nav overflows its pill, and to 1205px "Contact" runs under the palette icon

The inline nav takes over from the hamburger at 1151px, and at that width it
does not fit. `#nav-menu` has `min-width: 0` (`styles.css:1233`), so the flex
row shrinks the pill to 824.2px while its eight links, which cannot shrink, need
885px. The links spill out of the right end of the pill by 70.7px, and "Contact"
lands 49.7px deep inside the action group's box — its label sits under the
palette glyph.

| Width | Spill past the pill | Overlap with the action row |
| ---: | ---: | ---: |
| 1151 | 70.7px | 49.7px |
| 1180 (iPad Air / iPad, landscape) | 44.0px | 23.0px |
| 1194 (iPad Pro 11", landscape) | 31.1px | 10.1px |
| 1200 | 25.6px | 4.6px |
| 1210 | 16.4px | clear |
| 1230 | 0 | clear |

Tablet landscape is a device class a recruiter reads on, and on it the one bar
present on every page renders broken.

Of the 885px, 205.6px are the eight link icons: each glyph plus its own
`margin-right: 6px` (`styles.css:1201`) plus the link's `gap: 6px` — a
double-spaced 12px between icon and label. The icons are generic (a house, a
person, a briefcase, a heart, three cubes, a line chart, a robot, an envelope),
each sits beside a label that already says what it is, and together with the
three action glyphs they put eleven icons in one bar. The labels carry the
meaning; the icons carry the width.

**The fix** — hide them above 1150px. The rule needs the `#nav-menu` scope:
Font Awesome's `.fas { display: var(--fa-display, inline-block) }` in
`fonts.css` loads after `styles.css` and beats a bare `.nav-icon` at equal
specificity — which is also why the current `display: inline-flex` at `:1198`
never applied.

```css
/* styles.css:1197 - replaces the whole .nav-icon rule */
#nav-menu .nav-icon {
  display: none;
  line-height: 1;
}
```

The ≤1150px `#nav-menu .nav-icon` rule at `:7238` is later in source at the same
specificity, so the phone panel keeps its icon tiles and every property they
used from here (`line-height: 1` is the only one it did not restate).

After: the nav is 679.3px and clears the action row by 36.9px at 1151 and by
91.4px at 1440. Contrast unchanged — no colour moves. No motion. **CSS, −86 B.**

### 2. Hovering a link widens it 33.5px and slides the whole row ~16.5px; the shortcut it reveals is hover-only

`navigation.js:512` appends a `<kbd class="nav-shortcut">` numbered 1–8 to each
link, and `nav a:hover .nav-shortcut` (`styles.css:9413`) flips it from
`display: none` to `inline-block`. It is in flow, so hovering "Experience" grows
that link from 136.5 to 170px — the 18.7px badge, its `margin-left: 8px` and the
link's 6px gap. The pill is centred by `space-between`, so the growth is shared
out: every link moves, the ones to the left by −16.4px and the ones to the right
by +16.4px. Sweeping the pointer along the nav makes the whole row slide under
it, once per link.

The intuitive half is that the hint answers the wrong input. The number keys
are a keyboard feature, and the only way to learn they exist is to point at a
link with a mouse; a visitor who Tabs along the nav — the visitor most likely
to use them — never sees one (`display: none` under `:focus-visible`, measured).

**The fix** — take the badge out of flow as a keycap on the link's corner, and
show it for keyboard focus too. `#nav-menu a` is already `position: relative`
(`styles.css:1274`).

```css
/* styles.css:9400 */
.nav-shortcut {
  display: none;
  position: absolute;
  top: calc(-1 * var(--space-xs));
  right: calc(-1 * var(--space-2xs));
  line-height: 1;
  font-size: var(--text-2xs);
  background: var(--accent-fill);   /* was --accent-mild; see below */
  color: var(--on-accent);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
  font-weight: 700;
  z-index: 1;
}                                   /* margin-left and vertical-align go */

nav a:hover .nav-shortcut,
nav a:focus-visible .nav-shortcut {
  display: inline-block;
}

/* inside the ≤1150px block, next to #nav-menu .nav-label at :7278 -
   a full-width tile has room, and a corner badge would sit on its border */
#nav-menu .nav-shortcut {
  position: static;
}
```

The fill moves from `--accent-mild` to the opaque `--accent-fill` because the
focus ring (3px at 3px offset) now passes under the badge's corner; a 58%-alpha
badge let the ring show through its numeral. Badge text is 11.16:1 light /
11.44:1 dark (was 13.99:1 on the translucent fill); the badge sits 12px inside
the 72px bar at rest and 4px inside the 56px bar scrolled.

After: hovering any link moves nothing (0.0px), and Tab reveals the number for
the focused link. No transition added. **CSS, +143 B.**

### 3. The nav is a pill inside a pill, and the inner pill is drawn only by its outline

`#nav-menu` (`styles.css:1225`) paints its own capsule inside the header's: a
`--card-bg` face, a 1px `--border`, `--elev-1`, and a 16px backdrop blur on top
of the header's 12px one. Inside it, the active link is a third capsule. Measured
against the header it sits in, the nav's face is **1.01:1** on light and
**1.08:1** on dark — there is no surface there, only a line. And the line is the
loudest edge in the bar: the nav's border is 1.31:1 against the header, while
the header's own edge (`--sheen-edge`) is 1.22:1 against the page. The inner
container is drawn more firmly than the outer one.

On scroll the header drops to 56px and the 46px nav is left 5px from its top
and bottom edges — two concentric-looking curves 5px apart, which is the exact
collision the note at `styles.css:1165` describes and removed for the action
group ("the two curves collided and read as a rendering glitch rather than as
nested containers"). That argument was made for one of the header's two nested
pills. This finding is the other one.

**The fix** — let the header pill be the container, as it already is for the
icons:

```css
/* styles.css:1225 - background, padding, border-radius, border,
   the backdrop-filter pair and box-shadow go; so does
   body.dark-theme #nav-menu at :1240 */
#nav-menu {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin: 0;
}
```

Two dependent edits come with it, both found by rendering:

- **`nav,` leaves the utility list at `styles.css:2213`.** That rule gives every
  `<nav>` a 24px backdrop blur. `#nav-menu` overrode it at every width; with the
  override gone it applies, and when the customizer's scrim is up it paints a
  square-cornered light rectangle behind the links. The only other `<nav>` is
  the hidden bottom bar, whose own class rule sets its blur.
- **`header.scrolled` takes `background: var(--surface)`** instead of
  `rgba(255, 255, 255, 0.85)` (`styles.css:1137`). The nav's 0.92 face was also
  shielding the labels from whatever scrolls under the bar. Without it, the
  darkest face measured under the labels while scrolling `#resume` is luma
  223.4, which puts the active label at **4.18:1** — under AA. `--surface` is
  the same white at 0.92, the alpha the nav had, and brings the darkest face to
  235.3: active label **4.60:1**, inactive labels 6.69 → **7.47:1**. Dark is
  unaffected (its scrolled face is 0.88 navy; the zero-blur worst case for the
  active label is 5.55:1).

After: two capsules instead of three, and 10px of air between the active pill
and the scrolled bar's edge instead of 5. Nothing animates that did not before.
**CSS, −276 B.**

### 4. The nav sits 51.7px left of the page axis at every desktop width

`justify-content: space-between` (`styles.css:1107`) places the nav with equal
gaps to its neighbours, and the neighbours are unequal: the wordmark is 28.7px,
the action row 144px. The nav's centre therefore lands at
`(28.7 − 144) / 2` = **−51.7px** from the header's — at 1151, 1200, 1280, 1366,
1440 and 1920 alike. The name, the role and the frame under it on `#home` are
centred on the page axis; the row that navigates between them is not.

The compact header already solved this: at ≤1150 the bar is a `1fr auto 1fr`
grid so the hamburger centres against the pill "rather than against whatever the
two groups happen to measure" (`styles.css:7005`). The desktop header, whose
centre slot holds the whole navigation, is the one that does not use it.

**The fix** — one layout model at every width. The desktop's asymmetric padding
moves onto the wordmark, exactly as `:7021` did at ≤1150, because a grid
centres against the content box:

```css
/* styles.css:1104 */
  padding: 0 8px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;                         /* justify-content goes */

/* styles.css:1152 */
.header-left {
  justify-self: start;
  padding-left: var(--space-md);     /* 8 + 12 + the wordmark's 4 = the 24px ink inset it has today */
  ...
}

/* styles.css:1172 */
.header-actions {
  justify-self: end;
  ...
}
```

The ≤1150 block's own `display: grid`, `grid-template-columns`, `align-items`
and the two `justify-self` declarations (`:7017–7019`, `:7035`, `:7044`) become
redundant and go; its `padding-left: 10px` on `.header-left` stays as the
compact override. `#nav-menu` is `position: fixed` at ≤1150 and the hamburger is
`display: none` above it, so each width still has exactly three grid items.

This needs finding 1. With the icons still in, the nav is 846.4px, the side
tracks come out at 136px against the action row's 144, and the result is −8.2px
at 1440 with the 1151 collision intact.

After (1, 3 and 4 applied): the nav is centred to within 0.1px at every width
from 1151 to 1920. Contrast unchanged. No motion. **CSS, −56 B.**

### 5. Hovering the wordmark fades it from 5.69:1 to 1.67:1 on light

`.logo-text:hover` (`styles.css:6024`) scales the mark to 1.06 and sets
`color: var(--accent-fill)`. On dark that is a step from 12.38:1 to 11.05:1 and
reads as a brightening. On light `--accent-fill` is the pale citron the palette
reserves for fills, and "RJ" goes from **5.69:1** to **1.67:1** — the home link
all but disappears at the moment the pointer asks it what it is. The two themes
do opposite things on the same gesture.

**The fix** — delete the colour; the scale is already the hover signal, and it
already clears the scrolled rest (`:6043`).

```css
/* styles.css:6024 */
.logo-text:hover {
  transform: scale(1.06);
}
```

After: 5.69:1 light and 12.38:1 dark at rest and on hover. The transform's
reduced-motion fallback is the existing global clamp (`styles.css:7518`).
**CSS, −25 B.**

### 6. On a light-OS machine, the theme button's first press changes nothing on the page

The button cycles light → dark → system in a fixed order (`theme.js:83`), and a
first-time visitor starts in "system". Measured, on a light-OS machine:

| Press | Mode | Page | Glyph |
| ---: | :--- | :--- | :--- |
| 0 | system | light | display |
| 1 | light | **light — unchanged** | moon |
| 2 | dark | dark | sun |
| 3 | system | light | display |

The first press only swaps the glyph. The majority of visitors, on light
systems, press a theme button and see the page do nothing. On a dark-OS machine
the dead press is the third, which is where it belongs.

The glyphs make it harder to read. `MODE_ICON` (`theme.js:52`) mixes two
grammars: the moon and the sun name where the next press goes, the display
names where you are. And the sun is wrong in its own grammar: from "dark" the
next press goes to "system", which on a dark OS stays dark.

**The fix** — keep all three modes and order the cycle against the OS, so that
the one press that cannot change the page — back to "system", which resolves to
what is already showing — comes last. Make every glyph name the mode in effect.

```js
// theme.js:52 - replaces MODE_ICON and MODE_LABEL
const MODE_ICON = {
  light: "fas fa-sun",
  dark: "fas fa-moon",
  system: "fas fa-display",
};

const MODE_NAME = { light: "light", dark: "dark", system: "following system" };

/* From "system" the next press goes to the theme the OS is NOT showing, so the
   first press always changes the page. The one press that cannot - back to
   "system", which resolves to what is already on screen - comes last. */
function nextThemeMode(mode) {
  const os = prefersDarkScheme.matches ? "dark" : "light";
  const other = os === "dark" ? "light" : "dark";
  return mode === "system" ? other : mode === other ? os : "system";
}

function syncThemeButton(mode) {
  const next = nextThemeMode(mode);
  const label = `Theme: ${MODE_NAME[mode]}. ${next === "system" ? "Follow system." : `Switch to ${next}.`}`;
  if (themeIcon) themeIcon.className = MODE_ICON[mode];
  if (themeBtn) {
    themeBtn.setAttribute("aria-label", label);
    themeBtn.setAttribute("title", label);
  }
}

// theme.js:83
  const next = nextThemeMode(readThemeMode());

// theme.js:177 - the label now depends on the OS, so an OS flip re-syncs it
  prefersDarkScheme.addEventListener("change", (event) => {
    if (readStoredTheme() === null) {
      applyTheme(event.matches);
    }
    syncThemeButton(readThemeMode());
  });
```

After (measured): light OS system → dark → light → system; dark OS system →
light → dark → system. The first two presses always repaint, and the label
always names the mode in effect and the next one. The sun, moon and display
glyphs are all in the vendored Font Awesome subset already. No test asserts the
old labels or order. The comment at `index.html:693` ("Cycles light -> dark ->
system") and the pre-JS label at `:698` are markup text, not an inline script,
so updating them does not touch the pinned CSP hashes. No contrast or motion
change. **JS, +115 B.**

---

## The first screen, on a phone

### 7. On a phone, the centred hamburger reads as a fourth icon

At ≤1150 the hamburger has "its own centre slot" (`index.html:511`), and at
1024 it reads that way: hundreds of pixels of bar on either side. On a phone it
does not. At 390px, measured glyph to glyph:

| From | To | Gap |
| :--- | :--- | ---: |
| wordmark | hamburger | 127.5px |
| hamburger | palette | 42.8px |
| palette | login | 30.0px |
| login | theme | 29.0px |

The hamburger is geometrically centred and perceptually the first of four
right-hand icons: proximity groups it with the action row, and it is the same
kind of object — a bare accent glyph. The decision's intent, "the primary
navigation control in its own slot", is not what the eye receives. Signed in, it
is also 12.8px off centre (finding 14).

**The fix** — keep the slot and change the grouping cue from proximity, which
the bar is too narrow to supply, to similarity: make the hamburger the one
control in the bar that is a filled capsule. The wash is the one the phone menu
already uses for "current", so it introduces no new vocabulary.

```css
/* styles.css:8749, inside @media (width <=1150px) */
  .hamburger-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: auto;                          /* was var(--header-action-size) */
    height: var(--header-action-size);
    min-width: var(--header-action-size);
    min-height: var(--header-action-size);
    padding: 0 var(--space-lg);           /* was 0 */
    border-radius: var(--radius-full);
    background: var(--accent-soft);
  }

/* styles.css:7437, inside @media (width <=375px) - a 44px disc there, so the
   narrowest bars keep today's centring */
  header .hamburger-btn {
    padding: 0;
  }
```

The capsule is 54.4×44px. Its wash is 1.08:1 on the light bar and 1.56:1 on the
dark one — a shape cue, not a boundary — and the glyph on it is 5.28:1 light /
7.96:1 dark. Centring is unchanged at every width measured: 0.0px from 1024 down
to 360, and −19.0px at 320 as today, which `:7005` records as the intended
trade. When the menu opens the × sits in the same capsule. No motion added.
**CSS, +90 B.**

---

## States only some visitors reach

### 8. The phone menu's heading is shrink-wrapped and centred, 57px in from its own tiles

Open the menu at 390px and "Navigation / Explore portfolio sections" starts
**57px** right of the tiles' left edge, the × stops **57px** short of their right
edge, and the rule under the heading is 200px long over a 314px column. At 1024
the insets are 101px and the rule is 200px over 402. The heading floats in the
middle of the panel while every tile under it runs edge to edge.

The cause is inherited: the desktop `#nav-menu` is `align-items: center`
(`styles.css:1227`), and the ≤1150 rule (`:7125`) turns the panel into a column
without resetting it, so every child without an explicit width is centred at its
content width. `.nav-menu-links` has `width: 100%` and escapes; the heading does
not. The customizer, opened from the same bar with the same header primitive,
runs its heading full width — the two panels do not match.

**The fix** —

```css
/* styles.css:7141, inside the ≤1150 #nav-menu rule */
    flex-direction: column;
    align-items: stretch;
```

After: 0px and 0px at both widths, and the rule spans the column. No contrast
or motion change. **CSS, +20 B.**

### 9. The phone menu's icons are 1.69:1 on light and 8.60:1 on dark

The icon inside each tile's square is `color: var(--accent-fill)`
(`styles.css:7249`). On dark that is 8.60:1 on the square; on light it is the
pale fill citron at **1.69:1**, so eight of the nine marks in the panel wash out
and the menu looks half-loaded in one theme only. Rule 4 is about exactly this
asymmetry. The hover state at `:7271` already uses `--accent-text`.

**The fix** —

```css
/* styles.css:7249 */
    color: var(--accent-text);
```

After: 5.77:1 light, 9.64:1 dark. The active tile keeps its filled square with
`--on-accent` glyph, so "current" is still the one fill; hover still has its
border and 1.06 scale. **CSS, 0 B.**

### 10. Opening the customizer dims the theme toggle but leaves the login icon lit

When a header panel opens, the other action icons drop to 0.35
(`styles.css:1056`) — except `.nav-auth-container`, which is exempted. But
`body.dropdown-open` is only ever set by `.header-dropdown` toggles
(`navigation.js:330`), and the customizer is the only one; the user menu opens
with its own `.show` class (`auth-ui.js:1499`) and never sets it. The exemption
protects nothing, and its one visible effect is that the control least related
to theming stays at full strength beside the open palette while the theme toggle
recedes.

**The fix** —

```css
/* styles.css:1056 */
body.dropdown-open .header-actions>*:not(.header-dropdown.is-open) {
```

After: both non-palette icons dim together. The 0.35 fade keeps its existing
`--motion-base` transition and the global reduced-motion clamp. **CSS, −25 B.**

### 11. The header's panels hang from the icon, not the bar — one overlaps it by 8.2px

`.header-dropdown-menu` sits at `top: calc(100% + 12px)` (`styles.css:1397`) of
its 44px icon box, and the icon is centred in a bar that is taller than it. So
the gap under the bar changes with the bar:

| Panel | At rest | Scrolled |
| :--- | ---: | ---: |
| Customizer | **−2px** (overlaps the bar) | 6px |
| User menu (`auth-modal.css:247`, `100% + 10px` of a 35.6px avatar) | **−8.2px** | — |

The customizer's top edge is drawn over the pill's bottom border at rest, and
the user menu's rounded corners start 8px inside the bar.

**The fix** — anchor both to the bar. The icon box is vertically centred on it,
so `50%` of the box is the bar's centre line:

```css
/* styles.css:1397 and auth-modal.css:247 */
  top: calc(50% + var(--header-height) / 2 + var(--space-md));
```

After: 12px at rest and 12px scrolled for the customizer, 12px for the user
menu. At ≤1150 the customizer is `position: fixed` with its own `top` and is
unaffected; the user menu stays absolute there and lands 12px under the 56px
bar. No contrast or motion change. **CSS, +74 B.**

### 12. Theme presets are names, not colours

The customizer offers "Matrix", "Nord" and "Dracula" as three identical grey
chips (`index.html:571`). The only way to learn what one looks like is to apply
it and look at the page — for a control whose whole subject is colour. Saved
themes are the same: a name and a ×.

**The fix** — give each chip a three-stop swatch of the triple it applies. The
colours already exist in `themePresets` (`theme-customizer.js:824`) and in each
saved entry's `raw`, so JS writes them as custom properties rather than CSS
restating them. `style.setProperty` is CSSOM, which `style-src 'self'` permits.

```js
// theme-customizer.js, after themePresets at :828
  function paintChip(chip, colors) {
    chip.style.setProperty('--chip-a', colors.primary);
    chip.style.setProperty('--chip-b', colors.secondary);
    chip.style.setProperty('--chip-c', colors.accent);
  }
  themeChips?.querySelectorAll('[data-preset]').forEach((chip) => paintChip(chip, themePresets[chip.dataset.preset]));

// theme-customizer.js:937, in renderThemeLibrary()
      paintChip(apply, entry.raw);
```

```css
/* styles.css, after .preset-btn at :1879 */
.preset-btn::before {
  content: '';
  flex: 0 0 var(--space-xl);
  height: var(--space-sm);
  margin-right: var(--space-xs);
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, var(--chip-a) 0 33%, var(--chip-b) 0 67%, var(--chip-c) 0);
}
```

After: a 24×8px bar reads the palette before the name, in both themes, from the
ramp (`--space-xl`, `--space-sm`, `--space-xs`, `--radius-full`). The swatch is
decoration beside a text label, so no ratio is at stake; the label keeps its
current 17.2:1. No motion. The saved-theme chip truncates its name
(`.theme-chip-name`) and loses 30px to the swatch, which is the one trade here.
**CSS +230 B, JS +232 B** — the largest item, and optional if the budget is
wanted elsewhere.

### 13. Two header surfaces are set in Arial, and the hex codes in the UA's monospace

There is no global `button { font: inherit }`, so a `<button>` without its own
`font-family` renders in the UA default. Computed on the live page:

| Element | `font-family` |
| :--- | :--- |
| `.preset-btn` — Matrix / Nord / Dracula (`styles.css:1860`) | **Arial** |
| `.nav-dropdown-item` — the whole signed-in menu (`auth-modal.css:272`) | **Arial** |
| `.color-hex-display` (`styles.css:2056`) | **`monospace`** — the UA's generic face, where the code blocks use the `ui-monospace` stack at `:1520` |

Every other string in the header is Plus Jakarta Sans. The preset chips sit
between two rows set in it, and the difference in the "a" and the "g" is
visible at a glance.

**The fix** —

```css
/* styles.css:1860 */
.preset-btn {
  flex: 1;
  font-family: inherit;
  ...

/* styles.css:2057 */
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;

/* auth-modal.css:284 */
  font-family: inherit;
  font-size: 14px;
  white-space: nowrap;
```

`white-space: nowrap` is there because Jakarta is wider than Arial: rendered
without it, "Change Password" wraps inside the menu's 200px `min-width`. With it
the menu grows to fit its longest item. No contrast or motion change.
**CSS, +118 B.**

### 14. The signed-in avatar is a 72.8×35.6 lozenge in a row of 44px glyphs

Signed in, the login glyph becomes `.nav-user-profile` (`auth-modal.css:214`): a
24px initial disc plus a chevron in an `--accent-soft` lozenge, 72.8×35.6px. It
is the only object in the action row that is not a 44px circle, the only one
with a resting fill — so it outweighs the palette and the theme toggle — and at
35.6px it is under the 44px floor the header pins its other controls to
(`styles.css:8734`). Its chevron advertises a menu that the palette, which also
opens one, does not advertise. On a phone it widens the action row enough to
push the hamburger **12.8px** off centre.

**The fix** — make it a member of the row: a 44px hit area around the initial
disc, which stays the one fill.

```css
/* auth-modal.css:214 - gap, padding, border-radius: 20px and the
   background-color go */
.nav-user-profile {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  width: var(--header-action-size, var(--min-touch-target));
  height: var(--header-action-size, var(--min-touch-target));
  border-radius: 50%;
  ...
}

.nav-user-profile > .fa-chevron-down {
  display: none;
}
```

Deleting the chevron from the template at `auth-ui.js:1465` instead of hiding it
is cleaner and saves the JS it costs; the CSS form is what was measured. After:
44×44px, the hamburger back at 0.0px at 390, and the initial disc unchanged
(`--on-accent` on `--accent-fill`). The existing hover border still marks the
pointer. **CSS, +97 B.**

---

## Cosmetic only

### 15. *Cosmetic.* The light bar does not deepen on scroll; the dark one does

When content starts passing under the bar, dark steps `--elev-3` → `--elev-4`
(`styles.css:1144`, `:1149`). Light goes `--elev-2` → `--elev-2`
(`:1114`, `:1136`): the scrolled rule restates the rest value, and the
`box-shadow` transition at `:1120` animates nothing. The condense gesture has
depth in one theme and none in the other.

```css
/* styles.css:1136 */
  box-shadow: var(--elev-3);
```

One rung, as in dark. **CSS, 0 B.**

### 16. *Cosmetic.* The customizer's action buttons are dressed as its group labels

"THEMES" sits beside "+ SAVE", and "YOUR COLORS" beside "RANDOMIZE". Label and
button share the colour (`--muted`, rgb 63 75 90), the case and the tracking;
the label is 12.64px/700 and the button 11.25px/600. The button is told apart
only by its 1px border, so each row reads as two labels, one boxed.

```css
/* styles.css:1930-1931 - both lines go */
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
```

Sentence-case "Save" and "Randomize" read as verbs next to the uppercase nouns.
**CSS, −61 B.**

---

## Checked and found sound

- **Label contrast.** Inactive nav labels are 8.87:1 on light and 11.38:1 on
  dark today; the active label 5.35:1 and 7.18:1. Action glyphs are 5.69:1 and
  12.38:1. Finding 3 is the only proposal that changes what the labels sit on,
  and it carries its own compensation.
- **The navy bar in dark.** It reads bluer than the neutral cards below it
  (hue 221° against the cards' 210°), but it is `--glass-dark-bg`, the terminal
  panel's material (`styles.css:285`), not drift. Not a finding.
- **The phone menu's height.** 592px of an 844px viewport at 390, no internal
  scroll, and the action row dims behind it.
- **Dropdown timing.** The customizer is interactive on the frame it opens
  (`visibility 0s` on the way in, `styles.css:1418`), and its enter uses
  `--ease-enter` over `--motion-medium`.
- **The theme label.** Before and after finding 6, the accessible name always
  states the mode in effect — the defect is what the page does, not what the
  button says.
- **320px.** The hamburger sits 19.0px left of centre there, which `:7005`
  records as the deliberate alternative to overlapping the icon row. Finding 7
  leaves it exactly as it is.

## Not declaration-level, but worth the owner's attention

- **The collapse point could move.** With finding 1 in, the inline nav needs
  about 896px of bar and a 1024px viewport offers 924, so tablet-landscape and
  small-laptop visitors could keep the full navigation instead of a hamburger
  (not centred at 1024 — the side tracks would be short). The 1150px query also
  carries the whole phone panel (~200 lines), so this is a scoping change, not a
  declaration.
- **Two ×s on the phone menu.** With the menu open, the hamburger's × and the
  panel's own × are both on screen, 150px apart, and do the same thing. Dropping
  the panel heading would remove one, but `navigation.js:74` focuses
  `#nav-menu-close` on open, so it needs a JS change to move initial focus.
- **Two header-height values that do not bind.** `--header-height: 52px` at
  ≤640 (`styles.css:463`) is overridden by the ≤1150 `:root` at `:6923`, later in
  source, so phones get 56. And the ≤1150 `header.scrolled { height: 52px }` at
  `:7047` shrinks the bar without the token, so scrolled-state consumers of
  `--header-height` are 4px off. That is enforcement — prompt 7's territory.
- **§B of `ai_prompts/code_review.txt`** still lists `visual-<page>.md` as never
  run, with three now written. A read-only review does not edit it.
