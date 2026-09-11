# Intent: Cron & Regex Visualizer

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX)
  - [ ] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [ ] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)
- **Problem Statement**:
  Back-end developers and technical visitors frequently need to debug, inspect, and verify cron schedules and regular expressions without navigating bloated, ad-ridden web tools. Adding a dedicated, zero-latency visualizer to the Apps section provides immediate practical utility to visiting engineers while serving as a high-polish showcase of clean, frameworkless client-side logic.

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules. No frameworks (React, Vue, etc.) or external component abstractions.
  - **ADR-016**: Zero third-party asset requests. Self-hosted typography, local icons from the subset, and zero external CDN script or stylesheet dependencies (mirroring `/arcade` standalone architecture).
  - **ADR-023**: Fully client-side execution; no reliance on AI or backend models for translation or parsing.
  - **Apps Shelf Contract**: Launch tile in `frontend/index.html` within `<section id="apps">` adhering to standard preview image (1200x630), Font Awesome subset icon, and `"in a new tab"` accessibility labeling.
- **Explicit Non-Goals**:
  - **Non-ECMAScript Regex Flavors**: No support for PCRE, Python-specific lookbehinds, or Go regular expression engines; strictly standard ECMAScript `RegExp`.
  - **Extended Cron Syntax**: No 6-part or 7-part schedules (e.g. Quartz seconds or years); strictly standard 5-part POSIX cron (`minute hour day-of-month month day-of-week`).
  - **Server-Side Execution / API Endpoints**: Zero backend calls or endpoints. All parsing, evaluation, and next-run schedules compute client-side in the browser.
  - **Code Generation**: No automated code snippet generator (Python/Node/Go boilerplate) in v1 scope.

## 3. Success Metrics & Verifiable Criteria
- **User-Facing Behavior**:
  - **Unified Standalone Route (`/cron` & `/regex`)**: Accessible at `/cron` with an instant toggle/switcher between Cron and Regex modes, as well as fragment deep-linking (`/cron#regex` or `/cron#cron`).
  - **Cron Visualizer**:
    - Real-time plain-English translation of standard 5-part expressions (e.g., `*/15 9-17 * * 1-5` -> "Every 15 minutes, between 09:00 AM and 05:59 PM, Monday through Friday").
    - Interactive 5-part picker/builder (Minute, Hour, Day of Month, Month, Day of Week) updating the expression synchronously.
    - Visual timeline displaying the next 10 calculated trigger timestamps in the user's local timezone.
    - Syntax error highlighting with immediate, helpful feedback for invalid cron tokens.
  - **Regex Visualizer**:
    - Live regex pattern matcher against a test string with interactive flag toggles (`g`, `i`, `m`, `s`, `u`).
    - Syntax color-coded breakdown of pattern components (character classes, quantifiers, groups, anchors).
    - Visual match breakdown showing all matches, zero-based start/end indices, and named/numbered capturing groups.
    - Safe execution handling (preventing catastrophic backtracking / ReDoS lockups during live typing via input debouncing and timeout bounds).
  - **Persistence & Sharing**:
    - URL state encoding via hash/query parameters to enable shareable permalinks.
    - `localStorage` persistence of the last active tab and expressions per browser.
  - **App Shelf Integration**:
    - New `<a class="app-tile reveal">` added to the Apps section in `frontend/index.html` with preview media, eyebrow, description, and accessibility labels.
    - Sitemap inclusion in `frontend/sitemap.xml`.
- **Deterministic Quality Gates**:
  - [ ] Frontend tests pass (`npm test`) with dedicated test suites for the cron evaluator and regex matcher.
  - [ ] Code formatting and linters pass (`npm run lint`).
  - [ ] Documentation and CSP hashes remain in sync (`python3 scripts/check_docs.py --fix`, `python3 scripts/check_csp_hashes.py`).

## 4. Risks & Mitigations
- **Performance / Asset Size Impact**:
  - *Risk*: Heavy parsing libraries causing bundle bloat.
  - *Mitigation*: Implement lightweight, zero-dependency vanilla JS parsers specifically tailored for 5-part cron and browser RegExp.
- **Client Freeze / ReDoS**:
  - *Risk*: Complex regex patterns evaluated against long strings causing main thread UI freezing.
  - *Mitigation*: Debounce input evaluation and enforce max string lengths and execution bounds.
- **Security / Output Sanitization**:
  - *Risk*: Rendering arbitrary user regex matches directly to DOM risking XSS.
  - *Mitigation*: Escape all rendered match text safely using text nodes / DOM textContent or sanitize via vendored DOMPurify.
