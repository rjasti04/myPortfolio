# Intent: Landing Hero — Desktop Glass Frame, Mobile-Only Paint

> **Revision, same day.** This began as two changes: the glass frame *and* a
> redesign of the paint from an upright panel into a diagonal swash. The swash
> was built, reviewed against the mocks and then **reverted at the owner's
> direction** — the panel stays as it was. What shipped is the frame, the
> mobile-only scoping of the paint, and a thinner frame fill. Section 1.2
> below records the swash argument as it was made, because the reasoning about
> the stacked layout is still the honest account of why the question came up;
> the decision went the other way.

## 1. Problem & Persona Context

- **Target Persona Priority**:
  - [x] 1. Visitor / Recruiter (Priority: first paint, mobile layout, accessibility — the
        landing view is the door and is the LCP view)
  - [x] 2. Portfolio as a Work Sample (Priority: vanilla CSS on the token system, a
        generated asset rather than a hand-drawn one, no framework, no third-party asset)
  - [ ] 3. Owner

- **Problem Statement**:

  The landing view (`#home`) currently renders the same decoration at every width: a
  painted **panel** — `.home-portrait::before`, an upright block of `--accent-fill`
  masked by `frontend/brush-backdrop.webp` — standing behind the portrait cutout.
  It is the only ground the view has, and it is carrying two jobs it cannot do at once:

  1. **On desktop it competes with the page rather than framing it.** The panel is a
     vertical slab behind a left-hand portrait while the name, role, disciplines line,
     two pills and the seven-control icon row sit unframed in the right-hand column.
     The two halves have no shared container, so at 1280×800 the view reads as a cutout
     with a smear behind it beside a stack of loose type — there is nothing that says
     "this is one composition". The site backdrop (the circuit schematic) runs straight
     under the type at full strength, which is exactly where `--backdrop-scrim` is doing
     the most work and has the least headroom.
  2. **On mobile the panel is the wrong shape for the layout it lands in.** Below 900px
     the portrait moves above the text and centres, and the upright panel — tuned to
     frame a standing figure beside a text column — becomes a rectangle-shaped stain
     directly behind a centred head. Phones also lose `.site-backdrop` entirely
     (`(pointer: coarse) and (width <= 768px)`), so this is the *only* decoration
     on the smallest screens and it is the one place it has to be good.

  **The objective**, working from the two mocks supplied:

  - **Desktop and wider (≥ 901px)**: the *entire* hero — portrait and intro column
    together — sits inside one **glassmorphic frame with an illuminated edge**: a
    translucent, backdrop-blurred surface with a lit accent rim and an outer bloom,
    so the circuit backdrop reads *through* the frame (softened) instead of *against*
    the type. The paint is removed at this width entirely.
  - **Mobile (≤ 900px)**: the paint stays **exactly as it is** — the upright panel,
    every number measured against this layout, now simply scoped to it. No glass
    frame at this width. (A diagonal swash was built here and reverted; see the
    revision note at the top.)

  One decoration per layout, each designed for the layout it is in.

---

## 2. Constraints & Non-Goals

- **Inviolable Constraints**:
  - **ADR-001**: Vanilla CSS and vanilla ES modules. No component abstraction, no
    framework, and — for this change — **no new JavaScript at all**. The frame is a
    media query and one pseudo-element.
  - **ADR-016**: Zero third-party asset origins. Nothing is fetched, and the frame
    adds no asset at all — it is CSS.
  - **ADR-023**: Not applicable — no chat or model surface is touched.
  - **`docs/DESIGN.md` rules 1–4**: every new value joins a ramp or becomes a named
    token with a comment; every new colour/elevation token gets a dark-theme
    counterpart; accent-derived tokens are declared on `body`, never `:root`, or they
    freeze at the light accent and ignore both the dark theme and the theme customiser.
  - **The landing view must never scroll.** The `.home-portrait` height bound
    (`calc(90dvh - 85px)` on desktop, the `82dvh` ramp on mobile) is measured against a
    hero with *zero* block padding. A frame with block padding changes that arithmetic
    and the bound has to move with it, or short desktop windows overflow.
  - **The paint must be gone before the figure dissolves.** `.home-portrait-img` carries
    `mask-image: linear-gradient(to bottom, #000 68%, transparent 97%)`; any opaque
    paint behind the figure below 68% prints its bristle texture through the jacket.
    The generator computes that band from four mirrored CSS constants. Wrapping the
    rule in a media query changes none of them, which is the point: the panel's
    geometry and its fade are untouched.
  - **Contrast**: the frame sits under every line of type on the LCP view. Body copy,
    the muted greeting and the disciplines line must still clear WCAG AA over the new
    surface in both themes, including where the circuit backdrop's brightest traces
    pass under the frame.

- **Explicit Non-Goals**:
  - No animated or pulsing edge glow. A looping ambient animation on the landing view
    is a WCAG 2.2 SC 2.2.2 liability and the site deliberately plays `.home-role`'s
    gradient **once**; the rim is static.
  - No new DOM. No wrapper `<div>` around the hero, no extra elements for the glow —
    which also keeps `frontend/index.html` untouched and the three pinned CSP
    `sha256-` hashes valid.
  - No change to the portrait flip card, its two mattes, `js/home-portrait.js`, or
    `scripts/generate_profile_cutout.py`.
  - No change to the frame on tablets. 901px is the existing stacked/two-column
    boundary and the redesign reuses it rather than inventing a third tier.
  - Not touching `ucl.html` / `worldcup.html` — they are outside the SPA by design.

---

## 3. Impacted Layer Matrix & Quality Gates

- [x] **Frontend**:
  - Styles: `frontend/styles.css` — DESIGN TOKENS & THEMES (radius rung + five
    frame tokens across both themes), HOME HERO (the frame, the swash geometry, the revised
    portrait height bound), ACCESSIBILITY & PRINT PREFERENCES (`forced-colors`,
    `prefers-contrast`, print), BACKDROP-FILTER FALLBACKS.
  - Asset: `frontend/brush-backdrop.webp` — **unchanged**.
  - Script: `scripts/generate_brush_backdrop.py` — **unchanged**.
  - Markup: **none**.
  - Build: `scripts/build.mjs` — `BUDGETS_KIB.css`, see the CSS-budget risk below.
  - Gates: `npm run lint` && `npm test` && `npm run build`
- [ ] **Backend**: N/A — no routes, services or schemas touched.
- [ ] **Database**: N/A — no models, no migration.
- [x] **Docs / Hashes**:
  - `python3 scripts/check_csp_hashes.py` — must stay green; `index.html` is not edited,
    so this is a regression check rather than a repair.
  - `python3 scripts/check_docs.py --fix --show-tokens` — `styles.css` grows, so the
    line count and token estimate in `.claude/rules/navigation.md` move with it.
  - `docs/DESIGN.md` — the radius ramp gains a rung and the note has to say so.

---

## 4. Risks & Mitigations

- **Performance / Asset Size Impact**
  - *`backdrop-filter` on the largest box on the LCP view.* The blur is a compositor
    pass over ~1050×560 CSS px, on a **static** backdrop (the Three.js canvas is
    retired — `frontend/three-bg.js` is dead code) with nothing animating behind it, so
    the layer is painted once and cached. `header`, `nav`, `.item`, `.skill-group` and
    `.act-card` already run the same filter over the same ground. Mitigation: the frame
    is desktop-only, so no phone GPU ever pays for it, and the blur reuses the existing
    `--blur-lg` rung rather than adding a radius.
  - *Asset bytes.* None. The mask is byte-identical to what shipped before, and no
    new asset is added. (The reverted swash would have halved it, 84.8 KB → 43.8 KB;
    that saving goes with it.)
  - *CSS budget.* `scripts/build.mjs` fails past a hard ceiling of minified CSS, and
    **the ceiling was already at exactly 100.0%** (288.0 KiB of 288) before this work —
    not 99%, 100.0%. There is no headroom to spend, so the change has to trim what it
    can and then raise `BUDGETS_KIB` with a written reason, which is what the build's
    own failure message instructs. Verified by `npm run build`.
- **API Cost / Rate Limits**: none — no network call is added or removed.
- **Security / Authentication**: none — no auth surface, no user-controlled output, no
  inline script. The CSP is unchanged: the mask is a same-origin image already covered
  by `img-src 'self'`, and no element or attribute is added to `index.html`.
- **Accessibility**
  - *Text over glass.* Mitigated by keeping the frame's fill opaque enough to hold the
    scrim's job (the token carries a measured value per theme) and by forcing an opaque
    surface under `prefers-contrast: more`.
  - *Forced colours.* The rim and sheen are painted with `background` images, which
    Windows High Contrast Mode blanks — leaving a gap where an edge was. Both
    pseudo-elements are dropped under `forced-colors: active`, and the frame's real
    `border` (a system colour there) is what remains.
  - *Reduced motion.* Nothing here animates, so the blanket rule in the ACCESSIBILITY
    region has nothing to clamp.
- **Regression risk on the "never scrolls" promise**: the portrait bound is re-derived
  against the frame's block padding rather than left alone, and checked at the short
  desktop viewports the existing note names (1280×568, 1440×568, 1920×568) plus the
  short-and-tall cases around 900×760.
