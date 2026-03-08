# Codebase Task Proposals

## 1) Typo fix task
**Title:** Replace "Forget Password?" with "Forgot Password?" in the login UI.

**Why:** The current label uses incorrect phrasing and looks unpolished in user-facing copy.

**Scope:**
- Update the login button text in `index.html`.

**Acceptance criteria:**
- The button text reads **"Forgot Password?"** in the rendered login dropdown.
- No layout regressions are introduced around the login form actions row.

## 2) Bug fix task
**Title:** Handle browser history navigation (`back`/`forward`) to keep section state in sync.

**Why:** The app updates section visibility and hash on nav click, but there is no `popstate`/`hashchange` handling, so using browser back/forward can leave UI state inconsistent with the URL hash.

**Scope:**
- Add a `hashchange` (or `popstate`) listener in `scripts.js`.
- On history navigation, call `setActiveSection()` when the hash maps to an existing section.
- Define fallback behavior for empty/unknown hashes (e.g., default to `about`).

**Acceptance criteria:**
- Clicking in-page nav updates sections as today.
- Pressing browser back/forward updates both active section and active nav link to match URL.
- Unknown hash values do not break navigation state.

## 3) Comment/documentation discrepancy task
**Title:** Expand README so docs match real project capabilities and developer scripts.

**Why:** README currently only says "My Webapp", while the codebase includes lint/format scripts and multiple UI features; this is a documentation gap.

**Scope:**
- Update `README.md` with:
  - project overview,
  - local development setup,
  - available npm scripts from `package.json`,
  - brief feature list.

**Acceptance criteria:**
- README includes runbook-style instructions for install/lint/format.
- Documented scripts exactly match `package.json` script names.
- New contributors can run quality checks using README alone.

## 4) Test improvement task
**Title:** Add automated tests for navigation state and auth form validation logic.

**Why:** There are no tests today, and critical UI behaviors (section activation, hash handling, password validation) are regression-prone.

**Scope:**
- Introduce a lightweight JS test setup (e.g., Vitest + jsdom).
- Add tests for:
  - `setActiveSection` behavior (section and nav active state),
  - initial hash and history/hash navigation behavior,
  - sign-up password policy and mismatch validation messaging.

**Acceptance criteria:**
- Tests run in CI/non-interactive mode via a single npm script (e.g., `npm test`).
- At least one test each for navigation, hash/history handling, and signup validation.
- Failing behavior is reproducible by test before fix and verified after fix.
