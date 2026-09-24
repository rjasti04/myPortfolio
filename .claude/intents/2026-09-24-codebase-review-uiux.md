# Intent: Whole-Codebase Review §4 — UI/UX Remediation

**Source report**: `docs/review/codebase_review_20260924.md`, §4 "UI/UX",
findings **U1–U12** (1 × P1, 8 × P2, 3 × P3). The report's line numbers refer to
`f33d629`. HEAD at the time of writing is `8e44ed9`, which carries the §1 and
§2 work. That work moved lines in `index.html`, `auth-ui.js` and `chat.js`; no
other file §4 cites has changed. The spec cites line numbers at `8e44ed9`.
**Companion spec**: `.claude/specs/2026-09-24-codebase-review-uiux.md`
**Status**: planned. Nothing is implemented yet. Implementation starts once
this and the spec are approved, in the five phases the spec sets out (A–E),
one commit per phase.

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter: all twelve findings land here. `AGENTS.md`
        ranks accessibility and mobile layout ahead of internal elegance, and
        this section of the report is where the site misses that. A keyboard
        user can't reach sign-out (U1). A keyboard user has to Tab back from
        the top of the page after every pick in either predictor (U2). A
        screen-reader user hears "Send message" on a Stop button (U3), and on
        phones a "move up" tap can move the team down (U7). A visitor with
        storage blocked gets a blank `/worldcup` (U5). Someone who opens a
        friend's shared bracket sees their own bracket instead (U9).
  - [x] 2. Portfolio as a Work Sample: the gaps an accessibility reviewer
        checks first are here: a `<div>` used as a button, `outline: none`
        with nothing to replace it, `role="menu"` without menu keyboard
        behaviour, `aria-modal` without a focus trap, skipped heading levels.
        The fixes the report proposes already exist elsewhere in the repo
        (`ucl.html`'s focus restore, `diff.html`'s hidden file input, the
        SPA's dismissable toast), so most of this work applies existing
        patterns to the pages that lack them.
  - [x] 3. Owner: the owner is the person most often signed in, so U1's menu
        is the owner's menu too.

- **Problem Statement**:
  Every finding was re-checked against the working tree before this was
  written, and **all 12 still reproduce**. The spec corrects six of the
  report's proposed fixes:

  1. **U9**: "offer 'Restore my saved bracket' as a secondary action, **as
     `/ucl` does**". `/ucl` has no such action. Its URL-first load
     (`ucl.html:3079-3085`) calls `saveStateToLocalStorage()` straight away,
     so opening a shared link **silently overwrites the visitor's own saved
     bracket**. The report missed this. Copying `/ucl`'s behaviour into
     `/worldcup` would fix the display bug and bring the data loss with it.
     Both predictors now keep one backup of the saved bracket before a
     shared link replaces it, and show a banner with a Restore action.
  2. **U12**: the report says the pre-paint theme script "adds a CSP hash only
     if those pages gain a CSP". They already have one. `cron.html`,
     `crypto.html`, `json.html` and `diff.html` each ship a CSP meta with
     `script-src 'self'` (`cron.html:7`), so an inline script would be
     blocked. Allowing it would need four new pinned hashes, and
     `check_csp_hashes.py` only checks `index.html`. The spec instead uses an
     external classic script, `js/app-shared/theme-prepaint.js`. That is the
     same approach the SPA already uses for `js/theme-bootstrap.js`.
  3. **U12**: adding `.back-btn` to arcade's Back link is not enough on its
     own. `initAppSwitcher` would then mount the Apps trigger with class
     `action-btn`, and `arcade.css` doesn't define `action-btn`, so the
     trigger would render as an unstyled browser-default button. The trigger
     needs a rule in `arcade.css` in the same change.
  4. **U4**: there is no `--focus-ring` token in the Dev Tools apps. Their
     existing focus style is `outline: 2px solid var(--primary);
     outline-offset: 2px` (`crypto.css:868-874`, `cron.css:348-352`). The fix
     uses that style.
  5. **U8**: `config.js` exports `prefersReducedMotion` as a
     `MediaQueryList`, not a function (`chat.js:1814` reads
     `prefersReducedMotion.matches`). The report's `prefersReducedMotion()`
     would throw. The Dev Tools apps don't import the SPA's `config.js`: the
     build keeps the two module groups apart (`scripts/build.mjs:355-367`).
     They get a local `matchMedia` check instead, in the same form as
     `ucl.html:3172`. The report also missed two smooth-scroll calls:
     `cron-main.js:118` and `crypto-main.js:128`.
  6. **U10**: "Reuse the SPA's dismissable toast" can't be done literally.
     `showToast` in `js/utils.js` depends on the SPA's `#toast-container`
     and on `styles.css`, the predictors are self-contained single files,
     and the Dev Tools apps don't import SPA modules. The spec copies the
     *behaviour* (a close button, a timer that pauses on hover or focus,
     3.2 s) into each app's own toast function.

  The spec also fixes these, found while re-checking:
  - **U1**: the account-menu items close the dropdown but leave
    `aria-expanded="true"` on the trigger (`auth-ui.js:1547-1573`).
  - **U1**: the full username goes into the new `aria-label`. `setupNavUI`
    builds that markup with `innerHTML`, so the label must be set with
    `setAttribute`, never interpolated into the template.
  - **U3**: the truncation tooltip says "2000 tokens". The server's ceiling
    is 2048 (`bedrock_service.py:207,277`), and ADR-023 makes the server the
    owner of that number, so the client should not repeat it.

  The 12 findings fall into five groups, and each group is one phase:

  | Phase | Group | Findings |
  | :--- | :--- | :--- |
  | A | SPA header and auth dialog | U1, U7 (password toggle) |
  | B | SPA chat, motion and document structure | U3, U8 (SPA), U10 (chat status), U11 (SPA) |
  | C | The two predictors | U2, U5 (`/worldcup`), U6 (confirm), U7 (arrows), U8 (`/worldcup`), U9, U10 (predictors), U11 (Random Fill), U12 (confirm) |
  | D | Dev Tools: focus and semantics | U4, U6 (1–5), U11 (apps) |
  | E | Dev Tools: resilience and consistency | U5 (`/crypto`, `/cron`), U6 (confirm), U8 (apps), U10 (apps), U12 |

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - ADR-001: vanilla ES modules. The only new file is the classic script
    `js/app-shared/theme-prepaint.js` (about 20 lines, built as an IIFE like
    `theme-bootstrap.js`). No framework, no component layer, and no shared
    helper module for storage, copy or confirm buttons (assumption 5).
  - ADR-016: no new origin. Every change is markup, CSS or same-origin JS.
  - ADR-023: untouched. U3 *removes* a model-side number from the client.
  - CSP: no inline script in `index.html` is edited, so the three pinned
    hashes stay as they are and `check_csp_hashes.py` must still pass
    unchanged. The Dev Tools pages keep `script-src 'self'`. That is why the
    new script is an external file.
  - `ucl.html` and `worldcup.html` stay self-contained single files. Their
    fixes are made inline, in each file's own idiom, and nothing is moved
    out of them.
  - The build keeps the SPA and the app module groups separate
    (`build.mjs:355-367`). Nothing in `js/app-shared/` or the app folders
    starts importing from the SPA's `js/*.js`.

- **Explicit Non-Goals**:
  - Sections 1, 2, 3 and 5 of the report. §1 and §2 are done. §3 is
    backend-only. §5 is Claude Code setup. None of them touches a file this
    work edits, except the two §1 overlaps the spec lists under sequencing:
    `setInputState` (C12) and `setupNavUI` (C4).
  - No visual redesign. The changed elements (`div`→`button`, `h3`→`h2`,
    `div`→`h1`, `a`→`button`) are meant to look exactly as they do now. Each
    phase checks computed styles to prove it (spec §6).
  - No ARIA menu pattern. Both the account menu (U1) and the Apps switcher
    (U6) become disclosures: a button with `aria-expanded` and a panel of
    ordinary buttons or links (assumption 4).
  - No new toast system shared across apps, no safe-storage helper, no copy
    helper (assumption 5).
  - No assistive-technology or real-device test pass. The report's
    "Unverified" section already says U3 and U7 were inferred from code. The
    spec lists what stays unverified and adds one Playwright
    `elementFromPoint` check for U7, which approximates the finger geometry
    but is not a device.
  - `/arcade` stays dark-only. It gets the Apps switcher and a `<main>`, not
    a theme.

## 3. Impacted Layer Matrix & Quality Gates

- [x] **Frontend** (every phase): `npm run lint` && `npm test`. `npm test`
      already builds `dist/` and runs `scripts/tests/build.test.js`, so a
      separate `npm run build` adds nothing (`AGENTS.md` §6). Phase E changes
      `scripts/build.mjs`, and `build.test.js` covers that.
- [ ] **Backend**: not touched.
- [ ] **Database**: not touched.
- [x] **Docs / Hashes** (every phase): `python3 scripts/check_csp_hashes.py`
      && `python3 scripts/check_docs.py --fix --show-tokens`. Phases A and B
      edit `index.html` markup outside the pinned scripts, so the CSP gate
      must pass **without** a re-pin. If it fails, an inline script was
      touched by mistake. New tests move the per-module counts in
      `docs/TESTING.md` and `docs/JAVASCRIPT.md`, and `--fix` repairs them.

## 4. Risks & Mitigations

- **Visual regressions from tag changes**: a `<button>`, an `<h1>` and an
  `<h2>` each bring browser default styles (background, padding, font size,
  margin) that the current `<div>`, `<h3>` and `<a>` don't have. Class rules
  that set every one of those properties explicitly are unaffected. Rules
  that inherit them change size. Mitigations:
  - Every promoted element's class rule sets `font-size` and `margin`
    explicitly, and resets `background`, `border`, `padding` and `font` on
    buttons.
  - `#resume .item h3` (`styles.css:4705,5010`) is the only tag-keyed
    selector that matches a heading being promoted, and it is retargeted to
    `h2`.
  - One Playwright pass per phase compares computed styles of the changed
    elements before and after (spec §6). No screenshots.
- **Focus restoration side effects (U2)**: focusing a re-rendered node can
  scroll the page. Every restore passes `preventScroll: true` and then calls
  `scrollIntoView({ block: "nearest" })`, as `ucl.html:2426-2433` already
  does.
- **`aria-busy` (U3)**: screen readers treat `aria-busy` on a live region
  differently. Some hold the updates and read the finished reply once; others
  read nothing until the single "Response received" announcement. Both are
  better than today's repeated fragments. The difference is recorded as
  unverified, not designed around.
- **Toast removal under reduced motion (U8 + U10)**: `/worldcup`'s toast is
  removed on `animationend` (`worldcup.html:1865-1867`). The new
  reduced-motion block must shorten animations to `0.001ms`, as `ucl.html`
  does, and not use `animation: none`, which never fires `animationend` and
  would leave the toasts in the DOM forever.
- **Shared-link backup (U9)**: the backup is one slot per predictor, and it
  is written only when the slot is empty. A second shared link opened before
  the visitor has chosen would otherwise back up the *first friend's*
  bracket over the visitor's own. The slot empties when the visitor picks
  Restore or "Keep this one", and the banner shows whenever the slot is full
  (spec §4, Phase C). With storage blocked there is nothing to back up, so no
  banner appears.
- **Render-blocking script (U12)**: `theme-prepaint.js` blocks first paint
  of four Dev Tools pages for one same-origin request of about 400 bytes,
  content-hashed and cached. That is the cost of not flashing dark before
  light. The SPA already makes the same trade with `theme-bootstrap.js`.
  The service worker doesn't precache the app pages (`sw.js` doesn't
  reference them), so it needs no change.
- **Performance / bundle**: net change is a few hundred bytes of CSS and JS
  per page. `build.test.js`'s size budget is the check.
- **API Cost / Security**: none. No backend change. The one DOM-sink concern
  (U1's username in an attribute) is handled by `setAttribute` and has its
  own regression test.

## 5. Assumptions

This is a Claude Code on the web session, so the intent-planner interview was
skipped, as it was for §1 and §2. These answers were inferred and chosen:

1. **Scope** is exactly U1–U12, plus the report gaps listed in §1 that sit
   in the same code: the `/ucl` overwrite, the two missed smooth scrolls,
   arcade's unstyled trigger, `aria-expanded` left `"true"` after an item is
   chosen, and the "2000 tokens" text. Nothing from §3 or §5 is included.
2. **This task's deliverable** is the intent and the spec. "Before
   implementing" is read as a gate, as the §1 and §2 work read it.
   Implementation follows, phase by phase, once the spec is approved.
3. **Delivery** is five phases, A–E, in that order: the P1 first, then the
   SPA, then the predictors, then the Dev Tools apps. Each phase is one
   commit and runs the gates once, after its last edit.
4. **Disclosure, not menu.** A `role="menu"` commits the control to roving
   focus, typeahead and arrow-only navigation, and every other header panel
   in the SPA (`navigation.js:314-345`) is already a disclosure. The account
   menu gets arrow keys as well as Tab, which the disclosure pattern allows.
   The Apps switcher drops `role="menu"`/`menuitem` and keeps Escape and
   focus-first-item, which it already has.
5. **Fix in place, no new shared helpers.** The five two-press confirms, the
   five copy fallbacks, the three unguarded storage sites and the three
   toasts are fixed where they are. The predictors can't import, and the
   Dev Tools apps don't share modules with the SPA. A shared `app-shared/`
   helper would cover only three of the five copies of each and add a module
   and its tests. The one exception is `theme-prepaint.js`, because the CSP
   leaves no inline alternative.
   *Speed vs. Maintenance*: fixing in place ships sooner and changes less
   per file. The cost is that five copies of each pattern stay, and each
   copy gets its own test.
6. **U3 truncation is visible text** ("Cut off at the length limit"), not an
   `sr-only` label. The report allows either. Touch users can't read a
   `title` tooltip, and they are the users who can't see the current icon's
   meaning either.
7. **U3 announcements go through the existing `#route-announcer`**
   (`index.html:436`) by clearing it and then setting the text on the next
   frame, so the same message can be announced twice in a row. The
   throwaway live region in `chat.js:2489-2512` is removed.
8. **U7 sizes**: the password toggle becomes `var(--min-touch-target)`
   square (44 px, 48 px on coarse pointers), and the input's right padding
   grows to fit it. On the predictors, each arrow's hit area stops at the
   middle of the gap between the two arrows, and on `/ucl` the outer inset
   grows by 1 px so each target is at least 24 px tall (WCAG 2.5.8).
9. **U9 banner, not toast**: the Restore action needs to stay on screen until
   the visitor chooses. A toast with a button either times out, which fails
   WCAG 2.2.1, or never times out, which defeats the point of a toast. So it
   is an inline `role="status"` banner with two buttons: "Restore my
   bracket" and "Keep this one".
10. **Confirm timeout is 4 s everywhere**, and the class is `.is-confirming`.
    The predictors already use 4 s, and the longer window is the safer
    choice for the two-press pattern.
