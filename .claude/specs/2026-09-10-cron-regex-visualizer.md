# Technical Specification: Cron & Regex Visualizer

**Related Intent**: [.claude/intents/2026-09-10-cron-regex-visualizer.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-10-cron-regex-visualizer.md)  
**Target Audience**: 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX) & 2. Work Sample

---

## 1. Architectural Impact & Component Overview
- **Impacted Layers**:
  - [x] Frontend Standalone App (`frontend/cron.html`, `frontend/cron.css`, `frontend/js/cron/`)
  - [x] Frontend Apps Launcher Shelf (`frontend/index.html`, `<section id="apps">`)
  - [x] Routing & Server Config (`frontend/.htaccess`, `frontend/sitemap.xml`)
  - [x] Build Pipeline (`scripts/build.mjs`, `package.json`)
  - [ ] Backend API (None: 100% client-side computation, ADR-023)
  - [ ] Database Schema (None: no persistence on server)

---

## 2. API Contract & Schemas
*None*: Fully client-side computation adhering to ADR-023. No backend endpoints or network requests required (`connect-src 'none'`).

---

## 3. Frontend Implementation & DOM Contract
- **Module Structure**:
  - `frontend/cron.html`: Semantic, accessible HTML shell with dark/light theme support, tab switcher, masthead actions (theme toggle, copy permalink), and dedicated panels for Cron and Regex.
  - `frontend/cron.css`: Modular Vanilla CSS utilizing existing design tokens (HSL colors, glassmorphism, responsive grid, timeline nodes, and syntax token colors).
  - `frontend/js/cron/cron-parser.js`:
    - `parseCron(expr)`: Validates 5-part POSIX cron syntax (`minute hour day-of-month month day-of-week`).
    - `translateCron(expr)`: Translates expressions to natural human English.
    - `getNextRuns(expr, count = 10, fromDate = new Date())`: Computes next 10 trigger dates considering leap years and month boundaries.
  - `frontend/js/cron/regex-parser.js`:
    - `tokenizeRegex(pattern)`: Parses pattern into syntax tokens (character classes, quantifiers, groups, anchors, escapes, literals).
    - `evaluateRegex(pattern, flags, text)`: Safely tests pattern against sample text, returning match ranges, indices, and captured groups (numbered and named).
  - `frontend/js/cron/cron-ui.js`: Interactive 5-part picker, preset chips, live timeline renderer, and error banner controller.
  - `frontend/js/cron/regex-ui.js`: Real-time highlight backdrop, flag toggle pills, preset library, match breakdown table, and captured groups inspector.
  - `frontend/js/cron/main.js`: App controller managing tabs (`#cron` vs `#regex`), URL hash/query sync, `localStorage` persistence, clipboard sharing, and keyboard shortcuts.

- **State Management**:
  - Ephemeral UI state in memory.
  - URL state synchronized via `history.replaceState` or hash (`#cron?expr=...` and `#regex?pattern=...&flags=...&text=...`).
  - Saved to `localStorage` under `rj-inspector:state` for returning visitors.

- **DOM Sanitization**:
  - All user-controlled text rendered via `textContent` or `document.createTextNode`.
  - Syntax highlights use programmatically created DOM elements with class names (`.tok-quantifier`, `.tok-group`, `.tok-class`), avoiding raw HTML string concatenation.

- **Content Security Policy**:
  - In `cron.html`:
    ```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none';" />
    ```

---

## 4. Routing & Server Configuration
- `frontend/.htaccess`:
  - `cron.html` automatically serves at `/cron` via the existing extensionless rewrite rule.
  - Add explicit rewrite rule for `/regex` -> `/cron#regex` so both requested paths work seamlessly.
- `frontend/sitemap.xml`:
  - Add `https://rjasti.com/cron` with `<priority>0.6</priority>` and image metadata referencing `cron-preview.png`.

---

## 5. Build Pipeline Updates
- `scripts/build.mjs`:
  - Register `cron.css` in the CSS bundling loop.
  - Register `js/cron/main.js` as an esbuild bundle entry (`entryNames: "cron-[hash]"`), rewriting references in `dist/cron.html`.
- `package.json`:
  - Include `frontend/js/cron/*.js` in `npm run lint:js`.

---

## 6. Verification & Test Plan
- **Frontend Unit Tests** (`frontend/tests/cron.test.js`, `frontend/tests/regex.test.js`):
  - Cron parser: test standard expressions (`* * * * *`, `*/15 * * * *`, `0 9-17 * * 1-5`, `0 0 1 1 *`), invalid tokens, edge boundaries.
  - Cron next runs: test exact timestamp calculation for minute, hour, day, and day-of-week combinations.
  - Regex tokenizer: test complex patterns with character classes, nested groups, escaped characters, and flag combinations.
  - Regex execution: test zero-match, multiple global matches, named capture groups, and empty pattern handling.
- **Automated Gates**:
  - `node --test frontend/tests/cron.test.js frontend/tests/regex.test.js`
  - `python scripts/check_csp_hashes.py`
  - `python scripts/check_docs.py --fix`
