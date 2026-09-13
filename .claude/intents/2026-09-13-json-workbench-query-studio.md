# Intent: JSON Workbench & Query Studio

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [ ] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [ ] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)
- **Problem Statement**:
  Engineers handle JSON constantly — an API response that will not parse, a config
  with a trailing comma, a 4,000-line payload where the one field that matters is
  buried six levels down, a fixture that has to become YAML for a Helm chart or CSV
  for a spreadsheet. The tools for this are a scattered set of ad-supported sites,
  and every one of them asks you to paste the payload into someone else's server.
  That is the wrong trade for an API response carrying a bearer token, a customer
  record, or an internal schema.

  The JSON Workbench & Query Studio (`/json`) is a zero-egress, fully client-side
  answer to all four needs in one document: **validate and repair**, **query**,
  **explore**, **convert**. It follows the `/cron` and `/crypto` precedent — a
  standalone page, its own esbuild entry, no third-party asset, no network call —
  and it is a stronger work sample than either, because the interesting parts are
  not wrappers over browser APIs. A tolerant JSON parser with deterministic error
  positions, a JSONPath evaluator whose filter expressions are parsed rather than
  `eval`'d, a YAML emitter that knows why `no` has to be quoted, and a TypeScript
  interface inferencer are all real algorithmic work written from scratch.

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules. No framework, no component abstraction,
    no runtime npm import. Every parser, emitter and evaluator is hand-written.
  - **ADR-016**: Zero third-party asset requests. Self-hosted Plus Jakarta Sans via
    `fonts.css`, icons from the existing Font Awesome subset only.
  - **ADR-023**: Zero AI and zero backend involvement. No `/chat` call, no model,
    no server-side compute.
  - **Zero Network Egress**: The page ships `connect-src 'none'`. No pasted
    document, query, or conversion result ever leaves the tab.
  - **No `eval` / `new Function`, anywhere**: query filters (`price > 50`) are
    evaluated by a hand-written expression parser over a parsed AST. This is the
    single hardest constraint in the feature — nearly every JSONPath library on npm
    implements filters with `eval`, and none of them could ship here. The page's
    CSP carries no `'unsafe-eval'`, so a violation fails loudly rather than
    silently, and the test suite asserts it directly.
  - **App Chrome Contract** (`docs/FRONTEND.md`): the shared `.app-header` /
    `.app-footer` DOM shape, the seven `--chrome-*` tokens, and the four
    breakpoint tiers, coloured from this app's own palette.
  - **Apps Shelf Contract**: one `<a class="app-tile reveal">` in
    `<section id="apps">` of `frontend/index.html`, a 1200x630
    `json-preview.png`, an eyebrow icon that already exists in the subset, and the
    `"in a new tab"` wording in the `aria-label`.
- **Explicit Non-Goals**:
  - **Persisting the document by default**: people paste secrets into JSON tools.
    Tab choice and formatting options persist; document text does not, unless the
    visitor explicitly opts in with a toggle that defaults to off.
  - **Full RFC 9535 JSONPath**: a documented subset ships. Script expressions
    (`[(...)]`), user-defined functions, and the function extensions (`length()`,
    `match()`, `search()`) are out — the first is unimplementable without `eval`,
    and the rest are surface without a user.
  - **Full YAML 1.2**: a documented subset ships. Anchors and aliases (`&a`/`*a`),
    merge keys (`<<`), multi-document streams, explicit tags (`!!binary`) and
    complex mapping keys (`? `) are out. The in-app UI states the limits; it does
    not fail silently on input it cannot represent.
  - **JSON Schema**: no schema generation, inference or validation in v1. It is a
    coherent feature, it is not one of the four asked for, and it would roughly
    double the module surface.
  - **JSONL / NDJSON, JSON5 as an output format, streaming multi-GB files**: out.
    JSON5-ish input *is* accepted by the repair pass; it is never emitted.
  - **Server-side endpoints, database rows, analytics events**: none. The page is
    inert from the backend's point of view.
  - **Diffing or merging two documents**: out of v1 scope.

## 3. Impacted Layer Matrix & Quality Gates
- [x] **Frontend**: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: not touched — no route, no service, no schema
- [ ] **Database**: not touched — no model, no migration, `alembic check` unaffected
- [x] **Docs / Hashes**: `python3 scripts/check_csp_hashes.py` && `python3 scripts/check_docs.py --fix --show-tokens`

**Note on the CSP gate**: `check_csp_hashes.py` covers only the three inline
`<script>` blocks in `frontend/index.html`. This change edits `index.html` markup
(the new tile) but no inline script, so the three pinned hashes are unchanged.
`json.html`, like `crypto.html`, carries its own CSP and no inline script at all.

## 4. Success Metrics & Verifiable Criteria
- **User-Facing Behaviour**:
  - **One document, four lenses.** `/json` holds a single source document in memory
    and four deep-linkable tabs read it: `#format`, `#query`, `#tree`, `#convert`.
    Paste once, switch tabs, never re-paste. This is the structural difference from
    `/crypto`, where each tab is an independent tool with its own input.
  - **Format & Repair (`#format`)** — pretty-print at 2/4/tab indent, minify, sort
    keys, and validate with a deterministic `line:column` error and a caret into the
    offending text. Repair is a separate, explicit action that fixes trailing
    commas, unquoted and single-quoted keys, single-quoted strings, `//` and
    `/* */` comments, `NaN`/`Infinity`/`undefined`, Python `True`/`False`/`None`,
    and smart quotes — and reports every edit it made as a line-referenced log.
    Repair is never silent and never automatic.
  - **Query Studio (`#query`)** — live filtering as you type, accepting JSONPath
    (`$.items[0].id`, `$..price`, `$.items[?(@.price > 50)]`), bare dot-notation
    (`items[0].id`), and the `filter(price > 50)` sugar. Match count, per-match
    path, and results as a copyable JSON array.
  - **Tree Explorer (`#tree`)** — a collapsible tree beside the code view, with
    type and size badges per node, expand/collapse-all, and a breadcrumb whose
    click copies the focused node's path in JSONPath, dot, or bracket dialect.
  - **Convert (`#convert`)** — JSON to YAML and back, JSON to CSV and back, and
    JSON to TypeScript interfaces, each with the subset limits stated in the panel.
  - **Ergonomics** — drag-and-drop or pick a file (5 MB cap, matching `/crypto`),
    one-click copy on every output, download the result, a "Clear All" privacy
    wipe, full keyboard reachability, and `theme` shared with the SPA so a visitor
    who chose light on the portfolio arrives here in light.
- **Deterministic Quality Gates**:
  - [ ] `npm test` passes, with four new suites covering the parser and repair
        rules, the query engine, the three converters, and the tree renderer.
  - [ ] A test asserts the query engine refuses expression injection rather than
        executing it — the `eval`-free guarantee is verified, not just claimed.
  - [ ] `npm run lint` passes (ESLint over `frontend/js/json/*.js` after the
        `lint:js` glob is extended, Stylelint over `json.css`).
  - [ ] `npm run build` passes **including its size budget gate**.
  - [ ] `python3 scripts/check_docs.py --fix --show-tokens` reports no drift, with
        every new module documented in `docs/JAVASCRIPT.md` and every new test
        listed in `docs/TESTING.md` at its real line count.
  - [ ] `python3 scripts/check_csp_hashes.py` passes unchanged.

## 5. Risks & Mitigations
- **Bundle size budget — the binding constraint on this feature**:
  - *Risk*: `scripts/build.mjs` enforces `BUDGETS_KIB = { js: 305, css: 250 }` and
    the current build sits at **JS 300.2 KiB (98%)** and **CSS 246.1 KiB (98%)** —
    4.8 KiB and 3.9 KiB of headroom. A sixth app cannot fit. For scale, `/cron`
    costs 28.2 KiB JS + 22.8 KiB CSS and `/crypto` costs 18.5 KiB JS + 19.4 KiB
    CSS; this app is the larger of the two in JS terms.
  - *Mitigation*: raise the ceilings deliberately to `{ js: 345, css: 275 }` and
    amend the rationale comment above them in the same commit, which is exactly the
    procedure that comment prescribes. The budget exists to make the argument
    explicit, not to freeze the site. The alternative — reclaiming the ~10 KiB of
    app-chrome CSS that `arcade.css`, `cron.css` and `crypto.css` triplicate — is
    real and already identified in that same comment, but it is a refactor of three
    shipped apps and belongs in its own change, not smuggled into a feature.
- **Tree rendering on large documents**:
  - *Risk*: a 5 MB document expanded whole is hundreds of thousands of DOM nodes;
    the tab locks and the visitor's impression of the site is a frozen page.
  - *Mitigation*: children render only on expand, a node renders at most 200
    children before a "show N more" control, the input is capped at 5 MB with a
    clear rejection notice, and parse/query/convert work is debounced.
- **Correctness of hand-written parsers**:
  - *Risk*: a YAML emitter that writes `no` unquoted, a CSV writer that loses an
    embedded newline, or a repair pass that changes meaning rather than syntax —
    each silently corrupts a visitor's data, which is worse than refusing it.
  - *Mitigation*: roundtrip-property tests per converter, explicit YAML 1.1
    ambiguity vectors (`no`, `yes`, `on`, `off`, `null`, `~`, `0755`, `1:30`,
    `1.0`), RFC 4180 CSV vectors, and a rule that repair only ever rewrites syntax
    — it never reorders, coerces, or drops a value, and it logs every edit.
- **Security / DOM injection**:
  - *Risk*: a pasted document containing `<img onerror=...>` as a key or value is
    rendered into the tree view.
  - *Mitigation*: every node label, value and badge is written with `textContent`.
    No `innerHTML` interpolation anywhere in `js/json/`. DOMPurify is not needed
    because no HTML string is ever constructed.
- **Query evaluation**:
  - *Risk*: the conventional filter implementation is `eval("@.price > 50")`, which
    would execute visitor-supplied script in the page's origin.
  - *Mitigation*: filters are tokenised and parsed into an AST and walked by a
    switch over known node types. `eval` and `new Function` appear nowhere in the
    module; the CSP omits `'unsafe-eval'`; a test feeds the evaluator an injection
    payload and asserts a parse error.
- **API Cost / Rate Limits**: none. Zero Bedrock calls, zero database queries, zero
  API requests of any kind.
- **First paint / SPA impact**: none. `/json` is a separate esbuild entry on a
  separate page. It shares no module with the SPA, so nothing enters the service
  worker's shell graph and `index.html`'s critical path is unchanged — the SPA's
  only delta is one static tile with a lazily-loaded image.

## 6. Assumptions
1. **`/json` is the route**, served from `json.html` by the existing extensionless
   rewrite in `frontend/.htaccess` (rule 3) with no new rule required. Two aliases
   are added for parity with `/regex` and `/encode`: `/yaml` -> `/json#convert` and
   `/jsonpath` -> `/json#query`.
2. **Eyebrow is "Dev Tools"** — the same category as `/cron` — with the
   `fa-diagram-project` icon, which is already present in the vendored Font
   Awesome subset. Every glyph this app needs is already in the subset, so
   `scripts/vendor_fonts.py` does **not** need re-running.
3. **TypeScript conversion is one-way in v1** (JSON -> interfaces). The reverse
   direction is a TypeScript declaration parser emitting a sample document; it is
   specified as a deferred v1.1 item rather than dropped. Flagged for the approval
   decision — say the word and it lands in v1.
4. **Theme follows the SPA** via the shared `theme` localStorage key, resolved in
   `json-main.js` the way `crypto-main.js` does it, with `<meta name="theme-color">`
   kept in sync.
