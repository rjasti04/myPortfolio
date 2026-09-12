# Intent: Apps UI/UX Redesign — Visual Consistency, Responsiveness & Shared Chrome

## 1. Problem & Persona Context
- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: First paint, mobile responsiveness, accessibility, intuitive UX)
  - [x] 2. Portfolio as a Work Sample (Priority: Architectural discipline, vanilla ES modules, clean code)
  - [ ] 3. Owner (Priority: Analytics dashboard, Bedrock chat demo, personal utility)
- **Problem Statement**:
  The 5 apps linked from `rjasti.com/#apps` — **UCL Predictor**, **World Cup Predictor**, **Arcade**, **Cron & Regex Visualizer**, and **Crypto & Encoders** — were built independently with three entirely different design systems. A visitor navigating between them encounters jarring inconsistencies in header structure, navigation patterns, footer design, color systems, theme toggling, and mobile responsiveness. Three of the five apps (Arcade, Cron, Crypto) have **zero CSS media queries** and break on mobile viewports. This undermines both the visitor experience and the portfolio's credibility as a work sample.

## 2. Constraints & Non-Goals
- **Inviolable Constraints**:
  - ADR-001: Pure vanilla ES modules. No frameworks (React, Vue, etc.) or component abstractions.
  - ADR-016: Zero third-party asset requests for the SPA apps (Arcade, Cron, Crypto). **UCL & World Cup are deliberate exceptions** that load Google Fonts and cdnjs directly — they will not be "fixed" to match the SPA, nor will they be cited as precedent.
  - ADR-023: Client cannot dictate model ID, system prompt, or token ceilings.
- **Explicit Non-Goals**:
  - Do NOT refactor UCL/World Cup internal body layouts (group tables, bracket trees, sortable rankings). Only align their header/footer/nav chrome.
  - Do NOT extract UCL/World Cup inline CSS into external sheets or change their font/asset loading strategy.
  - Do NOT add a theme toggle to Arcade — its dark-only retro aesthetic is intentional.
  - Do NOT introduce a shared CSS framework, component library, or build-time CSS preprocessor.
  - Do NOT change the functional logic of any app — only layout, styling, and responsive behaviour.
  - Do NOT unify the five apps into a single page or router. Each remains a standalone HTML page.
  - Do NOT touch the tab/nav switcher or card/panel components *beyond* the shared header/footer pattern — keep internal component styling per-app.

## 3. Impacted Layer Matrix & Quality Gates
Determine impacted layers and execute matching quality gates:

- [x] **Frontend**: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no backend changes
- [ ] **Database**: N/A — no schema changes
- [x] **Docs / Hashes**: `python3 scripts/check_csp_hashes.py` && `python3 scripts/check_docs.py`

## 4. Risks & Mitigations
- **Performance / Asset Size Impact**: Adding media queries and refining CSS increases total CSS size modestly (~2–4 KB per app). No bundle impact since these are separate HTML pages with their own CSS files.
- **API Cost / Rate Limits**: N/A — pure frontend changes.
- **Security / Authentication**: CSP hashes in `index.html` are unaffected (these are standalone pages). UCL/World Cup have no CSP meta tag. Arcade, Cron, and Crypto have their own CSP meta tags — no inline script changes needed.
- **Regression Risk**: UCL and World Cup are single-file monoliths (3,143 and 2,749 lines). Touching their header/footer CSS inside inline `<style>` blocks risks unintended cascade changes. Mitigation: scope header/footer styles under a dedicated class prefix (e.g., `.app-chrome-*`) and test both light and dark themes.

## 5. Current State Audit

### Design System Fragmentation

| Dimension | UCL + World Cup | Cron + Crypto | Arcade |
|:---|:---|:---|:---|
| **CSS location** | Inline `<style>` (1,500+ lines) | External `.css` files | External `arcade.css` |
| **Token system** | Own HSL variables | Own HSL variables (different names) | Own warm palette |
| **Theme mechanism** | `body.light-theme` class | `[data-theme="dark"]` attr | Dark only |
| **Header pattern** | Centered hero banner with brand, h1, subtitle, chips, progress bar | Left-aligned brand bar with icon+title+subtitle + right action buttons | Wordmark masthead with icon buttons |
| **Footer** | None | Cross-linked footer with privacy/disclaimer | None |
| **Tab navigation** | Pill-shaped `<div>` tablist | Segmented nav with `<button>` tabs | Launcher grid / stage HUD |
| **Responsive breakpoints** | 4–5 `@media` rules | **0 media queries** | **0 media queries** |
| **Font loading** | Google Fonts (external) | Self-hosted `fonts.css` | Self-hosted `fonts.css` |
| **Icon loading** | cdnjs Font Awesome (external) | Self-hosted Font Awesome | SVG inline icons only |

### Mobile Issues (Tested at 375×812)

| App | Issues |
|:---|:---|
| **UCL** | Header brand overlaps action buttons on narrow screens; tab pill text truncates |
| **World Cup** | Similar header overflow; group cards don't stack properly below 430px |
| **Arcade** | Launcher cards don't reflow — horizontal overflow; HUD bar items collapse |
| **Cron** | Builder grid overflows horizontally; input group wraps but buttons clip; entire layout assumes ≥768px |
| **Crypto** | IO grid columns don't stack; hash cards overflow; clock grid breaks; time converter inputs truncate |

## 6. Proposed Solution Direction

### Strategy: "Shared Chrome, Distinct Palette"

Each app keeps its own colour palette and personality, but all 5 adopt a shared **header/footer structural pattern** with consistent:

1. **App Header** — Left-aligned brand area (icon + title + subtitle), right-aligned actions (Back to Portfolio link, theme toggle where applicable, share button)
2. **App Footer** — Cross-links between apps, portfolio link, and privacy/attribution line
3. **Mobile-first responsive breakpoints** — Every app gets at minimum a 375px, 640px, and 1024px tier
4. **Consistent animation/transition** — Shared easing curves and durations for hover/focus states

### Per-App Scope

| App | Header/Footer | Mobile Responsiveness | Theme |
|:---|:---|:---|:---|
| **UCL** | Adopt shared header pattern (keep hero content, move brand+actions to chrome bar) | Improve existing breakpoints, especially < 430px | Unify to `[data-theme]` mechanism |
| **World Cup** | Same | Same | Same |
| **Arcade** | Adapt masthead to shared chrome pattern while preserving wordmark personality | Add breakpoints for launcher grid + HUD | Keep dark-only |
| **Cron** | Already close — normalize to exact shared pattern | **Add all missing breakpoints** | Already uses `[data-theme]`, unify toggle logic |
| **Crypto** | Already close — normalize to exact shared pattern | **Add all missing breakpoints** | Already uses `[data-theme]`, unify toggle logic |
