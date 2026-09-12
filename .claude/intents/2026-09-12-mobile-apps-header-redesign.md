<!--
IMPORTANT INSTRUCTION FOR AI AGENTS:
DO NOT overwrite this template file (.claude/templates/intent.md).
When drafting or preparing an intent document for a feature, create a new distinct file at:
  .claude/intents/YYYY-MM-DD-<feature-slug>.md
-->

# Intent: Mobile Top Navigation Header Redesign for Client-Side Utility Apps

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [ ] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)
- **Problem Statement**:
  The client-side utility applications featured on the Apps shelf—specifically **Cron & Regex Visualizer** (`/cron`) and **Crypto & Encoders** (`/crypto`), alongside the broader suite of apps—suffer from severe mobile ergonomics, visual hierarchy degradation, touch-target collisions, and viewport space cannibalization in their sticky top navigation headers on screens under 768px.

  Specific audit findings on mobile viewports (<768px / <640px / <390px):
  1. **Excessive Sticky Header Height (Screen Real Estate Theft)**:
     - On desktop, the headers layout horizontally across 3 columns: Brand (left), Mode Tabs (center), and Action Buttons (right).
     - On mobile screens, `/cron` stacks all three containers vertically (`flex-direction: column; align-items: stretch; gap: 0.75rem;`), while `/crypto` stacks into a column at 640px.
     - With `position: sticky; top: 0;`, the resulting header height swells to **165px–190px**. On a standard mobile device (390px × 844px or 360px × 780px), the sticky header alone consumes **22% to 25% of the visible viewport**, severely constricting the interactive input/output work area and forcing constant vertical scrolling.
  2. **Touch-Target Conflicts & Accidental Tap Hazards (WCAG 2.5.5 / 2.5.8)**:
     - Icon-only action buttons (e.g., `#theme-toggle-btn`) have computed dimensions as small as ~34px × 34px, failing the WCAG 44px × 44px minimum touch target requirement.
     - In `/crypto`, the destructive action `#privacy-clear-all-btn` ("Clear All") sits directly adjacent to navigation (`.back-btn`) and utility (`#share-link-btn`) buttons with a mere 8px (`0.5rem`) gap, creating a high risk of accidental data/session wiping when tapping with mobile thumbs.
     - The action buttons in `/crypto` do not wrap gracefully on narrow devices (<390px), resulting in horizontal overflow or asymmetric button cracking across multiple lines.
  3. **Visual Hierarchy & Information Architecture Confusion**:
     - Secondary actions (Share, Theme Toggle, Clear All, Portfolio link) are visually prioritized on equal or greater footing than the primary app workspace mode switcher (`.mode-tabs`).
     - In `/cron`, `.header-actions` is aligned to `flex-end`, placing the "Back to Portfolio" link arbitrarily in the bottom-right of the header rather than following mobile convention (top-left back affordance).
     - In `/crypto`, `.mode-tabs` combines `justify-content: space-around` with `overflow-x: auto`, causing potential flex clipping on narrow devices (<360px) without visual edge indicators (gradient fades) to hint that tabs are horizontally scrollable.
  4. **Breakpoint Inconsistencies**:
     - `/cron` collapses to mobile layout at `768px`, while `/crypto` collapses at `640px`. On mid-sized viewports (641px–768px, such as portrait tablets or foldables), `/cron` is in a tall 3-row stack while `/crypto` is crammed into an unyielding horizontal row.

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - **ADR-001**: Pure vanilla ES modules and Vanilla CSS. No UI component frameworks (React, Vue, Svelte) or third-party CSS libraries (Tailwind, Bootstrap).
  - **ADR-016**: Zero third-party asset requests. All icons (Font Awesome subset) and fonts (Plus Jakarta Sans) must remain local and self-hosted.
  - **ADR-023**: 100% client-side execution; no backend API dependencies or network round-trips for header navigation state.
  - **WCAG 2.1 / 2.2 AA Compliance**: Minimum 44px × 44px touch targets for all interactive header buttons and tab triggers (`docs/DESIGN.md`).
- **Explicit Non-Goals**:
  - **Full-Screen Hamburger Drawer**: Utility tools require instant, single-tap mode switching between tools (e.g., Cron vs Regex, Encoders vs Hasher); burying primary modes behind a modal drawer reduces developer efficiency.
  - **Altering Core Utility Functionality**: This initiative will not modify regex parsing, cron evaluation, hashing engines, or encoding routines.
  - **Forced Parity with Standalone Sports Predictors**: `/ucl` and `/worldcup` have dedicated bracket canvases and distinct standalone exception rules (ADR-016 third-party assets exception). While their headers can share design principles, this initiative specifically targets the client-side developer utility suite (`/cron`, `/crypto`).

## 3. Proposed Architecture & Acceptance Criteria

### A. Two-Tier Compact Mobile Header Architecture
Redesign the sticky mobile header across client utilities into a streamlined **two-tier architecture** with a strict vertical budget (<96px total):
- **Tier 1: Global App Bar (Height: ~48px–52px)**
  - **Left**: Ergonomic "Back to Portfolio" button (`.back-btn`), rendered as a prominent touch-friendly icon link (44px × 44px minimum hit target) with accessible label.
  - **Center**: App identity (`.brand-wrap`), featuring compact icon and streamlined title with ellipsis safety.
  - **Right**: Secondary utilities grouped compactly (`#theme-toggle-btn`, `#share-link-btn`), each meeting 44px touch targets.
- **Tier 2: Segmented Mode Switcher (Height: ~40px–44px)**
  - Dedicated full-width segmented control (`.mode-tabs`) docked directly beneath the App Bar.
  - Touch-friendly tab pills with minimum 44px hit areas and clear active state indicators (`aria-selected="true"`).
  - Touch-friendly horizontal scroll with smooth momentum scrolling (`-webkit-overflow-scrolling: touch`), subtle gradient fade masks on overflowing edges, and scroll snap points.
- **Relocation of Destructive Action**:
  - Decouple `#privacy-clear-all-btn` from the top navigation bar in `/crypto`. Move it into a contextually appropriate location (e.g., within the active workbench panel actions or footer utility section) to eliminate thumb-tap collisions with navigation.

### B. Responsive Breakpoint & Layout Shift Harmonization
- [ ] Standardize the mobile header breakpoint to `@media (max-width: 768px)` across both `/cron` and `/crypto`.
- [ ] Establish a sub-mobile breakpoint at `@media (max-width: 480px)` for compact screen optimization (iPhone SE, 360px Android devices).
- [ ] Fix explicit container heights and aspect ratios to eliminate Cumulative Layout Shift (CLS) during font swap or viewport resize.
- [ ] Maintain the sticky header behavior (`position: sticky; top: 0; z-index: 50`) while reducing total mobile height from ~180px to under ~96px (saving >80px of vertical workspace).

### C. Touch Target & Ergonomics Remediation
- [ ] Expand all action button touch boundaries (`.action-btn`, `.tab-btn`, `.back-btn`) to at least 44px × 44px using CSS pseudo-elements (`::after`) or min-dimensions while preserving crisp visual styling.
- [ ] Provide distinct focus-visible rings (`var(--accent-cron)`, `var(--primary)`) compliant with WCAG 2.4.7.
- [ ] Ensure minimum 8px spatial separation between distinct touch targets to satisfy WCAG 2.5.8 Target Size (Minimum).

### D. Visual Polish & Theming Consistency
- [ ] Unify background treatment (`background-color: var(--surface); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border);`) across all utility headers.
- [ ] Maintain theme synchronization between Dark (`#090d16`) and Light (`#f8fafc`) modes without color or border discrepancies.

## 4. Impacted Layer Matrix & Quality Gates
- [x] **Frontend**:
  - `npm run lint` (ESLint and Stylelint checks must pass cleanly)
  - `npm test` (JSDOM test suites must pass)
  - `npm run build` (esbuild bundling must succeed within performance budgets)
- [ ] **Backend**: Not impacted (Zero API changes).
- [ ] **Database**: Not impacted (Zero schema changes).
- [x] **Docs / Hashes**:
  - `python3 scripts/check_csp_hashes.py` (Verify inline script hashes remain untouched)
  - `python3 scripts/check_docs.py --fix --show-tokens` (Update documentation tables and verify token metrics)

## 5. Risks & Mitigations
- **Risk: Content Clipping in Horizontal Tab Scrolling**:
  - *Mitigation*: Replace `justify-content: space-around` with `justify-content: flex-start; overflow-x: auto; scrollbar-width: none;` and add CSS mask-image linear gradients on left/right edges to indicate scroll overflow smoothly.
- **Risk: Breaking Existing Automated Frontend Tests**:
  - *Mitigation*: Keep all existing element IDs (`#tab-cron`, `#tab-regex`, `#tab-encoders`, `#share-link-btn`, `#theme-toggle-btn`, `#privacy-clear-all-btn`) intact so test selectors continue to bind without breakage.
- **Risk: Sticky Header Z-Index Conflicts**:
  - *Mitigation*: Maintain `z-index: 50` on `.app-header` and verify layering against modal dialogs and dropdown menus (`z-index: 100+`).
