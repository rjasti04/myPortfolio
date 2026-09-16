# Technical Specification: Hide Background Canvas Animation (Preserve Implementation)

**Related Intent**: [.claude/intents/2026-09-16-hide-threejs-background.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-16-hide-threejs-background.md)  
**Target Audience**: Visitor / Recruiter (cleaner visual presentation), Work Sample (clean lifecycle and reversibility)

---

## 1. Architectural Impact & Component Overview

- **Impacted Layers**:
  - [x] Frontend SPA (`frontend/index.html`, `frontend/styles.css`, `frontend/three-bg.js`)
  - [ ] Backend API — none
  - [ ] Database Schema — none
  - [ ] CI/CD & Deploy — none

All changes are strictly additive or toggles in existing files. No files are deleted, moved, or renamed. The 1,550+ lines of simulation code in `frontend/three-bg.js` remain completely intact.

---

## 2. API Contract & Schemas

**N/A.** No backend routes or schemas are touched.

---

## 3. Database Schema & Migration Plan

**N/A.** No models or databases are touched.

---

## 4. Frontend Implementation & DOM Contract

### 4.1 Master Toggle & Lifecycle in `frontend/three-bg.js`
- Define a top-level constant `ENABLE_BACKGROUND_ANIMATION = false;`.
- In `shouldEnableBackground()`, evaluate `if (!ENABLE_BACKGROUND_ANIMATION) return false;` as the initial guard.
- When `shouldEnableBackground()` returns `false`:
  - `syncThreeBackgroundImpl()` marks `canvas.hidden = true`.
  - `destroyBackground?.()` executes, cancelling `requestAnimationFrame`, disconnecting mutation observers, removing resize/scroll/pointer event listeners, and clearing the 2D context via `ctx.clearRect(0, 0, width, height)`.
  - No background CPU/GPU render loops persist.

### 4.2 Declarative CSS in `frontend/styles.css`
- In `styles.css` under `.webgl-canvas`:
  - Apply `display: none !important;` to ensure the canvas is never painted even prior to JavaScript initialization or on non-JS environments.
  - Retain `.webgl-canvas[hidden] { display: none !important; }` rule for semantic DOM alignment.

### 4.3 Markup Initial State in `frontend/index.html`
- Add the `hidden` attribute to `<canvas id="webgl-canvas" class="webgl-canvas js-only" aria-hidden="true" hidden></canvas>`.
- Preserves the DOM element for potential re-enabling while ensuring zero paint flash on initial document load.
- No inline script tags are altered, keeping all CSP hashes in `scripts/check_csp_hashes.py` strictly valid.

---

## 5. Security & CSP Review

- [x] No changes to inline `<script>` tags in `frontend/index.html` (verified via `python scripts/check_csp_hashes.py`).
- [x] No third-party script or style origins introduced (ADR-016 compliant).
- [x] No sensitive data exposed.

---

## 6. Verification & Test Plan

Execute quality gates:

```bash
# Frontend tests and linting
npm test
npm run lint
npm run build

# CSP and documentation verification
python scripts/check_csp_hashes.py
python scripts/check_docs.py --fix --show-tokens
```
