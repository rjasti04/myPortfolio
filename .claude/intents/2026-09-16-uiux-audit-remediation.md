# Intent: UI/UX Audit Remediation — Route Semantics, Contrast, and Cross-App Consistency

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [ ] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)

- **Problem Statement**:

  A full read-only audit of the SPA, the five standalone developer apps and the two
  predictors found the visual and interaction design to be in good shape — the token
  system is honoured, focus-visible coverage is broad (133 rules), there are **zero**
  duplicate element IDs and **zero** dangling ARIA references across all six HTML
  pages, and no icon-only button anywhere lacks an accessible name. The defects that
  remain are not styling problems. They cluster into four groups:

  1. **The SPA's eight views behave as one page.** `.js-enabled section { display: none }`
     (`styles.css:7501`) means exactly one section is in the accessibility tree at a
     time, so each view *is* a page. But `document.title` is never rewritten,
     `<link rel="canonical">` and `og:url` are frozen at `https://rjasti.com/`, and
     `setActiveSection()` (`app-logic.js:2-19`) neither moves focus nor announces the
     change. Only `#home` carries an `<h1>`, so **seven of the eight views render a
     document with no level-1 heading at all**. A screen-reader user who activates
     "Resume" gets no title change, no announcement, no focus move, and a document
     whose first heading is an `<h2>`. `aria-current="page"` on the nav link is the
     only signal that anything happened.

  2. **Two measured contrast and forced-colors failures.** `.link-action:hover`
     (`styles.css:3754`) resolves to `--accent-hover` = `hsl(64,60%,43%)`, which is
     **2.27:1** on the light `--bg` — the resume *Download* link drops from an
     accessible 5.52:1 to a WCAG AA failure on hover, in the single most
     recruiter-relevant control on the site. Separately, three gradient-text rules
     (`styles.css:3211` `.home-role`, `:3572` `.section-title`/`.contact-title`,
     `:4951` `.stat-number`) paint with `-webkit-text-fill-color: transparent`, which
     forced-colors mode does not reset — and the repo has no `forced-colors` media
     query anywhere. In Windows High Contrast Mode the job title, every section
     heading and all six stat figures render invisible. Compounding it, both
     `@media (prefers-contrast: high)` blocks (`styles.css:1289`, `:6745`) use a
     non-standard value that Chrome and Firefox never match, so the high-contrast
     token overrides and enhanced focus outlines are dead code for most users.

  3. **The developer apps drifted apart again.** The 2026-09-12 harmonisation aligned
     their chrome, but behaviour diverged since: JSON Workbench's `flash()`
     (`json-ui.js:116-126`) assigns `button.textContent`, which **permanently destroys
     the `<i class="fas fa-copy">` icon inside every copy button after its first
     click** — while `crypto-ui.js:73-80` saves and restores `innerHTML` correctly.
     Primary editing fields in json/diff/crypto sit at 13.6–14px, under the 16px floor
     that stops iOS Safari zooming the viewport on focus. `.btn-sm` — the Copy /
     Download / Load-sample class — misses the 44px touch target in all three apps and
     at every breakpoint in crypto. Arcade's two `role="dialog"` overlays move and
     restore focus correctly but never trap `Tab`.

  4. **Content and discovery gaps.** The second employer's four experience groups
     (`index.html:1216,1231,1246,1261`) have no `id` anchors and no entries in
     `search-index.js`, so roughly 24 bullets are unreachable from the Ctrl+K palette —
     and the palette's own comment notes find-in-page cannot substitute, because the
     router keeps the other seven sections out of the DOM. The contact lede says "the
     form on the right" while `.contact-layout` collapses to one column below its
     breakpoint. And `index.html` ships 29.7 KB of HTML comments (21% of a 141 KB
     render-blocking document), 9.9 KB of which is commented-out dead resume markup.

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules. No frameworks or component abstractions.
    The long single initialisers in `chat.js` / `auth-ui.js` are an accepted cost.
  - **ADR-016**: Zero third-party asset origins in the SPA. `script-src` stays `'self'`
    plus the three pinned inline hashes; `formsubmit.co` remains the one sanctioned
    runtime egress.
  - **ADR-023**: The client never dictates model ID, system prompt or token ceilings.
  - **ADR-024 / ADR-025** (`docs/DESIGN.md`): every new colour joins a scale, carries a
    **measured** contrast ratio in a comment, and is defined in **both** themes.
  - **ADR-008**: the frontend API base stays runtime-resolved; no build-time config.

- **Explicit Non-Goals**:
  - Do **NOT** "fix" `ucl.html` / `worldcup.html` to match the SPA's CSP or asset
    policy. Their Google Fonts / cdnjs / FlagCDN loads are a recorded exception, and
    they are not precedent for the SPA. Their internal bracket layouts stay untouched.
  - Do **NOT** introduce a router library, a view-transition framework, or a
    component abstraction to solve the per-view title problem — it is a handful of
    lines against the existing `setActiveSection()`.
  - Do **NOT** restyle the visual language. The glass surfaces, plexus canvas, tile
    hover choreography and three-hue palette are settled and working; this is a
    semantics, contrast and consistency pass, not a redesign.
  - Do **NOT** remove the architectural design-rationale comments from `frontend/`.
    They are a deliberate work-sample asset (persona 2). Comment stripping happens in
    the **build**, so `frontend/` stays the source of truth and `dist/` ships lean.
  - Do **NOT** add a theme toggle to Arcade — its dark-only retro aesthetic is
    intentional (2026-09-12 intent).
  - Do **NOT** change any app's functional logic; this is layout, semantics and
    feedback only.
  - Do **NOT** authenticate `POST /chat` or `POST /sessions`.

## 3. Impacted Layer Matrix & Quality Gates

- [x] **Frontend**: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no `server/` changes
- [ ] **Database**: N/A — no schema changes
- [x] **Docs / Hashes**: `python3 scripts/check_csp_hashes.py` && `python3 scripts/check_docs.py`

Both doc gates pass at baseline on this branch and must still pass afterwards.
`check_csp_hashes.py` matters here specifically: the per-view title work touches
`navigation.js`, **not** an inline `<script>`, and it must stay that way — editing any
inline script in `index.html` invalidates one of the three pinned `sha256-` hashes.

## 4. Risks & Mitigations

- **Performance / Asset Size Impact**: Net negative, which is the point. Stripping
  comments from shipped HTML removes ~29.7 KB from a render-blocking document
  (gzip recovers much of it, but the parse cost is real). The new CSS is a handful of
  tokens and one `forced-colors` block — well inside the 240 KiB CSS budget that
  `scripts/build.mjs` enforces.

- **API Cost / Rate Limits**: None. No endpoint, prompt or Bedrock call changes.
  Reducing the service-worker `registration.update()` interval (`main.js:318`, today
  every 60 s regardless of tab visibility) *lowers* origin request volume.

- **Security / Authentication**: No auth surface is touched. The one real hazard is
  the build-time comment stripper: it must never touch inline `<script>` bodies, or it
  silently breaks the three pinned CSP hashes. `build.mjs` already states that inline
  script bodies are never modified; the stripper must honour the same rule and
  `check_csp_hashes.py` is the gate that proves it.

- **Regression Risk**:
  - Promoting each section's heading to `<h1>` changes the visual type scale unless
    `.section-title` keeps its own sizing. Mitigation: change the *element*, keep the
    class, so `--text-fluid-section` still governs.
  - A `forced-colors` block is invisible in normal rendering and easy to get wrong
    with no feedback. Mitigation: verify in Windows HCM or Chrome DevTools'
    *Emulate forced-colors* before merging.
  - Fixing `prefers-contrast` from `high` to `more` **activates two blocks that have
    never actually run in Chrome or Firefox**. They may contain latent visual bugs.
    Mitigation: treat this as a new feature and review both blocks rendered, rather
    than assuming they are correct because they have always been "present".
  - `json-ui.js`'s `flash()` is covered by existing tests; switching `textContent` to
    `innerHTML` must keep those green and must not introduce an unsanitised sink — the
    restored value is the button's own prior markup, never user input.

## 5. Assumptions

This session is non-interactive (Claude Code on the web), so per the `intent-planner`
skill the requirement interview was skipped and the answers inferred from the request,
the repo and `AGENTS.md`. The choices made:

1. **Scope is remediation of audit findings, not a redesign.** The request asked what
   would improve the UI/UX *and* for bugs; the code shows a design system that has
   already been through several review passes, so the value is in correctness and
   consistency rather than new visual direction.
2. **Persona 1 and 2 both checked.** The route-semantics and contrast defects hit
   visitors directly; the cross-app inconsistencies hit the work-sample reading.
3. **Per-view `<h1>` chosen over an `aria-live` route announcer alone.** Both are
   proposed, but the heading fix is the structural one — a live-region announcement on
   a document that still has no `<h1>` treats the symptom.
4. **Comment stripping placed in the build, not in `frontend/`.** `AGENTS.md` is
   explicit that `frontend/` is the source of truth and `dist/` is what deploys, and
   the comments are a work-sample asset. The dead commented-out resume markup
   (`index.html:1161`, `:1202`) is the exception — that is deleted at source, since it
   is superseded content with no documentary value.
5. **Severity ranked by visitor impact, not by effort.** The gradient-text and
   route-semantics items are High because they remove information entirely for a class
   of users, not because they are hard to fix.
6. **No implementation performed in this session.** The deliverable requested was a
   plan; the audit is read-only and no application file was modified.

## 6. Acceptance Criteria

Deterministic checks that verify completion:

1. Navigating to each of the eight sections rewrites `document.title`, and
   `<link rel="canonical">` / `og:url` track the active view.
2. Every section renders exactly one `<h1>`; no view renders zero. Verifiable by
   asserting `document.querySelectorAll('section.active h1').length === 1` per route.
3. A route change moves focus to the new section and is announced once via a polite
   live region.
4. `.link-action:hover` measures **≥ 4.5:1** against `--bg` in both themes.
5. A `forced-colors: active` block restores `-webkit-text-fill-color` on all three
   gradient-text rules; the job title, section headings and stat numbers stay visible
   in Windows High Contrast Mode.
6. `prefers-contrast` queries use the standard `more` value and both blocks render
   correctly when emulated.
7. Copy buttons in JSON Workbench retain their icon across repeated clicks.
8. Every text-entry control in json / diff / crypto is ≥ 16px, and `.btn-sm` meets
   44px (48px under 640px) in json, diff and crypto.
9. Arcade's pause and game-over dialogs trap `Tab`.
10. The second employer's four experience groups carry `id` anchors and appear in
    `search-index.js`; searching "Serverless Order Pipeline" in Ctrl+K finds them.
11. `dist/index.html` contains no HTML comments, the three CSP hashes still validate,
    and `frontend/index.html` retains its architectural commentary.
12. All gates green: `npm run lint`, `npm test`, `npm run build`,
    `python3 scripts/check_csp_hashes.py`, `python3 scripts/check_docs.py`.
