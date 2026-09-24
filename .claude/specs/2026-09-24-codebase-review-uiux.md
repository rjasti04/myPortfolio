# Technical Specification: Whole-Codebase Review §4 — UI/UX Remediation

**Related Intent**: `.claude/intents/2026-09-24-codebase-review-uiux.md`
**Source report**: `docs/review/codebase_review_20260924.md` §4 (U1–U12)
**Target Audience**: Visitor / Recruiter first, then Work Sample and Owner
**Status**: planned, phases A–E. Nothing is implemented yet.
**Tree**: line numbers are at `8e44ed9`: the report's `f33d629` plus the §1
and §2 implementations. Those moved lines in `index.html`, `auth-ui.js` and
`chat.js` only. For those three files, use the numbers here, not the
report's.

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA: `frontend/index.html` (markup only, no inline script),
        `frontend/js/auth-ui.js`, `chat.js`, `confetti.js`,
        `terminal/palette.js`, `owner-analytics.js`,
        `frontend/auth-modal.css`, `frontend/styles.css`,
        `scripts/generate_resume.py` (writes part of `index.html`)
  - [x] Standalone apps: `frontend/ucl.html`, `frontend/worldcup.html`,
        `cron.html`/`.css`, `crypto.html`/`.css`, `json.html`, `diff.html`,
        `arcade.html`/`.css`, `app-chrome.css`, `js/app-shared/*.js`,
        `js/cron/*`, `js/crypto/*`, `js/diff/diff-ui.js`,
        `js/json/json-main.js`
  - [x] Build: `scripts/build.mjs` (one new IIFE entry, Phase E)
  - [ ] Backend API: not touched
  - [ ] Database Schema: not touched
  - [ ] CI/CD & Deploy: not touched

- **One new file**: `frontend/js/app-shared/theme-prepaint.js`, a classic
  (non-module) script built as an IIFE, which follows the precedent of
  `js/theme-bootstrap.js` (`build.mjs:345-353`). There is no new ES module
  and no new import edge between the SPA group and the apps group.

- **Delivery**: five phases, one commit each, in order. Each phase runs the
  gates once, after its last edit (§6).

| Phase | Findings | Surface | Why grouped |
| :--- | :--- | :--- | :--- |
| **A** | U1, U7 (password toggle) | SPA header, auth dialog | The P1. `auth-ui.js` and `auth-modal.css` only |
| **B** | U3, U8 (SPA), U10 (chat status), U11 (SPA) | SPA chat, `index.html` structure | Every SPA file except the header. Also the resume generator |
| **C** | U2, U5, U6 (confirm), U7 (arrows), U8, U9, U10, U11 (Random Fill), U12 (confirm) | `ucl.html`, `worldcup.html` | Two self-contained files, fixed side by side so they stay in step |
| **D** | U4, U6 (1–5), U11 (apps) | Dev Tools and arcade: markup, CSS, `app-shared` | Focus visibility and ARIA semantics |
| **E** | U5, U6 (confirm), U8, U10, U12 | Dev Tools and arcade: JS behaviour, build | Storage, motion, feedback, theme flash, confirm parity |

---

## 2. API Contract & Schemas

None. No route, schema, status code or response body changes.

---

## 3. Database Schema & Migration Plan

None.

---

## 4. Implementation & Acceptance

Each finding has its change and its **acceptance** test. A test named as
"new" goes into the existing file named, unless a new file is given.

### Phase A: account menu and password toggle

**U1: the account control becomes a disclosure button**
(`auth-ui.js:1488-1575`)

```html
<button type="button" class="nav-user-profile" id="nav-user-btn"
        aria-expanded="false" aria-controls="nav-user-dropdown">
  <span class="nav-user-icon" aria-hidden="true">${escapeHTML(initial)}</span>
</button>
<div class="nav-user-dropdown" id="nav-user-dropdown">
  <button type="button" class="nav-dropdown-item" id="nav-2fa-btn">
    <i class="fas fa-shield-halved" aria-hidden="true"></i> …
  </button>
  … (all five items: type="button", icon aria-hidden)
</div>
```

- **Name**: after the `innerHTML` render,
  `profileBtn.setAttribute('aria-label', \`Account menu for ${name}\`)` and
  the same `title`, where `name` is `user.username || user.email`. **Never
  interpolated** into the template (§4, DOM sanitization).
- `nav-user-icon` changes from `<div>` to `<span>`, because a `<button>`
  may hold phrasing content only. `display: flex` in its rule is
  unchanged. `escapeHTML` comes from `./utils.js`. `initial` is a single
  character, so this is defence in depth, not a fix for a live bug.
- **Open** (`click`, and so Enter and Space, which a native button already
  handles): `closeAllDropdowns()`, add `.show`, `aria-expanded="true"`,
  then focus the first item on the next animation frame. The rAF is needed
  for the same reason as `navigation.js:333-343`: the panel transitions in
  from `visibility: hidden`.
- **Keys** on the dropdown: ArrowDown and ArrowUp move between the five
  items and wrap at the ends. Home and End go to the first and last item.
  Escape closes the menu and focuses `#nav-user-btn`.
  `navigation.js:373-383` also handles that Escape, by closing everything,
  and its `openToggle` is `null` for this menu, so the two handlers don't
  conflict. `navigation.js` is not edited.
- **Leaving**: a `focusout` whose `relatedTarget` is outside both the
  button and the dropdown closes the menu without moving focus, so Tab
  walks on to the next control.
- **Choosing an item**: one local `closeMenu({ restoreFocus: true })`
  replaces the five bare `dropdown.classList.remove('show')` calls
  (`:1547-1573`). It also resets `aria-expanded`, which the current code
  leaves at `"true"`. It runs **before** the `request-*-modal` event is
  dispatched, because `openModal` records `document.activeElement` as its
  return target (`modal.js:124`). Today that is the item, which is
  `visibility: hidden` by the time the modal closes. After this change it
  is the button.
- **Logout**: the re-render replaces the button. Then, in a rAF, if focus
  is on `<body>`, move it to `#nav-login-btn`. This is the same fallback
  as `:175-180`.
- The dialog-close fallback at `:178` needs no change. It already focuses
  `#nav-user-btn`, which starts working once that is a button.
- Kept as they are: the `navUserMenuListeners` AbortController (`:1458-1539`)
  and the `isRejectedResponse` branch (`:1585`), both from §1 (C4 and the
  listener leak).
- **CSS** (`auth-modal.css:237-253`, `:298-322`): `.nav-user-profile` gains
  `padding: 0; background: transparent; font: inherit;`. It gains a
  `:focus-visible` rule, `outline: 2px solid var(--focus-ring);
  outline-offset: 2px`, the token the same file already uses at `:591`.
  `.nav-dropdown-item:focus-visible` uses the `:hover` background plus the
  same outline.

**U7 (password toggle)** (`auth-modal.css:557-592`, `:339-356`)

```css
.password-toggle-btn {
  right: 4px;
  width: var(--min-touch-target);   /* 44px; 48px on coarse pointers (styles.css:464) */
  height: var(--min-touch-target);
  border-radius: 8px;
}
.auth-form .floating-label-group .input-wrapper:has(> .password-toggle-btn) input {
  padding-right: calc(var(--min-touch-target) + 8px);
}
```

The input is at least 52 px tall (`:341`), so a 44–48 px target fits
inside it vertically. The other inputs keep their 40 px right padding.

**Acceptance** (`frontend/tests/auth-nav-session.test.js`, new tests):
1. `#nav-user-btn` is a `BUTTON` with `type="button"`, `aria-expanded="false"`,
   `aria-controls="nav-user-dropdown"`, and an `aria-label` that contains
   the username.
2. A username of `"><img src=x onerror=alert(1)>` yields no `<img>` in
   `#nav-auth-container`, and the label holds the string exactly as typed.
3. Clicking opens it: `aria-expanded="true"`, and after rAF the focus is on
   `#nav-2fa-btn`. ArrowDown ×5 wraps back to the first item, and End goes
   to `#nav-logout-btn`. Escape leaves it closed, with
   `aria-expanded="false"` and focus on `#nav-user-btn`.
4. Clicking "Change Password" closes it and sets `aria-expanded="false"`.
   Focus is on `#nav-user-btn` at the moment `request-change-password-modal`
   fires.
5. The existing "keeps one outside-click listener however often the header
   re-renders" test still passes, unchanged.
6. (`auth-register.test.js`) Static CSS: `.password-toggle-btn` takes its
   width and height from `var(--min-touch-target)`.

**Evidence** (one Playwright check, §6): at 375 px, the toggle's bounding
box is at least 44 × 44 and lies inside the input's right padding.

### Phase B: SPA chat, motion and structure

**U3: chat semantics** (`chat.js`)

1. `setInputState` (`:1710-1739`): set `aria-label` whenever `title` is
   set, on both send buttons: `'Stop generating'` while busy, `'Send
   message'` otherwise. `title` uses the same strings. The two glyphs
   written into `innerHTML` gain `aria-hidden="true"`. The static
   `aria-label="Send message"` at `index.html:2040,2113` stays as the
   initial value.
2. `aria-busy` moves from the inputs and forms (`:1720-1723`, `:1731-1733`)
   to the two message lists, `aiPageMessages` (`:85`) and
   `messagesContainer` (`:79`): `"true"` while streaming, removed when the
   stream ends. The lists keep `aria-live="polite"` (`index.html:2020,2103`).
   The single "Response received" announcement (`:2240`) stays.
3. The truncation warning (`:1323-1332`) becomes visible text:
   `<span class="msg-truncated"><i class="fas fa-exclamation-triangle"
   aria-hidden="true"></i> Cut off at the length limit</span>`. The inline
   `style` assignments and the `title` go. The token count goes too: the
   server's ceiling is 2048 (`bedrock_service.py:207,277`), not 2000, and
   ADR-023 makes the server its owner. The new `.msg-truncated` rule in the
   chat region of `styles.css` uses `.warning-icon`'s colour (`:9228`).
4. `announceToScreenReader` (`:2488-2512`) writes to the permanent
   `#route-announcer` (`index.html:436`), instead of creating and removing
   a node that already holds its text:

   ```js
   function announceToScreenReader(message) {
     const announcer = document.getElementById('route-announcer');
     if (!announcer) return;
     announcer.textContent = '';
     requestAnimationFrame(() => { announcer.textContent = message; });
   }
   ```

   Clearing it first means a repeated message is announced again.
   `navigation.js:191-193` writes route labels to the same node. Both
   writers are polite, and whichever writes last is read.

**U8 (SPA)**
- `confetti.js`: `import { prefersReducedMotion } from './config.js'`, and
  `if (prefersReducedMotion.matches) return;` as the first statement of
  `triggerConfetti`. `form.js:389` is not changed.
- `chat.js:1254`, `:1265-1268`: `behavior: prefersReducedMotion.matches ?
  'auto' : 'smooth'`. `chat.js` already imports it (`:2`).
- `terminal/palette.js:192`: the same, importing from `../config.js` as
  `terminal/index.js:2` does.

**U10 (chat status)** (`index.html:2090`)
- The span gains `id="chat-status"`. A new `syncChatStatus()` in
  `initChat` sets its text and a `data-state`:
  - `isApiConfigured()` is false: **Unavailable** (`unavailable`).
  - `navigator.onLine` is false: **Offline** (`offline`).
  - Otherwise: **Online** (`online`).
- It runs at init and on the window's `online` and `offline` events.
- The green treatment in `styles.css` is scoped to `[data-state="online"]`.
  The other two states use `--muted`.

**U11 (SPA)**
- **Headings**: each view goes h1 → h2 → h3 with no skipped level.
  - `index.html`: promote h3 → h2 at `:1378,1390,1402,1414` (hobbies),
    `:1472,1497,1523,1549,1575,1600,1626` (apps), `:1715,1733` (activity)
    and `:1859` (contact).
  - The Experience section (`:1149` h3, `:1162-1270` h4) is **generated**
    by `scripts/generate_resume.py:168,200`. The generator changes to emit
    h2 and h3, and is re-run. CI runs its `--check`, as does
    `tests/backend/unit/test_resume_context.py:28`, so a hand edit would
    fail. `#resume .item h3` (`styles.css:4705,5010`) becomes
    `#resume .item h2`.
  - `owner-analytics.js:135,193,202`: h3 → h2 and h4 → h3, so the owner
    panel stays a peer of the visitor's cards in `#activity`.
- **Auth actions**: `index.html:2180-2181`, the `<a href="#">` for "Forgot
  password?" and "Magic link", become `<button type="button">`. The
  `.forgot-password-link` rule gains a button reset: `background: none;
  border: 0; padding: 0; font: inherit; cursor: pointer`. The click handlers'
  `preventDefault()` becomes redundant, and stays harmless.
- **Label in name**: "Ask AI" (`index.html:877`) gets
  `aria-label="Ask AI assistant"`. The label begins with the visible text.
- **Icons**: every decorative `<i class="fa…">` in `index.html` gains
  `aria-hidden="true"`. The ones inside the generated regions are fixed in
  `generate_resume.py`. The same applies to icons that `auth-ui.js`
  generates.
- **Palette** (`terminal/palette.js:118-124`): the empty-results branch calls
  `field.removeAttribute("aria-activedescendant")` before it returns.

**Acceptance**:
1. `chat-stop.test.js`: while generating, both send buttons have
   `aria-label="Stop generating"`. After the stream ends, they have
   `"Send message"`. During the stream the message list has
   `aria-busy="true"`, and the input and form have no `aria-busy`. After
   the stream ends, the list has none either. No existing test asserts
   `aria-busy` on the chat input (the ones in `contact-form.test.js` are
   about the contact form, which is not changed).
2. `chat-render.test.js`: a truncated reply contains the visible text "Cut
   off at the length limit" and no "2000".
3. `chat-render.test.js`: `announceToScreenReader` changes
   `#route-announcer`'s text and appends no node to `<body>`.
4. `chat-render.test.js`: `#chat-status` reads "Unavailable" when no API is
   configured. Dispatching `offline` makes it "Offline", and `online` brings
   back "Online".
5. `contact-form.test.js`: with `matchMedia('(prefers-reduced-motion:
   reduce)')` matching, a successful submit appends no `<canvas>`.
6. `route-semantics.test.js`: **no section skips a heading level**. Walking
   each `section`'s headings in document order, each level is at most one
   more than the level before it.
7. `route-semantics.test.js`: every `<i class="fa…">` in `index.html` has
   `aria-hidden="true"`.
8. `route-semantics.test.js`: no `<a href="#">` remains in `index.html`.
9. `terminal.test.js`: typing a query with no matches leaves the field with
   no `aria-activedescendant`.
10. `python3 scripts/generate_resume.py --check` passes after the generator
    is re-run.

### Phase C: the two predictors

**U2: focus survives a re-render.** Both files use one mechanism. Every
focusable that a render creates gets a stable `data-focus-key` built from
data, not position:

| Element (`worldcup.html`) | Key |
| :--- | :--- |
| Group row `li` (`:2006`) | `row:${team.code}` |
| Reorder buttons (`:2022-2023`) | `up:${team.code}`, `down:${team.code}` |
| Wildcard card (`:2184-2187`) | `wild:${groupLetter}` |
| Match row (`:2451-2453`) | `pick:${matchId}:${team.code}` |

```js
function renderAllViews() {                         // worldcup.html:1967
  const focusKey = document.activeElement?.closest?.("[data-focus-key]")?.dataset.focusKey ?? null;
  // … existing renders …
  if (focusKey) restoreFocus(focusKey);
}
function restoreFocus(key) {
  const nodes = [...document.querySelectorAll(`[data-focus-key="${key}"]`)];
  const target = nodes.find((n) => n.getClientRects().length) ?? nodes[0];
  if (!target) return;
  target.focus({ preventScroll: true });
  if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "nearest" });
}
```

- A key follows the **team**, so after ArrowUp the focus is on the same
  team at its new rank. The desktop and mobile brackets can both render a
  key, and the visible one wins.
- Keys are built only from team codes, group letters and match ids, all
  generated by the page, so no `CSS.escape` is needed.
- In `ucl.html`, knockout rows (`:2698-2704`) get
  `pick:${matchId}:${team.name}`, and `renderAllViews` gets the same
  snapshot and restore. The league table's `pendingFocusRank`
  (`:2154,2426-2441`) stays as it is, because it works and has tests. The
  generic restore runs only when `pendingFocusRank` is `null`.
- **World Cup semantics** (matching `ucl.html:2701-2704`):
  - Match rows get `role="button"` and `aria-pressed="${isWinner}"`, with
    `aria-label` set to `${label}: pick ${team.name} to go through`.
  - Wildcard cards get `role="checkbox"` and `aria-checked="${isSelected}"`,
    with `aria-label` set to `Advance ${name}, third in Group ${g}`. The
    state leaves the label text. Their keydown (`:2202`) already handles
    Space and Enter. Verify that during implementation.

**U5 (`/worldcup`)**: wrap `saveStateToLocalStorage` and
`loadStateFromLocalStorage` (`:2671-2682`) in `try/catch`, exactly as
`ucl.html:3062-3077` does. `saveStateToLocalStorage` returns `true` or
`false` in both files, because U9 needs that result.

**U6 (6), confirm announcement**: in `armTwoPress` (`worldcup.html:3146-3170`,
`ucl.html:3377-3401`), arming saves the button's `aria-label` and replaces it
with `${armedLabel}: press again to confirm`. Disarming restores the saved
label. The timeout stays at 4 s.

**U7 (arrows)**: each arrow's hit area stops at the midline of the gap
between the two arrows.

```css
/* worldcup.html mobile block, replacing :676-684. Gap is 4px (:658). */
.reorder-btn::after { content: ''; position: absolute; left: -8px; right: -8px; z-index: 10; }
.reorder-up::after   { top: -10px; bottom: -2px; }
.reorder-down::after { top: -2px;  bottom: -10px; }

/* ucl.html, replacing :626-630. Gap is 2px (:611); 8 + 15 + 1 = 24px tall (WCAG 2.5.8). */
.reorder-up::after   { content: ''; position: absolute; inset: -8px -6px -1px; }
.reorder-down::after { content: ''; position: absolute; inset: -1px -6px -8px; }
```

**U8 (`/worldcup`)**:
- Add the `ucl.html:1487-1496` reduced-motion block. It shortens durations
  to `0.001ms` and does **not** set `animation: none`, because the toast is
  removed on `animationend` (`:1865-1867`).
- `triggerGoldPodiumCelebration` (`:2873`) shows its toast and then returns
  before drawing when reduced motion is on, as `ucl.html:3170-3176` does.

**U9: a shared link wins, and the visitor's own bracket is kept.** Both
files:

```js
const OWN_KEY = `${STORAGE_KEY}:own`;     // worldcup's STORAGE_KEY is "predictor-state"

function loadStateFromUrl() {
  const serial = new URLSearchParams(location.search).get("s");
  if (!serial) return false;
  const saved = readStored(STORAGE_KEY);   // try/catch → null
  if (!deserializeState(serial)) return false;
  if (saved && saved !== serial && readStored(OWN_KEY) === null) writeStored(OWN_KEY, saved);
  if (saveStateToLocalStorage()) history.replaceState({}, document.title, location.pathname);
  return true;
}
```

- `worldcup.html:1878-1884` changes to the `/ucl` order:
  `if (!loadStateFromUrl() && !loadStateFromLocalStorage()) resetToDefaults(false);`
- `?s=` is dropped from the address bar **once the state is saved**.
  Without this, a reload re-applies the link and throws away any edits the
  visitor has made since. If storage is blocked, the parameter stays, and
  it is the only copy.
- **Banner**: when `OWN_KEY` is present, an inline
  `<div class="shared-banner" role="status">` sits above the bracket and
  reads "You're viewing a shared bracket." It has two buttons:
  - **Restore my bracket**: deserialize `OWN_KEY`, save it, remove
    `OWN_KEY`, re-render, and toast "Your saved bracket is back."
  - **Keep this one**: remove `OWN_KEY` and hide the banner.
- The backup slot is written only when it is empty, so a second link opened
  before the visitor chooses can't overwrite the visitor's own bracket
  with the first friend's.
- `resetToDefaults` removes `OWN_KEY` as well.

**U10 (predictors)**:
- **Copy** (`worldcup.html:3185-3206`, `ucl.html:3344-3355`): the fallback
  checks `document.execCommand("copy")`'s return value. On failure, it
  runs `history.replaceState({}, "", shareUrl)` and shows a warning toast,
  "Couldn't copy. The link is in the address bar now." The `alert()` goes.
- **Toast** (`worldcup.html:1851-1868`, `ucl.html:2203-2219`): port the
  behaviour of the SPA's `showToast` (`js/utils.js:46-110`):
  - A close button, with `aria-label="Dismiss notification"`.
  - `role="alert"` for warnings, `role="status"` otherwise.
  - 3.2 s, with the timer held while the toast has hover or focus.
  - Removal on `animationend`, with a timeout as the floor.

**U11 (Random Fill)**: the label begins with the visible text.
- `ucl.html:1778`: "Random fill: every undecided tie across the bracket".
- `worldcup.html:1474`: "Random fill: every undecided stage and match".

**Acceptance** (`worldcup-bracket.test.js`, `ucl-bracket.test.js`):
1. Enter on a match row: afterwards `activeElement.dataset.focusKey` is the
   same key, and `aria-pressed="true"`. Both files.
2. ArrowUp on a group row (`/worldcup`): focus is on `row:${code}`, one rank
   higher.
3. Space on a wildcard card: `aria-checked` flips, and focus stays on
   `wild:${g}`.
4. With a `localStorage` whose getter throws, `/worldcup` still renders 12
   groups, and a pick doesn't throw.
5. With a saved bracket A and a URL holding bracket B, the page shows B,
   the banner is visible, `OWN_KEY` holds A, and the address bar has no
   `?s=`. Restore brings A back and removes `OWN_KEY`. Both files.
6. With a clipboard that rejects and `execCommand` returning `false`, the
   toast is a warning and the location carries `?s=`.
7. When armed, Reset's `aria-label` ends ": press again to confirm", and it
   is restored after the timer. Both files.
8. A toast has a "Dismiss notification" button, and pressing it removes the
   toast.
9. Static CSS: `worldcup.html` has a `prefers-reduced-motion: reduce` block.
10. The existing "header contains autofill-btn … accessible attributes"
    test (`worldcup-bracket.test.js:41`) is updated to the new label.

**Evidence** (one Playwright check per page, §6): at 375 px, calling
`elementFromPoint` 1 px above the midline between a row's two arrows
returns the up button, and 1 px below it returns the down button.

### Phase D: Dev Tools focus and semantics

**U4**:
- `cron.css:407-409` and `crypto.css:249-251`: `.panel-container:focus {
  outline: none; }` becomes:

  ```css
  .panel-container:focus:not(:focus-visible) { outline: none; }
  .panel-container:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  ```

- `.hash-input` and `.field-output` (`crypto.css:803-812,990-999`) join the
  existing `:focus-visible` group at `crypto.css:868-872`.
- The report's `var(--focus-ring)` is not used: no Dev Tools stylesheet
  defines it.

**U6 (1–5)**:
1. `crypto.html:354` and `json.html:242`: the file input gains
   `aria-hidden="true" tabindex="-1"`, which is `diff.html:187`'s pattern.
2. Diff's Split/Unified buttons get `aria-pressed`:
   - In the markup, from the default view.
   - When preferences are restored.
   - In the click handler at `diff-ui.js:464-469`:
     `other.setAttribute("aria-pressed", String(other === button))`.
3. Shortcuts sheet (`app-shortcuts.js:100-112`): while it is open, a keydown
   on the sheet with Tab keeps focus among the sheet's focusable elements,
   of which there is one today, the close button. The trap is local, about
   eight lines. `app-shared` does **not** import the SPA's `modal.js`: that
   module's visibility filter relies on `offsetParent`, and the build keeps
   the two module groups apart.
4. Apps switcher (`app-switcher.js:52-97`):
   - Drop `role="menu"` from the panel, `role="menuitem"` from the links,
     and `aria-haspopup` from the trigger.
   - Keep `aria-expanded`, `aria-controls`, Escape-to-trigger and
     focus-first-link on open.
   - `setOpen` focuses the first `a`.
   - It is a disclosure of links. Tab moving through the eleven links while
     it is open is correct for that pattern. The CSS is class-based, so it
     is unaffected.
5. `/crypto` status: `<p class="visually-hidden" id="crypto-status"
   role="status" aria-live="polite">` goes in `crypto.html`'s `<main>`.
   `crypto-ui.js` writes to it on two occasions only:
   - When an output **enters** an error state, or its error message changes
     (`:159-163`, `:277-283`).
   - When an explicit button action finishes: "Output updated."
   Live results as the visitor types are not announced (`:189` and others
   fire on every keystroke).

**U11 (apps)**:
- `cron.html:74`, `crypto.html:75`, `diff.html:66` and `json.html`'s brand:
  `<div class="brand-title">` becomes `<h1 class="brand-title">`. The
  `.brand-title` rules in `app-chrome.css` and `cron.css` gain `margin: 0`,
  and keep their explicit `font-size`.
- `json.html:195` "Source document" goes from `<h1>` to `<h2>`. Any
  `h1.card-title` selector in the json stylesheet moves with it.
- `arcade.html`: the launcher and the stage are wrapped in
  `<main id="main-content">`.
- Label in name: `crypto.html:99` becomes "Share: copy a link to this tab
  and its settings". Any other app's `.action-btn` that the test below
  catches is fixed the same way.

**Acceptance**:
1. `app-shared.test.js`, static, across
   `cron.css` and `crypto.css`: no `.panel-container:focus { outline: none }`
   without a matching `:focus-visible` rule. `.hash-input` and
   `.field-output` appear in a `:focus-visible` selector.
2. `app-shared.test.js`: in every app page, each `input[type=file]` has
   `tabindex="-1"` and `aria-hidden="true"`.
3. `diff-render.test.js`: clicking Unified sets `aria-pressed="true"` on it
   and `"false"` on Split.
4. `app-shared.test.js`: with the sheet open, Tab and Shift+Tab leave focus
   inside `#shortcuts-sheet`.
5. `app-shared.test.js`: the switcher has no `[role="menu"]` or
   `[role="menuitem"]`. The existing Escape test (`:67`) is updated to select
   `a`, and still passes.
6. `crypto-encoders.test.js`: invalid Base64 input puts the error text in
   `#crypto-status`, and a second keystroke that is still invalid, with the
   same message, doesn't rewrite it.
7. `app-shared.test.js`: each of `cron`, `crypto`, `json` and `diff` has
   exactly one `<h1>`, and `arcade.html` has a `<main>`.
8. `app-shared.test.js`: in every app page, each `.action-btn` that holds an
   `.action-label` has an `aria-label` that begins with that label's text,
   ignoring case.

### Phase E: Dev Tools resilience and consistency

**U5**: `crypto-main.js:70` and `cron-main.js:287` read the theme with the
`json-main.js:80-87` guard. That means `try/catch`, and accepting only
`"light"` or `"dark"`, falling back to the system theme.

**U8 (apps)**: each of `cron-main.js:102,118`, `crypto-main.js:112,128` and
`diff-ui.js:329` passes
`behavior: reduceMotion() ? "auto" : "smooth"`, with one local helper per
module:
`const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;`.

**U10 (apps)**:
- **Copy**:
  - The textarea fallbacks in `cron-ui.js:438-457`, `regex-ui.js:367-385`
    and `crypto-ui.js:60-81` return `document.execCommand("copy")`'s result,
    inside a `try`. A `false` result or a throw shows "Copy failed" and
    skips the `.copied` class.
  - That is the wording `json-ui.js:146` uses.
- **`/cron` toast** (`cron-main.js:35-50`): 3.2 s, held on hover and focus.
  The text goes in a child `span` and a "Dismiss notification" button sits
  beside it, so `textContent` no longer overwrites the button.
- **`/diff` file load** (`diff-ui.js:333-344`):
  - Each pane gets `<p class="pane-note" role="status">` in `diff.html`.
  - The 5 MB refusal and a new `catch` around `file.text()` ("Couldn't read
    that file.") write there.
  - `window.alert` goes.
  - The note clears on the next successful load or input.
- **`/` shortcut** (`app-shortcuts.js:28-35`): if
  `!target || target.closest("[hidden]") || target.disabled`, return
  `false` **before** `preventDefault()`, so the keystroke reaches the page.

**U12**:
- **Arcade switcher**:
  - `arcade.html:97` gains `back-btn` (`class="btn back-btn"`).
  - `arcade.css` gains an `.app-switcher-trigger` rule that matches its
    `.btn`, with the trigger's `.action-label` visually hidden. Arcade's
    header buttons are icon-only.
  - This is the gap the report missed: `app-switcher.js:51` gives the
    trigger `action-btn`, which only `app-chrome.css` styles.
- **Theme flash**: `js/app-shared/theme-prepaint.js`:

  ```js
  (function () {
    var theme = null;
    try { theme = localStorage.getItem("theme"); } catch (e) { /* storage blocked */ }
    if (theme !== "light" && theme !== "dark") {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.setAttribute("data-theme", theme);
  })();
  ```

  - It is loaded as `<script src="js/app-shared/theme-prepaint.js"></script>`
    in the `<head>` of `cron.html`, `crypto.html`, `json.html` and
    `diff.html`, after the meta tags and before the first stylesheet.
  - `data-theme="dark"` stays in the markup as the no-JS default.
  - `script-src 'self'` already allows it, so no CSP changes.
  - The apps' own theme code still runs and still syncs
    `<meta name="theme-color">`.
  - `build.mjs`: a third IIFE build next to `theme-bootstrap.js`
    (`:345-353`), registered in `rewrites` under
    `"js/app-shared/theme-prepaint.js"`. The existing all-pages text rewrite
    (`:471-504`) then points the four pages at the hashed file.
- **Confirm parity**:
  - `diff-ui.js:542-551`, `json-main.js:176-185` and `crypto-ui.js:652-661`
    move from 3 s to 4 s, and take the armed `aria-label` from Phase C.
  - `/crypto` moves from `.confirming` to `.is-confirming`, and
    `app-chrome.css:220`'s `.action-btn.confirming` selector goes.

**Acceptance**:
1. `storage-blocked.test.js`, new cases: with a throwing `localStorage`,
   `/crypto` wires its tabs (a tab click changes the panel), and `/cron`'s
   theme toggle flips `data-theme`.
2. `cron.test.js` and `crypto-*.test.js`: with reduced motion matching, the
   stubbed `scrollTo` and `scrollIntoView` receive `behavior: "auto"`.
3. `copy-feedback.test.js`: with the clipboard rejecting and `execCommand`
   returning `false`, the cron, regex and crypto copy buttons read "Copy
   failed", not "Copied!".
4. `diff-render.test.js`: loading a 6 MB file writes the refusal to the
   pane note. A stub `window.alert` that throws is never called.
5. `app-shared.test.js`: `/` with the primary input inside a `hidden` panel
   returns `false`, and doesn't call `preventDefault`.
6. `app-shared.test.js`: `initAppSwitcher` on `arcade.html` returns non-null,
   and the Back link keeps `href="/"`. Statically, `arcade.css` has an
   `.app-switcher-trigger` rule.
7. New test in `app-shared.test.js`: running `theme-prepaint.js` in jsdom
   with `theme=light` stored gives `data-theme="light"`. With a throwing
   `localStorage` and a light `matchMedia`, it also gives `"light"`.
8. `build.test.js`: each of the four `dist/` pages references an
   `assets/theme-prepaint-*.js` that exists, inside `<head>`, before the
   first `<link rel="stylesheet">`.
9. `app-shared.test.js`: in the three apps, the confirm class is
   `is-confirming` and the disarm timeout is 4000 (fake timers).

### DOM sanitization

- **U1** is the one new user-controlled value to reach the DOM: the
  username, in an attribute. It goes through `setAttribute`, never through
  the `innerHTML` template. Acceptance test A2 pins that.
- Everything else written to `innerHTML` in this work is a fixed string or
  a glyph. The predictors' existing `escapeHtml` use for team names is
  unchanged. The `/crypto` status region and the `/diff` pane notes use
  `textContent`.

### Styling

- No new design tokens. The focus rings use `--focus-ring` in the SPA and
  `--primary` in the Dev Tools apps, as each already does. Touch targets use
  `--min-touch-target`.
- Tag promotions (`div`→`button`, `div`→`h1`, `h3`→`h2`, `a`→`button`)
  must render exactly as before. Each promoted element's class rule states
  `font-size` and `margin`, and each new button resets `background`,
  `border`, `padding` and `font`. §6 checks this.
- New visible elements (`.msg-truncated`, the predictors' `.shared-banner`,
  the toast close buttons, `/diff`'s `.pane-note`) reuse the surrounding
  file's existing colours and radii. None of them introduces a new visual
  language.

---

## 5. Security & Rate Limiting Review

- [x] No endpoint, rate limit or auth dependency changes.
- [x] No secret or token enters the DOM. The one new user-controlled value
      in the DOM is the username in `aria-label`, set with `setAttribute`
      (test A2).
- [x] No inline `<script>` in `index.html` is edited, so the three pinned
      hashes don't move. The Dev Tools pages keep `script-src 'self'`, and
      the new script is same-origin.
- [x] No new origin (ADR-016).
- [x] U9 writes one more `localStorage` key per predictor. It holds only a
      serialized bracket, which is the same data the page already stores.

---

## 6. Verification & Test Plan

Run each gate **once, after the last edit of that phase**. If one fails, fix
it and re-run that gate alone (`AGENTS.md` §6).

```bash
# Every phase
npm run lint
npm test                      # also builds dist/ and runs scripts/tests/build.test.js
python3 scripts/check_csp_hashes.py          # must pass with NO re-pin
python3 scripts/check_docs.py --fix --show-tokens

# Phase B only (the resume generator)
python3 scripts/generate_resume.py --check
PYTHONPATH=. pytest tests/backend/unit/test_resume_context.py
```

**Style parity and the geometry evidence.** Phases A–E change structure,
not appearance. Each phase runs **one** Playwright script against a static
server of `dist/`, using Chromium from `/opt/pw-browsers`. It records
`getComputedStyle` for every element whose tag or class changed: `font-size`,
`font-weight`, `margin-*`, `padding-*`, `background-color`, `width` and
`height`. The same values are recorded on the phase's parent commit and after the
phase's edits, and every value must be equal. It uses two
widths, 375 and 1280, and no screenshots. The two geometry checks ride in
the same script:
- **A**: the password toggle's box.
- **C**: `elementFromPoint` at the arrow midlines.

**Docs changed with the code**, in the same commit as the change they
describe:

| Phase | Doc | Change |
| :--- | :--- | :--- |
| A | `docs/JAVASCRIPT.md` (`auth-ui.js`) | The account menu is a disclosure button: keys, focus return, label set with `setAttribute` |
| A, B | `docs/FRONTEND.md` "Accessibility" (`:968-982`) | The account menu is keyboard-operable. Chat announcements go through `#route-announcer`, with `aria-busy` on the list. Views don't skip heading levels |
| B | `docs/JAVASCRIPT.md` (`chat.js`, `confetti.js`, `terminal/palette.js`, `owner-analytics.js`) | Chat status states. Reduced-motion guards. Heading levels |
| C | Wherever the predictors' `?s=` behaviour is described (`grep -rn '?s=' docs/`) | A link wins, the visitor's bracket is backed up once, and the banner |
| D | `docs/FRONTEND.md` "App chrome" (`:530-620`) | The Apps switcher is a disclosure of links, not an ARIA menu |
| E | `docs/FRONTEND.md` "App chrome" theming paragraph (`:610-618`) | The four Dev Tools pages resolve the theme before first paint through `theme-prepaint.js`. The sentence about inline scripts in `ucl.html` and `worldcup.html` stays |
| E | `docs/FRONTEND.md` "The build" (`:949`), `docs/JAVASCRIPT.md` tree (`:28`) and a new module section | The new IIFE entry |

`check_docs.py --fix` repairs the per-module counts in `docs/JAVASCRIPT.md` and
`docs/TESTING.md` that the new tests move.

**Report update.** `docs/review/codebase_review_20260924.md` is edited only
after a phase's gates pass. Each U-finding is marked with its real outcome.
Where the fix differs from the report's suggestion (U4, U8, U9, U10, U12), it
says so.

### Sequencing with the report's other sections

| Other finding | Overlap | Rule |
| :--- | :--- | :--- |
| §1 C12 (Stop button) | Phase B edits `setInputState` again | `chat-stop.test.js` stays green. The new `aria-busy` assertion goes in beside its tests |
| §1 C4 and the listener leak | Phase A rewrites the markup inside `setupNavUI` | The AbortController and the `isRejectedResponse` branch are untouched. `auth-nav-session.test.js`'s existing three tests stay green |
| §2 S9 | `chat.js`, a different function | None |
| §3 PF1–PF6 | Backend only | None |
| §5 CS6 (the vendored `accessibility` skill) | This work may load the skill. It is never edited | None |

### Unverified going in

- **Assistive technology**: how NVDA, JAWS and VoiceOver treat `aria-busy`
  on a polite live list (U3), whether a changed `aria-label` on the focused
  button is announced when it is armed (U6), and whether two writers
  sharing `#route-announcer` ever swallow one another. None of this has been
  run with a real screen reader. It is the same gap the report records.
- **Touch (U7)**: `elementFromPoint` in Chromium is a proxy for a finger. The
  pitch between rows also has to exceed each arrow pair's hit area, so that
  one row's down arrow doesn't reach into the next row's up arrow. The
  Phase C script checks that too, but still not on a device.
- **Computed-style parity**: not yet known whether every class rule on a
  promoted element (`.app-tile-title`, `.hobby-title`, `.act-card-title`,
  `.contact-form-title`, `.act-owner-title`, `.brand-title`,
  `.forgot-password-link`) states its `font-size` and `margin`. The parity
  script finds any that don't, and those rules gain the missing
  declaration.
- **Icon count**: the report says 73 of 165 icons lack `aria-hidden`. A
  single-line grep at `8e44ed9` finds 165 icons and 87 with it, but it
  misses tags that span lines. Test B7 settles it.
- **World Cup wildcard keys**: that `:2202` handles Space as well as Enter.
  If it doesn't, Space is added, because `role="checkbox"` promises it.
- **`:has()`** in the U7 selector: supported in every browser the site
  targets since 2023. Stylelint's config has not yet been run against it.
- **ESLint** on a classic `var`-style file under `js/app-shared/`: the config
  (`.eslintrc.json`) has no `no-var` rule and `theme-bootstrap.js` already
  passes. Expected to pass. Confirmed only by Phase E's lint run.
