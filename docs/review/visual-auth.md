# Visual & Interaction Review — the login/register dialog

Read-only. Scope is the auth dialog's shell and its two tabbed panels: the
`#auth-modal` markup in `frontend/index.html` (2126–2229), the dialog, tab,
form and checklist rules in `frontend/auth-modal.css` (1–170, 306–590), the
shared rules that reach into it from `frontend/styles.css` (`.hidden` at 798,
`.form-group` at 5619, the `:valid`/`:invalid` field icons at 5659–5673, the
shared focus ring at 1483), and the parts of `js/auth-ui.js` that drive what
the visitor sees — `openAuthModal` (126), `switchTab` (242) and
`updatePasswordValidation` (379). The nine tab-less views (forgot password,
magic link, 2FA, sessions and the rest) are out of scope except where the
header behaves differently on them. Accessibility and base state handling are
treated as met (`docs/review/uiux.md` Tier 7, all fixed; `docs/review/2fa.md`);
where a ratio appears below it is there because rule 2 requires every proposal
to name one, not as a finding.

This is a taste review: is the header intuitive, and is it beautiful. Three
defects surfaced while rendering it (findings 9, 10 and 11); they are reported
because each is the most visible thing about the dialog in the state where it
happens, not because this document hunts them.

**The short answer.** In dark, the header is close to right — citron on navy,
every ratio above 11:1 — and what it needs is alignment and type. In light,
which is what a first visit on a light-OS machine gets, it is neither
intuitive nor beautiful: the card is mid-grey rather than white, the selected
tab is the faintest word on it at 1.12:1, the tab labels are Arial under a
Plus Jakarta Sans heading, the close button hangs 14.5px above the tab line
and on top of Register's hit box, and pressing Register moves the tab row
114px out from under the pointer. Every one of those has a declaration-level
fix, and all sixteen together cost **CSS +140 B, JS −227 B**.

## Status: open

Nothing here has shipped. Every proposal was applied to a scratch copy of
`frontend/` to take the "after" figures; none of it is in the tree.

---

## Method

Numbers in this document are measured, not estimated.

- **Rendering** — `frontend/` served statically and driven through Playwright
  in the pre-installed Chromium, service worker blocked, every non-origin
  request answered 503. The dialog opened through its own
  `request-login-modal` event, exactly as the header's login button opens it.
  Viewports 1920×1080, 1440×900, 1366×768, 1280×720, 768×1024, 390×844,
  375×667, 360×640 and 320×568, phones with touch and `isMobile`; both themes
  through `colorScheme`; login and register at rest, the tab switch, typing
  into Register (one character, then a password meeting all four rules),
  hover on every control, keyboard focus on the tabs, and the forgot-password
  view.
- **Geometry** — `getBoundingClientRect()` on the live page. Text positions
  come from a `Range` over the label, not from the button box, so "the tab
  label's centre line" means the glyphs.
- **Contrast** — WCAG relative luminance. The card is translucent, so its
  face was **sampled** from the screenshot (beside the heading, clear of any
  text) rather than modelled; every ratio against the card uses that sample.
  The method reproduces the stylesheet's own published pairs (`--accent-text`
  5.52:1 and `--accent-fill` 1.62:1 on light `--bg`), so figures here are
  comparable with the comments in `styles.css`.
- **Motion** — `document.getAnimations()` in the first frame after the open
  event, plus the overlay's computed `opacity` and the card's `transform` in
  that frame.
- **Budget** — `npm run build` on the current tree: **CSS 302,392 B = 295.3
  of 296 KiB, 712 B of headroom**; **JS 391,340 B = 382.2 of 390 KiB**. The
  ceilings are `scripts/build.mjs:177`, not the 300/240 in the brief.
- **Byte costs** — each proposal applied on its own to a copy, the copy
  minified with the repo's esbuild (`styles.css` + `auth-modal.css` for CSS,
  `auth-ui.js` for JS), and the figure is the exact difference. All sixteen
  applied together: **CSS +140 B, JS −227 B, markup +4 B**, which leaves
  572 B of CSS headroom. With every proposal applied, `stylelint` reports 0
  problems on both stylesheets, `eslint` is clean on `auth-ui.js`, and the
  frontend suite passes 628/628. The "after" figures below are from rendering
  that copy.

---

## Standing visual decisions this review does not reopen

| Decision | Where it is recorded |
| :--- | :--- |
| The circuit schematic is the site's ground; the glass frame belongs to `#home` alone | `.claude/intents/2026-09-17-circuit-backdrop-redesign.md`; `.claude/intents/2026-09-20-hero-glass-frame.md` §1 |
| An account only lifts the chat limit — `POST /chat` stays anonymous, so this dialog is an offer, never a gate | `AGENTS.md` "Non-Goals"; `docs/SECURITY.md` "Known limitations" |
| One dialog, many panels: login and register are tabs, and the other nine views hide the tab row | `auth-ui.js:241` (`hiddenTabIds`) |
| It is a real dialog, routed through `modal.js` — focus trap, Escape, scroll lock, focus restore | `auth-ui.js:97–154` |
| The tabs are ARIA tabs with a roving tabindex, arrows and Home/End, and the dialog is renamed after the visible panel | `auth-ui.js:262–273`, `:325–340` |
| Floating labels, with field text at 16px so Mobile Safari never zooms | `auth-modal.css:320–327` |
| Password rules are shown live, as a four-row checklist and a meter | `index.html:2193–2211`; `auth-ui.js:379` |
| Submit readiness is `aria-disabled`, dimmed but still operable, never `disabled` | `auth-modal.css:800–807` |
| The primary action is the one citron fill on a surface | `docs/review/visual-header.md` "What already works" §3 |
| `--accent-fill` is for fills, `--accent-text` for text and strokes | `styles.css:37–38`; `docs/DESIGN.md` "The four rules" §2 |
| `.hidden` is `display: none !important`, globally | `styles.css:798`. **Finding 9 works with this, not against it** |

Nothing below adds a decoration to the dialog, changes what it asks for, or
moves a control out of it. Finding 1 rebuilds the card in the material the
site's other 420px dialog already uses.

---

## What already works

**1. The primary action needs no explaining.**
The submit button is full width, 50.6px tall and the only citron fill in the
card, so on both tabs the eye's last stop is the thing to press. The one-fill
grammar the header and hero use holds here without a rule saying so, and
`aria-disabled` rather than `disabled` means a Register button that is not
ready yet still explains itself on press instead of going dead.

**2. The fields are calm and tall.**
52px fields with the label inside them, lifting to 11px `--accent-text` on
focus; 16px input text, so no zoom on iOS; the label's `max-width` stops it
running under the field's icon. The form never needs a separate label row,
which is most of why a three-field Register panel fits on a laptop at all.

**3. Dark theme is nearly finished.**
Measured on the dark card (`rgb(14 22 28)` sampled): heading 16.52:1, tabs
11.01:1 and 12.30:1, subtitle and links 12.30:1, the Magic link 12.32:1.
Citron on navy is the header's own material, and the dialog reads as part of
the same object. Findings 1, 2, 14 and 16 are light-theme problems and barely
register in dark; the other twelve apply to both themes.

---

## Summary

"Before scrolling" for a dialog means what it shows on open. The ranking is
therefore: what every visitor sees when it opens, then what happens the moment
they press Register, then states only some visitors reach.

| # | Finding | Axis | Cost |
| ---: | :--- | :--- | :--- |
| 1 | On light, the card is mid-grey, and every ratio on it is roughly half what the stylesheet designed | Beautiful (material, depth) | CSS, **−140 B** |
| 2 | On light, the selected tab is the faintest word in the dialog — 1.12:1 | Intuitive + Beautiful (colour) | CSS, +16 B |
| 3 | The close button hangs 14.5px above the tab labels, and its box sits on top of Register's | Beautiful (alignment) + Intuitive | CSS, +85 B |
| 4 | The tab labels are Arial under a Plus Jakarta Sans heading | Beautiful (type) | CSS, +40 B |
| 5 | The email field opens inside three rings | Beautiful (restraint) | CSS, **−108 B** |
| 6 | The header names one action four ways, in two cases | Intuitive (copy) | Markup, +4 B |
| 7 | Fields sit 40px apart, and 79px of blank card separates the last one from the button | Beautiful (rhythm) | CSS, +71 B |
| 8 | The heading is off the type ramp and set on body leading | Beautiful (type) | CSS, +115 B |
| 9 | The dialog's entrance is written but never plays | Beautiful (motion) + a defect | CSS, **−238 B** |
| 10 | Pressing Register moves the tab row 114.3px; on a short screen it leaves the screen | Intuitive + a defect | CSS, +119 B |
| 11 | The strength meter never fills | Intuitive + a defect | JS, **−57 B** |
| 12 | Register marks every rule wrong on the first keystroke | Intuitive (tone) | CSS +60 B, JS **−168 B** |
| 13 | An unmet rule is drawn as a solid disc — a bullet, not an empty box | Intuitive (iconography) | CSS, +134 B |
| 14 | On light, five hovers fade their control to citron, the × to 1.11:1 | Beautiful (colour) + Intuitive | CSS, **−24 B** |
| 15 | The tabs and the × are the only controls wearing the browser's focus ring | Beautiful (consistency) | CSS, +56 B |
| 16 | *Cosmetic.* The two links under Password are a grey one and an accent one | Beautiful (hierarchy) | CSS, **−46 B** |

**Net: CSS +140 B, JS −227 B, markup +4 B.** Findings 1, 5 and 9 delete about
490 bytes of CSS between them — dead transitions, a triple focus ring and a
hand-built material — which is what pays for 10, 13 and the rest. No new
asset, no new origin, and no inline script: finding 6 changes text inside
`index.html`, never a `<script>`, so the pinned CSP hashes are untouched.

---

## On opening

### 1. On light, the card is mid-grey, and every ratio on it is roughly half what the stylesheet designed

`auth-modal.css:24–36`:

```css
.auth-modal-content {
  background: var(--surface-soft, rgb(30 30 46 / 85%));
  backdrop-filter: blur(20px) saturate(180%);
  border-radius: var(--radius-lg, 16px);
  …
  box-shadow: 0 24px 64px rgb(0 0 0 / 35%), inset 0 1px 1px 0 rgb(255 255 255 / 15%);
```

Light `--surface-soft` is white at 70% (`styles.css:94`). The overlay behind it
is black at 65% (`auth-modal.css:7`), so 30% of the card is a darkened page
showing through. Sampled, the card face is **`rgb(188 188 188)`** — a flat
mid-grey. The fields on it are `--bg` `#f8fafb`, so the inputs are the
brightest thing in the dialog and look pasted on rather than set in.

Every colour in the stylesheet was tuned against `--bg`, not against that grey,
and all of them lose about half their contrast on it:

| Text | Designed, on `--bg` | On the grey card |
| :--- | ---: | ---: |
| Subtitle, "Forgot Password?", inactive tab (`--muted`) | 8.48:1 | 4.67:1 |
| "Magic Link" (`--accent-text`) | 5.52:1 | **3.05:1** — under AA at 12.8px |
| Selected tab (`--accent-fill`) | 1.62:1 | **1.12:1** — finding 2 |

The site already has a dialog of the same width drawn in the right material:
`.confirm-modal-panel` (`styles.css:6686`) is `var(--surface)`,
`var(--elev-3)`, `var(--radius)`. The auth dialog is the only one that built
its own — and its fallbacks (`rgb(30 30 46 / 85%)`, `rgb(255 255 255 / 15%)`)
are Catppuccin literals from before the token layer, which
`.claude/intents/2026-09-18-ui-ux-visual-design-review.md` already flagged for
removal. The tokens are always defined when this file loads, so those
fallbacks never paint.

**Proposal** — use the confirm dialog's material, and drop the two off-ramp
blurs:

```css
/* auth-modal.css:8 */
backdrop-filter: blur(var(--blur-lg));          /* was blur(16px) saturate(180%) */

/* auth-modal.css:25–27, :32, :35 */
background: var(--surface);                      /* was --surface-soft + blur(20px) saturate(180%) */
border-radius: var(--radius);                    /* 20px, as .confirm-modal-panel */
box-shadow: var(--elev-3);
border: 1px solid var(--border);
```

At 92% white the card no longer needs a blur of its own; the overlay's already
frosts the page.

**After** — the light card samples **`rgb(242 242 242)`**. Subtitle, links and
inactive tab 7.93:1; heading 15.95:1; the checklist rows 7.93:1 (were 4.67:1).
Dark samples `rgb(20 29 37)` (was `rgb(14 22 28)`), every ratio still above
11:1. Rule 4 holds by construction: `--surface`, `--elev-3` and `--border` all
have `body.dark-theme` counterparts. **CSS −140 B.**

### 2. On light, the selected tab is the faintest word in the dialog — 1.12:1

`auth-modal.css:94–108` colours the selected tab and its underline
`--accent-fill`, the citron meant for fills. On the grey card that is **1.12:1**,
and even on `--bg` it would be 1.62:1. The *unselected* tab is 4.67:1. So the
one piece of state the header exists to show — which way in am I? — is shown
by making the chosen option nearly vanish; at a glance "Login" reads as the
disabled one and "Register" as the current one. The 2px underline is the only
other cue, and at 1.12:1 it fails WCAG 1.4.11's 3:1 as a state indicator too.

The site's rule is already written down: fills take `--accent-fill`, text and
strokes take `--accent-text`. The header's own active link is 700 against 600
(`styles.css:1302`), which is the site's second cue for "current".

**Proposal** —

```css
.auth-tab.active {
  color: var(--accent-text);   /* was --accent-fill */
  font-weight: 700;            /* the header's active-link grammar */
}

.auth-tab.active::after {
  background-color: var(--accent-text);   /* was --accent-fill */
}
```

The tabs are `flex: 1`, so the heavier weight moves nothing: each label is
centred in its own fixed cell.

**After** — with finding 1, the selected label and its bar are **5.17:1** on
light (the unselected one is 7.93:1, so weight and the bar carry the
selection, not a drop in contrast). Dark: 11.50:1. **CSS +16 B.**

### 3. The close button hangs 14.5px above the tab labels, and its box sits on top of Register's

`auth-modal.css:43–47` pins the × at `top: 1rem; right: 1rem` — 16px from the
card's edge — while the tab row starts at the 32px padding and runs the full
content width. Measured at 1440×900:

- the × glyph's centre is at y 222.7, the tab labels' at 237.2: **14.5px high**,
  so the × belongs neither to the tab row nor to the card's corner;
- its 44px box (869–913 × 200.7–244.7) overlaps the Register tab's box
  (720–897 × 216.7–258.7) by **28×28px**. With keyboard focus on Register, the
  browser's ring is drawn straight through the ×.

On the tab-less views the same rule leaves the × 13px above the heading's
centre line (forgot password: glyph centre 272.2, heading 285.2).

**Proposal** — put the × on the tab row's centre line, beside it rather than
on it:

```css
.auth-modal-close {
  top: var(--space-2xl);     /* was 1rem */
  right: var(--space-2xl);   /* was 1rem - the box's right edge on the content edge */
}

.auth-modal-tabs {
  margin-right: calc(var(--min-touch-target) + var(--space-sm));
}
```

**After** — the × centre is at y 185 and the tab labels' at 185.5: **0.5px**.
The tab row ends 8px short of the × box. The × glyph now sits 22px in from the
fields' right edge, on the same vertical axis as the password field's eye
toggle below it (both at x 875), so the header's one control lines up with the
form's. At 320px, where the coarse-pointer target is 48px, "Register" still
fits its 83px cell with no overflow. The row's hairline now stops before the ×,
which reads as a header row with its own close rather than a rule the × was
dropped onto. On the tab-less views the × lands 9.5px below the heading's
centre instead of 13px above it — see "Not declaration-level". Colour and
contrast unchanged. **CSS +85 B.**

### 4. The tab labels are Arial under a Plus Jakarta Sans heading

`.auth-tab` (`auth-modal.css:77`) is a `<button>` with no `font-family`, so it
takes the UA's — computed **`Arial`**, 16px/600 — directly above a heading in
Plus Jakarta Sans. The two faces meet in the dialog's first 60 vertical pixels,
and Arial's heavier, narrower "Register" is visibly from somewhere else. The
header review found and fixed the same leak in the header (its finding 13);
`.back-to-login-btn` (`auth-modal.css:406`), on the forgot-password view, has
it too.

**Proposal** — `font-family: inherit;` on `.auth-tab` and `.back-to-login-btn`.

**After** — both compute to Plus Jakarta Sans. The tab row grows from 43 to 46px
because Jakarta's line box is taller; finding 3's alignment figures already
include that. **CSS +40 B.**

### 5. The email field opens inside three rings

Opening the dialog focuses the email field (`auth-ui.js:137`). Focused, it
draws a citron border and a 2px `--accent-soft` glow (`auth-modal.css:338–342`)
**and** a 3px `--focus-ring` outline 2px outside that (`:348–351`). The comment
on the outline says it "applies only for keyboard focus so the softer
treatment still covers clicks" — but a text input matches `:focus-visible` on
every focus, mouse or programmatic included. So every visitor, however they
opened the dialog, meets the form as a field wrapped in three concentric
olive-and-citron lines: the heaviest thing on the card after the button, on
the one field that has nothing in it yet.

The comment's underlying point is right: the citron border is 1.62:1 against
the field and the glow is 1.12:1, so the outline was added because neither of
the other two qualified as a focus indicator. The fix is one ring that
qualifies, not three.

**Proposal** — replace both rules with one:

```css
.auth-form .floating-label-group input:focus {
  outline: none;
  border-color: var(--accent-text);
  box-shadow: 0 0 0 1px var(--accent-text);   /* a solid 2px ring with the border */
}
```

and delete the `:focus-visible` rule and its comment.

**After** — one 2px `--accent-text` ring: **5.52:1** against the field and
5.17:1 against the card on light, 13.08:1 against the field on dark. That clears
1.4.11 on its own, for mouse and keyboard alike, and the lifted label is
already the same colour, so ring and label read as one thing. **CSS −108 B.**

### 6. The header names one action four ways, in two cases

Reading the login panel top to bottom: tab **"Login"**, heading **"Welcome
Back"**, subtitle **"Log in to unlock…"**, button **"Log In"** — and the
header icon that opened it is titled "Log In". One action, a noun and a verb
spelled three ways. Register is "Register" on the tab and "Create Account" on
the heading and button. Everything in the dialog is Title Case ("Forgot
Password?", "Magic Link", "Confirm Password"), while the site's newer surfaces
are sentence case — "Your visit, minute by minute", "Send a message", "Ask me
anything", and the customizer's "Save" after the header review.

The tabs are controls, so their labels are verbs; the button a tab leads to
should say the same verb.

**Proposal** — `index.html` text only:

| Line | Now | Proposed |
| :--- | :--- | :--- |
| 2135 | `Login` | `Log in` |
| 2141 | `Welcome Back` | `Welcome back` |
| 2161 | `Forgot Password?` | `Forgot password?` |
| 2162 | `Magic Link` | `Magic link` |
| 2168 | `Log In` | `Log in` |
| 2175 | `Create Account` | `Create an account` |
| 2216 | `Confirm Password` | `Confirm password` |
| 2227 | `Create Account` | `Create account` |

The header icon's `title`/`aria-label` (`index.html:687–688`,
`auth-ui.js:1577`) should follow to "Log in", but that is header territory.
No inline script is touched. **Markup +4 B.**

### 7. Fields sit 40px apart, and 79px of blank card separates the last one from the button

Measured top to bottom on the login panel at 1440×900: tabs → heading 24px,
heading → subtitle 8px, subtitle → email 24px, **email → password 40px**,
password → its links 6px, **links → button 79.2px**. The largest gap in the
card is between the last thing you fill and the thing you press, so the
button reads as detached from the form rather than as its conclusion.

Two rules stack to make the 40px: `.auth-form { gap: 1.25rem }`
(`auth-modal.css:146`) and a 20px `margin-bottom` on every field group — once
from `.auth-form .floating-label-group` (`:312`) and, under it, from the contact
form's `.form-group` (`styles.css:5619`). The 79px is those two again plus the
empty error line, which holds 19.2px open at all times (`auth-modal.css:161`)
with a gap on each side.

**Proposal** —

```css
.auth-form { gap: var(--space-lg); }                       /* was 1.25rem, off the ramp */

.auth-form .floating-label-group { margin-bottom: 0; }     /* was 1.25rem; also beats .form-group's 20px */

/* Empty, it gives its gap back. Still rendered, so role="alert" stays live. */
.auth-error:empty {
  min-height: 0;
  margin-top: calc(-1 * var(--space-lg));
}
```

**After** — 24 / 8 / 24 / **16** / 6 / **24**: the header-to-form break (24) is
now larger than the space between fields (16), and the button sits 24px under
the links, the same distance the form starts under the subtitle. The login card
goes from 532.7 to 444px, Register from 761.2 to 625.3px. When an error does
appear it lands 8px under the field it is about, and the button moves down
to make room — after the press that caused it, so nothing moves under a
pointer that is about to act. **CSS +71 B.**

### 8. The heading is off the type ramp and set on body leading

`.auth-modal-content h3` (`auth-modal.css:129–134`) is `font-size: 1.5rem` —
24px, between `--text-2xl` (22.78px) and `--text-3xl` (25.63px), so on no rung
— and inherits the body's 1.6 leading, which gives a 24px heading a 38.4px
line box with 4px of dead space above the capitals. Tracking is `normal`,
where the site's headings use `--tracking-tight` (`styles.css:1348` and 13
others). The subtitle is `0.9rem` (14.4px), also off the ramp beside
`--text-sm` (14.22px), and on a phone it breaks as "…unlimited AI chat /
messages." — one word alone on its second line.

**Proposal** —

```css
.auth-modal-content h3 {
  margin-bottom: var(--space-sm);
  font-size: var(--text-2xl);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}

.auth-modal-subtitle {
  font-size: var(--text-sm);
  text-wrap: pretty;             /* as .section-lede, styles.css:4388 */
}
```

**After** — the heading's box is 26.2px for 29px of glyphs, so the 8px under it
is 8px to the subtitle rather than 8px plus leading. At 390 the subtitle breaks
"Log in to unlock unlimited AI / chat messages." Contrast unchanged: 15.95:1 and
7.93:1 on light with finding 1. `text-wrap` is ignored where unsupported, which
leaves today's break. **CSS +115 B.**

### 9. The dialog's entrance is written but never plays

`auth-modal.css:13–22` and `:33–41` describe an opening: the overlay fades in
over 240ms and the card rises 24px from 96% scale on `--ease-overshoot`. None of
it runs. The overlay's closed state is the class `hidden`, and `.hidden` is
`display: none !important` (`styles.css:798`). A transition needs a rendered
"before" style, and an element coming out of `display: none` has none. In the
first frame after the open event the overlay's opacity is already 1 and the
card's transform is the identity; `getAnimations()` lists only the panel's own
8px `slide-fade-in`. So the scrim and the card snap on, and the only motion is
the form sliding inside a card that is already there.

If it did run, it would be on the wrong curve: `--ease-overshoot` is the hero
panel lift's signature easing, which `docs/DESIGN.md` §Motion says belongs to
exactly one effect.

**Proposal** — keyframes, which do run when an element starts rendering, both
of them already in the codebase; and delete the dead transition code
(`:13–15`, the whole `.auth-modal-overlay.hidden` rule at `:18–22`, `:33–34`,
and `.auth-modal-overlay.hidden .auth-modal-content` at `:39–41`):

```css
.auth-modal-overlay.active {
  animation: backdrop-fade-in var(--motion-medium) var(--ease-standard);   /* styles.css:1067 */
}

.auth-modal-overlay.active .auth-modal-content {
  animation: slide-fade-in var(--motion-medium) var(--ease-enter);         /* auth-modal.css:117 */
}
```

`modal.js` adds `active` in the same task that removes `hidden`, so both start
on the first painted frame.

**After** — in the first frame the overlay's opacity is 0 and the card is
translated 8px; `backdrop-fade-in` and `slide-fade-in` are running. The card
rises 8px on the decelerating curve while the scrim fades, and the panel's own
8px slide lands just after it, so the form settles a beat behind its card.
Closing stays instant (see "Not declaration-level").
**Reduced motion:** the global rule at `styles.css:7589` sets every
`animation-duration` to 0.001ms, so both keyframes collapse to their end state.
**CSS −238 B.**

---

## Pressing Register

### 10. Pressing Register moves the tab row 114.3px; on a short screen it leaves the screen

The overlay centres the card (`auth-modal.css:10–12`). Register is 228.5px
taller than Login, so switching re-centres a taller card and the whole header
moves: **the tab row jumps 114.3px up at every viewport measured**, from
1920×1080 to 320×568. The pointer that pressed "Register" is left over the new
heading; pressing "Log in" again sends the row back down. A tab that moves when
pressed is the one thing a tab must not do.

The overlay also cannot scroll — `overflow` is `visible` and `modal.js` has
locked the page — so wherever Register is taller than the viewport, the
overflow is cut off at both ends:

| Viewport | Register card | Tab row top | Submit button |
| :--- | :--- | ---: | :--- |
| 1280×720 | −20.6 → 740.6 | 12.4 | 657–707.6, on screen |
| 375×667 | −58.6 → 725.6 | **−25.6, off screen** | 642–692.6, **half off** |
| 360×640 | −72.1 → 712.1 | **−39.1, off screen** | 628.5–679.1, **off screen** |
| 320×568 | −108.1 → 676.1 | **−75.1, off screen** | 592.5–643.1, **off screen** |

On a small phone, then, pressing Register removes both the way back and the way
forward: the tabs are above the screen, the button below it, and nothing
scrolls. Escape or the scrim are the only exits.

**Proposal** — hang every panel from the line that centres the tallest one, and
let the overlay scroll:

```css
.auth-modal-overlay {
  /* Half the tallest panel (Register, 625-648px after finding 7). Every panel
     hangs from the line that centres it, so switching tabs grows the card
     downward and the tab row stays under the pointer that pressed it. */
  --auth-hang: 20rem;

  inset: 0;                         /* was top/left 0 + 100vw/100vh */
  align-items: flex-start;          /* was center */
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: max(var(--space-lg), 50dvh - var(--auth-hang)) var(--space-lg) var(--space-lg);
}

.auth-modal-content {
  width: min(420px, 100%);          /* was 90% + max-width: 420px, as .confirm-modal-panel */
}
```

`--auth-hang` is a new named value, not a rung on an existing scale: it is
tied to one panel's height and says so (rule 3's second option).

**After** — the tab row moves **0.0px** on the switch at every viewport. Every
desktop size fits Register without scrolling: 1440×900 hangs both panels at
130 (Register ends at 755.3), 1366×768 at 64 (ends 689.3), 1280×720 at 40
(ends 665.3). A 390×844 phone fits both (Register 102 → 750). At 375×667,
360×640 and 320×568 both panels start 16px from the top, the tab row sits at
49, and the overlay scrolls the 13–112px it needs to reach the button. Login
now sits above centre rather than on it — at 1440×900 its card spans 130–574 —
which is where the optical centre is anyway; on a phone, a card that starts at
the top is also the one the virtual keyboard does not cover. With finding 9 the
entrance still plays, and reduced motion is unaffected. **CSS +119 B.**

### 11. The strength meter never fills

`updatePasswordValidation()` runs once at start-up (`auth-ui.js:486`) with an
empty field, and the empty branch writes `pwStrengthBar.style.width = '0%'`
(`:426`). Nothing ever removes it, and an inline width beats
`.password-strength-meter.weak/.medium/.strong { width: … }`
(`auth-modal.css:445–458`). Measured after typing a password that meets all
four rules: class `password-strength-meter strong`, background the success
green, computed width **0px**. The meter the Register panel draws under every
password is an empty grey track in every state; only its caption changes.

**Proposal** — delete `auth-ui.js:426`. The base rule already sets `width: 0`,
so the empty state is unchanged. The change-password and reset-password panels
carry the same line (`:1040`, `:1205`) and the same bug; deleting all three is
one proposal.

**After** — one character fills a red third; the full password fills the track
green. Colours are `--color-error`/`--color-warning`/`--color-success`, both
themes. The width already animates on `--motion-medium`, so under reduced
motion it steps. **JS −57 B.**

### 12. Register marks every rule wrong on the first keystroke

Type one character into Register's password field and all four checklist rows
turn `--color-error` with a × (`auth-ui.js:392–406`), while the caption, which
already said "Strength: Weak" in the markup before anything was typed
(`index.html:2197`), turns red. The email field does the same: the contact
form's `:invalid` rule (`styles.css:5667`) reaches into the auth form and puts
a red × beside the envelope on the first character of an address and keeps it
there until the address is complete. The visitor is told they are wrong at
every step of doing it right.

A checklist that is filling in is the better metaphor: unmet rules stay
neutral, each turns green as it is met, and red is kept for a submit that
fails — which the form already handles: `setSubmitReadiness` and
`blockedBeforeSubmit` (`auth-ui.js:17–30`) put exactly what is missing into the
form's `role="alert"` line and focus the field to fix when an unready button
is pressed.

**Proposal** —

```js
// auth-ui.js:392 - an unmet rule stays neutral while typing
function toggleCheckItem(el, isValid) {
    if (!el) return;
    const icon = el.querySelector('i');
    el.className = isValid ? 'checklist-item valid' : 'checklist-item';
    if (icon) icon.className = isValid ? 'fas fa-check-circle' : 'far fa-circle';
}

// auth-ui.js:427-428 - no verdict on an empty field
pwStrengthText.textContent = '';
```

```css
/* auth-modal.css - no verdict on an address still being typed; the shared
   cross returns when the field is left */
.auth-form .input-wrapper input:focus {
  background-image: none;
}
```

**After** — after one character, all four rows are `--muted` (7.93:1 on light
with finding 1, 12.30:1 on dark) and the meter shows a red third, since grading
is the meter's job; with a full password the rows are green, as before. An empty
field shows the track and no caption. Leaving an incomplete address still draws
the red border and ×. The `.checklist-item.invalid` rules stay: change-password
and reset-password still use them. **CSS +60 B, JS −168 B.**

### 13. An unmet rule is drawn as a solid disc — a bullet, not an empty box

The checklist markup asks for `far fa-circle`, an empty ring
(`index.html:2200–2209`). Only the solid Font Awesome face is shipped, and
`fonts.css:100` maps `.far` onto it at weight 900, so every unmet rule renders
as a **filled** dark disc. Four filled discs read as a bulleted list of rules,
or as ticks already given — not as four boxes waiting to be ticked. The
metaphor the checklist depends on is lost at rest, which is how every visitor
first sees it.

**Proposal** — draw the ring the markup names, in the 14px box the tick later
replaces it in, so the text does not move when a rule is met:

```css
.checklist-item .fa-circle::before {
  content: none;
}

.checklist-item .fa-circle {
  aspect-ratio: 1;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2px;   /* currentColor */
}
```

**After** — four empty `--muted` rings, each replaced by a filled green
check as its rule is met. The ring takes `currentColor`, so it follows the
row's colour in both themes (7.93:1 and 12.30:1 against the card). Static.
**CSS +134 B.**

---

## States only some visitors reach

### 14. On light, five hovers fade their control to citron, the × to 1.11:1

The ×, both links under Password, the back-to-login button and the password
eye all hover to `--accent-fill` (`auth-modal.css:65–68`, `:396–398`,
`:421–423`, `:550–553`). On light that makes the control **fainter** on hover:
the × goes to **1.11:1** on its own `--accent-soft` wash, "Forgot Password?" to
1.12:1, the eye toggle to 1.62:1 against its field. A visitor reaching to close
the dialog watches the × all but disappear under the pointer. The header
review fixed the same inversion on the wordmark (its finding 5), and the user
menu's rows already hover to `--accent-text` (`auth-modal.css:301`).

**Proposal** — `--accent-text` in all five `:hover` colours, and drop the dead
`rgb(255 255 255 / 10%)` fallback from the ×'s.

**After** — with finding 1: the × 4.85:1 on its wash, the links 5.17:1, the eye
5.52:1. In dark, `--accent-text` is lighter than `--accent-fill`, so hovers
brighten a little further. The colour change keeps its 180ms transition,
which reduced motion zeroes. **CSS −24 B.**

### 15. The tabs and the × are the only controls wearing the browser's focus ring

Tab to the Register tab and it draws Chromium's default — `auto 1px`, black
and white — where this dialog's submit button, and every control in the
header, draws a 3px `--focus-ring` outline. Neither
`.auth-tab` nor `.auth-modal-close` is in the shared list at `styles.css:1483–
1507`. With finding 3 not yet applied, that default ring is also the clearest
picture of the × sitting on top of the tab.

**Proposal** — add `.auth-tab:focus-visible` and
`.auth-modal-close:focus-visible` to that shared selector list. Nothing else.

**After** — both draw `3px solid var(--focus-ring)` at a 3px offset
(`--accent-text`, 5.17:1 on the light card, 11.50:1 on dark). With finding 3,
the ring around Register ends 2px clear of the × box. Its `outline-offset`
transition is already zeroed by reduced motion. **CSS +56 B.**

---

## Cosmetic only

### 16. *Cosmetic.* The two links under Password are a grey one and an accent one

"Forgot Password?" is `--muted`; "Magic Link" is `--color-accent`
(`auth-modal.css:587–589`) with a wand icon. The row is lopsided, and the
colour that means "the site's accent" goes to the rarer path. The wand already
marks it as the special one.

**Proposal** — delete `.magic-link-trigger { color: var(--color-accent); }`.

**After** — both links 7.93:1 on light, 12.30:1 on dark; the wand stays.
**CSS −46 B.**

---

## Checked and found sound

- **Tab mechanics.** Arrows, Home and End move between the two tabs; the
  unselected one is `tabindex="-1"`; `aria-selected` follows; the dialog is
  renamed after the visible panel's heading (`auth-ui.js:262–273`, `:325–340`).
- **Focus on a switch** moves into the new panel's first field
  (`auth-ui.js:308–318`), so a keyboard user is never left on `<body>`.
- **Dismissal.** ×, Escape and a click on the scrim all close, and focus
  returns to the header button, including after the header has been rebuilt
  under it (`auth-ui.js:139–152`).
- **Horizontal stability.** The tabs are `flex: 1`, so neither the tab switch
  nor finding 2's weight moves a label sideways; the floating label never runs
  under a field icon (`max-width: calc(100% - 56px)`).
- **Dark theme.** Every text ratio on the dark card is 11:1 or better, before
  and after.
- **Reduced motion.** The panel's slide-fade and every transition in the
  dialog go through the global rule at `styles.css:7589`, and so would
  finding 9's keyframes.
- **Password fields** never show the shared `:valid`/`:invalid` icons, which
  would collide with the eye toggle (`auth-modal.css:560–567`).

---

## Not declaration-level, but worth the owner's attention

- **What Register sells.** Both subtitles are the same sentence with a
  different verb ("…to unlock unlimited AI chat messages."), so switching tabs
  rewrites three lines to change one word, and the one reason to make an
  account is the quietest line in the header. Whether Register's heading should
  carry that reason — and whether the account is free, which is the question a
  visitor has — is copy the owner has to decide; this review does not invent
  claims on the owner's behalf.
- **The tab-less views.** With finding 3, the × on forgot password, magic link
  and the 2FA views sits 9.5px below the heading's centre line (13px above it
  today). One `:has(.auth-modal-tabs.hidden)` rule could align it there too;
  those views are outside this review's scope.
- **Closing is instant.** `closeModal` → `onClose` adds `hidden`, which is
  `display: none` at once. Animating the exit needs a delayed `hidden` — the
  dual-state pattern `.claude/intents/2026-09-18-ui-ux-visual-design-review.md`
  describes — which is JS in `auth-ui.js` and `modal.js`, not a declaration.
  A dialog that leaves the moment you are done with it is acceptable; the
  entrance was the part missing.
- **Autofocus on a phone.** Opening focuses the email field, which raises the
  virtual keyboard over the lower half of the dialog before the visitor has
  read it. Finding 10's top-hung card is what keeps the header visible when
  that happens; whether a touch device should autofocus at all is a decision,
  not a declaration.
- **Card padding on small phones.** The card keeps 32px of padding at every
  width, so at 320px the form is 224px wide. The confirm dialog uses 24px;
  moving to `clamp(var(--space-xl), 8vw, var(--space-2xl))` would give the
  fields 16px back, at the cost of re-measuring finding 3's alignment on
  phones.
- **`ai_prompts/code_review.txt` §B** still lists `visual-<page>.md` as never
  run; `visual-header.md`, `visual-home.md`, `visual-activity.md` and now this
  document exist.
