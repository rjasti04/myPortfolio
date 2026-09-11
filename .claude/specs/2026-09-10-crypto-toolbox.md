# Technical Specification: Encoder & Cryptographic Toolbox

**Related Intent**: [.claude/intents/2026-09-10-crypto-toolbox.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-10-crypto-toolbox.md)  
**Target Audience**: 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code) & 1. Visitor / Recruiter

---

## 1. Architectural Impact & Component Overview
- **Impacted Layers**:
  - [x] Frontend Standalone App (`frontend/crypto.html`, `frontend/crypto.css`, `frontend/js/crypto/`)
  - [x] Frontend Apps Launcher Shelf (`frontend/index.html`, `<section id="apps">`)
  - [x] Routing & Web Server Rules (`frontend/.htaccess`, `frontend/sitemap.xml`)
  - [x] Build Pipeline & Tooling (`scripts/build.mjs`, `scripts/check_docs.py`, `scripts/generate_social_previews.py`)
  - [ ] Backend API (None: 100% client-side computation, ADR-023)
  - [ ] Database Schema (None: zero server persistence)

---

## 2. API Contract & Schemas
*None*: Fully client-side execution adhering to ADR-023. Zero network egress or backend API dependencies (`connect-src 'none'`). All transformations execute in-browser using standard Web Platform APIs (`window.crypto.subtle`, `crypto.getRandomValues()`, `TextEncoder`, `TextDecoder`, and `FileReader`).

---

## 3. Frontend Implementation & DOM Contract

### 3.1 Document Shell & Assets
- **`frontend/crypto.html`**:
  - Semantic, accessible standalone document with dark theme default and light theme toggle matching the site design token contract.
  - Four primary tool panels: Encoders, Hasher, Generators, and Time Workbench.
  - Header actions: Back link to home portfolio, tab switcher pills, theme toggle, and a dedicated "Clear All" privacy button.
  - Content Security Policy:
    ```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none';" />
    ```
- **`frontend/crypto.css`**:
  - Scoped styles using established CSS variables from `docs/DESIGN.md` (`--bg-primary`, `--color-accent`, `--text-primary`, `--border-subtle`, glassmorphism cards).
  - Responsive grid layouts for side-by-side input/output on desktop and stacked views on mobile (<768px).
  - Drag-and-drop file upload target zone with active drag-over states.
  - Monospace code output blocks with customized scrollbars and floating 1-click copy action icons.

### 3.2 Modular JavaScript Architecture (`frontend/js/crypto/`)
Pure vanilla ES modules (ADR-001) without external libraries:

1. **`frontend/js/crypto/encoders.js`**:
   - `encodeBase64(text)` / `decodeBase64(base64)`: UTF-8 safe bidirectional string conversion using `TextEncoder` / `TextDecoder` and `Uint8Array` binary bridging (avoiding deprecated `unescape` or ASCII-only `btoa`).
   - `fileToBase64DataUri(file)`: Validates file size (strictly enforces <= 5 MB cap); converts `File`/`Blob` to a standard Data URI (`data:<mime>;base64,...`) using `FileReader.readAsDataURL()`. Rejects files exceeding the limit with a user-friendly error.
   - `encodeUrl(text, componentMode = true)`: Standard `encodeURI` vs `encodeURIComponent` wrapper with decoding counterpart `decodeUrl(text)`.
   - `textToHex(text, delimiter = "")` / `hexToText(hex)`: Byte-level UTF-8 text to hexadecimal conversion with optional space/colon delimiters.
   - `encodeHtmlEntities(text)` / `decodeHtmlEntities(text)`: Converts sensitive HTML markup characters (`&`, `<`, `>`, `"`, `'`) to named entities and back, preventing DOM injection.
   - `textToBinary(text, delimiter = " ")` / `binaryToText(binary)`: 8-bit byte representation with formatting options.

2. **`frontend/js/crypto/hasher.js`**:
   - `computeHash(text, algorithm)`: Asynchronous cryptographic digest using `crypto.subtle.digest(algorithm, new TextEncoder().encode(text))` supporting `"SHA-256"`, `"SHA-512"`, and `"SHA-1"`.
   - `formatHexDigest(arrayBuffer, uppercase = false)`: Converts digest `ArrayBuffer` to formatted hex string.
   - `getHashMetrics(text)`: Computes character length and UTF-8 byte length metrics.

3. **`frontend/js/crypto/generators.js`**:
   - `generateUuidV4()`: RFC 4122 compliant UUID v4 using `crypto.randomUUID()` when available, falling back to `crypto.getRandomValues()` with appropriate version (4) and variant (10xx) bit-twiddling.
   - `generateUuidV7(timestampMs = Date.now())`: RFC 9562 compliant UUID v7 composed of:
     - 48 bits: Unix timestamp in milliseconds.
     - 4 bits: Version 7 (`0111`).
     - 12 bits: Cryptographically random entropy (rand_a).
     - 2 bits: Variant 1 (`10`).
     - 62 bits: Cryptographically random entropy (rand_b).
     - Formats into canonical `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx` hex string.
   - `generateSecureToken(length = 32, charset = "hex")`: Cryptographically secure random tokens:
     - `"hex"`: Byte array formatted as hex string.
     - `"base64url"`: URL-safe base64 string.
     - `"password"`: Configurable character sets (A-Z, a-z, 0-9, special characters) with guaranteed inclusion rules.
   - `generateBatch(generatorFn, count = 1)`: Batch utility generating 1, 5, 10, or 25 outputs sequentially.

4. **`frontend/js/crypto/time-workbench.js`**:
   - `getLiveClock()`: Returns current UTC and Local timestamps in epoch seconds and milliseconds.
   - `epochToDetails(epoch)`: Parses seconds or milliseconds into ISO 8601 string, UTC format, Local time string, and relative time description.
   - `parseDateInput(input)`: Parses ISO strings, date-time pickers, or natural dates into epoch seconds and milliseconds.
   - `formatRelativeTime(epochMs, nowMs = Date.now())`: Human-friendly relative descriptions ("X seconds ago", "in Y hours").

5. **`frontend/js/crypto/crypto-ui.js`**:
   - Renders active panels, attaches event listeners for live evaluation, debounces hashing/encoding inputs, manages drag-and-drop visuals, and provides copy-to-clipboard visual feedback.
   - Manages the "Clear All / Privacy Reset" modal and state wipe.

6. **`frontend/js/crypto/crypto-main.js`**:
   - Main controller bootstrapping the app.
   - Handles tab navigation (`#encoders`, `#hasher`, `#generators`, `#time`) and URL hash synchronization.
   - Persists safe UI preferences in `localStorage` (`rj-crypto:preferences`).
   - Registers keyboard shortcuts (e.g. `Tab` navigation, `Escape` to close modals, `Ctrl/Cmd+Enter` to generate).

### 3.3 DOM Sanitization & Security Contract
- **Text Insertion**: Every output field is populated exclusively via `HTMLInputElement.value`, `HTMLTextAreaElement.value`, or `Node.textContent`. Zero `innerHTML` string interpolation.
- **Data Privacy**: No user inputs are sent to remote services. State stored in `localStorage` is restricted to tool tab preference and generator settings (never hashed payloads, passwords, or uploaded file data).
- **Clipboard Handling**: Uses standard `navigator.clipboard.writeText()` with fallback to temporary `textarea` selection for older browser contexts.

---

## 4. Routing, Server Configuration & App Shelf Integration

### 4.1 Apache `.htaccess` Rules
Add rewrite rule in `frontend/.htaccess`:
```apache
# Alias /encode to /crypto#encoders
RewriteRule ^encode/?$ /crypto#encoders [R=301,NE,L]
```
Extensionless route `/crypto` automatically serves `crypto.html` via the existing rewrite engine.

### 4.2 Apps Shelf in `frontend/index.html`
Add app card tile under `<section id="apps">` in `frontend/index.html`:
```html
<a class="app-tile reveal" href="/crypto" target="_blank" rel="noopener"
  aria-label="Launch the Crypto & Encoders Toolbox in a new tab">
  <span class="app-tile-media">
    <img src="crypto-preview.png" alt="" width="1200" height="630" loading="lazy" decoding="async" />
  </span>
  <span class="app-tile-body">
    <span class="app-tile-eyebrow"><i class="fas fa-shield-halved" aria-hidden="true"></i>Security</span>
    <h3 class="app-tile-title">Crypto &amp; Encoders</h3>
    <p class="app-tile-text">All-in-one client-side transformation workbench. Real-time cryptographic hashing, bidirectional Base64/Hex/URL encoding, RFC 9562 UUID v7 generation, and live Unix timestamp inspection.</p>
    <span class="app-tile-cta">Launch<i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i></span>
  </span>
</a>
```

### 4.3 Sitemap Entry (`frontend/sitemap.xml`)
Register `/crypto` in `frontend/sitemap.xml`:
```xml
<url>
  <loc>https://rjasti.com/crypto</loc>
  <lastmod>2026-09-10</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.7</priority>
  <image:image>
    <image:loc>https://rjasti.com/crypto-preview.png</image:loc>
    <image:title>Crypto &amp; Encoders | Client-side cryptographic workbench</image:title>
    <image:caption>Preview card for the crypto and data transformation toolbox</image:caption>
  </image:image>
</url>
```

---

## 5. Build Pipeline Updates

1. **`scripts/build.mjs`**:
   - Add `"crypto.css"` to the CSS minification and hashing pipeline.
   - Bundle `frontend/js/crypto/crypto-main.js` with entry name `"crypto-[hash]"`.
   - Rewrite `<script>` and `<link>` tags in `dist/crypto.html`.
2. **`scripts/check_docs.py`**:
   - Append `"frontend/js/crypto/"` to `JS_ROOTS` array to ensure doc line-counting tools cover the new modules.
3. **`scripts/generate_social_previews.py` & `scripts/social-previews/crypto-preview.html`**:
   - Create template card and register `"crypto": ("crypto-preview.html", "crypto-preview.png")` for automated 1200x630 preview generation.

---

## 6. Verification & Test Plan

### 6.1 Automated Unit Tests (Node Test Runner + JSDOM)
Dedicated unit test suites under `frontend/tests/`:

1. **`frontend/tests/crypto-encoders.test.js`**:
   - Base64 UTF-8 roundtrip: standard ASCII, unicode multibyte characters (emojis, accents), and empty strings.
   - URL encoding/decoding: query parameters, special URI characters, spaces (`%20` vs `+`).
   - Hex encoding/decoding: byte representation, single-byte padding (`0A`), invalid non-hex inputs.
   - HTML entities: entity map check (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`).
   - Binary encoding: 8-bit alignment, byte roundtrips.
2. **`frontend/tests/crypto-hasher.test.js`**:
   - SHA-256, SHA-512, and SHA-1 vectors against known NIST test vectors.
   - Uppercase/lowercase hex formatting.
   - Metric calculators: UTF-8 byte length vs character length.
3. **`frontend/tests/crypto-generators.test.js`**:
   - UUID v4: RFC 4122 compliance, variant bit check (`8`, `9`, `a`, or `b` at position 19), version check (`4` at position 14).
   - UUID v7: RFC 9562 compliance, variant bit check, version check (`7` at position 14), 48-bit timestamp reconstruction matching input timestamp.
   - Secure random tokens: character set validation, length validation, entropy distribution sanity check.
4. **`frontend/tests/crypto-time.test.js`**:
   - Seconds and milliseconds Unix Epoch conversions.
   - ISO 8601 formatting and timezone offset handling.
   - Relative time calculations across past/future boundaries.

### 6.2 Quality Gates
Run CI validation commands:
```bash
# 1. Frontend tests
npm test

# 2. Linters
npm run lint

# 3. Production build validation
npm run build

# 4. Hash and doc sync
python scripts/check_csp_hashes.py
python scripts/check_docs.py --fix --show-tokens
```
