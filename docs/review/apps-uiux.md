# Apps Shelf & Standalone Apps — UI/UX and Feature Review

**Date:** 2026-09-22
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

---

## A. The shelf (`#apps` in `index.html`)

### A1. Preview images repeat the tile's own title and blurb

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Medium |
| **Location** | `frontend/*-preview.png`; `frontend/styles.css:8148` |
| **The "Why"** | Each preview is a 1200×630 marketing card carrying its own eyebrow, title and blurb — `json-preview.png` reads "DEVELOPER UTILITY • DATA WORKBENCH / JSON Workbench / Query Studio" plus a three-line description. The tile body below it then says the same things again, quieter. Every tile reads as two competing headlines. The stylesheet already fights this with a scrim that lifts on hover, and its own comment says so: *"the real fix is re-rendering the PNGs without baked-in copy."* |
| **The Fix** | Re-render the seven previews as screenshots of the app's actual UI with no text overlay, and drop `--app-media-scrim` and the `::after` veil. The OG cards can stay text-heavy — `og:image` is a different job from a tile thumbnail, so split them: `*-og.png` for social, `*-tile.webp` for the shelf. |

### A2. Seven full-size PNGs served into a 320–420px box

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Medium |
| **Location** | `frontend/index.html:1440` and six siblings; `frontend/styles.css:388` (`--app-tile-min: 320px`) |
| **The "Why"** | 331–355 KB per preview × 7 = **~2.3 MB**, all PNG, all 1200×630, all rendered into a grid track that floors at 320px and rarely exceeds ~420px. The project already ships WebP with `<picture>` + `srcset` for the portraits and the backdrop, so the toolchain and the idiom exist — the shelf is the one place that skipped them. `loading="lazy"` defers the cost but does not remove it, and on a phone the whole shelf is one scroll. |
| **The Fix** | Emit `640w` and `1280w` WebP per app and swap the bare `<img>` for the same `<picture>`/`srcset` pattern `index.html:766` already uses. Expect ~85% off: ~2.3 MB → ~300 KB. Keep one PNG fallback per app only if the OG card needs it. |

### A3. The filter is not addressable

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Low |
| **Location** | `frontend/js/apps-filter.js:31` |
| **The "Why"** | `#apps` always opens on **All**. There is no way to link someone to the Dev Tools subset, and a chosen filter does not survive a reload or a section change — which the SPA's own router makes cheap to support. |
| **The Fix** | Read `location.hash` for `#apps/dev-tools` on init and `history.replaceState` on each chip press. Roughly ten lines, and it reuses the routing vocabulary already in `navigation.js`. |

### A4. Tiles state what an app does, never what it costs to try

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Low |
| **Location** | `frontend/index.html:1436-1546` (`.app-grid`) |
| **The "Why"** | The shelf lede promises "runs entirely in your browser", but a visitor deciding between seven tiles gets no per-tile signal of size, offline capability or whether anything is stored. The apps themselves make a point of this — every footer says "Zero Network Egress" — and the shelf, which is where the decision is actually made, says it once in prose at the top. |
| **The Fix** | A single row of two or three micro-chips above the Launch pill, driven from `data-` attributes on the tile: `No sign-in`, `Works offline`, `Nothing stored`. Reuse `.app-filter-chip` metrics so no new vocabulary is introduced. |

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

### B2. Decorative Font Awesome icons are not hidden

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (accessibility) |
| **Severity** | Medium |
| **Location** | `ucl.html` — 6 of 19 `<i class="fa…">` (lines 1797-1799, 1813, 1816, 1819, 2190-2192, 2311, 2313); `worldcup.html` — 12 of 20 (1425, 1428, 1431, 1738-1740, 1854-1855, 2028, 2379, 2384, 2395, 2406) |
| **The "Why"** | Every `<i class="fa…">` in the four Dev Tools apps carries `aria-hidden="true"`; the two predictors mostly do not, including inside toasts and the final podium, where the glyph sits next to the text it decorates. Some screen readers announce the private-use codepoint. |
| **The Fix** | Add `aria-hidden="true"` to every decorative `<i>` in both files, including the ones built in template literals. |

### B3. World Cup is a design generation behind UCL

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Medium |
| **Location** | `worldcup.html:1416-1421` vs `ucl.html:1792-1808, 1839-1876` |
| **The "Why"** | `/ucl` got a pass `/worldcup` did not. UCL has a hero meta row (`36 clubs · 8 matchdays`, `Swiss league phase`, `Final · Madrid`), a global `0 of 23 ties decided` progress bar, a zone legend on the standings, and a right-hand rail carrying *How the format works*, *Your seeded eight* and *Key dates*. World Cup has a heading, a paragraph, and nothing else — no progress indicator anywhere except the wildcard counter on one of its three tabs. Someone landing on `/worldcup` from `/ucl` sees the same chrome around a visibly thinner app. Its reorder buttons are also labelled generically — `aria-label="Move team up"` (`worldcup.html:1854`) where UCL names the club (`ucl.html:2311`). |
| **The Fix** | Port three things, in this order: (1) the `.progress-wrap` markup (`ucl.html:1801-1807`) and the fill logic at `ucl.html:2906` — World Cup has a fixed denominator (12 groups + 8 wildcards + 31 knockout ties); (2) the `.hero-meta` chip row (`ucl.html:1796-1800`) (`48 teams · 12 groups`, `Round of 32`, `Final · New Jersey · 19 Jul 2026`); (3) the team name into the reorder labels. The rail is a bigger lift and can wait. **Note:** this reaches into `/worldcup`'s body layout, which the 2026-09-12 redesign listed as a non-goal for that task. |

### B4. Brand title reads "FIFA 26" beside a "Not Affiliated With FIFA" footer

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (content) |
| **Severity** | Low |
| **Location** | `worldcup.html:1378` vs `worldcup.html:1582` |
| **The "Why"** | The header brands the app with the governing body's mark; the footer then disclaims affiliation with it. "FIFA 26" also reads as the video game rather than the tournament. UCL avoids this — it brands itself "UCL 26/27", a competition abbreviation, not an organisation. |
| **The Fix** | `FIFA 26` → `World Cup 26`. One line. |

### B5. Reset uses native `window.confirm()`

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (consistency) |
| **Severity** | Low |
| **Location** | `ucl.html:3303`, `worldcup.html` reset handler |
| **The "Why"** | Both throw a browser-chrome dialog prefixed "rjasti.com says", breaking out of a page that otherwise controls every pixel. The SPA has `js/confirm-dialog.js` and the Dev Tools apps use an inline two-press confirm on the same class of action (`diff-ui.js:489`, `.action-btn.is-confirming`). The predictors are the only surface still calling the native one. |
| **The Fix** | Adopt the two-press `is-confirming` pattern the Dev Tools already use — it needs no import and keeps both pages self-contained. |

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

### C2. Controls are a card footnote, not a how-to-play

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Low |
| **Location** | `frontend/js/arcade/shell.js:124` (`.launch-controls`), `arcade.html` pause panel |
| **The "Why"** | `meta.controls` is the only rules text a player gets, and Tetris's runs to three clauses — *"Arrows or swipe to move · Up or tap to rotate · Space or swipe down to drop"* — inside a card that also carries art, a name, a tagline and a score bubble. The pause panel doubles as the how-to sheet, which means the way to learn the rules is to start playing and then stop. |
| **The Fix** | Add an optional `meta.rules` string (one sentence: what scores, what ends the run) and show it in the pause panel above the controls. Cheap, and it makes the pause panel the sheet it is already described as. |

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

### D2. No `@daily`-style macros, no timezone selector

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (feature gap) |
| **Severity** | Low |
| **Location** | `frontend/js/cron/cron-parser.js:146`, `cron-ui.js:101` (`#cron-tz`) |
| **The "Why"** | The parser handles named tokens (`JAN`, `MON`), ranges, steps and lists — genuinely good — but rejects anything that is not exactly five fields, so pasting `@daily` or a 6-field Quartz expression from a real crontab or a Kubernetes manifest gets *"Expected exactly 5 fields"* rather than an answer. Separately, the Next-10-Triggers rail computes in the visitor's local zone and says so in a static pill; the common question is *"when does this fire in UTC / in the server's zone"*, and the app cannot answer it. |
| **The Fix** | Two independent, additive changes: (1) expand the six standard macros (`@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@hourly`) to their canonical five-field form before parsing, and detect a 6-field input to say *"looks like a Quartz expression — drop the seconds field"* instead of a bare count error; (2) turn `#cron-tz` from a pill into a `<select>` over `Intl.supportedValuesOf('timeZone')` and pass it to the existing `Intl.DateTimeFormat` call in the timeline. No new dependency for either. |

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

### E2. "Clear All Workbench Data" lives in the footer

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (consistency) |
| **Severity** | Low |
| **Location** | `frontend/crypto.html:762-772` vs `json.html:33-41`, `diff.html:30-38` |
| **The "Why"** | `/json` and `/diff` put Clear in `header-actions` as an `.action-btn.text-danger` beside the theme toggle. `/crypto` — which holds more sensitive residue than either, since its fields carry plaintext about to be hashed — puts the same control at the bottom of the page, below the privacy statement, where a visitor has to scroll past the whole workbench to find it. Three apps, two placements, and the odd one out is the one where it matters most. |
| **The Fix** | Move it into `header-actions`, matching `/json`. The footer keeps the privacy sentence without the button. |

### E3. Hashing is SHA-only

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (feature gap) |
| **Severity** | Low |
| **Location** | `frontend/js/crypto/hasher.js` |
| **The "Why"** | Three SHA digests recomputed per keystroke, with SHA-1 correctly flagged as collision-broken. The two things developers most often reach a client-side crypto tool for are absent: **HMAC** (a keyed digest, one extra input and `crypto.subtle.sign`) and **JWT decoding** (split on `.`, Base64URL-decode header and payload, render the claims, render `exp` as a relative time). The page already has Base64URL decoding in `encoders.js` and relative-time formatting in `time-workbench.js` — a JWT tab is mostly wiring two existing modules together. |
| **The Fix** | Add an **HMAC** row to the hasher panel (key input + algorithm select, `crypto.subtle.importKey` → `sign`), and a fifth **JWT** tab. Decode only — never offer to verify a signature client-side, and say so on the panel, since a tool that appears to verify is worse than one that plainly does not. |

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

### F2. The source textarea is fixed-height and never gets out of the way

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance (interaction) |
| **Severity** | Low |
| **Location** | `frontend/json.css:329` (220px), `json.css:958` (170px at ≤640px) |
| **The "Why"** | The source card sits above the tab panels by design — correct, since all four tabs read it. But it is a fixed 220px box plus a dropzone plus a status strip, so on a phone the output of whichever tab you are using starts below ~400px of input furniture, every time, on every tab. The one thing you came to look at is always the thing below the fold. |
| **The Fix** | Collapse the source card to a one-line summary (`document · 1,204 lines · valid`) once a document parses, with a click to re-expand, and auto-collapse on tab switch. The `.status-strip` already carries the state the summary needs. |

### F3. No JSON-to-JSON comparison, on a site that ships a diff engine

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (feature gap) |
| **Severity** | Low |
| **Location** | `frontend/js/json/`, `frontend/js/diff/diff-engine.js` |
| **The "Why"** | `/diff`'s About tab states the limitation itself: *"two JSON documents that differ just in key order are reported as different."* `/json` can already sort keys (`#sort-keys`) and pretty-print deterministically. A structural JSON compare is the obvious app neither page has, and it sits exactly between two that already ship every piece of it. |
| **The Fix** | A fifth **Compare** tab in `/json`: second document textarea, canonicalise both (sort keys, fixed indent), run the existing Myers implementation over the two rendered strings. Imports `diff-engine.js` across app folders — the only structural decision worth taking deliberately. |

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

### G2. Seven comparison options in one undifferentiated wrap row

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Low |
| **Location** | `frontend/diff.html:209-237`, `frontend/diff.css:306` |
| **The "Why"** | `.options-row` is a single `flex-wrap` line holding the split/unified segment, five checkboxes, a context `<select>` and "Remember my panes". Four of those change what counts as a difference, one changes rendering, one changes layout and one changes storage — four different kinds of decision presented as one list, reflowing into different arrangements at every width. "Remember my panes" in particular is a privacy choice sitting between "Ignore blank lines" and a context selector. |
| **The Fix** | Three labelled groups on one row — **Compare** (the four ignores), **View** (layout, wrap, context), **Session** (remember) — using the `.seg-group` vocabulary already in the file. No new tokens. |

### G3. No way to swap the panes, and no sample to try

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (feature gap) |
| **Severity** | Low |
| **Location** | `frontend/diff.html:158-196` |
| **The "Why"** | Pasting the two sides in the wrong order means selecting, cutting and re-pasting both — a swap button is the single most common control on a diff tool and there is no `swap` handler anywhere in `js/diff/`. Separately, `/json` opens with **Load sample** and `/cron` and `/crypto` both ship preset chips; `/diff` opens with two empty boxes and a placeholder, so a visitor evaluating it has to supply their own material before it does anything. |
| **The Fix** | A swap button in `.options-row` (exchange the two `value`s, redraw), and a **Load sample** `btn-sm` in the Original pane header that fills both sides with a short before/after — ideally a real snippet from this repo, which makes the demo a work sample too. |

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

### H2. Every app is a dead end except back to the portfolio

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (design) |
| **Severity** | Low |
| **Location** | every app's `.app-footer` / `.arcade-footer` |
| **The "Why"** | Cross-links exist but only in the footer, and each app names a different arbitrary pair — `/cron` points at crypto and arcade, `/json` at crypto and cron, `/diff` at json and crypto. A visitor who likes one tool has to either scroll to the bottom or go back to the shelf to find the next. The header has room and already holds the Back link. |
| **The Fix** | Replace the back button with a small app-switcher: same `action-btn`, a popover listing all seven with the current one marked. One shared `app-switcher.js` next to `app-chrome.css`, seven identical insertions, and it makes the shelf navigable from inside the apps. |

### H3. Keyboard support stops at `/diff`

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture (consistency) |
| **Severity** | Low |
| **Location** | `frontend/js/diff/diff-ui.js:464` |
| **The "Why"** | `/diff` binds `j`/`k` and arrows to step through changes and guards correctly against text fields and modifier keys. No other app has a document-level shortcut, and none of the seven has a `?` shortcuts sheet — so `/diff`'s own shortcuts are undiscoverable too. For a shelf whose audience is developers, this is the cheapest credibility win available. |
| **The Fix** | One shared `app-shortcuts.js`: `?` opens a sheet, `/` focuses the primary input, `1`–`4` switch tabs, `Esc` closes. Register per-app extras (`/diff`'s `j`/`k`) through the same table so the sheet is generated from what is actually bound rather than hand-written. |

---

## I. New features, ranked

Effort is rough: **S** ≤ half a day, **M** one to two days, **L** more.

| # | Feature | App | Effort | Why this one |
| ---: | :--- | :--- | :---: | :--- |
| 1 | `role="tab"` / `aria-selected` + arrow keys | `/ucl`, `/worldcup` | S | Closes the only WCAG failure found; the helper already exists twice in the repo |
| 2 | WebP + `srcset` previews | shelf | S | ~2 MB off the shelf using a `<picture>` pattern already in `index.html` |
| 3 | Progress bar + hero chips | `/worldcup` | S | Brings the weaker predictor level with its sibling; logic ports from `ucl.html:2906` |
| 4 | JWT decoder tab | `/crypto` | M | Highest-demand missing dev tool; reuses `encoders.js` and `time-workbench.js` |
| 5 | HMAC row | `/crypto` | S | `crypto.subtle.importKey` + `sign`, one key input |
| 6 | Timezone selector on Next 10 Triggers | `/cron` | S | Answers the question the app is most often opened to answer |
| 7 | `@daily` macros + 6-field detection | `/cron` | S | Stops rejecting expressions copied from real crontabs |
| 8 | Swap panes + Load sample | `/diff` | S | Most common diff control; gives the app a cold-start demo |
| 9 | Shortcuts sheet (`?`) | all | M | One shared module; makes `/diff`'s existing bindings discoverable |
| 10 | App switcher in the header | all | M | Turns seven dead ends into a shelf you can browse from inside |
| 11 | About tab | `/cron`, `/crypto`, `/json` | M | Matches `/diff`; strongest surface for audience 2 |
| 12 | Structural JSON compare | `/json` | M | Fixes the limitation `/diff` documents about itself |
| 13 | Arcade session summary + clear scores | `/arcade` | S | Data is already in storage; only the rollup is missing |
| 14 | Re-render previews without baked-in copy | shelf | M | Removes the duplicate-headline problem the CSS currently works around |
| 15 | Collapsible source card | `/json` | M | Reclaims ~400px above the fold on every phone, on every tab |

## J. Suggested sequencing

**Pass 1 — correctness (S, ~1 day).** I1, I2, I3, plus B2 (`aria-hidden`), B4
("World Cup 26"), D1 (cron brand), E1 (share-link label), F1 (minify icon) and
G1 (diff brand). Small, independent, individually verifiable, and it clears
every accuracy and accessibility finding in one pass.

**Pass 2 — the tools people came for (M, ~3 days).** I4–I8. Additive; nothing
existing changes shape.

**Pass 3 — shelf coherence (M/L).** I9–I12 and H2. These introduce shared
modules beside `app-chrome.css` and are worth planning as one piece of work
rather than four.

Everything in Pass 1 and Pass 2 is confined to the standalone apps, which sit
outside `index.html`'s CSP, so `scripts/check_csp_hashes.py` is untouched. The
shelf items (A1–A4) do edit `index.html` markup but no inline `<script>`, so the
three pinned hashes hold there too.
