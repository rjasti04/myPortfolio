# Intent: Apps Shelf & Standalone Apps — UI/UX Review Remediation

**Source report**: `docs/review/apps-uiux.md` (25 findings, dated 2026-09-22)

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter — the shelf is a decision surface and the seven
        apps are what it sells. One finding (B1) is an outright WCAG 2.2 4.1.2
        failure; two more (A2, G1) cost first paint and legibility on a phone.
  - [x] 2. Portfolio as a Work Sample — the report's recurring shape is *four
        apps got a pass the other three did not*. Inconsistency between sibling
        surfaces is the thing a reviewer notices first.
  - [ ] 3. Owner — nothing here touches the dashboard, chat or auth.

- **Problem Statement**:
  `docs/review/apps-uiux.md` audited the `#apps` shelf and all seven standalone
  apps and found 25 open items. Every one was re-checked against the working
  tree before this document was written; all 25 still reproduce. They cluster
  into four problems:

  1. **The two football predictors never had the accessibility pass the Dev
     Tools apps got.** Neither `ucl.html` nor `worldcup.html` declares
     `role="tablist"`, `role="tab"`, `aria-selected` or `aria-controls`
     anywhere, and neither binds arrow keys. The active stage is conveyed by a
     CSS class alone. Verified: `grep -c 'role="tab'` returns 0 in both.
     26 of 39 decorative `<i class="fa…">` across the two files also lack
     `aria-hidden` (B2).
  2. **The shelf ships 1.93 MB of 1200×630 PNG into a ≤420px grid track**, and
     each of those PNGs is a marketing card whose baked-in eyebrow, title and
     blurb repeat the tile text directly underneath it. `styles.css` already
     works around the second problem with a scrim whose own comment names the
     real fix.
  3. **Four apps are a generation ahead of the other three.** `/worldcup` has
     no progress bar, no hero chips and generic reorder labels where `/ucl` has
     all three; `/cron`, `/crypto` and `/json` have no About tab where `/diff`
     has the best writing in the shelf; only `/diff` binds a keyboard shortcut,
     and it is undiscoverable because nothing documents it.
  4. **Small accuracy defects**: a tile called "Cron & Regex Visualizer" opens a
     page headed "Logic Inspector" (D1); `/diff`'s header reads "Code
     Difference" on every phone because half its name is in the tag the shared
     chrome hides below 960px (G1); `/crypto`'s "Share permalink" copies a link
     to the tab and nothing else (E1); `/json`'s Minify button wears a
     left-arrow (F1); `/worldcup` brands itself "FIFA 26" above a "Not
     Affiliated With FIFA" footer (B4).

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - ADR-001: vanilla ES modules. The two shared modules this adds
    (`app-switcher.js`, `app-shortcuts.js`) are plain modules beside
    `app-chrome.css`, not a component layer.
  - ADR-016: zero third-party asset origins in the SPA. New shelf images are
    self-hosted WebP generated in-repo. `/ucl` and `/worldcup` keep their
    existing CDN links — that is the standing exception, and nothing here adds
    to it.
  - ADR-023: untouched; no API surface in scope.

- **Standing decisions this does not reopen** (carried from the report):
  `/arcade` stays dark-only; `/cron` keeps its own breakpoints; the predictors
  keep their CDN assets; no shared router or framework across the apps.

- **One non-goal is deliberately crossed**: B3 reaches into `/worldcup`'s body
  layout, which `2026-09-12-apps-uiux-redesign.md` listed as a non-goal. That
  non-goal was scoped to *that* task (aligning chrome), not recorded as
  permanent, and the report calls the crossing out explicitly rather than
  smuggling it. Carried forward here on the same terms.

- **Explicit Non-Goals**:
  - No backend, database, auth or CSP change. Nothing in scope edits an inline
    `<script>` in `index.html`, so the three pinned `sha256-` hashes hold.
  - No framework, no shared router, no build-step change.
  - `/crypto`'s JWT tab decodes only. It will never offer to verify a
    signature client-side, and will say so on the panel.
  - The `/ucl` right-hand rail (the third of B3's three items) is explicitly
    left for later by the report itself.

## 3. Impacted Layer Matrix & Quality Gates

- [x] **Frontend**: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: not impacted
- [ ] **Database**: not impacted
- [x] **Docs / Hashes**: `python3 scripts/check_csp_hashes.py` &&
      `python3 scripts/check_docs.py --fix --show-tokens`

## 4. Risks & Mitigations

- **Performance / Asset Size Impact**: net strongly positive. The shelf's seven
  previews drop from 1.93 MB of PNG to two WebP widths per app served through
  `<picture>`/`srcset`. The PNGs stay on disk only because `og:image` still
  points at them — a social card is a different job from a tile thumbnail, so
  the two are split rather than merged.
- **Regression risk on the predictors**: `ucl.html` and `worldcup.html` are
  single self-contained files with ~1,500 lines of inline script each, covered
  by `ucl-bracket.test.js` (19 tests) and `worldcup-bracket.test.js` (6). Both
  boot the real file in jsdom with `runScripts: "dangerously"`, so tab
  semantics and reset behaviour are directly testable; new tests go there.
- **`window.confirm` removal (B5)**: jsdom's `confirm` returns false, so the
  existing tests never exercised reset. The two-press replacement is testable
  and gains coverage rather than losing it.
- **Security / Authentication**: no change. `/crypto`'s new HMAC row and JWT
  tab run entirely on `crypto.subtle` in the page; the app declares
  `connect-src 'none'` and that is not relaxed.
- **API Cost / Rate Limits**: none — no request leaves the browser.
