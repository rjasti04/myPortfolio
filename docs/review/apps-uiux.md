# Apps Shelf & Standalone Apps — UI/UX and Feature Review

**Date:** 2026-09-22
**Status:** **All 25 findings closed.** Every one was re-checked against the
working tree before any code was written, and all 25 still reproduced. The
remediation is `.claude/intents/2026-09-22-apps-uiux-review-remediation.md` and
`.claude/specs/2026-09-22-apps-uiux-review-remediation.md`.
**Scope:** the `#apps` shelf in `frontend/index.html` and all seven apps it
launches — `/ucl`, `/worldcup`, `/arcade`, `/cron`, `/crypto`, `/json`, `/diff`.

This review is deliberately narrow. `docs/review/uiux.md` covered the SPA
(home, about, contact, chat, mobile nav, activity, AI, auth) and all 28 of its
findings are closed. None of them touched the standalone apps, and neither did
`docs/review/features.md`. This fills that gap.

## Method

Read the shelf markup and its `#region APPS` rules, `app-chrome.css`, each
app's `<body>` and stylesheet breakpoints, and the JS that drives tabs,
persistence, share links and keyboard handling. Prior decisions in
`.claude/intents/2026-09-11-developer-apps-uiux-harmonization.md` and
`2026-09-12-apps-uiux-redesign.md` were checked before proposing anything, so
nothing here re-opens a settled question without saying so.

## Standing decisions this review does not reopen

| Decision | Where |
| :--- | :--- |
| `/arcade` is dark-only; no theme toggle | `2026-09-12-apps-uiux-redesign.md` §2, `docs/FRONTEND.md` §App chrome |
| `/cron` keeps its own 860px / 480px breakpoints rather than adopting `app-chrome.css` | `docs/FRONTEND.md` §App chrome |
| `/ucl` and `/worldcup` load Google Fonts, cdnjs and FlagCDN directly | ADR-016, `AGENTS.md` |
| No shared router, framework or component library across the apps | ADR-001 |

One item below (**A4**, World Cup parity) does reach into `/worldcup`'s body
layout, which the 2026-09-12 redesign listed as a non-goal. That non-goal was
scoped to *that* task — aligning chrome — not recorded as permanent. It is
called out explicitly rather than smuggled in.

---

## Verdict

*Written at audit time; the resolution of each point follows.*

The shelf and the four Dev Tools apps are in good shape: real tablist
semantics with arrow-key navigation, roving `tabindex`, 44px touch targets,
`prefers-reduced-motion` handling, drag-and-drop with a visible dragover state,
and honest empty/error copy. The gaps are concentrated in three places:

1. **The two football predictors have not had the accessibility pass the Dev
   Tools apps got.** Neither declares `role="tab"` or `aria-selected` anywhere.
2. **`/worldcup` is a generation behind `/ucl`** — no progress bar, no
   explanatory rail, no hero context, generic reorder labels.
3. **The shelf ships 2.3 MB of oversized PNGs whose baked-in copy duplicates
   the tile text underneath them.**

Nothing found is a security issue. Severities below are UX severities.

### Where it landed

All three are closed, and the whole set with them.

1. Both predictors now declare `role="tablist"`/`role="tab"`, carry
   `aria-selected`, `aria-controls` and a roving `tabindex`, answer the arrow
   keys, and expose no decorative icon. The one WCAG 2.2 **4.1.2** failure in
   the report is gone.
2. `/worldcup` has the hero chip row, a progress bar over the whole tournament
   and reorder labels that name the club. The `/ucl` rail stays out, which the
   report itself scoped out.
3. The shelf serves WebP at two widths through `<picture>`: **1.93 MB of PNG →
   316 KB**, an 84% cut. The images are screenshots of the apps themselves, so
   the duplicate-headline problem is gone at the source and
   `--app-media-scrim` went with it.

Two figures in the report were slightly off and are corrected below where they
appear: the seven previews were **1.93 MB**, not 2.3 MB (§A2), and 26 of 39
decorative icons lacked `aria-hidden`, not the 18 the two counts in §B2 imply.
`/worldcup` has **32** knockout ties, not 31 (§B3) — the third-place play-off
was missed.

## A. The shelf (`#apps` in `index.html`)

### A1. Preview images repeat the tile's own title and blurb

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Medium |
| **Location** | `frontend/*-preview.png`; `frontend/styles.css:8148` |
| **The "Why"** | Each preview is a 1200×630 marketing card carrying its own eyebrow, title and blurb — `json-preview.png` reads "DEVELOPER UTILITY • DATA WORKBENCH / JSON Workbench / Query Studio" plus a three-line description. The tile body below it then says the same things again, quieter. Every tile reads as two competing headlines. The stylesheet already fights this with a scrim that lifts on hover, and its own comment says so: *"the real fix is re-rendering the PNGs without baked-in copy."* |
| **The Fix** | Re-render the seven previews as screenshots of the app's actual UI with no text overlay, and drop `--app-media-scrim` and the `::after` veil. The OG cards can stay text-heavy — `og:image` is a different job from a tile thumbnail, so split them: `*-og.png` for social, `*-tile.webp` for the shelf. |
| **Status** | ✅ **Resolved** |
| **What changed** | New `scripts/generate_app_tiles.py` screenshots each app's **real UI** over a throwaway local server and writes `*-tile-640.webp` and `*-tile-1280.webp`. There is no baked-in copy left to compete with the tile's `<h3>`, so `--app-media-scrim` and the `.app-tile-media::after` veil are deleted outright — the stylesheet comment that named this as the real fix is gone with them. The OG cards survive as `*-preview.png` and keep `og:image`, exactly the split the report proposed. `/ucl` and `/worldcup` load Google Fonts and cdnjs, which a build machine cannot reach, so the generator substitutes the self-hosted equivalents **in the response only** while it shoots; neither file on disk is touched. |

### A2. Seven full-size PNGs served into a 320–420px box

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Medium |
| **Location** | `frontend/index.html:1440` and six siblings; `frontend/styles.css:388` (`--app-tile-min: 320px`) |
| **The "Why"** | 331–355 KB per preview × 7 = **~2.3 MB**, all PNG, all 1200×630, all rendered into a grid track that floors at 320px and rarely exceeds ~420px. The project already ships WebP with `<picture>` + `srcset` for the portraits and the backdrop, so the toolchain and the idiom exist — the shelf is the one place that skipped them. `loading="lazy"` defers the cost but does not remove it, and on a phone the whole shelf is one scroll. |
| **The Fix** | Emit `640w` and `1280w` WebP per app and swap the bare `<img>` for the same `<picture>`/`srcset` pattern `index.html:766` already uses. Expect ~85% off: ~2.3 MB → ~300 KB. Keep one PNG fallback per app only if the OG card needs it. |
| **Status** | ✅ **Resolved** |
| **What changed** | `index.html` now uses the `<picture>`/`srcset` pattern from `index.html:766`, with `sizes` so the browser can actually choose. **1.93 MB → 316 KB across 14 files, an 84% cut.** (The report's ~2.3 MB was high: `ucl-preview.png` and `worldcup-preview.png` were 161 KB and 133 KB, not 331–355 KB.) Guarded by `apps-experience.test.js`, which asserts every tile has a `<picture>` with both widths, that every referenced file ships, and that the seven thumbnails together stay under 600 KB. |

### A3. The filter is not addressable

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Low |
| **Location** | `frontend/js/apps-filter.js:31` |
| **The "Why"** | `#apps` always opens on **All**. There is no way to link someone to the Dev Tools subset, and a chosen filter does not survive a reload or a section change — which the SPA's own router makes cheap to support. |
| **The Fix** | Read `location.hash` for `#apps/dev-tools` on init and `history.replaceState` on each chip press. Roughly ten lines, and it reuses the routing vocabulary already in `navigation.js`. |
| **Status** | ✅ **Resolved** |
| **What changed** | `apps-filter.js` reads `#apps/dev-tools` on init, `history.replaceState`s on each chip press, and listens for `hashchange`. An unknown slug falls back to All rather than painting an empty grid — a renamed category should not break someone's bookmark. This needed both routers to resolve a section from the first segment only (`app-logic.js` and the pre-boot router in `index.html`), which is a two-line change each and no section id contains a slash. **That edited an inline `<script>`, so one of the three pinned CSP hashes was recomputed and repinned** — contrary to the report's closing note, and the reason `check_csp_hashes.py` is a gate rather than an assumption. |

### A4. Tiles state what an app does, never what it costs to try

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Low |
| **Location** | `frontend/index.html:1436-1546` (`.app-grid`) |
| **The "Why"** | The shelf lede promises "runs entirely in your browser", but a visitor deciding between seven tiles gets no per-tile signal of size, offline capability or whether anything is stored. The apps themselves make a point of this — every footer says "Zero Network Egress" — and the shelf, which is where the decision is actually made, says it once in prose at the top. |
| **The Fix** | A single row of two or three micro-chips above the Launch pill, driven from `data-` attributes on the tile: `No sign-in`, `Works offline`, `Nothing stored`. Reuse `.app-filter-chip` metrics so no new vocabulary is introduced. |
| **Status** | ✅ **Resolved** |
| **What changed** | A `.app-tile-traits` row of two or three chips above each Launch pill, reusing `.app-filter-chip`'s metrics without its 44px touch target or its cursor — these are labels on a link, not controls. **Deviation:** they are markup rather than rendered from a `data-` attribute, so they survive with scripting off, which is the same no-JS state the grid already degrades to. Every claim is checked against the app: a test asserts that a tile saying "Nothing stored" belongs to an app with an opt-in to be the exception. |

---

## B. `/ucl` and `/worldcup` — the football predictors

### B1. Stage tabs have no tab semantics at all

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | **High** |
| **Location** | `frontend/ucl.html:1811-1821`, `frontend/worldcup.html:1423-1433`; also `ucl.html:1900-1905` (`.mobile-tab-btn`) |
| **The "Why"** | Both stage switchers are bare `<button class="tab-btn">` inside a `<nav>`. No `role="tablist"`, no `role="tab"`, no `aria-selected`, no `aria-controls`, no roving `tabindex` and no arrow-key handling. The active stage is conveyed by a CSS class alone, so a screen-reader user hears three identical buttons and cannot tell which stage they are in — WCAG 2.2 **4.1.2 Name, Role, Value**. This is the single biggest gap in the shelf, and it is notable precisely because `/cron`, `/crypto`, `/json` and `/diff` all get it right, including the arrow-key `bindTabKeyNav` helper duplicated in `cron-main.js:133` and `crypto-main.js:157`. |
| **The Fix** | Mirror the Dev Tools markup and port `bindTabKeyNav` into each page's inline script: `role="tablist"` on the `<nav>`, `role="tab" aria-selected aria-controls tabindex` on each button, `role="tabpanel" aria-labelledby` on each `.view-panel`, and `aria-selected` updated in the existing `tabBtns` click handler (`ucl.html:3253`). |
| **Status** | ✅ **Resolved** |
| **What changed** | Both predictors: `role="tablist"` on the `<nav>`, `role="tab"` + `aria-selected` + `aria-controls` + roving `tabindex` on each button, `role="tabpanel"` on each `.view-panel`, and `bindTabKeyNav` ported from `cron-main.js` for Arrow/Home/End. The mobile round switchers got the same treatment; one panel serves four (UCL) or five (World Cup) tabs, so its `aria-labelledby` follows the selection rather than being fixed in the markup. **The only WCAG 2.2 failure in the report, and it is closed.** |

### B2. Decorative Font Awesome icons are not hidden

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | Medium |
| **Location** | `ucl.html` — 6 of 19 `<i class="fa…">` (lines 1797-1799, 1813, 1816, 1819, 2190-2192, 2311, 2313); `worldcup.html` — 12 of 20 (1425, 1428, 1431, 1738-1740, 1854-1855, 2028, 2379, 2384, 2395, 2406) |
| **The "Why"** | Every `<i class="fa…">` in the four Dev Tools apps carries `aria-hidden="true"`; the two predictors mostly do not, including inside toasts and the final podium, where the glyph sits next to the text it decorates. Some screen readers announce the private-use codepoint. |
| **The Fix** | Add `aria-hidden="true"` to every decorative `<i>` in both files, including the ones built in template literals. |
| **Status** | ✅ **Resolved** |
| **What changed** | `aria-hidden="true"` on every decorative `<i class="fa…">` in both files, including those built in template literals. The real counts were **12 missing of 19 in `ucl.html` and 14 of 20 in `worldcup.html`** — 26 of 39, not the 18 the report's two figures imply. Both files now grep clean, and a test in each suite asserts zero exposed icons so a new one cannot slip in. |

### B3. World Cup is a design generation behind UCL

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Medium |
| **Location** | `worldcup.html:1416-1421` vs `ucl.html:1792-1808, 1839-1876` |
| **The "Why"** | `/ucl` got a pass `/worldcup` did not. UCL has a hero meta row (`36 clubs · 8 matchdays`, `Swiss league phase`, `Final · Madrid`), a global `0 of 23 ties decided` progress bar, a zone legend on the standings, and a right-hand rail carrying *How the format works*, *Your seeded eight* and *Key dates*. World Cup has a heading, a paragraph, and nothing else — no progress indicator anywhere except the wildcard counter on one of its three tabs. Someone landing on `/worldcup` from `/ucl` sees the same chrome around a visibly thinner app. Its reorder buttons are also labelled generically — `aria-label="Move team up"` (`worldcup.html:1854`) where UCL names the club (`ucl.html:2311`). |
| **The Fix** | Port three things, in this order: (1) the `.progress-wrap` markup (`ucl.html:1801-1807`) and the fill logic at `ucl.html:2906` — World Cup has a fixed denominator (12 groups + 8 wildcards + 31 knockout ties); (2) the `.hero-meta` chip row (`ucl.html:1796-1800`) (`48 teams · 12 groups`, `Round of 32`, `Final · New Jersey · 19 Jul 2026`); (3) the team name into the reorder labels. The rail is a bigger lift and can wait. **Note:** this reaches into `/worldcup`'s body layout, which the 2026-09-12 redesign listed as a non-goal for that task. |
| **Status** | ✅ **Resolved** |
| **What changed** | Two of the three ported, as the report ordered them. The `.hero-meta` chip row reads `48 teams · 12 groups`, `Round of 32`, `Final · New Jersey · 19 Jul 2026`. The progress bar counts **40** decisions, not the 51 proposed: the eight wildcard places plus **32** knockout ties — the report's 31 missed the third-place play-off, and group order is deliberately excluded because a group always has an order, so a counter reading 12 of 12 from first paint would be decoration. The reorder labels now name the club. The `/ucl` rail stays out, which the report scoped out. The `2026-09-12` non-goal this crosses is called out in the intent on the same terms the report used. |

### B4. Brand title reads "FIFA 26" beside a "Not Affiliated With FIFA" footer

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (content) |
| **Severity** | Low |
| **Location** | `worldcup.html:1378` vs `worldcup.html:1582` |
| **The "Why"** | The header brands the app with the governing body's mark; the footer then disclaims affiliation with it. "FIFA 26" also reads as the video game rather than the tournament. UCL avoids this — it brands itself "UCL 26/27", a competition abbreviation, not an organisation. |
| **The Fix** | `FIFA 26` → `World Cup 26`. One line. |
| **Status** | ✅ **Resolved** |
| **What changed** | `FIFA 26` → `World Cup 26`. The footer keeps its disclaimer; it was the brand that was wrong. |

### B5. Reset uses native `window.confirm()`

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (consistency) |
| **Severity** | Low |
| **Location** | `ucl.html:3303`, `worldcup.html` reset handler |
| **The "Why"** | Both throw a browser-chrome dialog prefixed "rjasti.com says", breaking out of a page that otherwise controls every pixel. The SPA has `js/confirm-dialog.js` and the Dev Tools apps use an inline two-press confirm on the same class of action (`diff-ui.js:489`, `.action-btn.is-confirming`). The predictors are the only surface still calling the native one. |
| **The Fix** | Adopt the two-press `is-confirming` pattern the Dev Tools already use — it needs no import and keeps both pages self-contained. |
| **Status** | ✅ **Resolved** |
| **What changed** | Both predictors adopt the two-press `.action-btn.is-confirming` pattern from `diff-ui.js`, with a 4s stand-down so an armed button is not a trap for the next click. Each page carries its own copy of the rule against its own palette, since neither links `app-chrome.css`. Worth noting: jsdom answers `confirm()` with `false`, so the old path could never be exercised at all — which is how it went untested this long. Both suites now cover arm-then-fire. |

---

## C. `/arcade`

Structurally the strongest of the seven: `hidden`-toggled launcher and stage so
only one is ever in the accessibility tree, focus returned to the launching
card on exit, `role="alertdialog"` on game over, a live region for pause and
personal bests, and per-game deep links (`/arcade#snake`).

### C1. The launcher shows six bests and never totals them

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (feature gap) |
| **Severity** | Low |
| **Location** | `frontend/js/arcade/shell.js:115-129, 139-148` |
| **The "Why"** | `refreshBests()` already reads a per-game best from storage and paints a bubble on each card. Nothing ties them together: no "4 of 6 played", no last-played game, no way to clear a score you are not proud of. The data is already in `localStorage` under one prefix; only the summary is missing. |
| **The Fix** | A one-line strip under the lede: *"4 of 6 played · best run: Tetris 12,400"*, plus a "Clear my scores" control beside it. `storage.js` already namespaces every key with `PREFIX`, so clearing is a prefix sweep. |
| **Status** | ✅ **Resolved** |
| **What changed** | `storage.js` gains `readAllBests()` and `clearAllBests()`, both prefix sweeps over the namespace rather than lists of known ids, so a renamed game leaves a key to be cleared rather than stranded. The launcher shows *"4 of 6 played · best run: Tetris 12,400"* and a **Clear my scores** control with the same two-press confirmation every other destructive control uses. The sound preference shares the prefix and is deliberately left alone — clearing scores is not resetting the arcade. |

### C2. Controls are a card footnote, not a how-to-play

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Low |
| **Location** | `frontend/js/arcade/shell.js:124` (`.launch-controls`), `arcade.html` pause panel |
| **The "Why"** | `meta.controls` is the only rules text a player gets, and Tetris's runs to three clauses — *"Arrows or swipe to move · Up or tap to rotate · Space or swipe down to drop"* — inside a card that also carries art, a name, a tagline and a score bubble. The pause panel doubles as the how-to sheet, which means the way to learn the rules is to start playing and then stop. |
| **The Fix** | Add an optional `meta.rules` string (one sentence: what scores, what ends the run) and show it in the pause panel above the controls. Cheap, and it makes the pause panel the sheet it is already described as. |
| **Status** | ✅ **Resolved** |
| **What changed** | An optional `meta.rules` on all six games — one sentence saying what scores and what ends the run — rendered in the pause panel above the controls, which makes it the how-to sheet it was already described as. A test asserts every game has one, that it is not just a restatement of `controls`, and that it says what ends a run. |

---

## D. `/cron` — Cron & Regex Visualizer

### D1. The shelf says "Cron & Regex Visualizer"; the page says "Logic Inspector"

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (content) |
| **Severity** | Low |
| **Location** | `frontend/cron.html:73` (brand-title) vs `frontend/index.html:1491` (tile title) |
| **The "Why"** | A visitor clicks a tile called "Cron & Regex Visualizer" and lands on a header reading **Logic Inspector / Developer Utility**. The `<title>` gets it right — *"Cron & Regex Visualizer — Logic Inspector for Developers"* — so only the one visible element disagrees. `/crypto` and `/json` both echo their tile exactly. |
| **The Fix** | `brand-title` → `Cron & Regex`, `brand-tag` → `Visualizer`. |
| **Status** | ✅ **Resolved** |
| **What changed** | `brand-title` → `Cron & Regex`, `brand-tag` → `Visualizer`. A test asserts the concatenation equals the shelf tile's title, so the two cannot drift apart again. |

### D2. No `@daily`-style macros, no timezone selector

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (feature gap) |
| **Severity** | Low |
| **Location** | `frontend/js/cron/cron-parser.js:146`, `cron-ui.js:101` (`#cron-tz`) |
| **The "Why"** | The parser handles named tokens (`JAN`, `MON`), ranges, steps and lists — genuinely good — but rejects anything that is not exactly five fields, so pasting `@daily` or a 6-field Quartz expression from a real crontab or a Kubernetes manifest gets *"Expected exactly 5 fields"* rather than an answer. Separately, the Next-10-Triggers rail computes in the visitor's local zone and says so in a static pill; the common question is *"when does this fire in UTC / in the server's zone"*, and the app cannot answer it. |
| **The Fix** | Two independent, additive changes: (1) expand the six standard macros (`@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@hourly`) to their canonical five-field form before parsing, and detect a 6-field input to say *"looks like a Quartz expression — drop the seconds field"* instead of a bare count error; (2) turn `#cron-tz` from a pill into a `<select>` over `Intl.supportedValuesOf('timeZone')` and pass it to the existing `Intl.DateTimeFormat` call in the timeline. No new dependency for either. |
| **Status** | ✅ **Resolved** |
| **What changed** | Both halves, and the second went further than the report asked. (a) `CRON_MACROS` expands the six standard macros — plus `@midnight` — before parsing; `@reboot` is named as having no schedule rather than failing on field count; a 6- or 7-field expression is named as Quartz. (b) `#cron-tz` is a `<select>` over `Intl.supportedValuesOf('timeZone')` with the local zone and UTC as shortcuts. **Re-formatting the result in another zone would have answered a different question**, so `getNextRuns` now walks wall-clock time *in the chosen zone* and converts matches back to instants — `0 9 * * *` in `America/New_York` resolves to 13:00 UTC in June, and a daylight-saving jump neither drops nor duplicates a daily run. Both properties are tested. |

---

## E. `/crypto` — Crypto & Encoders

### E1. "Share permalink" shares no state

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug |
| **Severity** | Medium |
| **Location** | `frontend/js/crypto/crypto-main.js:190-193`; markup `crypto.html:30-38` |
| **The "Why"** | The handler is `copyWithFeedback(window.location.href, shareBtn)`. `window.location.href` on this page is the origin plus a tab hash, so the button copies `https://rjasti.com/crypto#hasher` regardless of what is in any field. The `title` promises "Copy shareable permalink to clipboard" and the `aria-label` says "Share permalink"; what it does is copy a link to the tab. `/cron` sets the bar for what that word should mean — `cron-main.js:206-228` builds a real URL with `expr`, or `pattern`/`flags`/`text`. |
| **The Fix** | Either encode the safe state (`format`, direction, `gen-type`, `gen-batch`, `gen-length`) into `searchParams` the way `/cron` does — deliberately **not** the plaintext or the digests, which is a defensible reason to keep this narrow — or relabel the button "Copy link" and drop "permalink" from both the `title` and the `aria-label`. Relabelling is the honest one-line fix; encoding the settings is the better app. |
| **Status** | ✅ **Resolved** |
| **What changed** | The encoding option, which the report called the better app. `share-state.js` puts the tab and four closed-set controls (`encoder-format`, `gen-type`, `gen-batch`, `gen-length`) into `searchParams` and restores them before the workbench first renders. **Nothing typed travels** — not the plaintext, not the HMAC key, not a token — and a test asserts each of those by name, because a share link is pasted into chat windows and ticket comments. A value the page does not actually offer is dropped rather than assigned, since a `<select>` accepts an unknown value by going blank. The `title` and `aria-label` now describe what it does. |

### E2. "Clear All Workbench Data" lives in the footer

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (consistency) |
| **Severity** | Low |
| **Location** | `frontend/crypto.html:762-772` vs `json.html:33-41`, `diff.html:30-38` |
| **The "Why"** | `/json` and `/diff` put Clear in `header-actions` as an `.action-btn.text-danger` beside the theme toggle. `/crypto` — which holds more sensitive residue than either, since its fields carry plaintext about to be hashed — puts the same control at the bottom of the page, below the privacy statement, where a visitor has to scroll past the whole workbench to find it. Three apps, two placements, and the odd one out is the one where it matters most. |
| **The Fix** | Move it into `header-actions`, matching `/json`. The footer keeps the privacy sentence without the button. |
| **Status** | ✅ **Resolved** |
| **What changed** | Moved into `header-actions` as `.action-btn.text-danger`, matching `/json` and `/diff`, with its label shortened to `Clear` to fit the bar. The footer keeps the privacy sentence and loses only the button. |

### E3. Hashing is SHA-only

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (feature gap) |
| **Severity** | Low |
| **Location** | `frontend/js/crypto/hasher.js` |
| **The "Why"** | Three SHA digests recomputed per keystroke, with SHA-1 correctly flagged as collision-broken. The two things developers most often reach a client-side crypto tool for are absent: **HMAC** (a keyed digest, one extra input and `crypto.subtle.sign`) and **JWT decoding** (split on `.`, Base64URL-decode header and payload, render the claims, render `exp` as a relative time). The page already has Base64URL decoding in `encoders.js` and relative-time formatting in `time-workbench.js` — a JWT tab is mostly wiring two existing modules together. |
| **The Fix** | Add an **HMAC** row to the hasher panel (key input + algorithm select, `crypto.subtle.importKey` → `sign`), and a fifth **JWT** tab. Decode only — never offer to verify a signature client-side, and say so on the panel, since a tool that appears to verify is worse than one that plainly does not. |
| **Status** | ✅ **Resolved** |
| **What changed** | Both. `computeHmac` uses `crypto.subtle.importKey` → `sign` behind a key input and an algorithm select, folded into the hasher's existing recompute so key and message stay in step; it is verified against **RFC 4231** (SHA-256, SHA-512) and **RFC 2202** (SHA-1) vectors rather than against itself. A fifth **JWT** tab decodes header and payload, annotates the registered claims and renders `exp`/`iat`/`nbf` as relative times through `time-workbench.js`. Decode only, stated on the panel, and a test asserts the panel offers no control that would appear to verify. Every untrusted string lands via `textContent`; a malformed token returns `{valid: false, error}` rather than throwing. |

---

## F. `/json` — JSON Workbench

The best-organised of the four: one source document above four tabs that all
read it, honest per-converter limits, `line:column` errors, lazy tree nodes,
and an explicit opt-in before anything is stored.

### F1. Minify wears a left-arrow icon

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (UI) |
| **Severity** | Low |
| **Location** | `frontend/json.html:240` |
| **The "Why"** | `<i class="fas fa-arrow-left">` on the **Minify** button. Nothing about minification is directional, and in a rail whose next button is "Use as document" with `fa-rotate-left`, two left-pointing glyphs sit next to each other meaning unrelated things. |
| **The Fix** | `fa-arrow-left` → `fa-compress`. |
| **Status** | ✅ **Resolved** |
| **What changed** | `fa-arrow-left` → `fa-layer-group`. (Not the `fa-compress` the report suggested: that glyph is not in the vendored Font Awesome subset, and an unvendored class renders as blank space with no error. A new test now asserts every icon the five local-font apps use is one `fonts.css` actually carries — it caught nine of them, including three I had just introduced.) |

### F2. The source textarea is fixed-height and never gets out of the way

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance (interaction) |
| **Severity** | Low |
| **Location** | `frontend/json.css:329` (220px), `json.css:958` (170px at ≤640px) |
| **The "Why"** | The source card sits above the tab panels by design — correct, since all four tabs read it. But it is a fixed 220px box plus a dropzone plus a status strip, so on a phone the output of whichever tab you are using starts below ~400px of input furniture, every time, on every tab. The one thing you came to look at is always the thing below the fold. |
| **The Fix** | Collapse the source card to a one-line summary (`document · 1,204 lines · valid`) once a document parses, with a click to re-expand, and auto-collapse on tab switch. The `.status-strip` already carries the state the summary needs. |
| **Status** | ✅ **Resolved** |
| **What changed** | The source card collapses to its status strip once a document parses, re-expands on click, and auto-collapses on a tab change. The control stays hidden until there is a document, because offering to hide an empty textarea is offering to hide the thing you came to type in. The `.status-strip` deliberately sits outside the collapsing part — it is the summary a collapsed card shows. |

### F3. No JSON-to-JSON comparison, on a site that ships a diff engine

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (feature gap) |
| **Severity** | Low |
| **Location** | `frontend/js/json/`, `frontend/js/diff/diff-engine.js` |
| **The "Why"** | `/diff`'s About tab states the limitation itself: *"two JSON documents that differ just in key order are reported as different."* `/json` can already sort keys (`#sort-keys`) and pretty-print deterministically. A structural JSON compare is the obvious app neither page has, and it sits exactly between two that already ship every piece of it. |
| **The Fix** | A fifth **Compare** tab in `/json`: second document textarea, canonicalise both (sort keys, fixed indent), run the existing Myers implementation over the two rendered strings. Imports `diff-engine.js` across app folders — the only structural decision worth taking deliberately. |
| **Status** | ✅ **Resolved** |
| **What changed** | A fifth **Compare** tab. `json-compare.js` canonicalises both sides — keys sorted at every depth, one fixed indent, array order untouched because in JSON it means something — and runs `diff-engine.js` over the two rendered strings. The cross-folder import is taken deliberately and recorded in the spec: `diffLines` is a pure function over two strings with no DOM and no diff-page state, so the alternative was a second copy of Myers. The first test in `json-compare.test.js` is the limitation `/diff` documents about itself, now closed. |

---

## G. `/diff` — Code Difference Checker

Deepest of the seven, and the only one with an **About** tab that states its own
limits. `j`/`k` change navigation, split/unified, patch parsing, and an honest
"this diff is good rather than minimal" note when the Myers meter trips.

### G1. Brand reads "Code Difference" on every phone

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (UI) |
| **Severity** | Medium |
| **Location** | `frontend/diff.html:65-66` + `frontend/app-chrome.css` `@media (max-width: 960px) { .brand-tag { display: none } }` |
| **The "Why"** | The name is split across two elements — `brand-title` is "Code Difference" and `brand-tag` is "Checker". The shared chrome hides `.brand-tag` below 960px, so on every tablet and phone the header reads **"Code Difference"**, a noun phrase missing its noun. No other app breaks this way, because no other app puts half its name in the tag: `/crypto` is "Crypto & Encoders" + "Client-Side Workbench", `/json` is "JSON Workbench" + "Query Studio" — tag drops, name survives. |
| **The Fix** | `brand-title` → `Diff Checker`, `brand-tag` → `Code Comparison`. The tag is for a subtitle; the title has to stand alone. |
| **Status** | ✅ **Resolved** |
| **What changed** | `brand-title` → `Diff Checker`, `brand-tag` → `Code Comparison`. A test asserts both brands still read as a name at the width where `app-chrome.css` hides `.brand-tag`. |

### G2. Seven comparison options in one undifferentiated wrap row

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Low |
| **Location** | `frontend/diff.html:209-237`, `frontend/diff.css:306` |
| **The "Why"** | `.options-row` is a single `flex-wrap` line holding the split/unified segment, five checkboxes, a context `<select>` and "Remember my panes". Four of those change what counts as a difference, one changes rendering, one changes layout and one changes storage — four different kinds of decision presented as one list, reflowing into different arrangements at every width. "Remember my panes" in particular is a privacy choice sitting between "Ignore blank lines" and a context selector. |
| **The Fix** | Three labelled groups on one row — **Compare** (the four ignores), **View** (layout, wrap, context), **Session** (remember) — using the `.seg-group` vocabulary already in the file. No new tokens. |
| **Status** | ✅ **Resolved** |
| **What changed** | Three `<fieldset>`s with legends — **Compare** (the four ignores), **View** (layout, wrap, context) and **Session** (remember) — replacing the single wrap row. "Remember my panes" is no longer sitting between "Ignore blank lines" and a context selector as though it were another comparison flag. |

### G3. No way to swap the panes, and no sample to try

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (feature gap) |
| **Severity** | Low |
| **Location** | `frontend/diff.html:158-196` |
| **The "Why"** | Pasting the two sides in the wrong order means selecting, cutting and re-pasting both — a swap button is the single most common control on a diff tool and there is no `swap` handler anywhere in `js/diff/`. Separately, `/json` opens with **Load sample** and `/cron` and `/crypto` both ship preset chips; `/diff` opens with two empty boxes and a placeholder, so a visitor evaluating it has to supply their own material before it does anything. |
| **The Fix** | A swap button in `.options-row` (exchange the two `value`s, redraw), and a **Load sample** `btn-sm` in the Original pane header that fills both sides with a short before/after — ideally a real snippet from this repo, which makes the demo a work sample too. |
| **Status** | ✅ **Resolved** |
| **What changed** | A **Swap** button exchanging the two panes and redrawing, and **Load sample** filling both sides with a real before/after from this repo: the roving-tabindex fix these same apps' tablists run on, which makes the demo a work sample too. |

---

## H. Cross-cutting

### H1. Only `/diff` explains itself

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (consistency) |
| **Severity** | Low |
| **Location** | `frontend/diff.html:324-390` (About) vs `cron.html`, `crypto.html`, `json.html` |
| **The "Why"** | `/diff`'s About tab is the best writing in the shelf: what the engine is, where it stops, what it is knowingly wrong about. The other three state their privacy posture in a footer line and their limits nowhere. For audience 2 — the site as a work sample — that tab is the page that shows judgement, and three apps do not have one. |
| **The Fix** | An **About** tab on `/cron`, `/crypto` and `/json`, same shape: the algorithm, the limits, the deliberate omissions. `/json`'s converters already carry per-converter limit notes (`#convert-note`) that can be collected into one. |
| **Status** | ✅ **Resolved** |
| **What changed** | An **About** tab on `/cron`, `/crypto` and `/json`, same shape as `/diff`'s: the algorithm, the limits, the deliberate omissions. `/cron`'s states the POSIX day-of-month/day-of-week OR rule that surprises people; `/crypto`'s states why it will never verify a JWT signature; `/json`'s collects the per-converter limits. `.prose-card`/`.prose-heading`/`.prose-list` moved out of `diff.css` into `app-chrome.css` rather than being copied into three more stylesheets. A test asserts each tab is wired to a real panel, is not the tab the app opens on, and carries a Limits section. |

### H2. Every app is a dead end except back to the portfolio

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Low |
| **Location** | every app's `.app-footer` / `.arcade-footer` |
| **The "Why"** | Cross-links exist but only in the footer, and each app names a different arbitrary pair — `/cron` points at crypto and arcade, `/json` at crypto and cron, `/diff` at json and crypto. A visitor who likes one tool has to either scroll to the bottom or go back to the shelf to find the next. The header has room and already holds the Back link. |
| **The Fix** | Replace the back button with a small app-switcher: same `action-btn`, a popover listing all seven with the current one marked. One shared `app-switcher.js` next to `app-chrome.css`, seven identical insertions, and it makes the shelf navigable from inside the apps. |
| **Status** | ✅ **Resolved** |
| **What changed** | `js/app-shared/app-switcher.js`: the Back control keeps its place and its press, and a trigger beside it opens a popover listing all seven apps plus Portfolio home and the shelf, with the current one marked `aria-current="page"` rather than removed. `Esc` closes and returns focus; click-outside dismisses. The `APPS` array is asserted against `index.html`, so the switcher and the shelf cannot drift. |

### H3. Keyboard support stops at `/diff`

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (consistency) |
| **Severity** | Low |
| **Location** | `frontend/js/diff/diff-ui.js:464` |
| **The "Why"** | `/diff` binds `j`/`k` and arrows to step through changes and guards correctly against text fields and modifier keys. No other app has a document-level shortcut, and none of the seven has a `?` shortcuts sheet — so `/diff`'s own shortcuts are undiscoverable too. For a shelf whose audience is developers, this is the cheapest credibility win available. |
| **The Fix** | One shared `app-shortcuts.js`: `?` opens a sheet, `/` focuses the primary input, `1`–`4` switch tabs, `Esc` closes. Register per-app extras (`/diff`'s `j`/`k`) through the same table so the sheet is generated from what is actually bound rather than hand-written. |
| **Status** | ✅ **Resolved** |
| **What changed** | `js/app-shared/app-shortcuts.js`: `?` opens a sheet, `/` focuses the primary input, `1`–`9` switch tabs, `Esc` closes. The sheet is **generated from the table that does the binding**, so it can only list what is actually bound — a test asserts its row count equals the registered bindings plus the two the module owns. `/diff`'s `j`/`k` moved out of `diff-ui.js` and register through that table, which is what makes them discoverable. A `suppress` hook hands the keyboard back entirely while `/arcade` has a game on screen, since `Escape` belongs to the shell then. |

---

## I. New features, ranked

Effort is rough: **S** ≤ half a day, **M** one to two days, **L** more.
**All fifteen are built.** The "Built" column names what actually shipped where
it differs from the proposal.

| # | Feature | App | Effort | Built |
| ---: | :--- | :--- | :---: | :--- |
| 1 | `role="tab"` / `aria-selected` + arrow keys | `/ucl`, `/worldcup` | S | ✅ Stage and mobile round switchers both |
| 2 | WebP + `srcset` previews | shelf | S | ✅ 1.93 MB → 316 KB |
| 3 | Progress bar + hero chips | `/worldcup` | S | ✅ Denominator is 40, not 51 — see B3 |
| 4 | JWT decoder tab | `/crypto` | M | ✅ Decode only, and the panel says so |
| 5 | HMAC row | `/crypto` | S | ✅ Verified against RFC 4231 and RFC 2202 |
| 6 | Timezone selector on Next 10 Triggers | `/cron` | S | ✅ Re-evaluates the schedule, not just the labels |
| 7 | `@daily` macros + 6-field detection | `/cron` | S | ✅ Plus `@midnight` and a named `@reboot` |
| 8 | Swap panes + Load sample | `/diff` | S | ✅ Sample is a real snippet from this repo |
| 9 | Shortcuts sheet (`?`) | all | M | ✅ Generated from the bindings, not hand-written |
| 10 | App switcher in the header | all | M | ✅ Back keeps its place and its press |
| 11 | About tab | `/cron`, `/crypto`, `/json` | M | ✅ `.prose-*` promoted to `app-chrome.css` |
| 12 | Structural JSON compare | `/json` | M | ✅ Imports `diff-engine.js`, recorded in the spec |
| 13 | Arcade session summary + clear scores | `/arcade` | S | ✅ Prefix sweep; the sound preference survives |
| 14 | Re-render previews without baked-in copy | shelf | M | ✅ Merged with #2 — one generator, one pass |
| 15 | Collapsible source card | `/json` | M | ✅ Auto-collapses on a tab change |

## J. Suggested sequencing

Followed as written. Pass 1 (I1–I3, B2, B4, D1, E1, F1, G1) cleared every
accuracy and accessibility finding; pass 2 (I4–I8) was additive; pass 3
(I9–I12, H2) introduced `js/app-shared/` and `frontend/app-shared.css` as one
piece of work rather than four.

Two things the report's closing paragraph got wrong, both found by running the
gates rather than trusting the note:

- **A3 did edit an inline `<script>` in `index.html`.** Making the filter
  addressable needed the pre-boot router to resolve a section from the
  fragment's first segment, so one of the three pinned `sha256-` hashes was
  recomputed and repinned. `scripts/check_csp_hashes.py` passes.
- **The build's size budgets were not free.** CSS went 291 → 296 KiB for the
  five new panels, documented in `scripts/build.mjs` against what consumed it.
  JS did **not** move: the same work added ~48 KiB, and building the six
  standalone-app entries as one `splitting` group instead of six separate
  esbuild calls reclaimed ~29 KiB of shared code that had been inlined once per
  app — which is what "trim before raising" looks like when there is something
  real to trim.

## K. Verification

Every gate CI runs, run here:

| Gate | Result |
| :--- | :--- |
| `npm test` | **639 pass**, 0 fail (512 before this pass) |
| `npm run lint` | clean (ESLint + Stylelint) |
| `npm run build` | JS 381.9 KiB / 390, CSS 294.0 KiB / 296 |
| `python3 scripts/check_csp_hashes.py` | all inline scripts allowed |
| `python3 scripts/check_docs.py` | all documented figures match |
| `python3 scripts/check_agent_config.py` | all invariants satisfied |

Backend gates were not run: no file under `server/` is in scope. That is a
scope boundary, not a skipped gate.

New suites: `app-shared.test.js` (14), `app-about.test.js` (22),
`crypto-jwt.test.js` (10), `crypto-share.test.js` (9),
`json-compare.test.js` (12). Extended: `apps-experience.test.js`,
`ucl-bracket.test.js`, `worldcup-bracket.test.js`, `arcade.test.js`,
`cron.test.js`, `crypto-hasher.test.js`.

Two defects were found by the new tests rather than by reading, and both are
fixed: `compareRows` checked its row cap between changes rather than between
lines, so a single large `replace` blew straight through it; and nine Font
Awesome classes — three of them introduced in this pass — were not in the
vendored subset, which renders as blank space with no error on the five apps
that use the local font. A test now asserts every icon those apps ask for is
one `fonts.css` actually carries.
