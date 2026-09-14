# Technical Specification: Code Difference Checker

**Related Intent**: `.claude/intents/2026-09-14-code-diff-checker.md`
**Target Audience**: 2. Portfolio as a Work Sample, then 1. Visitor / Recruiter
**Route**: `/diff` (alias `/patch` -> `/diff#patch`)

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend standalone app (`frontend/diff.html`, `frontend/diff.css`, `frontend/js/diff/`)
  - [x] Frontend Apps launcher shelf (`frontend/index.html`, `<section id="apps">`)
  - [x] Routing and sitemap (`frontend/.htaccess`, `frontend/sitemap.xml`)
  - [x] Build pipeline and tooling (`scripts/build.mjs`, `scripts/check_docs.py`, `scripts/generate_social_previews.py`, `scripts/vendor_fonts.py`, `package.json`)
  - [x] Documentation (`docs/JAVASCRIPT.md`, `docs/TESTING.md`, `docs/FRONTEND.md`, `docs/ARCHITECTURE.md`)
  - [ ] Backend API — **none**. No router, no service, no Pydantic schema.
  - [ ] Database — **none**. No model, no Alembic revision; `alembic check` is unaffected.

### 1.1 The one structural decision

`/json` is one document seen through four lenses. `/diff` is **one comparison fed
from two directions**: the `#compare` tab builds a diff from two source strings,
and the `#patch` tab builds *the same diff structure* by parsing a unified patch.
Both converge on one intermediate representation, which one renderer draws.

```
  paste / drop  ──▶  state.left   (string)  ─┐
  paste / drop  ──▶  state.right  (string)  ─┤
                                             ├──▶  Hunk[]  ──▶  renderer
  paste .patch  ──▶  parsePatch()           ─┘   (the IR)      (split | unified)
```

That is the whole design. Because the patch parser produces the same `Hunk[]` the
engine produces, `#patch` costs a parser and no new view code, and the round-trip
property test in §6.2 exercises the emitter and the parser against each other for
free. Getting this boundary wrong — letting the patch tab own its own rendering —
is what turns a 30 KiB app into a 50 KiB one.

**The IR**, defined once in `diff-engine.js` and never mutated downstream:

```js
/** @typedef {{type: 'equal'|'insert'|'delete'|'replace',
 *             leftStart: number, leftLines: string[],
 *             rightStart: number, rightLines: string[],
 *             refine?: Array<{left: Span[], right: Span[]}|null>}} Change
 *  @typedef {{leftStart, leftCount, rightStart, rightCount,
 *             changes: Change[], header?: string}} Hunk
 *  @typedef {{start: number, end: number, changed: boolean}} Span
 *
 *  As built, `diffLines` returns the hunks inside a result object rather than a
 *  bare Hunk[]: { changes, hunks, algorithm, identical, stats, left, right }.
 *  The renderer needs the whole documents (for collapsed regions) and the
 *  result bar needs `algorithm` and `stats`, so threading them separately
 *  bought nothing.
 */
```

---

## 2. API Contract & Schemas

**None.** Fully client-side, consistent with `/cron`, `/crypto` and `/json`. The
page ships `connect-src 'none'`, so there is no endpoint to specify, no
authentication decision to justify, and no rate limit to configure. Platform APIs
used: `FileReader` / `Blob.text()`, `navigator.clipboard`, `Blob` +
`URL.createObjectURL` (download), `localStorage`, `matchMedia`.
*As built: no `IntersectionObserver` and no `requestAnimationFrame` — collapsed
regions made virtualisation unnecessary. See §4.4.*

**Explicitly not used**: `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`,
`new Function`, `innerHTML`.

---

## 3. Database Schema & Migration Plan

**None.** No model under `server/models/`, no Alembic revision. `alembic check`
remains green without action.

---

## 4. Frontend Implementation & DOM Contract

### 4.1 Document shell — `frontend/diff.html`

Mirrors `json.html`. The CSP is **identical** to `json.html`'s, copied verbatim:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'none';
           script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
           connect-src 'none';" />
```

No inline `<script>` anywhere in the file, so `scripts/check_csp_hashes.py` —
which only covers `index.html`'s three pinned hashes — is untouched.

Head also carries: `<title>Code Difference Checker</title>`, canonical
`https://rjasti.com/diff`, the full Open Graph / Twitter card block pointing at
`diff-preview.png` (1200x630), `theme-color`, `fonts.css`, `diff.css`, and
`<script type="module" src="js/diff/diff-main.js">` at the end of `<body>`.

`<html lang="en" data-theme="dark">` as shipped; `diff-main.js` resolves the real
theme from the shared `theme` key on boot, as `json-main.js` does.

**Header and footer** follow the App Chrome Contract in `docs/FRONTEND.md` exactly
— `.app-header > .header-container > .header-primary-bar`, the
`.brand-wrap`/`.brand-icon`/`.brand-text` shape, `.header-actions` ending in
`.action-btn.back-btn` with `.back-label-long` / `.back-label-short`, and
`.app-footer > .footer-container` with the privacy line plus cross-links to the
portfolio, the apps shelf and two sibling apps (`/json` and `/crypto`).

### 4.2 Module split — `frontend/js/diff/`

Seven modules. The right column held projected minified sizes while this was a
plan. Measured against the real build, the app costs **29.3 KiB of JS and
14.1 KiB of CSS** — JS within 1 KiB of the projection, CSS well under it.

| Module | Responsibility | ~KiB |
| :--- | :--- | ---: |
| `diff-engine.js` | Myers O(ND) with linear-space refinement, common prefix/suffix stripping, histogram fallback, hunk assembly with context. Pure — takes two `string[]`, no DOM. 615 lines. | 8 |
| `diff-refine.js` | Intra-line token diff. Splits a changed line pair into word/punctuation tokens and runs the same engine at token granularity to produce `Span[]`. 160 lines. | 3 |
| `diff-tokenize.js` | The generic syntax lexer: strings (3 quote styles + template), comments (`//`, `/* */`, `#`), numbers, punctuation, shared keyword set. Returns `Span[]` per line. 186 lines. | 2 |
| `diff-patch.js` | Unified patch **writer** (`Hunk[]` -> text, `\ No newline at end of file` handled) and **parser** (text -> `Hunk[]`, with `line:column` errors on malformed headers), plus `applyPatch` for the property test. 413 lines. | 4 |
| `diff-render.js` | `Hunk[]` -> DOM. Split and unified layouts, collapsed unchanged regions, merged syntax/refine spans, row ceiling. `textContent` only. 383 lines. | 6 |
| `diff-ui.js` | Tabs, toggles, file drop, clipboard, download, change navigation, counters, patch parsing, the "remember my panes" switch, "Clear both". 511 lines. | 8 |
| `diff-main.js` | Entry point: boots state, theme, the three deep-linkable tabs, error boundary. 145 lines. | 3 |
| | **Total** (projected ~34, measured **29.3**) | **~34** |

Each module is a pure ES module with named exports. `diff-engine.js`,
`diff-refine.js`, `diff-tokenize.js` and `diff-patch.js` touch no DOM at all,
which is what makes them directly unit-testable under jsdoc-free Node.

### 4.3 The engine

```js
export function diffLines(left, right, opts) -> Hunk[]
```

1. **Normalise** per `opts`: `ignoreWhitespace`, `ignoreCase`, `ignoreBlankLines`,
   `trimTrailing`. Normalisation produces a *comparison key* per line; the original
   text is always what gets rendered. This separation is the reason a whitespace-
   insensitive diff can still show you the whitespace.
2. **Strip common prefix and suffix** by key. The overwhelmingly common case — a
   few changed lines in a large file — collapses here before the algorithm runs.
3. **Myers O(ND)** over the remaining middle, in the linear-space divide-and-conquer
   form so memory is O(N) rather than O(ND).
4. **Work ceiling**: if the edit-distance search exceeds `MAX_EDIT_WORK`, abandon it
   and fall back to a **histogram diff** (bucket lines by key, anchor on the rarest
   common line, recurse). Result is good, not provably minimal. `diffLines` returns
   which algorithm ran, and the UI states it — a fallback is disclosed, never
   silent.
5. **Assemble hunks** with `contextLines` (default 3), merging hunks whose context
   overlaps.
6. **Pair adjacent delete/insert runs into `replace`** and hand each pair to
   `diff-refine.js` for `Span[]`, but only when both sides are under a length
   threshold — refining two 40 KB lines is never worth it.

### 4.4 DOM contract and rendering

- Root is `<main class="diff-shell">` with `data-view="split|unified"`,
  `data-tab="compare|patch|about"` and `data-wrap="on|off"`; CSS keys off those
  attributes. *As built: a tab or wrap change is one attribute write, but a
  **view** change re-renders. Split pairs a deleted line with its replacement in
  one row; unified interleaves all deletions then all insertions. Those are
  different row sets, not one row set restyled, and faking it in CSS would have
  cost more than the redraw, which is a few milliseconds over the hunks alone.*
- Each row is `<div class="diff-row" data-kind="equal|insert|delete|replace">`
  containing `.diff-gutter` (line number, `aria-hidden`) and `.diff-code`.
- **Every token is `document.createElement('span')` + `textContent`.** There is no
  `innerHTML` assignment in `frontend/js/diff/`, and a lint-level grep for it is
  part of the review checklist. Class names carry the colour; text carries only
  text.
- Long lines wrap by default with a per-pane no-wrap toggle; the horizontal scroll
  containers are the panes, never the page body.
- Collapsed regions render as a single `<button class="diff-expander">` reading
  "Show N unchanged lines", which is focusable and announced. *As built, this is
  what replaced virtualised rendering: only hunks are drawn, so a one-line change
  in a ten-thousand-line file costs a handful of rows without any windowing
  machinery. `MAX_RENDER_ROWS` (5,000) caps the pathological case — two large
  files sharing nothing — and says what it left out.*
- *As built: vertical scroll synchronisation needed no code. Both sides of a
  split row live in the same grid row inside one scroll container, so they
  cannot drift. Horizontal scrolling stays per-pane.*
- **Accessibility**: the diff is a `role="table"`-free plain structure with
  `aria-label` on each pane ("Original", "Changed"); the change counter is an
  `aria-live="polite"` region so a screen reader hears `+12 −7` after a re-diff;
  prev/next-change buttons move focus to the target row, which is
  `tabindex="-1"`. Diff state is never colour-only — inserted rows carry a `+`
  marker glyph and deleted rows a `−`, so the view survives a colour-blind reader
  and a monochrome print.

### 4.5 State and persistence

Module state in `diff-main.js`; no store abstraction.

| Key | Stored | Default |
| :--- | :--- | :--- |
| `theme` | shared with the SPA — read and written, never owned here | — |
| `diff:view` | `split` \| `unified` | `split` (desktop), forced `unified` under 640px |
| `diff:opts` | the four normalisation toggles + wrap | all off, wrap on |
| `diff:remember` | whether to persist pane content | **`false`** |
| `diff:left` / `diff:right` | pane content — **written only while `diff:remember` is true** | absent |

Flipping `diff:remember` off deletes `diff:left` and `diff:right` immediately
rather than merely stopping future writes. "Clear both" wipes panes, results and
all three keys.

### 4.6 Styling — `frontend/diff.css`

Own palette; the seven `--chrome-*` tokens defined at `:root` and again under
`[data-theme="light"]`. Diff colours are their own tokens
(`--diff-ins-bg`, `--diff-ins-marker`, `--diff-del-bg`, `--diff-del-marker`,
`--diff-refine-ins`, `--diff-refine-del`) chosen to clear 4.5:1 against their own
backgrounds in both themes. The four breakpoint tiers from the App Chrome Contract
apply unchanged; below 640px the split view collapses to unified and the pane
switcher becomes a two-button segmented control.

### 4.7 Build, routing and tooling changes

| File | Change |
| :--- | :--- |
| `scripts/build.mjs` | New esbuild entry block for `js/diff/diff-main.js` + its `rewrites.set(...)` line, copying the `/json` block at lines ~253-260. **And `BUDGETS_KIB` raised to `{ js: 390, css: 285 }` with the rationale comment amended in the same commit.** |
| `package.json` | `lint:js` glob gains `frontend/js/diff/*.js` |
| `scripts/check_docs.py` | `JS_ROOTS` gains `"frontend/js/diff/"` |
| `scripts/generate_social_previews.py` | `PAGES` gains `"diff": ("diff-preview.html", "diff-preview.png")` |
| `scripts/vendor_fonts.py` | Re-run so `fa-code-compare` enters the subset (regenerates the woff2 and `fonts.css`). Fallback if that churn is unwanted: use `fa-code` and skip this row. |
| `frontend/.htaccess` | Rule 8: `RewriteRule ^patch/?$ /diff#patch [R=301,NE,L]`. `/diff` itself needs no rule — existing rule 3 serves it from `diff.html`. |
| `frontend/sitemap.xml` | New `<url>` for `https://rjasti.com/diff` with its `<image:image>` block, `lastmod` 2026-09-14, `priority` 0.6 |
| `frontend/index.html` | One `<a class="app-tile reveal" href="/diff" target="_blank" rel="noopener">` appended inside `.app-grid`, eyebrow "Dev Tools", `aria-label` ending "in a new tab". Markup only — no inline script touched. |
| `docs/FRONTEND.md` | "App chrome" section: six apps -> seven, `/diff` added to both lists |
| `docs/JAVASCRIPT.md` | New `frontend/js/diff/` module group with per-module line counts |
| `docs/TESTING.md` | New suites listed with line counts |
| `docs/ARCHITECTURE.md` | `/diff` added to the standalone-apps inventory |

---

## 5. Security & Rate Limiting Review

- [x] **Rate limits**: N/A — no endpoint. The page makes zero network requests.
- [x] **No secrets logged or returned**: no logging, no payload, no transport. Pane
      content stays in memory unless the visitor opts into `localStorage`.
- [x] **CSP hashes**: `check_csp_hashes.py` covers only `index.html`'s three inline
      scripts. This change edits `index.html` markup but no inline script, so the
      three pinned hashes are unchanged. `diff.html` carries its own CSP and has no
      inline script.
- [x] **DOM injection**: the entire input surface is untrusted text the visitor
      wants rendered. Mitigated structurally — `textContent` only, no `innerHTML`,
      no DOMPurify needed because no HTML string is ever built. A test asserts an
      `<img src=x onerror=...>` payload in a pane renders as text.
- [x] **No `eval` / `new Function`**: the tokenizer is a character-stream lexer.
      The CSP carries no `'unsafe-eval'`, so a violation fails loudly.
- [x] **No egress**: `connect-src 'none'` is the enforcement, not a convention.
- [x] **Auth boundary**: untouched. No `get_current_user`, no anonymous endpoint,
      no session. The backend does not know this page exists.
- [x] **Resource exhaustion**: 5 MB input cap, debounced recompute, engine work
      ceiling with histogram fallback, virtualised rendering. A hostile paste
      degrades to a slower diff, not a hung tab.

---

## 6. Verification & Test Plan

### 6.1 New suites under `frontend/tests/`

| File | Covers |
| :--- | :--- |
| `diff-engine.test.js` | Known Myers vectors; identical inputs; empty input; one side empty; single-line files; no trailing newline; CRLF vs LF; each normalisation toggle; hunk assembly and context merging; the histogram fallback triggering and reporting itself |
| `diff-refine.test.js` | Token-level spans on a one-identifier change; whole-line replacement; the length threshold declining to refine |
| `diff-patch.test.js` | Patch writer output against `git diff` reference text; parser on well-formed multi-hunk patches; malformed hunk header -> `line:column` error; `\ No newline at end of file` in both directions |
| `diff-tokenize.test.js` | Each comment dialect, each quote style, numbers, keywords, and that an unterminated string does not run away to EOF |
| `diff-render.test.js` | jsdom: row kinds, collapsed-region expander, sync scroll, **and the XSS payload rendering as text** |

### 6.2 The round-trip property test

Lives in `diff-patch.test.js` and is the single most valuable assertion in the set:

```js
// for N generated (a, b) document pairs:
assert.deepEqual(applyPatch(a, writePatch(diffLines(a, b))), b);
```

It proves engine, writer and parser agree. An off-by-one in a hunk header is
invisible to inspection and fatal in use; this catches it.

### 6.3 Gate commands

```bash
# Frontend
npm ci --no-audit --no-fund     # node_modules is absent in a fresh clone
npm run lint                    # ESLint (glob extended) + Stylelint over diff.css
npm test                        # node --test, including the five new suites
npm run build                   # MUST pass its size budget gate — see intent §5.1

# Docs / hashes (non-mutating check, then fix)
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py --fix --show-tokens

# Not run — no backend surface is touched
# PYTHONPATH=. pytest ; ruff check server tests ; alembic check
```

### 6.4 Manual verification checklist

- [ ] `/diff` resolves without the `.html` suffix; `/diff.html` 301s to `/diff`
- [ ] `/patch` 301s to `/diff#patch`
- [ ] Deep links `#compare`, `#patch`, `#about` open the right tab on load
- [ ] Theme chosen on the portfolio carries to `/diff`; `theme-color` meta follows
- [ ] Split view collapses to unified at 640px; all targets ≥ 44x44 at mobile tiers
- [ ] Drag-and-drop, file-pick and paste all populate a pane; a 6 MB file is
      rejected with a visible notice rather than silently truncated
- [ ] "Remember my panes" off by default; toggling it off clears stored content
- [ ] Copy-as-patch output applies cleanly with `git apply`
- [ ] Keyboard: tab order, `j`/`k` change navigation, expander focusable, change
      counter announced
- [ ] DevTools console shows no CSP violation and no network request of any kind

---

## 7. Implementation Order

1. `diff-engine.js` + `diff-engine.test.js` — pure, no DOM, highest risk. Green
   before anything renders.
2. `diff-patch.js` + the round-trip property test. Still pure.
3. `diff-refine.js`, `diff-tokenize.js` + tests.
4. `diff.html` shell + `diff.css` chrome, copied from `json.html` / `json.css`.
5. `diff-render.js`, `diff-ui.js`, `diff-main.js` + jsdom tests.
6. Build wiring, **budget raise with its rationale comment**, lint glob,
   `check_docs.py` root.
7. `diff-preview.html`, preview PNG, tile in `index.html`, sitemap, `.htaccess`.
8. Docs, then `check_docs.py --fix --show-tokens`, then the full gate run.

Steps 1-3 are ~17 KiB of the bundle and carry essentially all of the correctness
risk; they are testable with no browser and no markup. If the change has to be
split across two commits, it splits after step 3.

---

## 8. As Built — reconciliation

Everything in §1-§7 shipped. Four things differ from the plan; each is corrected
inline above and collected here so the divergence is not buried:

1. **`diffLines` returns a result object**, not a bare `Hunk[]` (§1.1).
2. **A view switch re-renders** rather than being one attribute write (§4.4) —
   split and unified are different row sets, not one set restyled.
3. **No virtualisation.** Collapsed unchanged regions made it unnecessary;
   `MAX_RENDER_ROWS` handles the pathological case (§4.4).
4. **Scroll sync needed no code** — both sides of a split row share one grid row
   in one scroll container (§4.4).

Measured against the projections: **29.3 KiB JS** (projected ~30) and
**14.1 KiB CSS** (projected ~18). `BUDGETS_KIB` went to `{ js: 390, css: 285 }`
exactly as §5.1 of the intent proposed, leaving 14.1 and 8.3 KiB of headroom.
`diff.css` is now a **fifth** copy of the app chrome, which makes the shared
stylesheet extraction worth roughly 10 KiB; the rationale comment in
`scripts/build.mjs` now says so and names it as the thing to do before either
ceiling moves again.

**Four bugs the suites caught during implementation**, all real and all fixed —
recorded because they are the argument for building the pure core first:

1. Documents differing only in a trailing newline reported as identical. The
   no-newline marker has to go on **each side's own** final line independently:
   two files can both end unterminated on different lines, and the shared line
   that is last in one but not the other must still compare unequal, or the
   emitted patch cannot round-trip. `git diff` agrees, and a test now pins it.
2. `applyPatch` read the result's terminator off the patch even where a unified
   diff cannot encode it — when the patch never reaches the final line, the
   source's terminator is the right answer.
3. Whitespace-only tokens voted in the refiner's similarity score, pushing
   unrelated lines over the threshold on shared spaces alone.
4. Myers emits the insertion first when the inserted run is shorter, so an
   identical edit rendered as a `replace` or as a separate add and remove
   depending on relative run lengths. Both orders now pair.

**Verified in a real browser** (headless Chromium against the built `dist/`),
beyond the automated suites: character-level highlighting, split and unified
layouts, the patch tab rendering a pasted `git diff` with syntax colour and
refinement, a malformed patch reporting `line:column`, theme toggle with
`theme-color` sync, the forced unified layout at 390px with no horizontal
scroll, the `.reveal` animation firing for the new shelf tile, an XSS payload
executing nothing, **zero network requests of any kind**, and a clean console.

**One incidental fix.** Re-running `scripts/vendor_fonts.py` for
`fa-code-compare` revealed the vendored Font Awesome subset had drifted:
`fa-gear` (activity dashboard) and `fa-play`/`fa-pause` (skills carousel) are
referenced in the SPA but were missing from the subset, so they rendered as
blank space. Six glyphs were added for 360 bytes.
