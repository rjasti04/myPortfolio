<!--
IMPORTANT INSTRUCTION FOR AI AGENTS:
DO NOT overwrite this template file (.claude/templates/spec.md).
When drafting or preparing a technical specification for a feature, create a new distinct file at:
  .claude/specs/YYYY-MM-DD-<feature-slug>.md
-->

# Technical Specification: Mobile Top Navigation Header Redesign for Client-Side Utility Apps

**Related Intent**: [.claude/intents/2026-09-12-mobile-apps-header-redesign.md](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-12-mobile-apps-header-redesign.md)  
**Target Audience**: 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX) & 2. Portfolio as a Work Sample (Architectural discipline, clean Vanilla CSS/ES modules)

---

## 1. Architectural Impact & Component Overview
- **Impacted Layers**:
  - [x] Frontend Standalone Apps (`frontend/cron.html`, `frontend/cron.css`, `frontend/crypto.html`, `frontend/crypto.css`)
  - [x] Shared Design & Navigation Affordances (`frontend/arcade.html`, `frontend/arcade.css`, `frontend/ucl.html`, `frontend/worldcup.html` for back-link touch parity)
  - [ ] Backend API (None: 100% client-side execution, ADR-023)
  - [ ] Database Schema (None: Zero server-side persistence)
  - [x] Quality Gates & Documentation (`scripts/check_docs.py`, `scripts/check_csp_hashes.py`)

---

## 2. API Contract & Schemas
*None*: Purely client-side developer utility execution adhering to ADR-023. Zero network egress or backend endpoints.

---

## 3. Database Schema & Migration Plan
*None*: Zero database requirements.

---

## 4. Frontend Implementation & DOM Contract

### Part A: Two-Tier Mobile Header DOM Contract

To resolve the 3-tier vertical stacking bloat (~165px–190px) without disrupting the existing clean 1-row desktop layout, the top header is structured into two explicit, semantic tiers:

```html
<header class="app-header">
  <div class="header-container">
    <!-- Tier 1: Primary App Bar (48px) -->
    <div class="header-primary-bar">
      <a href="/" class="action-btn back-btn" aria-label="Back to Portfolio" title="Back to Portfolio">
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
        <span class="back-label">Portfolio</span>
      </a>

      <div class="brand-wrap">
        <div class="brand-icon" aria-hidden="true">
          <i class="fas fa-code"></i>
        </div>
        <div class="brand-text">
          <div class="brand-title">Logic Inspector</div>
          <span class="brand-tag">Developer Utility</span>
        </div>
      </div>

      <div class="header-actions">
        <button type="button" id="share-link-btn" class="action-btn action-btn-icon" aria-label="Share permalink" title="Copy shareable permalink to clipboard">
          <i class="fas fa-copy" aria-hidden="true"></i>
          <span class="action-label">Share</span>
        </button>
        <button type="button" id="theme-toggle-btn" class="action-btn action-btn-icon" aria-label="Toggle theme" title="Toggle Light / Dark theme">
          <i class="fas fa-sun" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- Tier 2: Segmented Mode Controller (40px) -->
    <nav class="mode-tabs" role="tablist" aria-label="Visualizer Mode">
      <button type="button" class="tab-btn active" data-tab="cron" role="tab" aria-selected="true" aria-controls="panel-cron" id="tab-cron">
        <i class="fas fa-sliders" aria-hidden="true"></i>
        <span>Cron Schedule</span>
      </button>
      <button type="button" class="tab-btn" data-tab="regex" role="tab" aria-selected="false" aria-controls="panel-regex" id="tab-regex">
        <i class="fas fa-search" aria-hidden="true"></i>
        <span>Regex Matcher</span>
      </button>
    </nav>
  </div>
</header>
```

#### Desktop Mode (>768px):
- On viewports wider than `768px`, `.header-primary-bar` is rendered with `display: contents`.
- The direct flex items of `.header-container` automatically become `[ .back-btn + .brand-wrap | .mode-tabs | .header-actions ]`, producing the unified horizontal 1-row desktop layout with zero markup duplication.

#### Mobile Mode (<=768px):
- `.header-container` switches to `display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem 0.75rem;`.
- `.header-primary-bar` is `display: flex; justify-content: space-between; align-items: center; width: 100%; height: 44px;`.
- `.mode-tabs` docks directly beneath it as Tier 2 with a fixed height of `38px`–`40px`.
- Total sticky header vertical height budget is capped at **<= 92px** (down from ~185px, reclaiming ~93px of visible workspace).

---

### Part B: Relocation of Destructive "Clear All" Action in Crypto

In `frontend/crypto.html`, the destructive `#privacy-clear-all-btn` button ("Clear All") is decoupled from the top navigation bar:
1. **Ergonomic Relocation**: Move `#privacy-clear-all-btn` to the active panel header toolbar (`.card-header` / `.workbench-toolbar`) or the `.app-footer` utility ribbon.
2. **Safety Separation**: Keeps navigation actions (`.back-btn`, `#theme-toggle-btn`, `#share-link-btn`) purely non-destructive, eliminating catastrophic thumb-tap wipes during one-handed mobile navigation.
3. **Preserve ID**: Keep `id="privacy-clear-all-btn"` so existing event listeners in [crypto-ui.js](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/frontend/js/crypto/crypto-ui.js#L486) continue to bind seamlessly with the 2-step confirmation logic.

---

### Part C: Touch Targets (WCAG 2.5.5 / 2.5.8) & Focus Styles (WCAG 2.4.7)

1. **44px Minimum Touch Targets**:
   ```css
   .action-btn,
   .tab-btn,
   .back-btn {
     min-height: 44px;
     min-width: 44px;
     box-sizing: border-box;
     display: inline-flex;
     align-items: center;
     justify-content: center;
   }
   ```
2. **Compact Visual Presentation with Extended Hit Areas**:
   - Where visual buttons appear sleek (e.g. 36px icon badges), use an expanded hit area pseudo-element:
     ```css
     .action-btn-icon::after {
       content: "";
       position: absolute;
       inset: -5px;
     }
     ```
3. **Touch Separation**:
   - Minimum 8px gap between all interactive elements (`gap: 0.5rem;`), ensuring no tap target collisions.
4. **Accessible Focus Rings**:
   - Explicit `:focus-visible` styling:
     ```css
     .action-btn:focus-visible,
     .tab-btn:focus-visible {
       outline: 2px solid var(--primary);
       outline-offset: 2px;
     }
     ```

---

### Part D: Horizontal Mode Tab Scrolling & Edge Fade Masks

On smaller devices (e.g., iPhone SE, 360px Android devices), especially in `/crypto` with 4 tabs ("Encoders", "Hasher", "Generators", "Time"):
1. **Scroll Snapping & Momentum**:
   ```css
   .mode-tabs {
     display: flex;
     align-items: center;
     gap: 0.35rem;
     background-color: var(--bg-subtle);
     border: 1px solid var(--border);
     border-radius: var(--radius-full);
     padding: 0.2rem;
     overflow-x: auto;
     overflow-y: hidden;
     scroll-snap-type: x proximity;
     -webkit-overflow-scrolling: touch;
     scrollbar-width: none; /* Firefox */
   }
   .mode-tabs::-webkit-scrollbar {
     display: none; /* WebKit */
   }
   .tab-btn {
     flex: 0 0 auto;
     scroll-snap-align: start;
     white-space: nowrap;
   }
   ```
2. **Overflow Mask Indicators**:
   - Use CSS linear-gradient `mask-image` on `.mode-tabs` (or its container) to visually fade the left/right edges when horizontal overflow occurs, signaling that additional modes are scrollable.

---

### Part E: Breakpoint Unification & CLS Elimination

1. **Standardized Breakpoints**:
   - Replace disparate 640px / 768px rules with standard breakpoints:
     - `@media (max-width: 768px)`: Triggers Two-Tier Mobile Header layout across all client tools.
     - `@media (max-width: 480px)`: Sub-mobile adjustments (hide `.action-label` text, showing crisp icon-only 44px buttons, and shorten brand title if necessary).
2. **CLS (Cumulative Layout Shift) Prevention**:
   - Set explicit `min-height: 57px` (desktop) and `min-height: 92px` (mobile) on `.app-header`.
   - Ensure sticky header positioning does not produce layout jank or content jump during font rendering.

---

### Part F: Cross-App Affordance Parity (`/arcade`, `/ucl`, `/worldcup`)

1. **Back to Portfolio Button Standardization**:
   - Align the `.back-btn` across all standalone apps to provide a consistent top-left back affordance with minimum 44px × 44px hit bounds and identical icon + text hierarchy.
2. **Standalone Integrity**:
   - Retain `/ucl` and `/worldcup` standalone architecture per ADR-016 without violating their separate third-party asset allowances.

---

## 5. Security & Rate Limiting Review
- [x] Zero API calls or egress (ADR-023 compliance).
- [x] Zero third-party asset dependencies (ADR-016 compliance).
- [x] No modifications to inline `<script>` tags, preventing CSP hash invalidation (`python3 scripts/check_csp_hashes.py`).

---

## 6. Verification & Test Plan

Execute quality gates to verify code cleanliness and test validity:

```bash
# Frontend Lint & Unit Tests
npm run lint
npm test
npm run build

# Documentation & CSP Hash Checks
python3 scripts/check_csp_hashes.py
python3 scripts/check_docs.py --fix --show-tokens
```
