# Technical Spec: Apps UI/UX Redesign — Shared Chrome & Responsive Overhaul

> **Intent**: [`.claude/intents/2026-09-12-apps-uiux-redesign.md`](file:///c:/Users/inbox_inm6dkz/OneDrive/Documents/GitHub/rjWebApp/.claude/intents/2026-09-12-apps-uiux-redesign.md)
> **Date**: 2026-09-12
> **Author**: AI (reviewed by user)

---

## 1. Overview

Redesign the UI/UX of all 5 portfolio apps at `rjasti.com/#apps` to achieve:
- A **shared header/footer chrome pattern** across all 5 apps while preserving each app's distinct colour palette
- **Full mobile responsiveness** (3 of 5 apps currently have zero CSS media queries)
- **Unified theme toggle mechanism** for UCL, World Cup, Cron, and Crypto (Arcade stays dark-only)
- Consistent visual quality that reinforces the portfolio's credibility as a work sample

---

## 2. Shared Chrome Pattern Specification

### 2.1 App Header

All 5 apps will share an identical header **structural layout** (class names, DOM structure, flex behaviour). Per-app CSS tokens colour it differently.

```
┌────────────────────────────────────────────────────────────────┐
│ [Icon] Title                               [← Portfolio] [⚙]  │
│        Subtitle                                                │
├────────────────────────────────────────────────────────────────┤
│ [Tab 1] [Tab 2] [Tab 3] ...    (only for multi-panel apps)    │
└────────────────────────────────────────────────────────────────┘
```

**Desktop (≥ 1024px)**:
- Left: Brand icon (40×40 area) + Title (18px, 700 weight) + Subtitle (12px, muted)
- Right: "← Portfolio" text link + Share button (icon + label) + Theme toggle (if applicable)
- All action buttons: 40px height, pill-shaped, surface background with border

**Tablet (641px–1023px)**:
- Same layout, but "← Portfolio" shortens to "← Back"
- Share button drops its text label, keeps icon only

**Mobile (≤ 640px)**:
- Brand title wraps if needed; subtitle may hide
- Actions compress to icon-only buttons
- Minimum 44×44px touch targets (WCAG 2.5.5)

### 2.2 App Footer

```
┌────────────────────────────────────────────────────────────────┐
│ [Privacy line / zero-egress statement]                         │
│ Portfolio · Apps Shelf · [Sibling App 1] · [Sibling App 2]    │
└────────────────────────────────────────────────────────────────┘
```

- Full-width bar, centred content, `max-width: 1200px`
- Top line: app-specific privacy/tech statement (e.g., "100% Client-Side · Zero Network Egress")
- Bottom line: cross-links to portfolio, apps shelf, and 2 sibling apps
- Footer text: 13px, muted colour, link colour on hover

### 2.3 Shared CSS Token Contract

Each app defines its own values for these tokens. The header/footer CSS references only these names:

```css
/* Every app must define: */
--chrome-bg:        /* header/footer background */
--chrome-border:    /* header bottom border, footer top border */
--chrome-text:      /* primary text in header/footer */
--chrome-muted:     /* subtitle, footer disclaimer text */
--chrome-action-bg: /* button background */
--chrome-action-hover: /* button hover background */
--chrome-accent:    /* brand icon tint, active tab indicator */
```

---

## 3. Per-App Responsive Breakpoint Plan

### 3.1 Breakpoint Tiers (Minimum for all apps)

| Tier | Width | Target |
|:---|:---|:---|
| **Mobile S** | ≤ 430px | iPhone SE / small Android |
| **Mobile L** | ≤ 640px | iPhone Pro Max, wider phones |
| **Tablet** | ≤ 1023px | iPad, small laptops |
| **Desktop** | ≥ 1024px | Default desktop layout |

### 3.2 Arcade (`arcade.css`)

**Current**: 0 media queries.

| Breakpoint | Changes |
|:---|:---|
| **≤ 640px** | Launcher grid: 1 column (currently ~3 across, overflows). Card aspect ratio adjusts. |
| **≤ 430px** | Wordmark font size reduces. HUD bar: score/best stack vertically. Pause/restart tools shrink to icon-only. |
| **641–1023px** | Launcher grid: 2 columns. HUD stays single row. |
| **≥ 1024px** | 3-column launcher grid (current default). |

**Launcher cards**: Use `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` for automatic reflow.

### 3.3 Cron & Regex Visualizer (`cron.css`)

**Current**: 0 media queries.

| Breakpoint | Changes |
|:---|:---|
| **≤ 430px** | Builder grid: 1 column (currently 5 across, overflows). Input group stacks vertically. Tab labels remain visible (text ≤ 6 chars). Timeline entries stack. |
| **≤ 640px** | Builder grid: 2–3 columns. Regex flags bar wraps. Test textarea full width. |
| **641–1023px** | Builder grid: 3 columns. Cards single column, full width. |
| **≥ 1024px** | Builder grid: 5 columns (current default). |

**Key fixes**:
- `.builder-grid`: `grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))`
- `.input-group`: `flex-wrap: wrap` at ≤ 640px
- `.flags-bar`: `flex-wrap: wrap; gap: 6px`

### 3.4 Crypto & Encoders (`crypto.css`)

**Current**: 0 media queries.

| Breakpoint | Changes |
|:---|:---|
| **≤ 430px** | IO grid stacks to 1 column. Hash cards: badge + bits text wrap. Clock grid: 1 column. Time converter inputs full width with buttons below. Tab labels: icon-only at this width. |
| **≤ 640px** | IO grid: 1 column. Hash cards single column. Clock grid: 2 columns. Actions toolbar wraps. |
| **641–1023px** | IO grid: 2 columns (current). Cards stack if needed. |
| **≥ 1024px** | Full 2-column IO layout (current default). |

**Key fixes**:
- `.io-grid`: `grid-template-columns: 1fr` at ≤ 640px
- `.clock-grid`: `grid-template-columns: 1fr` at ≤ 430px, `repeat(2, 1fr)` at ≤ 640px
- `.time-grid`: `grid-template-columns: 1fr` at ≤ 640px
- `.hashes-stack`: Ensure hash cards don't overflow — `overflow-wrap: anywhere` on hash values

### 3.5 UCL Predictor (`ucl.html` inline styles)

**Current**: 5 breakpoints (430–1280px) but gaps below 430px.

| Fix | Details |
|:---|:---|
| **Header overflow** | At ≤ 430px, stack brand and actions vertically instead of `space-between` |
| **Tab pill truncation** | Reduce font-size to 11px and padding at ≤ 430px; consider icon-only on narrowest |
| **Hero chips** | Already wrap, but spacing needs tightening at ≤ 430px |

### 3.6 World Cup Predictor (`worldcup.html` inline styles)

**Current**: 4 breakpoints (768–1200px) but no coverage below 768px.

| Fix | Details |
|:---|:---|
| **Add ≤ 640px and ≤ 430px** | Stack header, reduce hero title, make group cards full width |
| **Tab navigation** | Same icon-only fallback at narrow widths |

---

## 4. Theme Toggle Unification

### Current State

| App | Mechanism | Storage Key | Toggle UI |
|:---|:---|:---|:---|
| UCL | `body.light-theme` class | `ucl-theme` | Button in header-actions |
| World Cup | `body.light-theme` class | `wc-theme` | Button in header-actions |
| Cron | `[data-theme="dark"]` attr | `theme` | `#theme-toggle-btn` |
| Crypto | `[data-theme="dark"]` attr | `theme` | `#theme-toggle-btn` |
| Arcade | Dark only | N/A | N/A |

### Target State

- **UCL and World Cup**: Migrate to `[data-theme="dark"|"light"]` on `<html>`. Storage key: `theme` (shared with portfolio and other apps).
- **Cron and Crypto**: Already use `[data-theme]` — normalize storage key to `theme` if not already (Cron was fixed in previous audit).
- **Arcade**: No changes.
- **System preference fallback**: All 4 theme-enabled apps respect `prefers-color-scheme` on first visit (no stored preference).
- **Theme-color meta tag**: All 4 apps update `<meta name="theme-color">` when switching.

---

## 5. Implementation Phases

### Phase 1: Shared Chrome Foundation (Cron + Crypto)
These two apps already have the closest header pattern. Normalize them to the exact shared chrome specification.

**Files**: `cron.html`, `cron.css`, `crypto.html`, `crypto.css`
**Effort**: Low — mostly CSS refinement + footer link parity.

### Phase 2: Full Responsive Breakpoints (Cron + Crypto)
Add all missing media queries.

**Files**: `cron.css`, `crypto.css`
**Effort**: Medium — requires layout testing at each breakpoint.

### Phase 3: Arcade Chrome + Responsiveness
Adapt the arcade masthead to the shared chrome pattern while preserving the wordmark personality. Add responsive breakpoints.

**Files**: `arcade.html`, `arcade.css`
**Effort**: Medium — the wordmark and candy aesthetics need careful integration.

### Phase 4: UCL + World Cup Header/Footer Alignment
Apply the shared chrome pattern to the inline styles. Add missing sub-430px breakpoints. Migrate theme mechanism from `body.light-theme` to `[data-theme]`.

**Files**: `ucl.html`, `worldcup.html`
**Effort**: Medium-High — inline CSS monoliths require careful scoped edits to avoid cascade regression.

### Phase 5: Cross-App Testing & Polish
- Test all 5 apps on 375px, 430px, 640px, 768px, 1024px, and 1440px viewports
- Verify theme toggle persistence across app navigation
- Verify footer cross-links work
- Run lint, build, and CSP hash gates

---

## 6. Acceptance Criteria

| # | Criterion | Verification |
|:---|:---|:---|
| 1 | All 5 apps have a visually consistent header with brand area + back link + actions | Visual inspection at desktop and 375px |
| 2 | All 5 apps have a footer with cross-links to portfolio and sibling apps | DOM inspection + click testing |
| 3 | Arcade, Cron, and Crypto have at least 3 responsive breakpoints each | CSS audit + viewport testing |
| 4 | No horizontal scroll on any app at 375px viewport width | Browser responsive mode testing |
| 5 | UCL and World Cup use `[data-theme]` for theme switching | DOM inspection + localStorage check |
| 6 | Theme preference persists across apps via shared `theme` key | Navigate between apps, verify theme stays |
| 7 | All touch targets ≥ 44×44px on mobile | WCAG 2.5.5 audit |
| 8 | `npm run lint` passes | CI gate |
| 9 | `npm run build` succeeds | CI gate |
| 10 | `python3 scripts/check_csp_hashes.py` passes | CI gate |
