---
name: frontend-module
description: Architecture standards, vanilla ES module rules, zero third-party asset constraints, and token contracts for rjWebApp frontend.
---

# Frontend Module & Architecture Standards

When authoring or refactoring frontend code in `frontend/`:

## 1. Architectural Invariants (Non-Negotiable)
- **Vanilla ES Modules Only (ADR-001)**: Do not propose, install, or introduce frameworks (React, Vue, Svelte) or complex build abstractions. The plain ES-module architecture is an intentional portfolio design choice.
- **Zero Third-Party Asset Requests (ADR-016)**:
  - The SPA must load zero third-party scripts, stylesheets, fonts, or images from external origins.
  - Fonts (Plus Jakarta Sans) and icons (Font Awesome) are self-hosted subsets.
  - Vendored libraries (`DOMPurify`, `marked`) are checked into repo source; do not link to cdnjs, unpkg, or Google Fonts.
  - The sole permitted external network egress is the fallback contact form endpoint (`formsubmit.co`).
- **Plexus Canvas Background**: `frontend/three-bg.js` is plain 2D HTML5 canvas; there is no Three.js runtime.

## 2. Style & Design Token Contract
- Modify `frontend/styles.css` using established CSS variables defined in `:root` (`docs/DESIGN.md`).
- Avoid arbitrary hardcoded color hex values; use curated semantic tokens (`--color-accent`, `--bg-primary`, `--text-primary`, etc.).
- Maintain responsive fluid layouts across mobile (<480px), tablet (<768px), and desktop.

## 3. Large File Navigation Guidelines
- Do NOT read `frontend/styles.css` or `frontend/index.html` end-to-end to avoid context blowout.
- Map sections first:
  ```bash
  grep -n '#region' frontend/styles.css
  grep -n '<section id=' frontend/index.html
  ```

## 4. Verification Checklist
- [ ] Linters pass: `npm run lint` (ESLint + Stylelint).
- [ ] JSDOM tests pass: `npm test`.
- [ ] Build succeeds: `npm run build` (esbuild emits `dist/`).
- [ ] No new third-party CDN URLs introduced.
