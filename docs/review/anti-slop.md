# Anti-Slop Review

> **Status: all five findings fixed.** Implemented on
> `claude/anti-slop-ai-frontend-n7srgu`, grouped by pillar rather than by
> finding number. This document is kept as the record of *why* each change was
> made — the line numbers in each entry point at the code **as it was**, before
> the fix. `docs/DESIGN.md` describes the system as it is now.
>
> Two of the measurements that motivated this review were wrong on first pass,
> and both are corrected below, because a review that quietly restates its own
> numbers is worth less than one that shows where it was off:
>
> - **Motion-token adoption was measured with a line-based `grep -c` and came
>   out at 39 of 132 transitions.** The real figure was **111 of 132 (84%)** —
>   most `transition` declarations span several lines, so the property and its
>   `var(--motion-*)` value sit on different lines and a per-line count misses
>   them. The gap was real but far smaller than it first looked.
> - **Three `cubic-bezier()` values were read as inline duplicates of the
>   easing tokens.** They were the token *definitions*. There were three base
>   easings and five genuinely bespoke curves, not three duplicates and five
>   strays — which changed the fix from "fold them away" to "name them".

## The shape of the problem

This review was commissioned against a five-pillar "anti-slop" framework whose
premise is a codebase of unstyled defaults and framework boilerplate. **That
premise did not hold**, and the audit is more useful for saying so.

What was already here, measured before any change:

- **202 design tokens** across `:root`, `body` and `body.dark-theme`, including
  a Major Second (1.125) type ramp of eleven rungs plus six fluid `clamp()`
  steps, and four-step elevation and blur scales.
- **94% of `font-size` declarations already token-driven** — 255 of 271.
- **84% of `transition` declarations already on the motion scale** — 111 of 132.
- Colour `-text` variants chosen against **measured** contrast, with the ratios
  recorded in comments (5.81:1 and 7.95:1 on `--bg`); `--on-accent` exists
  because `#fff` had failed WCAG AA sitewide.
- A **1,163-line runtime palette engine** deriving both themes from three input
  colours, with its own contrast helper.
- `prefers-reduced-motion` honoured by a blanket rule and by ten JS modules
  through one `config.js` export.
- 23 ADRs, and a 28-finding UI/UX review already landed.

Two pillars were dropped before work started, and the reasons are part of the
record:

- **Pillar 2 (clone a battle-tested archetype) and Pillar 3 (merge it with the
  domain).** The information architecture is settled and has already been
  reviewed end to end. Restructuring eight sections against Linear or Stripe
  would have been a large, high-risk visual diff justified by nothing observed
  in the audit.
- **Pillar 5's edge-deployment half.** The site deploys to EC2 and Apache via a
  four-job Actions pipeline, behind a FastAPI backend with Postgres, Bedrock and
  in-memory rate limiting (ADR-012 is still Proposed). Re-platforming to
  Cloudflare or Vercel is a far larger change than a frontend pass, and nothing
  in the audit argued for it. Pillar 5's *motion and performance* half is where
  the two real findings in that area came from.

So the genuine gaps were narrow: one dimension of the design system that was
never put on a scale, a motion scale that was defined but not enforced, and — by
some distance the most valuable — **no record anywhere of why any of it is the
way it is**.

---

## Finding 1 — Spacing was the one visual dimension never put on a scale

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Medium |
| **Location** | `frontend/styles.css:1-452` (token region) |

**The "why"** — Blur was collapsed from nine radii to four, the sheen edge from
twenty alphas to two, and type, elevation and radius were each laddered on
purpose; the comments beside them say so. Spacing alone never got that
treatment: **zero spacing tokens against 36 distinct `px` literals** in
`padding`, `margin` and `gap`. The distribution shows a 4px grid contaminated by
off-grid neighbours — `12px` (111 uses), `8px` (94), `10px` (83), `16px` (68),
`6px` (66), `4px` (51), `14px` (50) — which is six steps in the range where
three would read as deliberate. The eleven spacing-*ish* tokens that did exist
(`--header-height`, `--rail-gap`, `--page-card-offset`) are single-purpose
layout constants, not a ramp.

**The fix** — An eight-rung `--space-*` ramp on a 4px base, whose rungs *are*
the eight most-used values in the stylesheet, so adopting one is a rename rather
than a reflow. 38 declarations in the three shared primitive regions (section
titles and cards, contact and forms, buttons) were migrated; the change was
verified value-preserving by expanding every `var(--space-*)` back to its
literal and diffing against the previous revision, which came back byte-identical.

10px, 14px, 18px and 22px are deliberately **not** on the ramp and are recorded
as exceptions in `docs/DESIGN.md`. They live in hero, activity and chat regions
tuned against layouts the earlier UI review settled; rounding them onto a rung
would move pixels to buy tidiness.

---

## Finding 2 — The motion scale was defined but not enforced

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | Medium |
| **Location** | `frontend/styles.css:264-273` and 21 call sites |

**The "why"** — Six durations and three easings were defined and then partly
ignored: **21 of 132 `transition` declarations carried a raw duration**, nine of
them at a 200ms that is not a rung on the general ramp. Separately, **five
`cubic-bezier()` curves sat inline with no name**, each used once, invisible
from the token layer. A scale nothing is obliged to use is documentation.

**The fix** — 38 declaration lines snapped onto the ramp: 250ms to
`--motion-medium`, 200ms to `--motion-base`, 150ms to `--motion-fast`. Each
moves by 10–30ms, under the threshold at which a duration change is perceptible.
On-token adoption went from **84% to 97%** (129 of 132).

The five bespoke curves were promoted to named tokens —
`--ease-overshoot-soft`, `--ease-overshoot`, `--ease-rollup`, `--ease-flip`,
`--ease-ripple` — rather than folded onto `--ease-press`. They are not
interchangeable: the portrait flip, the hero title's per-character roll-up and
the press ripple each read wrong on another curve, and homogenising them would
have cost the site its character to buy consistency. That is the trade this
review exists to refuse.

Three transitions keep a raw duration by design (the 0.35s hero panel lift, the
0.45s portrait bounce, the 760ms flip), and long-running ambient animations —
a 10s scanline, a 1.4s typing indicator — stay off the ramp entirely. The scale
spans 120–320ms and describes UI state changes; those are not that.

One distinction is now written down because it is the easy mistake to make:
`--motion-page` (200ms) and `--motion-reveal` (520ms) are named for one job each
and are **not** general rungs. Reaching for `--motion-page` on a button hover
because 200ms looked close is exactly what the note in `docs/DESIGN.md` prevents.

---

## Finding 3 — CSS and JS ran two unsynchronised motion scales

| Attribute | Detail |
| :--- | :--- |
| **Category** | Bug (latent) |
| **Severity** | Low |
| **Location** | `frontend/js/animations.js:7-8` |

**The "why"** — `TERMINAL_INTRO_START_MS = 180` and
`TERMINAL_INTRO_STEP_MS = 180` are `--motion-base` written a second time in a
second language. Change the token and the terminal intro silently keeps the old
cadence — a drift with no test and no symptom until someone notices the page
feels inconsistent with itself.

**The fix** — `motionMs(name, fallbackMs)` in `frontend/js/config.js` resolves a
`--motion-*` token to milliseconds off the root element, cached per token, with
a fallback for jsdom and for the window before the stylesheet applies.

Scoped narrowly on purpose. The other four constants in `animations.js`
(`REVEAL_STAGGER_MS`, `STAT_COUNT_DURATION_MS`, `MATRIX_FRAME_MS`,
`MATRIX_ITERATION_STEP`) have no CSS counterpart, and the many `*_MS` constants
elsewhere in the codebase are debounces, flush intervals and heartbeats —
domain timings that correctly have nothing to do with a visual scale.

---

## Finding 4 — The design system's rationale was unreachable from the docs

| Attribute | Detail |
| :--- | :--- |
| **Category** | Architecture |
| **Severity** | High |
| **Location** | `docs/ADR.md` (23 records, none on design) |

**The "why"** — This is the one finding that justified the review. The reasoning
behind the palette — why hues 64/214/274 with at least 60° of separation, why
saturation travels with the hue, why fills are hex but variants `hsl()`, why
`--on-accent` is dark ink — was written down **only inside CSS comments**. The
comments are excellent. They are also invisible from `docs/ADR.md`, invisible
from the `docs/README.md` task index, and unverifiable by
`scripts/check_docs.py`.

An agent told to "change styling" is routed by the task index to
`FRONTEND.md#styling`, which would not have told it that three-hue separation is
a standing constraint rather than a preference. So the most load-bearing rule in
a 12,000-line stylesheet was the least discoverable thing in the repository —
precisely the drift the repo's own single-source-of-truth convention exists to
prevent, and precisely how a system this deliberate decays into slop one
reasonable-looking commit at a time.

The same gap had a second half: `docs/ADR.md` conveyed its own format only by
example. No template, no statement of the next free number.

**The fix** — `docs/DESIGN.md`, the token contract as a living specification,
wired into both the `AGENTS.md` reference table and the `docs/README.md` task
index so "change styling" now routes through it. Two records lift the rules out
of the comments and make them citable:

- **ADR-024 — Design tokens are the styling contract.** Three-hue separation,
  measured contrast, every dimension a scale, both themes always.
- **ADR-025 — One motion scale, shared by CSS and JS.** Findings 2 and 3.

`docs/ADR.md` also gained the missing "Adding one" note: next free number, the
section shape, and how to supersede a record without deleting it.

One consequence worth recording, because it is a trap: **renaming a colour token
is a two-file change.** `clearCustomPalette()` in `theme-customizer.js` holds a
literal list of the properties it strips from `body.style`. Rename a token in
the stylesheet without moving it there and a custom palette silently fails to
clear.

---

## Finding 5 — Thirteen frontend CI gates, none about weight

| Attribute | Detail |
| :--- | :--- |
| **Category** | Performance |
| **Severity** | Medium |
| **Location** | `.github/workflows/deploy.yml:16-125`; `scripts/build.mjs:361` |

**The "why"** — CI ran lint, tests, build, CSP hashes, doc counts, resume
generation and an npm audit, and **not one of them was about size or speed**.
(The four `performance` and `budget` matches in the workflow are all prose in
comments about CI *minutes*.) Meanwhile the build was already computing
everything a budget needs — every `esbuild` call passes `metafile: true` — and
printing one total to a log nobody reads. The craft in the motion and asset
layers was real and nothing stopped it regressing.

**The fix** — `BUDGETS_KIB` in `scripts/build.mjs`: 300 KiB of JS and 240 KiB of
CSS, both measured over minified output with sourcemaps and images excluded, and
both failing the build when breached. Baseline at the time of writing is 251.2
KiB and 202.6 KiB — 84% of each ceiling.

Code only, deliberately. Images and fonts are content rather than critical-path
bytes, and a budget that fires whenever a photograph is added is one people
learn to raise reflexively.

CI needed no new step: `npm run build` already runs there. Two cases in
`scripts/tests/build.test.js` cover it, and the second is the one that matters —
it breaches the budget on purpose and asserts the build **fails**, because a
budget that is only reported is a log line.

---

## Summary

| # | Finding | Severity | Pillar |
| ---: | :--- | :--- | :--- |
| 1 | No spacing scale | Medium | 4 |
| 2 | Motion scale defined but not enforced | Medium | 4, 5 |
| 3 | CSS and JS motion scales unsynchronised | Low | 5 |
| 4 | Design rationale unreachable from the docs | **High** | 1 |
| 5 | No size or performance budget in CI | Medium | 5 |

Net effect on the shipped page: spacing and easing changes are value-preserving
by construction, and the duration snapping moves nine transitions by 10–30ms.
Everything else is documentation and a CI gate.

The honest conclusion is that four of the five pillars found a well-built system
and improved its edges. The fifth — context engineering — found the real gap,
and it was not that the design system was bad. It was that nothing outside the
stylesheet knew it existed.
