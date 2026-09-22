# Technical Specification: Apps Shelf & Standalone Apps — Review Remediation

**Related Intent**: `.claude/intents/2026-09-22-apps-uiux-review-remediation.md`
**Source report**: `docs/review/apps-uiux.md`
**Target Audience**: Visitor / Recruiter, then Work Sample

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA — `frontend/index.html` (`#apps` markup only, no inline
        `<script>`), `frontend/styles.css` (`#region APPS`),
        `frontend/js/apps-filter.js`
  - [x] Standalone apps — `ucl.html`, `worldcup.html`, `arcade.html`,
        `cron.html`, `crypto.html`, `json.html`, `diff.html` and their
        stylesheets and `js/` folders
  - [x] Shared app chrome — `frontend/app-chrome.css`, two new modules beside it
  - [x] Tooling — one new generator under `scripts/`
  - [ ] Backend API / Database / CI-CD: not impacted

- **Two new shared modules.** `app-switcher.js` (H2) and `app-shortcuts.js`
  (H3) are the only structural additions. Both are plain ES modules that take a
  config object and bind to markup the host page already has; neither owns
  state, and neither is imported by the SPA. They live in
  `frontend/js/app-shared/` so the existing per-app folders stay per-app.

- **One cross-folder import.** F3 imports `js/diff/diff-engine.js` from
  `js/json/`. This is the report's "only structural decision worth taking
  deliberately" and it is taken: the engine is already a pure function over two
  string arrays with no DOM and no diff-page state, so the alternative is a
  second copy of Myers. Recorded here rather than left implicit.

---

## 2. API Contract & Schemas

Not applicable. No endpoint, request or response shape is added or changed.
Every app in scope is client-only; `/cron`, `/crypto`, `/json` and `/diff`
declare `connect-src 'none'` and keep it.

---

## 3. Database Schema & Migration Plan

Not applicable. No model under `server/models/` is touched, so `alembic check`
has nothing to say about this change.

---

## 4. Frontend Implementation & DOM Contract

Findings are grouped by the report's own sequencing. Each row names the
acceptance signal that proves it, which is what the tests assert.

### Pass 1 — correctness

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **B1** | Stage tabs get real tab semantics. `role="tablist"` on the `<nav>`; `role="tab"`, `aria-selected`, `aria-controls`, roving `tabindex` on each button; `role="tabpanel"` + `aria-labelledby` on each `.view-panel`; the existing `tabBtns` click handler updates `aria-selected` and `tabindex`. Same treatment for the `.mobile-tab-btn` round switchers. Arrow/Home/End keys bound by a port of `bindTabKeyNav` (`cron-main.js:133`). | `ucl.html`, `worldcup.html` | Exactly one `aria-selected="true"` per tablist; the other tabs carry `tabindex="-1"`; `ArrowRight` moves selection |
| **B2** | `aria-hidden="true"` on every decorative `<i class="fa…">`, including those built in template literals. 12 missing in `ucl.html`, 14 in `worldcup.html`. | both predictors | zero `<i class="fa` without `aria-hidden` in either file |
| **B4** | `FIFA 26` → `World Cup 26` in `brand-title`. | `worldcup.html:1378` | no `>FIFA` in a brand element |
| **B5** | Reset drops `window.confirm()` for the two-press `.action-btn.is-confirming` pattern the Dev Tools already use (`diff-ui.js:489`); 3s timeout reverts. `.is-confirming` already exists in `app-chrome.css`, so each predictor gets the rule copied into its own inline `<style>` — they do not link the shared sheet. | both predictors | first press arms and does not clear state; second press clears |
| **D1** | `brand-title` → `Cron & Regex`, `brand-tag` → `Visualizer`. | `cron.html:73-74` | brand title matches the shelf tile title |
| **E1** | Share encodes the safe settings (`tab`, `enc-format`, `enc-direction`, `gen-type`, `gen-length`, `gen-batch`) into `searchParams`, the way `cron-main.js:206-228` does, and restores them on load. Plaintext, keys and digests are deliberately **not** encoded. | `js/crypto/crypto-main.js`, `crypto.html` | copied URL carries the settings and not the field contents |
| **F1** | `fa-arrow-left` → `fa-compress` on Minify. | `json.html:241` | Minify carries no directional glyph |
| **G1** | `brand-title` → `Diff Checker`, `brand-tag` → `Code Comparison`. | `diff.html:65-66` | the title stands alone with the tag hidden below 960px |

### Pass 2 — the apps themselves

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **A1 + A2** | The two are one job. New `scripts/generate_app_tiles.py` boots a throwaway HTTP server over `frontend/`, screenshots each app's **real UI** at 1200×630 with headless Chromium, and writes `*-tile-640.webp` + `*-tile-1280.webp`. `index.html` swaps the bare `<img>` for the `<picture>`/`srcset` pattern at `index.html:766`. The `*-preview.png` cards stay on disk and keep their `og:image` job. `--app-media-scrim` and the `::after` veil are dropped. | `scripts/generate_app_tiles.py`, `frontend/*-tile-*.webp`, `index.html`, `styles.css` | shelf payload falls from 1.93 MB; no `<img>` in `.app-tile-media` without a `<picture>` parent |
| **A3** | The filter reads `location.hash` (`#apps/dev-tools`) on init and `history.replaceState`s on each chip press. An unknown slug falls back to All rather than an empty grid. **Revised during implementation:** this needs both routers to resolve a section from the fragment's *first segment only* — `getValidHashTarget` in `app-logic.js` and the pre-boot router inline in `index.html`. That contradicts the "no inline `<script>` edit" claim under §5 below: one pinned CSP hash is recomputed and repinned. No section id contains a slash, so the change cannot swallow a real target. | `js/apps-filter.js`, `js/app-logic.js`, `index.html` | booting at `#apps/dev-tools` opens filtered; pressing a chip rewrites the hash; `check_csp_hashes.py` passes |
| **A4** | Two or three micro-chips above the Launch pill, reusing `.app-filter-chip` metrics. **Revised during implementation:** written as markup rather than rendered from a `data-` attribute, so they survive with scripting off — the same no-JS state the grid already degrades to, and no new module for seven static lists. | `index.html`, `styles.css` | every tile renders two or three non-repeating traits above its CTA |
| **B3** | Port to `/worldcup`: the `.progress-wrap` markup and fill logic (fixed denominator 12 groups + 8 wildcards + 31 knockout ties = 51), the `.hero-meta` chip row, and the team name into the reorder `aria-label`s. The `/ucl` rail is out of scope per the report. | `worldcup.html` | progress reaches 51/51 on a full bracket; reorder labels name the club |
| **C1** | Launcher summary strip — *"4 of 6 played · best run: Tetris 12,400"* — plus a "Clear my scores" control. Clearing is a `PREFIX` sweep in `storage.js`, guarded like every other accessor there. | `js/arcade/shell.js`, `js/arcade/storage.js`, `arcade.css` | summary counts played games; clear empties every `rj-arcade:best:` key and leaves `muted` alone |
| **C2** | Optional `meta.rules` per game, rendered in the pause panel above the controls. | `js/arcade/*.js`, `arcade.html` | every game declares rules; the pause panel shows them |
| **D2** | (a) Expand the six macros (`@yearly`/`@annually`/`@monthly`/`@weekly`/`@daily`/`@hourly`) to canonical five-field form before parsing, and name a 6-field input as a likely Quartz expression instead of a bare count error. (b) `#cron-tz` becomes a `<select>` over `Intl.supportedValuesOf('timeZone')`, passed to the existing `Intl.DateTimeFormat` in the timeline. | `js/cron/cron-parser.js`, `js/cron/cron-ui.js`, `cron.html` | `@daily` parses as `0 0 * * *`; a 6-field input says "Quartz"; changing the zone re-renders the triggers |
| **E2** | "Clear All Workbench Data" moves from the footer into `header-actions` as `.action-btn.text-danger`, matching `/json` and `/diff`. The footer keeps the privacy sentence. | `crypto.html` | the control is a child of `.header-actions` |
| **E3** | An **HMAC** row on the hasher panel (`crypto.subtle.importKey` → `sign`, key input + algorithm select) and a fifth **JWT** tab (split on `.`, Base64URL-decode header and payload, render claims, render `exp`/`iat`/`nbf` as relative time via `time-workbench.js`). The JWT panel states in the page that it does not verify signatures. | `js/crypto/hasher.js`, new `js/crypto/jwt.js`, `crypto.html`, `crypto.css` | known HMAC vector matches; a known JWT decodes; an unsigned/garbage token reports rather than throws |
| **F2** | The source card collapses to a one-line summary (`document · 1,204 lines · valid`) once a document parses, re-expands on click, and auto-collapses on tab switch. The `.status-strip` already holds the state. | `json.html`, `js/json/json-main.js`, `json.css` | collapsing sets `aria-expanded="false"` and hides the textarea |
| **F3** | Fifth **Compare** tab: second textarea, canonicalise both sides (sort keys, fixed indent), run `diff-engine.js` over the two rendered strings. | new `js/json/compare.js`, `json.html`, `json.css` | two documents differing only in key order compare equal |
| **G2** | `.options-row` splits into three labelled `.seg-group`s — **Compare** (the four ignores), **View** (layout, wrap, context), **Session** (remember). No new tokens. | `diff.html`, `diff.css` | each option sits under a named group |
| **G3** | A swap button (exchange the two `value`s and redraw) and a **Load sample** in the Original pane header filling both sides with a real before/after snippet from this repo. | `diff.html`, `js/diff/diff-ui.js` | swap is an involution; sample fills both panes and produces a non-empty diff |

### Pass 3 — shelf coherence

| # | Change | Files | Acceptance signal |
| :--- | :--- | :--- | :--- |
| **H1** | An **About** tab on `/cron`, `/crypto` and `/json`, same shape as `/diff`'s: the algorithm, the limits, the deliberate omissions. `.prose-card` / `.prose-heading` / `.prose-list` move from `diff.css` into `app-chrome.css` so four apps share one definition. `/json`'s per-converter `#convert-note` text is collected into its Limits list. | three `.html`, `app-chrome.css`, `diff.css` | each app's tablist carries an About tab wired to a panel |
| **H2** | `app-switcher.js`: the Back control becomes a popover listing all seven apps with the current one marked `aria-current="page"`. `Esc` closes, focus returns to the trigger, click-outside dismisses. One module, seven identical insertions. | new `js/app-shared/app-switcher.js`, all seven apps, `app-chrome.css` | the popover lists seven entries and marks exactly one current |
| **H3** | `app-shortcuts.js`: `?` opens a sheet, `/` focuses the primary input, `1`–`n` switch tabs, `Esc` closes. Per-app extras (`/diff`'s `j`/`k`) register through the same table, so the sheet is **generated from what is actually bound** rather than hand-written. Guards against text fields and modifier keys, as `diff-ui.js:464` already does. | new `js/app-shared/app-shortcuts.js`, all seven apps, `app-chrome.css` | the sheet's row count equals the registered binding count |

### DOM sanitization

No user-controlled string reaches `innerHTML` in any of this. The JWT decoder
is the one place untrusted text is rendered, and it goes in through
`textContent`. The arcade summary and the shortcuts sheet build from
module-owned data.

### Styling

Vanilla CSS tokens only. The chip metrics for A4 reuse `.app-filter-chip`; the
three `.seg-group`s in G2 reuse a class already in `diff.css`; the prose styles
for H1 are promoted, not rewritten.

---

## 5. Security & Rate Limiting Review

- [x] No endpoint added — no rate limit to configure.
- [x] No secret is read, logged or rendered. The HMAC key and the JWT stay in
      the page; neither is persisted and neither is encoded into the E1 share
      link, which carries settings only.
- [x] `frontend/index.html`'s pre-boot router **is** touched, by A3 above, so
      one of the three pinned `sha256-` hashes was recomputed and repinned.
      This is why `scripts/check_csp_hashes.py` is run as a gate rather than
      assumed: the report's own closing note predicted the hashes would hold,
      and it was wrong.
- [x] The standalone apps sit outside `index.html`'s CSP and keep their own
      `connect-src 'none'`. No new origin is introduced anywhere.

---

## 6. Verification & Test Plan

**New and updated tests** (Node test runner + jsdom, `frontend/tests/`):

| File | Covers |
| :--- | :--- |
| `ucl-bracket.test.js` | B1 tab semantics + arrow keys, B2 icon audit, B5 two-press reset |
| `worldcup-bracket.test.js` | B1, B2, B3 progress + hero chips + named reorder labels, B4 brand, B5 |
| `apps-experience.test.js` | A2 `<picture>` on every tile, A3 hash round-trip, A4 traits |
| `arcade.test.js` | C1 summary + prefix-sweep clear, C2 `meta.rules` present |
| `cron.test.js` | D2 macro expansion, 6-field Quartz message, timezone plumbing |
| `crypto-hasher.test.js` | E3 HMAC against a published vector |
| new `crypto-jwt.test.js` | E3 decode, `exp` rendering, malformed-token handling |
| new `crypto-share.test.js` | E1 settings round-trip, and that no field content is encoded |
| new `json-compare.test.js` | F3 key-order equality, real differences still reported |
| `diff-render.test.js` | G3 swap involution and sample load |
| new `app-shared.test.js` | H2 switcher covers seven apps, H3 sheet is generated from bindings |
| new `app-about.test.js` | H1 About tab wired on `/cron`, `/crypto`, `/json` |

**Gates** (all are run; none is assumed). The build's CSS budget also moved,
291 → 296 KiB, documented in `scripts/build.mjs` against what consumed it; the
JS budget did not, because building the six standalone-app entries as one
esbuild `splitting` group reclaimed more than the shared modules added:

```bash
npm run lint                                  # ESLint + Stylelint
npm test                                      # Node test runner + jsdom
npm run build                                 # esbuild -> dist/
python3 scripts/check_csp_hashes.py           # three pinned index.html hashes
python3 scripts/check_docs.py --fix --show-tokens
```

Backend gates are not run: no file under `server/` is in scope. That is a
stated scope boundary, not a skipped gate.

**Report update.** `docs/review/apps-uiux.md` is rewritten only after the gates
pass, and only to record what the code now does — each finding marked with its
real outcome and the commit-visible change that produced it.
