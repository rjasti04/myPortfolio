# UI/UX Review

> **Status: all 28 findings fixed.** Implemented across commits on
> `claude/ui-layer-review-docs-4x0hsh`, one per tier. This document is kept as
> the record of *why* each change was made — the "Location" line in each entry
> points at the code **as it was**, so line numbers refer to the pre-fix
> revision. `docs/JAVASCRIPT.md` describes the code as it is now.
>
> One extra defect surfaced while verifying finding 1 and is fixed with it:
> `theme-customizer.js`'s `readSavedPalette` guarded its `JSON.parse` but not
> its `getItem`, so `initTheme` still threw under blocked storage even after
> `theme.js` was fixed. `frontend/tests/storage-blocked.test.js` covers the
> whole chain.

Read-only audit of the frontend UI layer: loading/empty/error states,
duplicated components, form validation feedback, focus order and keyboard
traps, contrast, touch targets, unconfirmed destructive actions, and flows
that leave the visitor unsure whether something worked.

Findings are ranked by **traffic on the affected path** — Tier 1 reaches every
visitor on every section, Tier 7 is the owner-only auth surface. Within a tier
they are ordered by severity.

Scope: `frontend/index.html`, `frontend/js/**`, `frontend/styles.css`,
`frontend/auth-modal.css`. Out of scope by ADR: `ucl.html`, `worldcup.html`
and `arcade.html` are self-contained pages outside the SPA's CSP and
conventions (AGENTS.md, "Non-Goals").

## The shape of the problem

Four things in this codebase are already correct, and are worth naming because
**almost every finding below is a surface that bypasses one of them.** Most
fixes are "use the thing that already exists", not "build something new".

| Existing, correct | Where |
| :--- | :--- |
| Focus-trapping, reference-counted, focus-restoring dialog | `js/modal.js` |
| Full loading → empty → error state machine | `js/activity.js:361-418`, `:629-693` |
| Contrast-audited token layer, ratios documented inline | `styles.css:1-280` |
| Deliberate progressive enhancement (`js-only`, `<noscript>`, `.js-enabled`) | `index.html:163`, `:369`, `:1543` |

Hand-authored markup in `index.html` is consistently careful — `aria-current`,
`sr-only` live regions for colour-only feedback, real `<noscript>` fallbacks.
The gaps are concentrated in JS-generated DOM and in surfaces that predate the
light theme.

---

## Tier 1 — every visitor, every section

### 1. ✅ One throw in any early init blanks 20 sections of content

| | |
| :--- | :--- |
| **Category** | Bug / Architecture |
| **Severity** | Critical |
| **Location** | `frontend/js/main.js:88-103`, `frontend/js/theme.js:57`, `frontend/styles.css:1782` |

`main.js:88-103` runs fifteen init calls inside a bare `DOMContentLoaded`
handler with no `try`/`catch`. `initTheme()` is first, and `theme.js:57` reads
`localStorage.getItem("theme")` **unguarded** — while `theme.js:42-46` wraps
the matching `setItem` in a `try`/`catch` for exactly this reason:

```js
// theme.js:57 — throws in Safari "Block All Cookies", strict privacy extensions
const savedTheme = localStorage.getItem("theme");
```

When it throws, the handler unwinds and `initAnimations()` — fifth in the list
at `main.js:93` — never runs. `styles.css:1782` sets `.reveal { opacity: 0 }`
unconditionally, and only `js/animations.js:28`/`:35` ever adds `.active`.
There are 20 `.reveal` elements: the entire `.contact-section`, both Apps
tiles, and the About stats, skills and hobbies cards. They stay invisible.
Navigation and the hash router never initialise either.

The visitor gets blank space with no error state. `window.onerror`
(`main.js:6-12`) reports it to the owner, but nothing on screen says anything.

The same `opacity: 0` also means **JavaScript disabled produces the same blank
sections**, which contradicts the deliberate `<noscript>` work elsewhere in
`index.html`.

**The Fix** — three independent changes, each worth doing alone:

```js
// theme.js:57
let savedTheme = null;
try { savedTheme = localStorage.getItem("theme"); } catch { /* storage blocked */ }
```

```js
// main.js:88 — fault-isolate the init sequence
const boot = (name, fn) => {
  try { fn(); } catch (error) { reportClientError(error, { source: "init", at: name }); }
};
document.addEventListener("DOMContentLoaded", () => {
  boot("theme", initTheme);
  boot("navigation", initNavigation);
  // ...one per init
});
```

```css
/* styles.css:1782 — index.html:163 sets .js-enabled at parse time */
.js-enabled .reveal { opacity: 0; transform: translateY(24px); }
```

### 2. ✅ Error toasts are announced politely and vanish in 3.2 seconds

| | |
| :--- | :--- |
| **Category** | Accessibility (WCAG 2.2.1) |
| **Severity** | High |
| **Location** | `frontend/js/utils.js:57`, `:76-79` |

`showToast` sets `role="status"` on **every** toast including errors, inside a
container that is already `aria-live="polite"` (`index.html:369`). Polite
announcements queue behind other speech. `utils.js:76` then auto-dismisses at
3200 ms with no close button and no pause on hover or focus.

A failed contact-form send is the most consequential message this site
produces, and it can be spoken late or gone before it is read.

**The Fix** — branch on the `type` the function already receives, add a
dismiss control, and hold the timer while the toast is hovered or focused:

```js
toast.setAttribute("role", type === "error" ? "alert" : "status");
```

### 3. ✅ The update banner cannot be dismissed and duplicates its own ids

| | |
| :--- | :--- |
| **Category** | Bug / UX |
| **Severity** | High |
| **Location** | `frontend/js/main.js:320-361` |

No dismiss control. `z-index: 10001`, pinned `bottom: 20px; right: 20px` —
directly over the floating chat toggle, permanently, until the visitor
reloads. `registration.update()` runs every 60 s (`main.js:299-301`), so a
second `updatefound` appends a **second** banner carrying the same
`id="update-refresh-btn"`; `main.js:348` binds by `getElementById`, which
returns the first. The newest banner's Refresh button does nothing.

**The Fix** — keep a module-level reference and reuse one node; bind the click
listener to the element reference rather than by id; add a dismiss button.

### 4. ✅ Offline banner is off-palette and its alert never fires

| | |
| :--- | :--- |
| **Category** | UX / Accessibility |
| **Severity** | Medium |
| **Location** | `frontend/js/navigation.js:352-374` |

Built with `style.cssText` and hardcoded `#fde68a` / `#0f172a` — the only
surface on the site that ignores the token layer entirely, so it renders as a
bright yellow slab in dark theme. It is appended at init with its text already
present (`:355`, `:374`), which is the standard way to get a `role="alert"` to
announce once on page load or never again.

**The Fix** — move the styling into an `.offline-banner` rule using
`--color-warning` / `--on-warning`; append the node empty and write its text in
`showOfflineBanner()` so the alert actually fires on the transition.

---

## Tier 2 — Home → About → Work (the recruiter path)

### 5. ✅ The About terminal is a keyboard trap

| | |
| :--- | :--- |
| **Category** | Accessibility (WCAG 2.1.2, Level A) |
| **Severity** | Critical |
| **Location** | `frontend/js/terminal/keymap.js:40-41`, `frontend/js/terminal/index.js:199-200` |

`intentFor` returns `Intent.COMPLETE` for `Tab` regardless of `shiftKey`:

```js
// keymap.js:40-41
case "Tab":
  return Intent.COMPLETE;
```

```js
// index.js:199-200
case Intent.COMPLETE: {
  event.preventDefault();
```

There is no Escape handler and no blur path. **Focus that lands in
`#terminal-input` cannot leave by keyboard in either direction.** The input
sits on the default tab path through the second-most-visited section, so every
keyboard-only visitor to About hits it. `#terminal-keyhints`
(`index.html:880-883`) documents Tab-completes but names no way out.

**The Fix** — in `intentFor`, decline Tab when it is the escape gesture; add
Escape; say so in the hints:

```js
case "Tab":
  return event.shiftKey ? Intent.NONE : Intent.COMPLETE;
case "Escape":
  return Intent.BLUR;
```

Shift+Tab then always leaves, which is the mechanism WCAG 2.1.2 asks for.
Declining Tab on an empty input is a reasonable addition — there is nothing to
complete.

### 6. ✅ Skills carousel autoplays with no pause control

| | |
| :--- | :--- |
| **Category** | Accessibility (WCAG 2.2.2, Level A) |
| **Severity** | High |
| **Location** | `frontend/js/skills-carousel.js:5`, `:108-112` |

`AUTOPLAY_MS = 4500`, restarted indefinitely. It runs **only** under
`(max-width: 640px)` — phones, where there is no hover — and the only pause
paths are `mouseenter`, `focusin` and an in-progress touch (`:171-174`,
`:139`). `prefers-reduced-motion` disables it, which satisfies a different
success criterion. A phone reader has no way to stop the slide moving under
them mid-sentence.

**The Fix** — add a visible pause/play toggle inside `.skills-carousel-dots`
that latches autoplay off for the session. The dots container is already a
`role="tablist"` with a 44px row (`styles.css:5211-5223`), so there is room.

### 7. ✅ Carousel indicators fail non-text contrast

| | |
| :--- | :--- |
| **Category** | Accessibility (WCAG 1.4.11) |
| **Severity** | Medium |
| **Location** | `frontend/styles.css:5240-5245` |

The inactive `.skills-carousel-dot::before` paints
`background: var(--border)` — `hsl(220 39% 11% / 0.13)` — on `--card-bg`.
That composites to roughly **1.2:1** against a required 3:1. The dots are the
only signal of how many skill groups exist and which one is showing.

**The Fix** — `background: var(--control-border)` (`#64748b`, already defined
at `styles.css:63` for exactly this class of affordance).

### 8. ✅ The resume PDF preview opens an empty panel with no loading or error state

| | |
| :--- | :--- |
| **Category** | UX |
| **Severity** | High |
| **Location** | `frontend/js/resume-pdf.js:59-66` |

```js
const iframe = document.createElement("iframe");
iframe.src = trigger.getAttribute("href") || getResumeUrl();
frame.replaceChildren(iframe);
openModal(modal, { initialFocus: closeButton || modal, onClose: teardown });
```

The dialog opens in the same tick as the iframe is created. No spinner, no
"Loading resume…", and no handling if the content-hashed PDF 404s behind a
stale service-worker cache — the visitor gets a blank white sheet inside a
dialog with no indication whether it is slow or broken. This is the Work
section, the page a recruiter opens next.

**The Fix** — render a `.skeleton` block or "Loading resume…" into
`#resume-pdf-frame` before appending the iframe; clear it on the iframe's
`load`; on `error`, swap in a short message pointing at the
`#resume-pdf-modal-tab` "open in a new tab" link that already exists in the
dialog header (`index.html:384-390`).

---

## Tier 3 — Contact (the conversion path)

### 9. ✅ Validating the message field destroys its character-count description

| | |
| :--- | :--- |
| **Category** | Bug / Accessibility |
| **Severity** | High |
| **Location** | `frontend/js/form.js:41`, `:48` |

```js
// :41  clearFieldError
field.removeAttribute("aria-describedby");
// :48  showFieldError
field.setAttribute("aria-describedby", errorEl.id);
```

`#contact-message` ships `aria-describedby="contact-message-count"`
(`index.html:1675`). Both branches clobber it, so the **first** validation
error permanently detaches the "0 / 1200" counter from the field for
screen-reader users — on the one field with a 1200-character limit.

**The Fix** — treat the attribute as the token list it is:

```js
const ids = new Set((field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
ids.add(errorEl.id);            // or ids.delete(errorEl.id) when clearing
field.setAttribute("aria-describedby", [...ids].join(" "));
```

### 10. ✅ An empty required field gives no inline error

| | |
| :--- | :--- |
| **Category** | UX / Accessibility |
| **Severity** | Medium |
| **Location** | `frontend/js/form.js:202-208`, `:235` |

```js
field.addEventListener('blur', () => {
  if (field.value && !field.checkValidity()) { showFieldError(field, errorEl); }
```

The guard on `field.value` means tabbing through the form blank produces
nothing. At submit, `contactForm.reportValidity()` (`:235`) raises a native
browser bubble that no `role="alert"` mirrors and that vanishes on the next
keystroke. The `.form-error-message` machinery to do this properly is already
built (`form.js:26-51`) and simply is not reached for the empty case.

**The Fix** — drop the `field.value` guard on blur, and replace
`reportValidity()` with a pass that renders every inline error and focuses the
first invalid field.

---

## Tier 4 — the chat widget (floats on six of eight sections)

### 11. ✅ Opening the widget never moves focus into it

| | |
| :--- | :--- |
| **Category** | Bug / Accessibility |
| **Severity** | High |
| **Location** | `frontend/styles.css:7012`, `frontend/js/chat.js:1168-1173` |

`.chat-dialog.hidden` (`styles.css:7012-7016`) sets only opacity, transform and
`pointer-events` — but the global utility `.hidden { display: none !important }`
(`styles.css:416-418`) wins on specificity-free `!important`. So the dialog
transitions `display: none` → `flex`, and **no CSS transition runs at all**
(there is no before-change style to animate from).

`chat.js:1168-1173` waits for exactly that transition:

```js
dialog.addEventListener('transitionend', function focusInput(e) {
  if (e.propertyName === 'transform') {
    chatInput?.focus();
    dialog.removeEventListener('transitionend', focusInput);
  }
});
```

The event never fires, so `chatInput.focus()` only ever runs on the
`prefers-reduced-motion` branch at `:1166`. Every other visitor opens the chat
and has to find the field themselves. The listener is also added on **every**
open and removed only from inside itself, so they accumulate — and
`transitionend` bubbles, so any descendant `transform` transition can later
fire the whole stack and yank focus into the composer unprompted.

**The Fix** — delete the `transitionend` branch and focus directly:

```js
setChatOpen(true);
chatInput?.focus();
```

If the enter animation is wanted back, give `.chat-dialog.hidden` a
`visibility: hidden` state that does not collide with the `.hidden` utility.

### 12. ✅ A modal-looking dialog with no focus trap and no `aria-modal`

| | |
| :--- | :--- |
| **Category** | Accessibility |
| **Severity** | High |
| **Location** | `frontend/index.html:1866`, `frontend/js/chat.js:378-385`, `frontend/styles.css:632-642` |

`body.chat-open .layout::after` paints a full-viewport scrim with
`pointer-events: auto` and a backdrop blur — the widget is visually and
functionally modal for a mouse. But `index.html:1866` declares `role="dialog"`
without `aria-modal`, and `setChatOpen` sets no focus trap and no scroll lock.
Escape and click-outside are handled (`chat.js:1194-1204`); **Tab is not**. A
keyboard user tabs out of the chat into a blurred page they cannot click.

Note the pattern: `js/modal.js:39-57` traps, `js/navigation.js:279-283` traps
the header dropdowns, `js/terminal/palette.js:139-142` traps the palette. The
chat widget is the only scrimmed surface that does not.

**The Fix** — route it through `openModal`/`closeModal` in `js/modal.js`,
which supplies the trap, the reference-counted scroll lock, Escape and focus
restore in one call. Minimum viable alternative: add `aria-modal="true"` and
call the exported `handleFocusTrap(event, dialog)` from the existing keydown
listener.

### 13. ✅ Deleting a conversation has no confirmation; clearing all has one

| | |
| :--- | :--- |
| **Category** | UX (destructive action) |
| **Severity** | High |
| **Location** | `frontend/js/chat.js:680-684` vs `:745-751` |

```js
// :680 — one click, gone
deleteItem.addEventListener('click', (e) => {
  e.stopPropagation();
  if (isGenerating) return;
  deleteSession(session.id);
});

// :745 — the same class of action, guarded
if (confirm('Delete all chat history? This action cannot be undone.')) {
```

Both destroy `localStorage`-backed history with no undo. The site has two
different answers for the same question, and the **weaker one is on the more
frequently used control** — a single row in a dropdown, adjacent to Rename.

`confirm()` is itself the odd one out: it is the only blocking, unthemed,
unstyleable dialog in a codebase that owns `js/modal.js`.

**The Fix** — one confirmation path for both, built on `modal.js`, naming the
conversation being deleted ("Delete *Kafka partitioning*?").

### 14. ✅ Chat message actions ignore the project's own touch-target token

| | |
| :--- | :--- |
| **Category** | Accessibility (touch targets) |
| **Severity** | Low |
| **Location** | `frontend/styles.css:7236-7237` |

`.msg-action-btn` is `width: 28px; height: 28px` against the declared
`--min-touch-target: 44px` (`styles.css:264`), which rises to 48px below
640 px (`:280`). Copy, regenerate and the two feedback buttons sit adjacent at
that size on a phone. It clears WCAG 2.2 SC 2.5.8's 24×24 floor, so this is a
house-standard gap rather than a conformance failure.

**The Fix** — keep the 28px visual box, raise the hit area, the way
`.skills-carousel-dot` (`styles.css:5228-5230`) already does it.

---

## Tier 5 — mobile navigation (every phone visitor)

### 15. ✅ The primary phone navigation is the one panel with no focus management

| | |
| :--- | :--- |
| **Category** | Accessibility |
| **Severity** | High |
| **Location** | `frontend/js/navigation.js:30-51`, `:271` |

`setMobileMenuState(true)` adds `.show-menu`, flips `aria-hidden`, locks
scroll, and paints a full scrim (`styles.css:630-642`) — but never moves focus
into the panel and never traps Tab. Escape at `:271` calls `closeTransientUi()`
then focuses `openToggle`, which is resolved from `.header-dropdown.is-open`
— **null when the thing that was open is the nav menu**, so focus is dropped.

The header dropdowns three functions away get all three behaviours
(`:231-238` moves focus in, `:279-283` traps Tab, `:272` restores). The
hamburger — which *is* the navigation on a phone — gets none.

**The Fix** — reuse what is already imported at `navigation.js:2`:

```js
// on open
document.getElementById("nav-menu-close")?.focus();
// in the Tab branch at :279
if (navMenu?.classList.contains("show-menu")) return handleFocusTrap(event, navMenu);
// on every close path
hamburger?.focus();
```

### 16. ✅ A second, weaker scroll lock

| | |
| :--- | :--- |
| **Category** | Architecture (duplicate implementation) |
| **Severity** | Medium |
| **Location** | `frontend/js/navigation.js:36`, `:40` vs `frontend/js/modal.js:17-30` |

```js
// navigation.js:36 / :40
document.body.style.overflow = 'hidden';   // ...and '' on close
```

`modal.js:17-30` implements a **reference-counted** lock that also preserves
the scroll offset via `body.style.top` and `position: fixed`
(`styles.css:651-655`) — and the comment there says why: `position: fixed` is
what actually stops iOS scroll-chaining behind a full-height sheet.
`overflow: hidden` alone does not.

Two implementations of one job, and the mobile nav — the surface most likely
to be opened on iOS — got the one that does not work there.

**The Fix** — export `lockBodyScroll`/`unlockBodyScroll` from `modal.js` and
call them from `setMobileMenuState`.

### 17. ✅ A whole navigation bar is built on every load and never shown

| | |
| :--- | :--- |
| **Category** | Architecture (dead UI) |
| **Severity** | Low |
| **Location** | `frontend/js/navigation.js:463-522`, `frontend/styles.css:11050`, `:11087-11090` |

`initMobileBottomNav()` constructs and appends an eight-item
`.mobile-bottom-nav` on every page load, and `updateMobileNavActive` is called
from three sites — but the CSS sets `display: none` at the base rule *and*
inside the `@media (width <= 1150px)` block. Nobody ever sees it.

Not a live layout bug: `--mobile-bottom-nav-height: 0px` (`styles.css:5586`)
correctly reclaims the reserved space. But the comment at
`navigation.js:474-484` still describes this bar as the phone's primary
navigation, so the JS and the stylesheet disagree about the mobile
navigation model — which is how the next person reading either one gets it
wrong.

**The Fix** — gate `initMobileBottomNav()` behind the same condition as the
CSS, or delete it and its three call sites. Either way, reconcile the comment
with `styles.css:11078-11083`, which already documents how to turn the bar
back on.

---

## Tier 6 — AI page and Activity dashboard

### 18. ✅ The conversation row menu has no menu semantics

| | |
| :--- | :--- |
| **Category** | Accessibility |
| **Severity** | Medium |
| **Location** | `frontend/js/chat.js:669-711`, `frontend/styles.css:9078-9092` |

`.session-menu-btn` carries no `aria-haspopup` and no `aria-expanded`; the
panel is a `div` with no `role="menu"`; nothing closes it on Escape; focus is
neither moved in nor returned. It is `display: none` when closed
(`styles.css:9137-9139`), so there is no phantom tab stop — but an open menu
is invisible *as a menu* to assistive tech.

The button is also roughly 20×24 (`font-size: var(--text-xs)`, `padding: 4px 6px`)
— under the 24×24 WCAG 2.2 floor on the narrow axis, and it is the only route
to Rename and Delete.

**The Fix** — `aria-haspopup="menu"` and a synced `aria-expanded` on the
button; `role="menu"` / `role="menuitem"` on the panel and its two items;
Escape closes and returns focus to the button; size the button with
`var(--min-touch-target)`.

### 19. ✅ Two activity panels report failure as emptiness

| | |
| :--- | :--- |
| **Category** | UX (missing error state) |
| **Severity** | Medium |
| **Location** | `frontend/js/activity.js:420-432`, `:434-447` |

```js
const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/events/funnel`);
if (!response.ok) return;                        // silent
} catch (error) { console.warn("Activity funnel load failed", error); }   // silent
```

A failed funnel request leaves "No navigation recorded yet."
(`index.html:1531`) on screen — a failure indistinguishable from an empty
session. A failed summary leaves the headline stats at their `0` / `—`
placeholders, which read as measurements rather than as their absence.

This is the one file that gets it right elsewhere: `loadActivity`
(`:361-418`) is a complete `loading | ready | error` machine with distinct
messages for 404 vs. 5xx vs. network, and `paintStream` (`:643-652`) renders
them. These two functions simply skipped it.

**The Fix** — give both an error branch that paints the same `.act-empty`
message/detail treatment already used at `:643-652`.

### 20. ✅ The chat "thinking steps" are invented progress

| | |
| :--- | :--- |
| **Category** | UX (misleading feedback) |
| **Severity** | Low |
| **Location** | `frontend/js/chat.js:1251-1320` |

"Initializing context → Fetching profile data → Querying Bedrock LLM" marches
forward on a fixed 700 ms `setInterval` with no connection to request state.
On a slow turn all three read "done" while nothing has arrived; on a fast turn
the visitor is shown steps for work that never happened. The progress is
decoration wearing the costume of telemetry.

**The Fix** — drive the steps from real events (request sent → first SSE frame
received), or use the honest indeterminate indicator that the
`prefers-reduced-motion` branch already renders at `:1256-1259`.

### 21. ✅ Disabling the composer drops focus to `<body>`

| | |
| :--- | :--- |
| **Category** | Accessibility |
| **Severity** | Low |
| **Location** | `frontend/js/chat.js:1214-1229`, `:1755-1758` |

`setInputState(true)` sets `aiPageInput.disabled = true` while generating. The
visitor is almost always focused in that field when they press Enter, so focus
is dropped to the document and a screen reader loses its place mid-turn. The
`finally` block then refocuses it unconditionally — including when the visitor
has navigated to another section in the meantime.

**The Fix** — use `readOnly` plus `aria-busy` on the form instead of
`disabled` (the element stays focusable and announced), and gate the refocus
on `#ai` still carrying `.active`.

---

## Tier 7 — Auth (owner-only surface, lowest traffic)

### 22. ✅ The session list is a dark-theme component rendered on a light modal

| | |
| :--- | :--- |
| **Category** | Accessibility (contrast) / Architecture |
| **Severity** | High *(within this surface)* |
| **Location** | `frontend/js/auth-ui.js:551-563` |

```js
<div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); ...">
  <div style="... color: var(--text-color, #cdd6f4);">
```

Three separate failures in one template string:

1. `.auth-modal-content` is `var(--surface-soft)` (`auth-modal.css:25`) —
   near-white in light theme. A `rgba(255,255,255,0.05)` card on it is an
   **invisible card with an invisible border**.
2. **`--text-color` is defined nowhere in the project.** Verified: zero
   definitions across `styles.css` and `auth-modal.css`. So the device name
   always paints the fallback `#cdd6f4` — roughly **1.5:1** on white. The
   row's primary text is unreadable.
3. `var(--color-error, #f38ba8)` at `:559` carries a Catppuccin-pink fallback.
   `--color-error` *is* defined (`styles.css:112`, `:316`), so this one never
   renders — but it is the same dark-only residue as the other two, and it
   misleads anyone reading the file for what the palette is.

Items 1 and 2 are live rendering failures; item 3 is dead code pointing at the
same cause. All three are dark-palette values that were never re-tokenised
when the light theme landed.

**The Fix** — delete the inline styles; add an `.auth-session-row` rule in
`auth-modal.css` using `--surface`, `--border`, `--text` and `--muted`; drop
the undefined `--text-color` entirely.

### 23. ✅ Two more dark-only values that vanish in light theme

| | |
| :--- | :--- |
| **Category** | Accessibility (contrast) |
| **Severity** | Medium |
| **Location** | `frontend/auth-modal.css:381`, `:262` |

- `:381` — `.password-strength-meter-container` track is
  `rgb(255 255 255 / 10%)`, invisible on the near-white modal. A weak password
  shows a stub bar with **no visible extent to compare it against**, which is
  most of what a strength meter communicates.
- `:262` — `.nav-dropdown-item:hover` is `rgb(255 255 255 / 5%)`, so the
  account menu has no visible hover state at all in light theme.

**The Fix** — `var(--border)` for the track, `var(--accent-soft)` for the
hover.

### 24. ✅ A failed revoke leaves the button permanently dead

| | |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | Medium |
| **Location** | `frontend/js/auth-ui.js:565-577` |

```js
btn.disabled = true;
btn.textContent = 'Revoking...';
try {
  await revokeSpecificSession(sid);
  await loadActiveSessionsUI();
} catch (e) {
  if (errEl) errEl.textContent = e.message || 'Failed to revoke session.';
}
// no finally
```

On error the list is not re-rendered, so the row stays disabled reading
"Revoking…" until the modal is closed and reopened. Every other async handler
in this file has the restoring `finally` — `:421-424`, `:594-597`,
`:1001-1004`.

**The Fix** — add the matching `finally` restoring `disabled` and the label.

### 25. ✅ Revoking a session is destructive with no confirmation

| | |
| :--- | :--- |
| **Category** | UX (destructive action) |
| **Severity** | Medium |
| **Location** | `frontend/js/auth-ui.js:566-572`, `:585-598` |

A single click logs a device out, immediately and irreversibly. "Log Out All
Other Devices" (`:585`) has no confirmation either — while delete-account, two
functions below, correctly demands both the current password and a typed
"DELETE" phrase (`:957-962`). The friction in this modal is inversely
proportional to how often each action is used.

**The Fix** — a `modal.js` confirmation naming the device for the single
revoke, and the same for the bulk action.

### 26. ✅ Submit stays disabled until valid, with nothing saying why

| | |
| :--- | :--- |
| **Category** | UX / Accessibility |
| **Severity** | Medium |
| **Location** | `frontend/js/auth-ui.js:381`, `:748`, `:898`, `:961` |

```js
registerSubmitBtn.disabled = !(allCriteriaMet && matches);
```

A disabled button is not focusable, announces nothing, and gives a keyboard or
screen-reader user no route to discover what is missing — they tab past it and
find the form has no way forward. The visual checklist at `:306-326` is the
only explanation, and it is colour-and-icon feedback with no live region.

The contact form in the same codebase takes the opposite approach: submit
stays enabled and reports on attempt.

**The Fix** — keep the button enabled; on submit, render the unmet criteria
into the existing `role="alert"` node (`index.html:2027`) and focus the first
failing field.

### 27. ✅ Logging in ends with no confirmation

| | |
| :--- | :--- |
| **Category** | UX |
| **Severity** | Low |
| **Location** | `frontend/js/auth-ui.js:414-417` |

```js
loginForm.reset();
closeAuthModal();
window.dispatchEvent(new Event('auth-changed'));
```

The dialog vanishes and the only feedback is the nav icon swapping — small, in
the header, easy to miss on a phone, and announced to nobody. Compare the
contact form, which fires a status message, a toast **and** confetti for a
less consequential action.

**The Fix** — `showToast("Signed in.", "success")` after `closeAuthModal()`;
the same on sign-out. `showToast` is already imported throughout the codebase.

### 28. ✅ Session rows interpolate server data into `innerHTML` unescaped

| | |
| :--- | :--- |
| **Category** | Security |
| **Severity** | High |
| **Location** | `frontend/js/auth-ui.js:555-559` |

```js
<i class="fas fa-${...}"></i> ${s.device_type || 'Desktop Device'}
<div style="...">IP: ${s.ip_address}</div>
<button ... data-session-id="${s.session_id}" ...>
```

All three are inserted raw. `device_type` derives from a client-supplied
`User-Agent`. `escapeHTML` exists at `js/utils.js:22` and every other render
path in the project uses it — `js/activity.js`, `js/activity-charts.js` — with
a comment at `utils.js:1-13` explaining that this exact class of bug was
already fixed once elsewhere.

Listed in this review because it is the same code as finding 22 and the same
rewrite fixes both, but it is a security defect, not a cosmetic one.

**The Fix** — build the row with `createElement`/`textContent`, which also
resolves 22 and 24 in the same pass.

---

## Summary

| Tier | Path | Findings | Highest severity |
| :--- | :--- | ---: | :--- |
| 1 | Every section | 4 | Critical — init throw blanks 20 elements |
| 2 | Home → About → Work | 4 | Critical — terminal keyboard trap |
| 3 | Contact | 2 | High — `aria-describedby` clobber |
| 4 | Chat widget | 4 | High — focus never enters, no trap |
| 5 | Mobile nav | 3 | High — no focus management |
| 6 | AI page / Activity | 4 | Medium — silent failures |
| 7 | Auth | 7 | High — unreadable text, unescaped HTML |

**Two Level-A conformance failures** — the terminal keyboard trap (2.1.2,
finding 5) and the unpausable carousel (2.2.2, finding 6) — both on the About
section.

All of the above are now implemented; what follows is the reasoning that
drove the ordering.

**The single highest-value change** was finding 1: three small, independent
edits that between them stop a blocked-`localStorage` visitor from seeing a
site with its contact form invisible.

**The recurring theme** is that this codebase already contains the correct
implementation of nearly everything it gets wrong. `modal.js` traps focus and
locks scroll properly; the mobile nav and chat widget reimplement both, worse.
`activity.js` models loading/empty/error completely; two functions in the same
file skip it. `escapeHTML` exists and is used everywhere except one template.
The token layer documents its own contrast ratios; one screen bypasses it with
hardcoded values and an undefined variable. Consolidating onto what exists
resolves roughly two-thirds of this list.
