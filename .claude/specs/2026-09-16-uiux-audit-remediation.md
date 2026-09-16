# Technical Specification: UI/UX Audit Remediation

**Related Intent**: `.claude/intents/2026-09-16-uiux-audit-remediation.md`
**Target Audience**: Visitor / Recruiter (primary), Work Sample (secondary)

Every finding below was verified against the cited lines. Contrast figures are
computed (sRGB relative luminance, WCAG 2.x formula), not estimated.

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA (`frontend/js/`, `frontend/index.html`, `frontend/styles.css`)
  - [ ] Backend API — none
  - [ ] Database Schema — none
  - [x] CI/CD & Deploy — `scripts/build.mjs` only (HTML comment stripping)

No module is added and no module is split. All work lands in existing files, which
keeps `docs/JAVASCRIPT.md`'s per-module counts stable except where noted.

---

## 2. API Contract & Schemas

**N/A.** No route is added, modified or called differently. `POST /chat` and
`POST /sessions` stay deliberately anonymous (ADR / `docs/SECURITY.md`).

---

## 3. Database Schema & Migration Plan

**N/A.** No model under `server/models/` changes, so no Alembic revision is required
and `alembic check` stays green without action.

---

## 4. Frontend Implementation & DOM Contract

### Phase 1 — Route semantics (Critical)

**The defect.** `.js-enabled section { display: none }` (`styles.css:7501-7505`) means
one section is in the accessibility tree at a time — each view *is* a page. But
`setActiveSection()` (`app-logic.js:2-19`) only toggles `.active` and `aria-current`;
`navigateToSection()` (`navigation.js:129-139`) only pushes a hash and scrolls. The
`section-changed` CustomEvent it dispatches (`navigation.js:127`) has **zero listeners
anywhere in the repo**. Only `#home` carries an `<h1>` (`index.html:751`), so the other
seven views render a document with no level-1 heading. `document.title` is written
nowhere in the SPA — only `js/arcade/shell.js:230` does it, so the pattern already
exists and the SPA is the inconsistent one.

**1a. Per-view `<h1>`.** Promote each section's top heading from `<h2 class="section-title">`
to `<h1 class="section-title">`, keeping the class so `--text-fluid-section` still
governs size — element change only, zero visual delta.

| Section | Line | Today | Becomes |
| :--- | ---: | :--- | :--- |
| `#about` | — | *(no heading at all)* | **new** `<h1 class="section-title">About</h1>` |
| `#resume` | 1043 | `<h2>Experience</h2>` | `<h1>` |
| `#hobbies` | 1359 | `<h2>Interests & Hobbies</h2>` | `<h1>` |
| `#apps` | 1434 | `<h2>Apps</h2>` | `<h1>` |
| `#activity` | 1549 | `<h2>Session Activity</h2>` | `<h1>` |
| `#contact` | 1679 | `<h2 class="contact-title">Let's talk.</h2>` | `<h1>` |
| `#ai` | 1875 | `<h2 class="ai-heading">Ask me anything</h2>` | `<h1>` |

`#about` is the special case: its first heading today is `Technical Skills` at
`index.html:928`, so the bio (`.hero-description`) and all six `.stat-card` figures sit
above the document's first heading. It needs a real section title. `#home`'s `<h1>` is
already `.home-name` — leave it.

Demote `#about`'s `Technical Skills` (928) from `<h2 class="section-title skills-title">`
to keep one `<h1>` per view; it stays an `<h2>` under the new section `<h1>`.

**1b. Title, canonical and `og:url` per view.** Add a route-metadata map and apply it in
`setActiveSection()`. No inline `<script>` is touched, so the three pinned CSP hashes
stay valid.

```js
// js/navigation.js — titles are the visible section labels, not new copy.
const ROUTE_META = {
  home:     { title: "Rajeev Jasti | Principal Data Engineer", label: "Home" },
  about:    { title: "About | Rajeev Jasti",            label: "About" },
  resume:   { title: "Experience | Rajeev Jasti",       label: "Experience" },
  hobbies:  { title: "Interests & Hobbies | Rajeev Jasti", label: "Interests & Hobbies" },
  apps:     { title: "Apps | Rajeev Jasti",             label: "Apps" },
  activity: { title: "Session Activity | Rajeev Jasti", label: "Session Activity" },
  contact:  { title: "Contact | Rajeev Jasti",          label: "Contact" },
  ai:       { title: "Ask my AI | Rajeev Jasti",        label: "Ask my AI" },
};
```

On each route change set `document.title`, and point `<link rel="canonical">`
(`index.html:14`) and `<meta property="og:url">` (`index.html:26`) at
`https://rjasti.com/#<target>` — `home` keeps the bare origin so the site root does not
acquire a fragment.

**1c. Announce and focus.** Give each `<section>` `tabindex="-1"` and, in
`setActiveSection()`, move focus to the newly active section and push
`"<label>"` into a polite live region. Reuse the established pattern
(`toast-container`, `contact-status`, `act-stream-status`). Guard the initial page load
so the first paint does not steal focus from the skip link.

This is also where the dead `section-changed` event earns its keep — either consume it
here or delete it; shipping an event with no listener is the kind of thing a reader of
this repo as a work sample will notice.

### Phase 2 — Contrast and forced colors (High)

**2a. `.link-action:hover` fails WCAG AA in the light theme.** `styles.css:3754` sets
`color: var(--accent-hover)`. `--accent-hover` is `hsl(64,60%,43%)` (`styles.css:39`),
which is a *background* colour — correct at 7.98:1 under `--on-accent` ink, but as a
foreground on `--bg` it measures **2.27:1**. The control is the resume **Download** link
(`index.html:1050`), so its resting state is an accessible 5.52:1 and hovering it makes
it *less* readable.

Add a proper theme-aware alias. Accent-derived tokens live on `body`, not `:root`, per
`docs/DESIGN.md` — a `var()` in a custom property substitutes where it is *declared*, so
declaring this on `:root` would freeze it at the light accent.

```css
body            { --accent-text-hover: hsl(64, 60%, 20%); } /* 7.94:1 on --bg (resting --accent-text is 5.52:1) */
body.dark-theme { --accent-text-hover: hsl(64, 60%, 75%); } /* 14.65:1 on --bg (resting 13.08:1) */

.link-action:hover { color: var(--accent-text-hover); }
```

Both themes, both measured, and hover now carries *more* contrast than rest — which is
what a hover state should do. Add `--accent-text-hover` to the literal token list in
`clearCustomPalette()` (`js/theme-customizer.js`) only if the customiser writes it;
if it does not, leave that list alone.

> The SPA a11y pass reported no contrast contradiction but explicitly did not re-derive
> every ramp. This is the one it would have found: it is a hover state, not a resting
> token, and the `5.76:1 / 7.20:1` figures in the comment at `styles.css:3307` describe
> `--accent-hover` as a *background*, which is why it reads as already-verified.

**2b. Gradient text disappears in forced-colors mode.** Three rules paint text with a
gradient and `-webkit-text-fill-color: transparent`:

| Selector | Line | What vanishes |
| :--- | ---: | :--- |
| `.home-role` | 3211 | "Principal Data Engineer" on the landing view |
| `.section-title`, `.contact-title` | 3572 | every section heading |
| `.stat-number` | 4951 | all six stat figures |

Forced-colors mode forces `color` but does **not** reset `-webkit-text-fill-color`
(a non-standard property outside the forced-colors adjusted set), and it forces
`background-image` toward `none`. The result is transparent text on a forced
background. The repo has **no `forced-colors` query at all** (grep-verified). Add one:

```css
@media (forced-colors: active) {
  .home-role,
  .section-title,
  .contact-title,
  .stat-number {
    -webkit-text-fill-color: currentColor;
    background: none;
    color: CanvasText;
  }
}
```

**2c. `prefers-contrast: high` never matches in Chrome or Firefox.** Both blocks
(`styles.css:1289`, `:6745`) use `high`. The standard Media Queries Level 5 values are
`no-preference | more | less | custom`; `high`/`low` were earlier draft names that only
Safari still accepts as aliases. So the high-contrast token overrides **and** the
enhanced `:focus-visible` outlines are dead for most users. Change both to `more`, or
list both values for Safari compatibility.

Treat the corrected blocks as **new code**, not as restored code — they have never
executed in Chrome or Firefox and have therefore never been visually reviewed.

### Phase 3 — Mobile and touch (High / Medium)

**3a. `.act-chain` swipe conflict.** `.act-chain` (`index.html:1570`) is
`overflow-x: auto` (`styles.css:8517`) and its own CSS comment records that the four
pipeline stages overflow by 40–110px on a 320–390px phone. It is a `<div>` holding
`<span>`s, so it matches none of `SwipeHandler.IGNORE_SELECTOR`
(`js/swipe-handler.js:40-41`). On the Activity section a horizontal drag to reveal
"Postgres" is also read as a section swipe and navigates the visitor away.

Fix in markup, matching `.terminal-panel` (`index.html:867`) and `.skills-carousel`
(`index.html:929`):

```html
<div class="act-chain no-swipe">
```

**3b. iOS zoom-on-focus — 16px floor.** Any text-entry control under 16px makes iOS
Safari zoom the viewport on focus and leaves the visitor to pinch back out.

| File | Line | Value | Control |
| :--- | ---: | :--- | :--- |
| `auth-modal.css` | 316 | `0.95rem` (15.2px) | **every** auth field — login, register, forgot, 2FA, change-password. The file has **zero `@media` queries**, so there is no override anywhere. |
| `json.css` | 313 | `0.85rem` (13.6px) | `#source-input` and the other code areas |
| `diff.css` | 253 | `0.85rem` | `#input-left` / `#input-right` |
| `crypto.css` | 582 | `0.875rem` (14px) | encoder / time-workbench inputs |
| `styles.css` | 4695, 7568 | `--text-body-sm` (~14.2px) | contact form — the 16px override at `:6585` is scoped to `width <= 640px`, so an iPhone in **landscape** (e.g. 932px) still zooms |

`cron.css:495` already uses `1.2rem` and is the in-repo proof the rule is known. For the
contact form prefer a `(pointer: coarse)` clause over a width breakpoint, so the floor
follows the input method rather than the logical width.

**3c. Touch targets under the 44/48px contract.** `docs/DESIGN.md` sets
`--min-touch-target` to 44px, 48px under 640px.

| Control | Location | Size today |
| :--- | :--- | :--- |
| `.btn-sm` (Copy / Download / Load sample) | `crypto.css:676-688` | ~30px — **no `min-height` at any breakpoint** |
| `.btn-sm` | `json.css:438-451`, `:949-951` | 36px at ≤640px |
| `.btn-sm` | `diff.css:273-278`, `:778-781` | 40px at ≤640px |
| `.flag-pill` (regex g/i/m/s/u/y) | `cron.css:933-937` | 36px, no override |
| `.dropdown-panel-close` / `.nav-menu-close` | `styles.css:1155-1175` | 34px — the mobile nav's primary dismiss |
| `.theme-save-cancel` | `styles.css:1624-1648` | 32px |
| `.color-popover-close` | `styles.css:1903-1916` | 32px |
| `.pdf-modal-close` | `styles.css:5957-5966` | 40px |
| `.auth-modal-close` | `auth-modal.css:43-58` | ~36–40px computed |
| `--scroll-to-top-size` | `styles.css:6127` | 46px, never stepped to 48px under 640px |

Drive each from `var(--min-touch-target)`, or keep the glyph size and enlarge the hit
area with padding. `app-chrome.css:336-340` (`.action-btn`) is the pattern to copy.

**3d. `safe-area-inset-top` is never used.** `index.html:8` opts into
`viewport-fit=cover` and the app ships full standalone-PWA chrome, but the stylesheet
references only `safe-area-inset-bottom` (3×) and `-left` (1×) — no `-top`, no `-right`.
On a notched iPhone running the installed PWA the sticky header
(`--header-sticky-offset: 10px`, `styles.css:6116-6127`) can sit under the status bar.
Fold `env(safe-area-inset-top, 0px)` into that offset.

### Phase 4 — Feedback and focus consistency (Medium)

**4a. JSON copy buttons lose their icon permanently.** `flash()`
(`js/json/json-ui.js:116-126`) does `button.textContent = label`, which removes the
button's child nodes — including `<i class="fas fa-copy">` (`json.html:254-256`,
`:313-315`, `:350-352`, `:445-447`). The revert restores only the string, so **after the
first click of a session every copy button in JSON Workbench is iconless for good**.
`js/crypto/crypto-ui.js:73-80` already does this correctly with `innerHTML`
save/restore; port that. The restored value is the button's own prior markup, never user
input, so this adds no sanitisation surface.

**4b. Diff's copy is colour-only.** `copyText()` (`js/diff/diff-ui.js:352-360`) adds a
class that recolours the border (`diff.css:300-303`) — no label change, no live region.
Colour is the sole signal, and nothing is announced. Match the "Copied!" swap that json,
crypto, cron and regex all use.

**4c. Background is not inert behind modals.** `openModal()` (`js/modal.js:64-106`)
traps `Tab`, locks scroll and restores focus correctly — genuinely good — but never sets
`inert` / `aria-hidden` on the background. A screen reader's browse cursor can still
reach `#main-content` and the header behind the resume PDF modal, the auth modal and
`confirm-dialog`'s `alertdialog`. Toggle `inert` on the background siblings in
`openModal` and clear it in `closeModal`.

**4d. Auth panel switches drop focus to `<body>`.** `switchTab()`
(`js/auth-ui.js:242-296`) never focuses anything in the newly shown panel, and
`.auth-tab-content { display: none }` (`auth-modal.css:103-105`) hides whatever had
focus. Clicking "Forgot password?" or "Back to login" inside a trapped dialog silently
drops the user to `<body>`. End `switchTab` by focusing the panel's first field —
`firstFieldOf()` already exists and is used by `openAuthModal`.

**4e. Colour pickers announce their hex, not their name.** `index.html:571-579` (and the
`secondary` / `accent` siblings at 580-597) pair `<label for="color-primary">Primary</label>`
with `<button id="color-primary">`. `<label for>` binds only to *labelable* elements and
`<button>` is not one, so the label is inert and the accessible name falls back to the
visible text — `#C5CF3F` (the swatch is `aria-hidden`). All three announce as a hex code.
Add `aria-label="Primary color"` (etc.) to each `.color-input-wrapper`.

**4f. Roving tabindex missing on two tablists.** `crypto.html:116-169` and
`cron.html:115-140` declare `role="tablist"`/`role="tab"`, which promises APG roving
tabindex, but `crypto-main.js:108-118` and `cron-main.js:86-96` never set `.tabIndex`.
`json-main.js:110` and `diff-main.js:115` already do `button.tabIndex = active ? 0 : -1`;
port that line.

**4g. Arcade dialogs do not trap `Tab`.** `#pause-panel` (`role="dialog"`,
`arcade.html:202-227`) and `#overlay` (`role="alertdialog"`, `:229-255`) move focus in and
restore it on close, but `js/arcade/shell.js` has no `Tab` handling at all. Both sit
inside `.stage-body`, a sibling of the still-tabbable `.hud` (`arcade.html:129-195`), so a
keyboard user tabs straight out to Mute/Exit/Restart behind the modal.

### Phase 5 — Content, discovery and payload (Medium)

**5a. A quarter of the work history is unsearchable.** The `GENERATED:experience` block
ends at `index.html:1159`; the second employer's four groups
(`:1216`, `:1231`, `:1246`, `:1261`) are hand-written below it with **no `id` anchors**,
and `content/resume.json` holds only the first company. `js/search-index.js` therefore
carries 7 anchors, all first-company — roughly 24 bullets, including "Serverless Order
Pipeline & APIs" and "SQL Server & Redshift Administration", cannot be found from Ctrl+K.
The palette's own header comment notes that find-in-page cannot substitute, because the
router keeps the other seven sections out of the DOM.

Move the second employer into `content/resume.json` so `scripts/generate_resume.py` emits
its anchors and index entries the same way, rather than hand-adding `id`s that would drift.

**5b. "The form on the right" is wrong on mobile.** `index.html:1681` reads
"…email, a social link, or the form on the right." `.contact-layout` collapses to a
single column at `styles.css:4478` and `:6568`, so the form is *below*. The spatial
reference is also meaningless to a screen-reader user. Rewrite without direction —
"…email, a social link, or the message form."

**5c. `index.html` ships 29.7 KB of comments — 21% of a 141 KB render-blocking document.**
`scripts/build.mjs:364-385` copies HTML through with URL rewriting only; there is no
minifier and no comment stripping. Two blocks are **dead commented-out resume markup**:
`index.html:1161` (4,033 B) and `:1202` (5,837 B) — 9.9 KB of superseded content with no
documentary value. Delete those two at source. Strip the remaining ~19.8 KB in the build
so `dist/` ships lean while `frontend/` keeps its architectural commentary (persona 2).

> **Constraint:** the stripper must never touch inline `<script>` bodies. `build.mjs`
> already states they are never modified, and `index.html` is in `.prettierignore` for the
> same reason — the three pinned `sha256-` CSP hashes break otherwise.
> `python3 scripts/check_csp_hashes.py` is the gate that proves it.

**5d. The service worker polls every 60 seconds forever.** `js/main.js:318-320` runs
`setInterval(() => registration.update(), 60000)` with no visibility check and no
`clearInterval`. A tab left open for an hour makes 60 origin requests, re-fetching and
re-validating `/sw.js` while hidden — needless battery and data on mobile. Check on
`visibilitychange → visible` plus a much longer interval (30–60 min).

**5e. The theme toggle is a one-way door.** `toggleTheme()` (`js/theme.js:38-48`) writes
`localStorage.theme` on every press; `initTheme()` (`:67-82`) follows the OS only while
nothing is stored. Once a visitor toggles, they can never get back to "follow system".
Make it a three-state control — Light / Dark / System — where System `removeItem`s the
key. The `prefers-color-scheme` listener at `:86-93` already handles the rest correctly.

### Phase 6 — Enhancements (not defects)

These are opportunities, not bugs. Each is independently shippable.

**6a. The header promotes the two least relevant apps.** `index.html:627` and `:632` are
permanent header shortcuts to `/worldcup` and `/ucl` — and `AGENTS.md` describes the
predictors as "side projects that share the domain and the build, not part of the SPA".
The five engineering work-samples (arcade, cron, crypto, json, diff) get no header
presence. Worse, **both icons are the identical glyph `fas fa-futbol`**
(`index.html:629`, `:634`): two adjacent, visually indistinguishable buttons that a
sighted pointer user can only tell apart by hovering for the tooltip. Their `aria-label`s
differ, so screen readers are fine — this is a purely visual ambiguity, and exactly the
mistake the `.home-socials` comment at `index.html:784` says was already fixed once
("Four identical circles gave a sighted pointer user no way to tell those apart").

Replace the pair with a single "Apps" entry point, or give each a distinct glyph. Both
links are also the only `target="_blank"` anchors in the file without `rel="noopener"`
(every app tile and social link has it) — a consistency fix worth making in the same edit.

**6b. No section has a lede.** Every section is a bare gradient heading followed
immediately by content. One sentence under each `<h1>` would orient a visitor who
arrives by deep link — which, once Phase 1 lands, is a link that finally says where it
goes.

**6c. The Apps grid has categories it does not use.** Seven tiles each carry an
`.app-tile-eyebrow` — Football, Games, Dev Tools, Security — but the grid is flat and
unfilterable. A filter chip row reusing the Activity section's `.act-families` pattern
would cost little and make the shelf scannable as it grows.

**6d. Experience is a 22 KB wall.** `#resume` is 62 bullets across 11 groups in a single
uncollapsible `.item`, all expanded. For the primary recruiter audience this is the
highest-value section and the hardest to skim. Options, cheapest first: collapse each
`<h4>` group behind a `<details>`; add a "Highlights" strip of 4–5 lead bullets above the
full list; or reuse the skills filter to show only groups matching a chosen technology.

---

## 5. Security & Rate Limiting Review

- [x] **Rate limits** — unchanged; no endpoint touched. Phase 5d *reduces* origin
      request volume.
- [x] **No secrets** logged, returned or added. No new storage key beyond the existing
      `theme` value, whose semantics Phase 5e extends to a third state.
- [x] **CSP hashes** — no inline `<script>` in `index.html` is edited. Phase 1 lands in
      `js/navigation.js`; the Phase 5c stripper must skip inline script bodies.
      `python3 scripts/check_csp_hashes.py` is the proof and must pass before merge.
- [x] **No new egress.** No third-party asset origin is added; ADR-016 holds.
- [x] **No new DOM sink.** Phase 4a switches `textContent` → `innerHTML` on a value that
      is the button's own prior markup, never user-controlled. No `DOMPurify` call is
      needed, and none is removed.
- [x] `docs/SECURITY.md`'s pre-merge checklist is **not** triggered — no auth, session
      token, rate limit, CSP directive or user-controlled output path changes. The CSP
      *hashes* are verified by their own gate above.

---

## 6. Verification & Test Plan

```bash
# Frontend — install first; a fresh clone has no node_modules and both suites
# fail misleadingly without it.
npm ci --no-audit --no-fund
npm run lint          # ESLint + Stylelint
npm test              # Node test runner + jsdom
npm run build         # enforces 300 KiB JS / 240 KiB CSS budgets

# Docs / hashes — both pass at baseline on this branch and must still pass.
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py
```

Backend gates are **not** required — nothing under `server/` is touched.

### Targeted regression tests to add

| Phase | Test | File |
| :--- | :--- | :--- |
| 1 | Each route sets its own `document.title`; `canonical`/`og:url` track it | `tests/preboot-router.test.js` |
| 1 | `document.querySelectorAll('section.active h1').length === 1` for all 8 routes | new, or `app-logic.test.js` |
| 1 | Route change moves focus to the section and writes to the live region | `app-logic.test.js` |
| 2a | `.link-action:hover` resolves ≥ 4.5:1 in both themes | `theme-color-meta.test.js` |
| 4a | Copy button retains its `<i>` across two consecutive clicks | `json-tree.test.js` / new |
| 4f | Inactive tabs carry `tabIndex === -1` in crypto and cron | `cron.test.js`, new crypto test |
| 5a | Every `.item-bullets-group` in `#resume` has an `id` present in `CONTENT_INDEX` | new |

### Manual verification (not automatable here)

1. **Windows High Contrast Mode**, or Chrome DevTools → Rendering → *Emulate
   forced-colors: active*: the job title, all section headings and all six stat numbers
   must remain visible (Phase 2b).
2. **`prefers-contrast: more` emulated in Chrome**: review both corrected blocks
   rendered. They have never executed in Chrome or Firefox and are effectively new code
   (Phase 2c).
3. **Real iOS Safari**, portrait *and* landscape: tap every auth field, the contact form
   and the json/diff/crypto editors — the viewport must not zoom (Phase 3b).
4. **A notched iPhone with the PWA installed**: the sticky header must clear the status
   bar (Phase 3d).
5. **A phone on `#activity`**: drag the pipeline strip horizontally — it must scroll to
   "Postgres" and must not navigate to an adjacent section (Phase 3a).

### Suggested sequencing

Phases are independent and can ship separately. Recommended order — highest
user-impact-per-unit-risk first:

1. **Phase 3a** — one attribute, fixes a navigation trap. Ship alone.
2. **Phase 2a + 2b** — measured contrast and forced-colors; small, self-contained.
3. **Phase 4a** — one function, fixes a visible permanent regression.
4. **Phase 1** — the structural fix; largest blast radius, wants its own review.
5. **Phase 3b/3c, 4b–4g** — mechanical consistency sweeps, batchable per app.
6. **Phase 2c, 5, 6** — the corrected contrast blocks need visual review; Phase 6 is
   discretionary.

---

## 7. Assumptions

1. **No implementation was performed.** The request was for a review and a plan; this
   spec is the plan. Every line reference is against the working tree at the time of the
   audit.
2. **iOS zoom-on-focus** (the 16px threshold) is applied from well-established browser
   behaviour; no device or simulator was available to confirm empirically. The CSS values
   cited are computed from the token definitions under a 16px root.
3. **`prefers-contrast: high` browser support** is asserted from the Media Queries Level 5
   specification and shipped-browser history (Safari accepts `high` as a legacy alias;
   Chrome and Firefox implement only `more`/`less`/`custom`/`no-preference`). Worth a
   quick runtime confirmation before the edit, since the whole fix rests on it.
4. **Contrast figures are computed**, not measured against a rendered page, so they
   assume the element sits on a flat `--bg` with no glass surface or gradient behind it.
   `.link-action` does; a control over `.glass-light` would need re-measuring.
5. **The mobile bottom nav is feature-flagged off** (`--mobile-bottom-nav: 0`,
   `styles.css:410`, gated by `bottomNavEnabled()` at `navigation.js:516-522`), so its CSS
   region is dead in production and was not audited further. Its `min-height: 44px`
   (`styles.css:12298`) is already correct for whenever the flag flips.
6. **Findings are static-code-verified**, not runtime-confirmed — no browser, axe-core,
   VoiceOver or TalkBack pass was run. The manual list above is what would close that gap.
7. **The predictors were assessed but produce no findings here.** Their third-party asset
   loads are a recorded exception, their bracket layouts are explicitly out of scope, and
   a check of their interactive controls found no icon-only button lacking an accessible
   name.
