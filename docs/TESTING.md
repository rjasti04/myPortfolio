# Testing

Two independent suites: Node's built-in test runner with jsdom for the frontend,
and pytest for the backend. Both run in CI on every push and pull request to
`main`.

- [Running the suites](#running-the-suites)
- [Frontend tests](#frontend-tests)
- [Backend tests](#backend-tests)
- [Tooling tests](#tooling-tests)
- [The test harness](#the-test-harness)
- [Coverage](#coverage)
- [Linting](#linting)
- [What is not tested](#what-is-not-tested)
- [Writing new tests](#writing-new-tests)

---

## Running the suites

```bash
# Frontend
npm test                                     # frontend/tests/*.test.js + scripts/tests/*.test.js

# Backend
PYTHONPATH=. pytest                          # pytest.ini sets testpaths
PYTHONPATH=. pytest tests/backend/unit        # one directory
PYTHONPATH=. pytest -k "session_token"        # by name
PYTHONPATH=. pytest --cov=server --cov-report=term-missing --cov-fail-under=55

# Lint
npm run lint                                 # ESLint + Stylelint
ruff check server tests
npm run check:csp                            # inline-script CSP hashes
```

`PYTHONPATH` must include the repository root. Node and npm are not always on
the default system `PATH` in agent environments — resolve the install path
first, or skip the JS suites and say so.

---

## Frontend tests

`frontend/tests/*.test.js` — Node test runner, jsdom for a DOM. No browser, no
Jest, no bundler.

| File | Lines | Covers |
| :--- | ---: | :--- |
| `app-logic.test.js` | 62 | `setActiveSection` and `aria-current`; `getValidHashTarget` fallbacks; that `main.js` lazily imports the activity module |
| `preboot-router.test.js` | 196 | **Refresh-flash regression.** The inline pre-boot section router in `index.html`, driven against a document that arrives in pieces the way a streaming response does: it sits above `<main>` and not after it, `#home` is stood down the moment it is parsed rather than once the document is complete, the target activates whether it arrives in a later parse or the same one, `#main-content` and unknown or wrong-case fragments leave home exactly as the markup has it, home is restored if the fragment names a nav link with no section, every nav target has a section to match, and `navigation.js` validates a fragment the same way the inline router does |
| `route-semantics.test.js` | 142 | **Per-view page semantics.** The router shows one section at a time, so each view is a page: every section carries exactly one non-empty `<h1>` and a `tabindex="-1"` for the router to focus, no view title is left on an `<h2>` (`.skills-title` is the documented subsection exception), `#route-announcer` is an empty polite live region outside `<main>`, and `ROUTE_META` covers every section with a distinct title while the shipped document keeps the home title and a bare-origin canonical |
| `apps-experience.test.js` | 231 | **The Apps filter and the Experience groups.** Every app tile carries a `data-app-category` and every category has a chip, filtering shows only that category with exactly one chip pressed, re-pressing the active chip clears it, each change is announced with correct singular/plural, and the chip counts match the tiles present. For Experience: the groups are `<details>` with the first open, the palette anchor sits on the `<details>` rather than the heading so it can be opened, every `exp-` anchor in `search-index.js` resolves to one, expand-all reports the next action in its label and the set state in `aria-expanded`, focusing a closed group opens it (the palette deep-link path), and every section lede reaches the Ctrl+K index |
| `copy-feedback.test.js` | 118 | **Copy-button regressions across the apps.** `json-ui.js`'s `flash()` snapshots and restores `innerHTML` rather than `textContent` — the bug that deleted the `<i>` icon on first click and never restored it — the json buttons still carry an icon worth preserving, `diff-ui.js`'s copy swaps in a visible "Copied!" instead of signalling by border colour alone, and the crypto and cron tablists set a roving `tabIndex` the way json and diff already did |
| `utils.test.js` | 208 | `escapeHTML` — both quote forms, an injected event handler failing to escape an attribute, and a visitor-controlled `page_path` in attribute position — plus `estimateTokens`, `debounce`, `throttle`, and `openModal`/`closeModal` ARIA handling |
| `activity-charts.test.js` | 310 | `bucketSession`, `renderTimeline`, `moveTimelineFocus`, `percentile`, `latencyBand`, `renderPaths` |
| `activity-events.test.js` | 77 | `describeEvent` escaping: markup in a click `tag` renders as text rather than reaching innerHTML; a `tag` of `constructor` is not resolved up the prototype chain; known tags keep their friendly name; a `page_path` carrying markup is escaped |
| `terminal.test.js` | 282 | Output builders escaping by construction; history (repeat collapsing, navigation, oversized entries, unparseable storage, flush persistence); individual commands; completion (common prefix, arguments, ambiguity, hidden commands never completed); keymap intents |
| `owner-analytics.test.js` | 162 | The owner panel asks for nothing when signed out; a 403 leaves the section as a visitor sees it with no empty shell; all six cards render for the owner; mistyped terminal commands are flagged; a failed panel is a `role="alert"` card rather than zeroes; the window picker re-requests every panel; signing out takes the panel down |
| `email-verification.test.js` | 82 | A 403 login is tagged `needsEmailVerification` (not string-matched) so the UI can offer a resend; a 401 is not; no tokens are stored on a refused login; verify-email and resend-verification post the right payloads and surface a rejected link |
| `chat-history-sync.test.js` | 312 | Server-side conversation history in the chat UI: every session gets a v4 UUID the route will parse; pre-`conversationId` sessions are backfilled without moving their local key; no history call when signed out; server conversations merge into the rail; a stub fetches its transcript only when opened; a failed load renders an error with a retry rather than an empty conversation; a 404 stub is dropped; delete removes the server copy; an unreachable API leaves local conversations intact; stored history that parses but is not an array (null, an object, a number, a string) is replaced rather than taking `initChat` down, and non-object entries are dropped |
| `palette-search.test.js` | 124 | Ctrl+K palette content search: the generated index ships with resume content; content matching no command is still found; commands rank before content; every result stays a listbox `option`; content results are capped so commands cannot be crowded out; selecting one navigates and focuses the anchor without running a command |
| `analytics-queue.test.js` | 175 | **BUG-08 regression.** The queue key is namespaced per session; `initAnalytics` discards another session's persisted queue; a restored queue is filtered to the owning session's events; a queue over its cap drops its oldest events rather than the newest |
| `auth-refresh.test.js` | 213 | **BUG-03 regression.** Concurrent 401s share one refresh instead of racing rotation; a later 401 starts a fresh refresh; a genuinely failed refresh signs the user out exactly once; a 429, 5xx or dropped connection during refresh keeps the session, while a 403 still ends it |
| `auth-2fa.test.js` | 287 | **Half-built-surface regression.** `disable2FA` was defined in `js/auth.js`, exported, and imported by nobody, while the nav item's label switched to "2FA Enabled" and its handler still dispatched the enrolment event - so an enrolled user got the enrolment panel, the server's refusal to reissue a live secret, an empty `<img>` and a bare "Secret Key:", plus an error naming a Disable control that did not exist. Drives the real `index.html` under jsdom: an unenrolled account reaches `/2fa/setup` and renders the QR and secret, an enrolled one routes to the manage panel and never calls setup, leaving the panel drops the secret out of the DOM (and leaves no empty `src`, which refetches `index.html` as an image), the disable form posts `{current_password, code}`, the disable button stays operable and explains what is missing, and a failed login challenge clears the spent pre-auth token and returns to the login tab |
| `auth-register.test.js` | 120 | Registration returns the created user and attempts no login - the auto-login could never succeed against an unconfirmed address, so it reported a successful registration as a failure and spent a second strict-budget request doing it; no tokens are stored; a real 400 still throws the server's reason |
| `auth-reset-password.test.js` | 162 | **Dead-submit-button regression.** #195 moved the four auth forms from `submitBtn.disabled = !(...)` to `setSubmitReadiness`, which writes `data-ready`/`aria-disabled` and deliberately never touches `.disabled` — but `index.html` kept the literal `disabled` attribute, and nothing was left to clear it. A disabled `<button type="submit">` fires neither `click` nor `submit`, so a visitor could open the emailed reset link, watch every rule on the checklist go green, and get nothing from the greyed-out button; Register, Change Password and Delete Account were dead the same way. Drives the real `index.html` under jsdom: all four submit buttons come out of `initAuthUI` operable, `?reset_token=` lands in the hidden field and is scrubbed from the address bar, a matching valid pair marks the button ready, a mismatch is explained in the error slot without reaching the API, and a valid submit posts `{token, new_password}` to `/auth/reset-password` |
| `ucl-bracket.test.js` | 633 | The Champions League predictor end to end in jsdom: the 36-row table renders in its three qualification zones with each club's association, the play-off ties pair seeds 9–16 against 17–24, the round of 16 seeds the top eight against the reserved bands, a chalk bracket crowns the top seed, the `?s=` share code round-trips, reordering the table clears picks that no longer exist, a malformed share code falls back to the default table, quick-fill settles the remaining ties without overwriting existing picks, and the rank pill's jump field clamps out-of-range positions and cancels on Escape |
| `worldcup-bracket.test.js` | 171 | The 2026 World Cup predictor end to end in jsdom: 12 groups of 4 teams, 12 wildcard candidates (8 advancing), all 32 knockout ties rendered, random fill completes undecided matches and crowns champion and podium, manual picks preserved, URL state parameter round-trips, and consecutive runs produce varied outcomes |
| `contact-form.test.js` | 395 | Accessible invalid-field feedback; the FormSubmit honeypot is excluded from validation but forwarded in the payload; offline submissions blocked; loading state set and reset; a timed-out request does **not** fall through to a native resubmission; first-party `POST /contact` is tried before FormSubmit, the fallback fires on an unreachable API and on 502 only, a 429 is not routed around, and a timed-out first-party POST is never retried |
| `pull-to-refresh.test.js` | 314 | The gesture that replaces the browser's own site-wide, which is all guards. Both modes. **Nested** (`#ai .ai-content-area`): a drag past the threshold reloads and a shorter one settles back; a gesture starting below the top of the scroller is ignored, so a flick back to the top is not a refresh; an upward drag is handed back uncancelled; a second finger drops the pull; the pull follows only the finger it started with; travel is capped; the scroller is marked `[data-ptr-scroller]` and unmarked on `destroy`; and the scroll-blocking `touchmove` is bound only while a pull is live — dropped on release and on cancel, kept when a stray finger ends. **Document**: the indicator is fixed to `body` rather than parented to `<html>`; a pull starting anywhere on the page refreshes; one starting inside the AI transcript is left to that scroller; one on a locked `body` (the AI shell, an open nav) is ignored; and `destroy` takes the listeners and the indicator with it |
| `theme-library.test.js` | 129 | `readThemeLibrary`, `saveTheme`, `deleteTheme` — the visitor's own named palettes in localStorage. Mostly the storage boundary, because that is where this breaks: a name overwrites case-insensitively instead of duplicating and keeps the original id, an empty name is refused and a long one truncated, the 12-entry cap blocks a new name but still allows updating an existing one, corrupt or hand-edited JSON reads as an empty library rather than throwing on panel open, entries without three usable hexes are dropped, and a `setItem` that throws (private browsing, blocked storage) is reported rather than reported as success |
| `theme-randomizer.test.js` | 122 | `randomPalette`, the theme customiser's **Randomize** button. Testing a random function is worth it precisely because it is constrained: over 400 rolls per case, every colour is a six-digit hex, saturation and lightness stay inside the bands `generateVariants` can derive usable light and dark variants from, the new primary always lands at least 35 degrees from the palette it replaced, and the three hues fall into the small closed set of gaps the fixed harmonies allow rather than spreading like three independent draws |
| `theme-library-update.test.js` | 236 | **Write-once-library regression.** Updating a saved theme, driven through the real panel because everything at stake is in the wiring rather than in the library functions. Overwriting by name always worked, but nothing said so: the Save field opened empty, no chip looked loaded, and Apply - the one button that reads like a commit - writes the active palette and leaves the named theme on its first colours, so editing a saved theme and applying it looked like a save that did nothing. Loading a chip marks it `aria-pressed`, an edit marks it as diverged and names that in the chip's `title`, the Save field opens prefilled with the loaded theme so Enter updates it in place under its original id, the confirm button reads Update rather than Save while the typed name is one already in the library, reopening the panel on a saved theme's colours finds it again (the state after a reload), a built-in preset or a delete drops the loaded theme so Save cannot overwrite it by accident, and Apply still writes only `rj_theme_palette` |
| `theme-panel-cancel.test.js` | 201 | **Palette-reset regression.** What closing the customiser panel undoes, driven through the real panel because the rollback hangs off a MutationObserver watching `is-open`: a roll from the landing view survives the panel being opened and closed untouched, the panel opens showing that roll rather than the shipped defaults, a preset clicked inside the panel is discarded back to the roll behind it instead of to the saved palette, Apply is not undone by the close it triggers itself, Reset leaves the defaults with no roll left to come back, and a cancel with nothing behind it still falls through to the saved palette |
| `theme-color-meta.test.js` | 239 | **Browser-bar regression.** The `theme-color` meta tag, which paints the mobile browser toolbar and the installed PWA's top bar. Randomising used to leave it on the previous colour until Apply, because only `applyTheme()` and Apply ever wrote it: a landing-view roll and an in-panel shuffle now move it without being saved, a cancel rolls it back with the palette, Apply's own close does not undo it, Reset returns it to the **dark** accent on a dark page (the tag is read off `<body>`, not the root, where the dark variant is not declared), and the fallback pair still applies when nothing resolves. Plus `theme-bootstrap.js` seeding the tag pre-paint from a saved palette, per theme |
| `resume-pdf.test.js` | 164 | The resume preview dialog: a hover-capable pointer opens it and mounts an iframe pointed at the link's `href`; closing tears the iframe back out of the DOM; a backdrop click closes but a click inside the panel does not; Escape closes; and both a touch pointer and an iOS user agent leave the plain link alone so the native viewer takes over |
| `arcade.test.js` | 524 | The six arcade games' rules, exercised as pure functions with no canvas. 2048: four equal tiles make two pairs, a tile produced by a merge cannot merge again in the same move, a move that changes nothing is not a move, and a full board with no equal neighbours is game over. Tetris: four quarter turns is the identity for every piece, the ceiling is open so a piece can spawn above the well, rotation against a wall kicks inwards instead of failing, O never kicks, rotation is refused when all five offsets collide, and cleared rows are replaced at the top with the rest keeping their order. Flapper: overlap is strict, so grazing an edge is not a collision, and a gap never opens flush against the ceiling or floor. Stack: a near-miss inside the tolerance snaps flush and loses nothing, an overhang is trimmed from the side it hangs over, the survivor plus the offcut is the block that was dropped, and touching edges count as no overlap. Snake: the tail vacates its cell on the same tick the head enters it so chasing your own tail is legal, the tail only stays put for the tick the food was taken, every wall is fatal, a turn back through the neck is refused, food never lands under the snake at either end of the random range, and a covered board has nowhere to put food — which is the win. Breaker: a hit reflects on the axis the ball came in through, contact is strict so grazing a brick is not a hit, a dead corner resolves vertically rather than along the row, the paddle sets the angle from where it was struck, and across every point on the paddle and past both ends the ball leaves upwards at the speed it arrived and never flatter than the cap — plus the one that guards the rest: no slice of a frame is longer than the ball is wide, which a full 1/60 frame at the speed cap is |
| `home-portrait.test.js` | 169 | The landing portrait's flip card, and specifically the three parts of it that are not CSS and would break silently: the button ships `disabled` and only `initHomePortrait()` enables it, so a no-JS page is never offered a control that cannot work; `aria-pressed` toggles both ways and is what the stylesheet rotates on, so the visual state and the announced state cannot drift apart; and the back face stays out of the LCP's way — not preloaded, `fetchpriority="low"`, raised to `high` once on the first hover. Also asserts the preload's `imagesrcset` still matches the front `<picture>` verbatim, since a preload that does not costs a round trip instead of saving one |
| `storage-blocked.test.js` | 138 | **Blank-page regression.** `localStorage` that *throws* rather than one that is empty — Safari with "Block All Cookies", strict privacy extensions — which is the case every read in the codebase used to miss: they handled a missing value, and several handled a failed `JSON.parse`, but a throwing accessor went straight up the stack. `initTheme` is the first call in `main.js`'s sequence and `.reveal` is invisible until `initAnimations` five calls later marks it active, so one throw left the contact form, both Apps tiles and the About cards as blank space with the router dead and nothing on screen saying why. Asserts `initTheme` and `reapplyCustomTheme` both survive it (the latter is the link that actually broke — `readSavedPalette` guarded its parse but not its `getItem`), that every `.reveal` still ends up active, and that the hiding rule in `styles.css` is scoped to `.js-enabled` so a no-JS visitor sees content too |
| `cron.test.js` | 79 | 5-part POSIX cron syntax validation, step and range parsing, month and day-of-week name normalization, plain-English translation generation, and sequential next-trigger timeline calculation |
| `regex.test.js` | 69 | ECMAScript RegExp tokenization (classes, quantifiers, groups, anchors, escapes), flag normalization, global match evaluation with boundary indices, named/numbered capture group extraction, and zero-length match infinite-loop protection |
| `crypto-encoders.test.js` | 86 | UTF-8 safe bidirectional Base64 conversion, URL encoding/decoding, byte-level Hexadecimal formatting, HTML entity escaping/restoration, and 8-bit Binary representation |
| `crypto-hasher.test.js` | 63 | Real-time native `crypto.subtle` cryptographic digests (SHA-256, SHA-512, SHA-1) against NIST test vectors, uppercase hex formatting, and UTF-8 byte metric calculations |
| `crypto-generators.test.js` | 79 | RFC 4122 UUID v4 formatting and version/variant bits, RFC 9562 UUID v7 chronological sort ordering and 48-bit timestamp recovery, secure random tokens, and strong password generation |
| `crypto-time.test.js` | 62 | Unix Epoch seconds and milliseconds bidirectional conversion to ISO 8601, date parsing, live clock ticking, and human-friendly relative time calculations |
| `json-parser.test.js` | 207 | Strict parsing agrees with `JSON.parse` on every invalid document (each case asserts the platform rejects it first, so the two can never drift); errors carry a real line, column and caret rather than an engine-specific message; one case per repair rule; repaired output always re-parses strictly; valid input is a no-op with an empty log; value-changing repairs are flagged `lossy` and syntax ones are not; an unrepairable document hands back the **original** text rather than a half-mangled one; member order is never rearranged; and 5,000-deep nesting is refused instead of overflowing the stack |
| `json-query.test.js` | 216 | Every path segment (child, bracket, index, negative index, wildcard, slices with step and negative bounds, recursive descent), filter operators and their precedence, `filter(...)` sugar proved equal to its JSONPath form, a property genuinely named `filter` still reachable, and returned paths re-queried to prove they round-trip. Three security tests carry the module's central claim: eight injection payloads (`; fetch(...)`, `constructor.constructor('...')()`, `process.exit`) select nothing and set no global; `@.constructor`, `@.__proto__`, `@.toString` and `@.hasOwnProperty` resolve to Nothing rather than JavaScript internals; and the module source is read back and asserted to contain no `eval(`, `new Function`, `Function(`, `setTimeout(` or `innerHTML` |
| `json-convert.test.js` | 277 | YAML round-trips over eight document shapes; **the Norway problem** — 30 bare words YAML 1.1 would re-read as a boolean, null or number (`no`, `on`, `~`, `0755`, `1:30`, `0x1A`) each survive as the string they were, keys included; `\|` and `>` block scalars with all three chomping indicators; anchors, merge keys, tags and multi-document streams each refused *by name*. CSV: the header is the union of ragged rows and a missing key does not shift columns, RFC 4180 quoting round-trips embedded commas, quotes and newlines, inference leaves `00123` and `+15551234567` as strings while a quoted cell is always a string, and an array of objects is refused with the offending column named. TypeScript: nested interfaces, optional members from ragged arrays, parenthesised unions, quoted invalid identifiers, structurally identical shapes sharing one interface, and bounded recursion |
| `json-tree.test.js` | 203 | The lazy renderer under jsdom: the root renders without building grandchildren, children appear only on expand and survive a collapse (hidden, not destroyed), a 500-child node renders 200 plus a "show more" control that pages twice and then disappears, selection is exclusive and reports its path, `expandAll` refuses past the node ceiling with an explanation instead of hanging, and ArrowRight/ArrowLeft open and close a branch. The security case renders `<img src=x onerror=...>` as both a key and a value and asserts no `img`, `script` or `b` element exists anywhere in the tree and no global was set |
| `diff-engine.test.js` | 313 | Myers' own 1986 worked example asserted **minimal**, not merely correct, and the same minimality checked against an LCS oracle across 60 randomised pairs — a diff that is plausible but not optimal fails here. Every change reconstructs both documents exactly, so a lost, duplicated or reordered line is caught regardless of how it renders. Degenerate inputs (identical, empty, one side empty, a single 5,000-character line), each normalisation option changing equality while leaving the rendered text alone, CRLF differing from LF by default and matching under `trimTrailing`, hunk context and the merging of hunks whose context would overlap, and the histogram fallback engaging under a deliberately tiny work ceiling and staying lossless. Three cases pin the newline semantics **verified against `git diff --no-index`**: a final unterminated line never matches a terminated one, adding a trailing newline is a real difference, and two files that both end unterminated on *different* lines still compare correctly |
| `diff-patch.test.js` | 247 | The writer matched **byte for byte** against reference output captured from real `git diff`: a merged hunk, the `\ No newline at end of file` marker in the position git puts it, a zero-count range anchored on the preceding line, and a single-line range written bare without `,1`. The parser on multi-file diffs with `diff --git` preambles, a bare paste of hunks with no file headers, and a context line whose leading space a mail client stripped; a malformed header, a hunk whose declared counts disagree with its body, and an unexpected marker each refused with a line, column and excerpt. The suite's centrepiece is the **round-trip property**: `applyPatch(a, writePatch(diff(a, b))) === b` over 200 generated pairs at four context widths plus seven degenerate documents, which is what holds the engine, the writer and the parser against each other — an off-by-one in a hunk header is invisible to inspection and silently corrupts a file in use |
| `diff-refine.test.js` | 204 | Token splitting is contiguous and covers the line exactly; refinement pinpoints the one changed token (`30` against `300`) and leaves the unchanged prefix as a single span; spans tile each line in strictly alternating runs with no gaps or overlaps. The refiner declines where highlighting would read worse than a plain pair — unrelated lines, identical, empty or oversized ones — and the similarity score counts only **non-whitespace** tokens, without which two lines sharing nothing but their spaces scored 0.4 and were refined into confetti. The lexer: three quote styles, escaped quotes not ending a string early, an unterminated string stopping at its own line end, all four comment dialects, hex and exponent numbers, case-insensitive keywords not matched inside identifiers, spans never overlapping or leaving the line, and block-comment state carrying across lines and then stopping |
| `diff-render.test.js` | 208 | The renderer under jsdom: hunk headers, one row per line, both halves present in split view and deletions interleaved before insertions in unified, an insertion's opposite side filled with a void half, per-side gutter numbering, character-level marks reaching the DOM as `.rf-del`/`.rf-ins`, syntax classes applied without losing any of the line's text, unchanged stretches collapsing to a focusable expander that renders on demand, a parsed patch drawn through the same path as a computed diff, the row ceiling stopping and saying so, and the container cleared between draws. Two security cases render `<img src=x onerror=...>` and a `<script>` payload through both the compare and patch paths and assert no `img` or `script` element exists anywhere, no global was set, and the payload is still **visible to the reader as text** |

The two regression files exist because both bugs were silent and expensive: one
lost analytics batches to a 403 whenever a second tab was open, the other signed
users out mid-session whenever three authenticated requests 401'd together.

### Build tests

`scripts/tests/*.test.js` — same runner, but they exercise `scripts/build.mjs`
rather than the browser. `npm test` picks them up along with the frontend
suite.

| File | Lines | Covers |
| :--- | ---: | :--- |
| `build.test.js` | 260 | The caching contract, which is only observable after a build. Every service-worker precache URL resolves to a file that actually shipped; the precache lists the *hashed* LCP image and the width `index.html` preloads, not a bare filename; the `.htaccess` immutable rule matches only content-hashed names; every shipped image and PDF is hashed, so nothing gets a year of caching under a reusable name; no page or manifest points at an un-hashed asset; and `CACHE_NAME` is stable when nothing changes but moves when any precached input does. It also guards the size budget: shipped JS and CSS sit under `BUDGETS_KIB`, and — the case that matters — breaching a budget actually **fails** the build rather than only reporting it |

A stale precache entry or an unhashed asset cannot be caught by linting or by
the frontend suite — both only appear once `dist/` exists, which is why these
run against a real build.

---

## Backend tests

`tests/backend/` — 15 files, 204 test functions (74 unit, 130 integration).

### `unit/`

| File | Tests | Guards |
| :--- | ---: | :--- |
| `test_security_wiring.py` | 34 | **Defences that existed in the tree but were not wired in.** Every middleware is registered; `RequestIDMiddleware` is outermost; CORS origins come from settings, not a hardcoded list; auth and chat routes are strict-limited under **both** mount prefixes; `_normalise_path` only strips a real `/api` prefix; the budgets are tracked separately; the two routes that turn a second factor on or off are strict-limited while `/2fa/setup` deliberately is not; `_required_secret` rejects the placeholder, a short key and an unset key; `security.py` has no default signing key; Bedrock slot release is idempotent and an abandoned streaming response does not leak its slot; both mount prefixes route while only one copy is documented; the chat client carries the configured timeouts; stream queue settings are actually used; a session cannot hold unlimited SSE streams |
| `test_pipeline_simulation.py` | 10 | The modelled Kafka stage stays **coherent**: idle reports empty; offsets total the events actually processed; partition lag totals reported lag; arrivals build depth; depth drains monotonically to zero; **the drain curve is independent of poll rate**; throughput tracks the rolling minute; health escalates with depth; simulation can be disabled for the honest `bypass` state; real broker metrics are never overwritten |
| `test_ingest_buffer.py` | 4 | A recoverable failure returns events for a retry; the buffer never grows past its cap; an unrecoverable failure **counts** what it discards; the pipeline stops reporting healthy once events are dropped |
| `test_notifications.py` | 7 | A password change actually sends an email (it once only logged); the message tells the owner what to do; a failed send does not raise; remote relays get certificate validation; an authenticated relay uses STARTTLS; loopback is the only TLS exemption; no email leaks the raw token into the logs |
| `test_dependency_locks.py` | 6 | The lock exists; every direct dependency is pinned; nothing is left unpinned; every pin carries a hash; the dev lock agrees with the runtime lock on shared packages; the locks target the supported Python floor |
| `test_utils.py` | 4 | `ensure_alternating_roles`: consecutive user messages merged, a leading assistant message handled, empty messages filtered, Converse format preserved |

### `integration/`

| File | Tests | Guards |
| :--- | ---: | :--- |
| `test_auth.py` | 56 | **Every `auth_service` call in the router resolves** (this file was once empty, which is how five routes shipped calling functions that do not exist while pytest stayed green). Then: register, login, wrong password, a token signed with the wrong key, change password, reset round trip, garbage reset token, session listing, the `DELETE` confirmation phrase, refresh rotation burning the old token, 2FA setup refusing to rotate a live secret, logout revoking the refresh token, the routes the frontend actually uses, enumeration resistance on reset and magic link, pre-auth replay refusal, 2FA lockout, cross-purpose token refusal, a password change voiding a pending reset, and a spent reset token staying spent; an emailed link redeemed on the magic-link or password-reset path confirms the address, and confirming twice does not move the timestamp; an expired lockout restores a full set of attempts while a live one is still enforced and a fresh run still re-locks; 2FA can be disabled and re-enrolled, disable needs both the password and a live code, disabling when 2FA is off is refused without counting toward the lockout, repeated bad disable codes do lock, enabling requires the current password, and a code that is not six digits never reaches `pyotp`. Four cases cover `scripts/clear_2fa.py`, the operator unlock for a lost authenticator: an account that is enrolled *and* locked out by the wrong codes logs straight in afterwards **and can reach `/2fa/setup` again** (clearing the flag but not the secret would pass the first check and fail the second), a refresh token from before the unlock is refused inside its lifetime, `--keep-sessions` leaves it working, and running it on an account with no second factor changes nothing rather than quietly revoking that account's sessions |
| `test_activity_events.py` | 17 | Summary counting and zero-filling; empty sessions; type filtering and rejection; `event_id` in list and broadcast payloads; `contact_prompt`, `ai_llm_telemetry` and `client_error` accepted; **an unknown type does not discard the rest of the batch**; a batch of only unknown types reports rather than failing; a batch touching another session is still refused; structurally invalid rows still rejected; the session cookie is set, authorises a call on its own, and its absence is still refused |
| `test_session_access_control.py` | 11 | Creating a session returns a token; the token is not derivable from the id; scoped endpoints refuse a caller without it; one token does not unlock another session; the holder gets through; events cannot be written into someone else's session; a bulk batch cannot smuggle a foreign session; an unknown session is indistinguishable from a forbidden one; the stream accepts the query parameter; a cookie for one session does not unlock another; a forged cookie is refused |
| `test_chat_stream.py` | 13 | Streaming success and metrics; Converse for a non-Anthropic model; consecutive user messages merged; invalid model rejected; **streaming does not block the event loop**; the anonymous free-message cap and its non-application to signed-in callers; `system_prompt` override refused; oversized message, oversized conversation, too many messages and unknown role rejected; a normal conversation still fits |
| `test_chat_history.py` | 10 | Compression round trip and that it actually shrinks a realistic transcript; empty payload tolerated; title derivation and truncation; history requires authentication; streaming while signed in saves a conversation; another user cannot read it; delete removes it; anonymous streaming saves nothing |
| `test_frontend_api_contract.py` | 4 | The frontend actually calls the API; **every endpoint the frontend calls exists on the backend**; three previously missing routes are served; logout revokes tokens rather than only clearing the client |

`test_frontend_api_contract.py` exists because the frontend is a static bundle
talking to the API over a hardcoded base URL, so nothing but a running browser
ever checked that the two agree. Three routes had silently drifted apart:
`POST /auth/logout` had no route at all (and `auth.js` discards the failure, so
a "logged out" refresh token stayed valid for 30 days),
`POST /auth/sessions/revoke-others` had no route despite the service function
existing, and `POST /auth/delete-account` was only served as `DELETE
/auth/account`.

---

## Tooling tests

`tests/tooling/` — 2 files, 46 tests. Repo tooling rather than the app;
nothing here imports `server/`, so it contributes no backend coverage.

| File | Tests | Guards |
| :--- | ---: | :--- |
| `test_bash_write_guard.py` | 37 | **The Bash hooks hold the same lines the `Write`/`Edit` hooks do.** Claude Code matches hooks on tool name, so every `.sh` guard in `.claude/hooks/` was wired to `Write`/`Edit` and a `sed -i` or a `>` reached none of them. These cover both directions: a tracked migration stays immutable through `sed -i`, `tee`, `cp`, `rm`, a redirection and an opaque `python3 -c`; the intent and spec templates are never written in place; a secrets file is never read from the shell; ADR-016's origin allowlist applies to shell writes into SPA files; a repo-wide `grep`/`find` is refused where it would descend into `server/.venv/` and allowed where that directory does not exist, each against a project root built to have it or not rather than against this repo, whose venv is there or not depending on whose machine it is. The rest are the false positives that would get the guard switched off — `npm ci`, `PYTHONPATH=. pytest`, the documented `sed -n` and `grep -n` recipes, a scoped search, an exempt predictor page, and a heredoc whose *body* mentions a guarded path — all of which must pass through untouched |
| `test_agent_config_check.py` | 9 | **`.claude/rules/` is config the validator accepts, not config it rejects.** `check_agent_config.py` listed `.claude/rules` as prohibited before the directory existed; the path-scoped navigation tables landed later and the CI gate failed on every commit after that. These pin both directions: the real repository passes its own validator, the four genuinely prohibited paths are still rejected, and a rules file that would silently stop loading — missing, or without a `paths` frontmatter list — is an error |

## The test harness

### `pytest.ini`

```ini
asyncio_mode = strict
testpaths = tests/backend tests/evals tests/tooling
addopts = --strict-markers --strict-config
```

There was no pytest configuration at all, so every one of these was inherited
from whatever versions happened to be installed. `strict` asyncio mode is stated
rather than assumed — the suite marks async tests explicitly, and under the
pinned pytest an async test that loses its `@pytest.mark.asyncio` is a hard
failure rather than a silent skip. `--strict-markers` turns a typo'd marker into
an error; `--strict-config` does the same for an unknown key here.

`filterwarnings` promotes `PytestUnraisableExceptionWarning` and
`PytestReturnNotNoneWarning` to errors, and ignores passlib's deprecated `crypt`
import (not ours; it disappears when passlib is replaced).

### `tests/backend/conftest.py`

Sets, before any `server` import can run:

```
TESTING=true
DATABASE_URL=sqlite+aiosqlite:///:memory:
AWS_REGION=us-east-1
DEFAULT_MODEL_ID=dummy-model-id
JWT_SECRET=<throwaway value that clears the 32-character floor>
```

`TESTING=true` bypasses the rate-limiting middleware and stops the three
background pipeline tasks from starting. `settings.py` validates at import, so
these must exist first — which is why `conftest.py` has an `E402` per-file
ignore in `ruff.toml`.

It then builds a separate SQLite engine (`StaticPool`, `check_same_thread:
False`, shared cache) and overrides `get_db`. Two session-scoped fixtures:

- `setup_db` — `drop_all` / `create_all` around the session, teardown drops.
- `async_client` — `httpx.AsyncClient` over `ASGITransport(app=app)`, so requests
  go through the real middleware stack without a socket.

`TEST_DATABASE_URL` can point the suite at a different database.

---

## Coverage

CI enforces `--cov-fail-under=55` over `server/`. That is a floor, not a target:
it exists to stop coverage collapsing, and the meaningful signal is in *which*
paths are covered — the security wiring, the access-control boundaries, the
schema-drift behaviours and the two frontend regression files.

There is no coverage gate on the frontend suite.

---

## Linting

| Tool | Scope | Configuration |
| :--- | :--- | :--- |
| ESLint | `frontend/*.js`, `frontend/js/*.js`, `frontend/js/terminal/*.js` | `.eslintrc.json` — `no-undef: error`, `no-unused-vars: warn` (ignoring `^_`), `DOMPurify`/`marked` as read-only globals, service-worker env override for `sw.js`, `dist/**` ignored |
| Stylelint | `frontend/**/*.css` | `.stylelintrc.json` — `stylelint-config-standard` with cosmetic rules disabled; `frontend/vendor/**` ignored |
| Prettier | `**/*.{html,css,js,json,md,yml,yaml}` | `.prettierignore` excludes `frontend/index.html` (CSP-hashed inline scripts), `worldcup.html`, `ucl.html`, the generated locks, `fonts.css`/`fonts/`, and `vendor/` |
| ruff | `server`, `tests` | `ruff.toml` — `F`, `E`, `W`, `B`, `ASYNC`, `C4`; ignores `E501`, `B008` (FastAPI's dependency idiom is a call in a default argument) and `E712` (`Column == False` builds SQL, and ruff's fix would silently break the query) |

The backend had no linting at all while the frontend ran two linters. `F821`
alone would have caught the five auth routes that shipped calling service
functions that do not exist.

---

## What is not tested

Known gaps, stated so nobody assumes coverage that is not there:

| Gap | Consequence | Mitigation in place |
| :--- | :--- | :--- |
| Migrations are never executed by pytest | The suite builds its schema with `create_all` against SQLite | The separate `migration-check` CI job runs the chain against real PostgreSQL and runs `alembic check` |
| No browser-level end-to-end tests | Rendering, CSS and real service-worker behaviour are unverified | The deploy's smoke test checks `GET /`, the served `sw.js` version and `/api/health` |
| Real Bedrock is never called | Streaming is exercised against mocks | The mock shape follows the botocore event stream; both the invoke and Converse paths are covered |
| SQLite, not PostgreSQL, in the suite | `JSONB`, the GIN index and window functions behave differently | Dialect variants on the two affected columns; the migration job uses real PostgreSQL |
| Kafka is never exercised with a real broker | Only the simulated and bypass paths are tested | The consumer falls back automatically, and the broker path is thin |
| `three-bg.js`, `particles-config.js`, `animations.js` are untested | Canvas rendering and animation are not asserted | Manual review; they are self-contained and degrade to no-ops |
| `chat.js` has no direct unit tests, and `auth-ui.js` only its reset and 2FA panels | Both are ~1,200-line single initialisers | `auth-reset-password.test.js` drives `initAuthUI` against the real `index.html`, so the reset panel's wiring - and the submit-readiness contract all four auth forms share - is asserted; `auth-refresh.test.js` and `auth-register.test.js` cover the riskiest shared paths in `auth.js`; the backend contract test covers the endpoints they call. The register panel's success painting is verified by reading only |
| No load or soak testing | Concurrency limits are reasoned about, not measured | The limits are conservative and observable via `/system/pipeline` |

---

## Writing new tests

**Backend.** Put endpoint behaviour in `integration/` using the `async_client`
fixture; put pure logic and wiring assertions in `unit/`. Mark async tests with
`@pytest.mark.asyncio` — strict mode means an unmarked async test fails rather
than silently skipping. Prefer a test that names the defect it prevents; every
file in this suite reads that way, and it is why the failures are legible years
later.

**Frontend.** Build the DOM fixture with jsdom inside the test, assign
`global.document`/`global.window`, then import the module under test. Assert on
observable DOM and on storage, not on internals.

**When adding an endpoint the frontend calls**, add it to
`test_frontend_api_contract.py` — that file is the only thing standing between a
renamed route and a silently broken deployed client.
