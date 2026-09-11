# Intent: Encoder & Cryptographic Toolbox

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [ ] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [ ] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)
- **Problem Statement**:
  Software engineers, security professionals, and technical visitors constantly require utilities to encode/decode data formats, compute cryptographic checksums, generate secure tokens or time-ordered UUIDs, and parse Unix timestamps. Existing web utilities are typically bloated with advertising scripts, slow load times, tracking pixels, and present security risks when pasting sensitive data or tokens into third-party servers. 
  
  The Encoder & Cryptographic Toolbox (`/crypto` / `/encode`) provides a zero-latency, privacy-first, 100% client-side workbench. Running entirely in the browser using native Web APIs (`crypto.subtle`, `crypto.getRandomValues()`, `TextEncoder`), it proves deep architectural discipline and modern web platform mastery without utility library bloat.

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules. No frameworks (React, Vue, etc.) or external component abstractions.
  - **ADR-016**: Zero third-party asset requests. Self-hosted typography, local icons from the Font Awesome subset (`fa-shield-halved`, `fa-key`, `fa-lock`, `fa-copy`, `fa-clock`), and zero external CDN dependencies.
  - **ADR-023**: Fully client-side execution; zero dependence on AI or backend models.
  - **Apps Shelf Contract**: Launch tile in `frontend/index.html` within `<section id="apps">` adhering to standard preview image (1200x630 `crypto-preview.png`), Font Awesome subset icon (`fa-shield-halved`), and `"in a new tab"` accessibility labeling.
  - **Zero Network Egress**: 100% client-side computation. No user input, hashed string, generated token, or uploaded file is ever transmitted to a server or logged.
- **Explicit Non-Goals**:
  - **Symmetric / Asymmetric Encryption**: No AES-GCM, ChaCha20, RSA, or PGP encryption/decryption in v1. The scope is strictly one-way cryptographic hashing, data encoding/decoding, secure random token generation, and Unix timestamp parsing.
  - **Large File Streaming / Disk Processing**: No streaming of multi-gigabyte files. Base64 Data URI file conversion enforces a strict client-side cap (5 MB) to avoid browser tab memory starvation or freezing.
  - **Server-Side API Endpoints**: Zero backend endpoints or server-side compute. All operations execute directly in the browser.
  - **Third-Party Utility Libraries**: Zero npm runtime imports (`crypto-js`, `uuid`, `moment`, `date-fns`, etc.). All converters and generators (including UUID v7 and binary bitwise operations) must be implemented natively from scratch.
  - **HMAC with Secret Keys**: Excluded from v1 scope to keep the UI clean and avoid credential storage concerns.

## 3. Success Metrics & Verifiable Criteria
- **User-Facing Behavior**:
  - **Unified Standalone Route (`/crypto`)**:
    - Accessible at `/crypto` with Apache `.htaccess` rewrite rule aliasing `/encode` -> `/crypto`.
    - Deep-linkable tabbed interface (`/crypto#encoders`, `/crypto#hasher`, `/crypto#generators`, `/crypto#time`).
  - **Tool Modules**:
    1. **Encoders & Decoders**:
       - *Base64*: Bidirectional text conversion + drag-and-drop / file picker for converting files to Base64 Data URIs (enforced 5 MB cap with user feedback).
       - *URL*: Standard and component encoding/decoding (`encodeURIComponent` / `decodeURIComponent`).
       - *Hexadecimal*: Byte-level text-to-hex and hex-to-text conversion with space-separated or continuous output options.
       - *HTML Entities*: Common character entity encoding and decoding with zero script-injection risk.
       - *Binary*: Byte-level 8-bit binary representation.
    2. **Cryptographic Hasher**:
       - Real-time hashing via `window.crypto.subtle.digest`: SHA-256, SHA-512, and SHA-1.
       - Instant calculation during live typing with character and byte metrics.
       - Hex output with lowercase/uppercase toggle and instant 1-click copy.
    3. **Secure Generators**:
       - *UUID v4*: RFC 4122 random UUID generation via `crypto.randomUUID()` / `crypto.getRandomValues()`.
       - *UUID v7*: Modern time-ordered UUID with millisecond timestamp prefix and cryptographically secure random entropy bits.
       - *Secure Tokens*: Cryptographically random hex tokens, Base64URL tokens, and customizable passwords (length, uppercase, lowercase, numbers, symbols).
       - *Batch Mode*: Ability to generate batches (1, 5, 10, 25) with a single click.
    4. **Unix Timestamp Workbench**:
       - Live ticking clock displaying current UTC and Local time in seconds and milliseconds.
       - Bidirectional conversion: Unix Epoch (seconds/ms) <-> ISO 8601 & formatted Local time.
       - Relative time computation ("just now", "X minutes ago", "in Y hours").
  - **Developer Ergonomics & Privacy**:
    - One-click copy-to-clipboard for every output field with visual confirmation (icon swap / toast).
    - `localStorage` persistence for active tool mode and non-sensitive options.
    - Explicit "Clear All / Privacy Reset" button that immediately wipes all inputs, outputs, and storage.
  - **App Shelf Integration**:
    - New `<a class="app-tile reveal">` in `frontend/index.html` within `<section id="apps">` featuring preview media, eyebrow, description, and accessibility labels.
    - Included in `frontend/sitemap.xml`.
- **Deterministic Quality Gates**:
  - [ ] Frontend tests pass (`npm test`) with dedicated test suites covering encoders, hashers, UUID v4/v7 generators, and timestamp converters.
  - [ ] Linting passes (`npm run lint`).
  - [ ] Build succeeds (`npm run build`).
  - [ ] Documentation and CSP hashes remain in sync (`python3 scripts/check_docs.py --fix`, `python3 scripts/check_csp_hashes.py`).

## 4. Risks & Mitigations
- **Performance / Asset Size Impact**:
  - *Risk*: Heavy utility overhead bloating page load.
  - *Mitigation*: Zero external dependencies; lightweight vanilla ES modules maintain sub-100ms first paint and minimal bundle footprint.
- **Client Memory Exhaustion / Freezing**:
  - *Risk*: Dragging large files into Base64 converter causes browser UI lockup.
  - *Mitigation*: Enforce a strict 5 MB file size limit with immediate visual rejection notice before `FileReader` execution.
- **Security & Data Privacy**:
  - *Risk*: Sensitive tokens or strings inadvertently leaked or persisted.
  - *Mitigation*: 100% client-side execution with zero external network requests; text safely rendered via `textContent` text nodes; prominent "Clear All" privacy button provided.
- **Cryptographic Randomness Correctness**:
  - *Risk*: Flawed randomness or non-standard UUID v7 implementation.
  - *Mitigation*: Strictly utilize `window.crypto.getRandomValues()` (never `Math.random()`) and enforce RFC 4122 / RFC 9562 bit-masking for UUID variants and versions.
