# Frontend Reference

The static tier: the page shell, styling, PWA behaviour, fonts, vendored
libraries and the build output. For the ES modules themselves see
[`JAVASCRIPT.md`](JAVASCRIPT.md).

- [Principles](#principles)
- [`index.html`](#indexhtml)
- [Content Security Policy](#content-security-policy)
- [Styling](#styling)
- [Theming](#theming)
- [Progressive Web App](#progressive-web-app)
- [Fonts](#fonts)
- [Vendored libraries](#vendored-libraries)
- [Static assets](#static-assets)
- [Open Graph cards](#open-graph-cards)
- [Apache configuration](#apache-configuration)
- [The build](#the-build)
- [Accessibility](#accessibility)
- [Local development](#local-development)

---

## Principles

1. **Vanilla first.** No framework, no CSS preprocessor, no bundler-specific
   syntax in source. `frontend/` is plain files a browser can serve directly.
2. **No third-party origin in the critical path.** Fonts are self-hosted and
   subset; DOMPurify and marked are vendored. The CSP's `script-src` is
   `'self'` plus three pinned inline hashes.
3. **`frontend/` is the source of truth and stays runnable standalone.** The
   build reads from it and never writes back.
4. **Degrade, don't fail.** Every backend-dependent feature is wrapped so an
   unreachable API is a quiet no-op. `<noscript>` gets a banner; motion respects
   `prefers-reduced-motion`; markdown rendering falls back to escaped text if
   marked or DOMPurify is missing.

---

## `index.html`

One page. It contains the DOM for **all eight sections**, which are
shown and hidden by class rather than fetched:

| Section id | Content |
| :--- | :--- |
| `home` | The landing view — identity treatment, the disciplines line (shared verbatim with the `#about` hero), two calls to action (About filled as the primary, Resume outlined), and an icon row grouped by destination: the in-site shortcuts to `#contact` and `#ai` (the latter labelled "Ask AI"), a hairline, then the two outbound profiles (LinkedIn, GitHub). The stack has almost no vertical slack — see the height-budget notes on `.home-portrait` and `.hero-kicker.home-kicker` in the HOME HERO region before adding to it |
| `about` | Hero, profile, stat counters, skills carousel, the interactive command prompt |
| `resume` | Experience timeline, downloadable résumé |
| `hobbies` | Personal interests |
| `apps` | Launcher shelf for the standalone side projects. Its tiles are ordinary anchors out to their own URLs (`/ucl` today) opened in a new tab — they carry no `data-target`, so the section router never sees them |
| `activity` | The session activity dashboard (live stream, timeline strip, path funnel, pipeline DAG) |
| `contact` | Contact form, prompt chips, copy-email control |
| `ai` | Full-page AI chat with a conversation sidebar |

`home` carries `class="active"` in the markup, which is the right first paint
for the root URL and the wrong one for every deep link: the fragment never
reaches the server, so `/#resume` is served this same document. An inline
**pre-boot section router**, placed **above `<main>`**, moves the class to the
section the fragment names, long before `js/navigation.js` arrives (through
`main.js`, a module, so not until `DOMContentLoaded`). Without it every refresh
away from home painted the landing portrait first — the LCP image of the page it
belongs to, preloaded and `fetchpriority="high"`, so it arrived fast and the
wrong content was what a visitor saw. It sets the same class the router sets, so
`#ai`'s height-locked shell and `#about`'s grid apply to the first paint rather
than to a second one, and it marks its section `is-boot-target` to suppress the
entrance animation — that section is the page as loaded, not a transition into
it.

**Where it sits is the whole point.** It ran after `</main>` first, which reads
as early enough and is not: a browser paints a document while it is still
streaming, and `#home` is the *first* section in it, so on a slow connection the
landing hero was on screen for as long as the remaining ~1,500 lines took to
arrive — measured at 165 ms into a chunked response on a deep link to `#resume`.
Sitting above `<main>` instead, the script is in place before the parser has
produced anything to paint, and a `MutationObserver` applies the swap to each
section the instant its start tag is parsed, one microtask before the frame
that would show it. Its cost is bounded: it watches the whole tree only until
`<main>` opens, then narrows to `main`'s direct children, and disconnects for
good once the target is active.

The fragment is validated against the header's own `nav a[data-target]` links
rather than a list kept in the script, so it cannot drift from the markup;
waiting for `<main>` is what makes that check conclusive, since the header
closes immediately above it. The target is then also required to be a direct
`<section>` child of `<main>`. The skip link's `#main-content` and stale
bookmarks match no nav link and leave home alone — and `js/navigation.js` now
applies the same rule at runtime, which is what stopped a reload on
`#main-content` blanking the page (see `resolveSection` in
[JAVASCRIPT.md](JAVASCRIPT.md)).

A `:target` rule in styles.css used to back this up for the streaming case. It
could never fire — the target section is parsed *after* `#home`, so it does not
exist at the paint that needed guarding, and Chromium leaves `:target`
unmatched until the parse completes anyway — and it is gone; the script's
position closes that window at the source.

The section list is duplicated in four places that have to move together: the
`<section>` markup, the header nav rows above it (their order also sets the
`1`–`8` keyboard shortcuts) — both in `index.html` — and, in
`js/navigation.js`, the `navItems` array behind the mobile bottom bar and the
`sectionOrder` array behind phone swipe navigation.

**Head, in order:** meta CSP → viewport/robots/author/theme-color → Open Graph
and Twitter cards → canonical → JSON-LD `Person` structured data → icons and
manifest → standalone-launch meta and the `apple-touch-startup-image`
links → `js-enabled` marker script → preloads (`profile-cutout-380.webp`,
`styles.css`) → stylesheets (`styles.css`, `auth-modal.css`, `fonts.css`) →
two font preloads.

**Body head, in order:** skip link → inline theme bootstrap →
`js/theme-bootstrap.js` → inline pre-boot section router. All three are
parser-blocking and all three are above `<main>`, because each of them has to
be settled before the first section can paint.

**Body tail, in order:** the deferred set, after `</main>`.

```html
<script defer src="vendor/purify.min.js"></script>
<script defer src="vendor/marked.min.js"></script>
<script src="./js/app-logic.js" defer></script>
<script type="module" src="./js/auth-ui.js"></script>
<script type="module" src="./js/main.js"></script>
```

The two `type="module"` entries are the only esbuild entry points.
`app-logic.js` is a **classic** script that assigns `window.AppLogic` and must
stay a separate non-module file loaded with `defer`.

Right after `<body>` sit the skip link and the inline theme bootstrap (below).

---

## Content Security Policy

Delivered as a `<meta http-equiv>` on `index.html`:

```
default-src 'self';
base-uri 'self';
object-src 'none';
form-action https://formsubmit.co;
script-src 'self' 'sha256-sI5s9yaTHalORCqpF/t6hv9DuC1mU/DRnTqMXP3RXsI='
                  'sha256-6XuTA/BFxDvJqIm0o2k13VOhDx9nZ5JDPwYSgDaaFdQ='
                  'sha256-TeGe8t4CWnpLfAepac4vc5uWDriFurKq3PdPmtrkFqY=';
style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline';
font-src 'self';
img-src 'self' data: https:;
connect-src 'self' https://rjasti.com https://staging-api.rjasti.com
            http://localhost:8000 http://127.0.0.1:8000
            https://get.geojs.io https://api.open-meteo.com https://formsubmit.co;
```

`style-src-attr 'unsafe-inline'` is required because several modules set inline
`style` properties (the plexus canvas container, the update banner, the confetti
canvas).

> `get.geojs.io` and `api.open-meteo.com` appear in `connect-src` and as
> `dns-prefetch` hints, but no shipped module calls either. They are vestigial
> and can be removed when someone is confident nothing depends on them.

### The three pinned inline scripts

1. **`document.documentElement.classList.add("js-enabled")`** — the CSS hook
   that reveals JS-only affordances.
2. **The theme bootstrap** — reads `localStorage.theme`, falls back to
   `prefers-color-scheme`, and applies `.dark-theme` before first paint.
3. **The pre-boot section router** — sits above `<main>` and moves the `active`
   class from `#home` to the section the fragment names, so a refresh on
   `#resume` paints the resume rather than the landing portrait.
   See [`index.html`](#indexhtml) above.

**Editing any of them — even reindenting — invalidates its hash, and the browser
then refuses to run it silently.** For the theme bootstrap the only symptom is
the flash-of-wrong-theme it exists to prevent, with nothing in the console; for
the pre-boot router it is the portrait flash coming back.

Two guards exist:

- `frontend/index.html` is in `.prettierignore`, so `npm run format` cannot
  reformat it.
- `scripts/check_csp_hashes.py` (run by CI, or `npm run check:csp`) recomputes
  every executable inline script's hash and fails on a mismatch **or** a
  declared hash that matches no script. It checks both the source page and
  `dist/index.html`, so a minifier reaching inline bodies would be caught too.

To change one deliberately: edit it, run `python scripts/check_csp_hashes.py`,
copy the `needs: 'sha256-…'` value it prints into `script-src`, re-run.

---

## Styling

| File | Size | Role |
| :--- | ---: | :--- |
| `styles.css` | ~8,850 lines | Everything except the account modal |
| `auth-modal.css` | ~615 lines | Auth modal, profile dropdown, password meter, 2FA, sessions |
| `fonts.css` | ~410 lines | **Generated** `@font-face` declarations |

`styles.css` is organised into 24 `#region` blocks. **Never read it end to
end** (~46k tokens). Get a map with live line numbers first:

```bash
grep -n '#region' frontend/styles.css
```

The regions, in file order: design tokens & themes · base/reset/utilities ·
header & navigation · code blocks & syntax highlighting · layout & page shell ·
hero & terminal panel · section titles & card primitives · experience ·
contact & forms · header info & stat counters · buttons & logo · skills &
skills carousel · modals & toasts · responsive global breakpoints ·
accessibility & print · hobbies · apps · section router & view transitions · chat
widget · activity section · AI page · overlays, ripple & scroll-to-top ·
mobile bottom nav & mobile fixes · command palette (Ctrl+K) · backdrop-filter
fallbacks.

Stylelint runs `stylelint-config-standard` with the cosmetic rules disabled
(`.stylelintrc.json`); what remains catches real defects such as invalid hex
colours. `frontend/vendor/**` is ignored.

---

## Theming

Three layers, which must agree or the theme visibly changes after load:

1. **Inline bootstrap** (CSP-pinned) — applies `.dark-theme` before first paint
   from `localStorage.theme`, else `prefers-color-scheme`.
2. **`js/theme-bootstrap.js`** — replays a saved custom palette from
   `localStorage.rj_theme_palette` onto `document.body` inline properties.
3. **`js/theme.js` `initTheme()`** — applies the identical rule, wires the
   header toggle, updates the `theme-color` meta from the computed
   `--accent-fill`, and follows OS changes only while no explicit choice is
   saved.

`js/theme-customizer.js` adds a user-chosen accent: it derives light/dark
variants from one hex value, checks contrast, writes CSS custom properties onto
`document.body`, and persists the palette. `reapplyCustomTheme(isDark)` is
called from `applyTheme` so a light/dark flip re-derives the right variant set.

The shipped defaults are amber `#F59E0B`, emerald `#10B981` and sky `#0284C7`,
defined as the `--accent-*`, `--secondary-*` and `--data-*` tokens in the
DESIGN TOKENS region of `styles.css`. Two notes on how they are written there.
The fills are **hex, not `hsl()`**: rounding an `hsl()` triple back to 8 bits
drifts a unit or two, the customiser's picker reports these as hex, and a
default the picker names has to be the colour the page paints or applying the
value already on screen shifts it. The `-text` variants stay in `hsl()`,
because their content is "the fill's hue and saturation, darker", and they are
chosen against measured contrast rather than a fixed offset — 5.78:1 and
6.02:1 on `--bg` in light, 12.34:1 and 8.11:1 in dark. `.hero-kicker` renders
`--secondary-text` at body size, so that is AA for normal text.

The panel offers four ways in, all of which are **previews** until Apply — a
MutationObserver rolls the palette back to whatever the panel opened showing if
it closes without one, so cancelling undoes what was done *inside* the panel
and nothing that came before it. Three
built-in terminal presets, the visitor's own saved themes, a hex field per
control, and a **Randomize** button that rolls all three at once. The
randomiser is constrained rather than uniform: full-range random produces
colours the variant generator cannot derive a usable light *and* dark set from,
and three independent hues do not read as a palette. See the `randomPalette`
entry in [JAVASCRIPT.md](JAVASCRIPT.md) for the bands and the harmonies.

There is a **second shuffle** in the landing view's `.home-socials` row, past a
hairline of its own. That row groups by destination — in-site routes, then
outbound profiles — and a shuffle is not a destination, so it gets its own
group rather than passing as a fourth route. Its roll is **not persisted**:
colours change instantly and survive navigation, a light/dark flip, and being
looked at in the panel and dismissed, but a reload restores whatever was saved.
That asymmetry is the point. A recruiter
who presses it out of curiosity has a free undo, and keeping a roll is a
deliberate second act — open the panel, where the controls are already filled
with what is on screen, and press Apply.

**Saved themes** are named palettes in `localStorage.rj_theme_library`, up to
12, available to every visitor with no account. The site has a full JWT/2FA
system, but per [AGENTS.md](../AGENTS.md) it exists for the owner's dashboard
rather than external users, so gating a theme library behind a login would hide
it from everyone who actually browses the page. Cookies would be the wrong
mechanism regardless: they ride along on every request for every asset and cap
at ~4KB. The honest cost of the local-only choice is worth stating — saved
themes live in one browser, and clearing site data takes them with it.

| Storage key | Holds |
| :--- | :--- |
| `theme` | `"dark"` or `"light"` — an explicit user choice |
| `rj_theme_palette` | `{light: {...}, dark: {...}}` custom accent palette |
| `rj_theme_library` | Up to 12 `{id, name, raw}` themes the visitor saved and named |

---

## Progressive Web App

### `manifest.json`

`name`, `short_name: "RJ"`, `start_url: "/"`, `display: standalone`,
`background_color: #0a0e14`, `theme_color: #F59E0B`, `orientation: any`, and the
three `android-chrome-*` icons — the 192 and 512 as `purpose: "any"`, plus
`android-chrome-maskable-512x512.png` as `purpose: "maskable"`.

`theme_color` matches the light-theme `--accent-fill` and the `<meta
name="theme-color">` in `index.html`; `applyTheme()` retargets that meta tag per
theme, but a manifest holds one static value, so it stays on the light accent.

`background_color` paints the launch splash and is deliberately the **dark**
`--bg`, not the light one, even though the no-JS default is light. A manifest
supports no media query, so one of the two audiences sees a mismatch either way;
dark-to-light is the gentler transition, and it costs no runtime machinery.

### Launch screens

`scripts/generate_launch_images.py` generates every asset a *standalone* launch
needs, all from `assets/master-icon.png` on the manifest `background_color`. None
of it affects an ordinary browser tab.

| Platform | What it reads | Without the assets |
| :--- | :--- | :--- |
| Android / Chrome | `background_color` + the largest manifest icon | The full-bleed square icon has no `maskable` variant, so the launcher plates it and the rounded RJ badge picks up a second, mismatched backdrop |
| iOS / Safari | `apple-touch-startup-image` only — **not** `background_color` | A blank frame until first paint, so a dark-theme visitor got a white flash and then a dark site |

The launch images are portrait only. Landscape would double a 17-file set for an
orientation almost nobody starts an installed portfolio in, and a device with no
matching media query falls back to the same blank frame it had before — the set
improves the launches it matches and regresses none of the ones it misses.

Only the one image whose media query matches is ever fetched, and only by iOS, so
the ~764 KB is deploy size rather than visitor bandwidth. The badge is composited
with a feathered alpha ramp: `master-icon.png` is full-bleed on its own faint
gradient, which pasted flat reads as a lighter square, and ramping it away also
roughly halves each file.

Re-run the script after changing `assets/master-icon.png` or `background_color`,
then re-run `npm run build` — the build content-hashes the PNGs and rewrites the
references in `index.html` and `manifest.json`.

`index.html` also carries `mobile-web-app-capable` and its `apple-` counterpart:
Safari needs the legacy name to honour the startup images on older iOS, and Chrome
warns when only the legacy one is present.

### `sw.js`

| Concern | Behaviour |
| :--- | :--- |
| Cache name | `rj-portfolio-<8-char hash>` — **rewritten by the build** from the hash of the precache list plus the worker source |
| Precache | `PRECACHE_URLS` — **rewritten by the build** from what was actually produced. The source file's list is a development placeholder |
| Install | `cache.add` **per URL** via `Promise.allSettled`, not `cache.addAll`: one missing file must not stop the worker installing and leave the visitor with no offline shell |
| Activation | Deletes other `rj-portfolio-*` caches, evicts entries older than 7 days (`sw-cached-time` header), then `clients.claim()` |
| `skipWaiting` | **Not** called on install. Only the update banner's button posts `{type:'SKIP_WAITING'}`, so the asset set is never swapped under a running page |
| Documents | Network-first, cache as fallback. `index.html` names hashed assets, so a stale copy points at a build that no longer exists |
| Other same-origin GETs | Stale-while-revalidate — safe precisely because filenames are content-hashed, so a cached asset can never be the wrong version of itself |
| `/api/*` | Never cached |
| Cross-origin | `ALLOWED_ORIGINS` is **empty**; nothing third-party is fetched any more, and the empty set stops a stray request being cached silently |
| Non-GET, non-http(s) | Passed through / rejected with 400 |

The precache list covers the app shell only: the two entry points, everything
they reach through **static** imports, the stylesheets and the two classic
scripts. Dynamic-import chunks (chat, activity, plexus) are deliberately
excluded — precaching them would undo the lazy loading `main.js` arranges. They
are cached on first use by the runtime strategy.

`main.js` registers the worker on `load`, calls `registration.update()` every
60 s, and renders an update banner when a new worker reaches `installed` while
one is already controlling the page.

---

## Fonts

Self-hosted and subset. `frontend/fonts.css` and `frontend/fonts/` are
**generated by `scripts/vendor_fonts.py` — never hand-edit them.**

| File | Source |
| :--- | :--- |
| `plus-jakarta-sans-latin-153fc85b.woff2` | Google Fonts, latin subset only |
| `plus-jakarta-sans-latin-ext-38e3b8fd.woff2` | Google Fonts, latin-ext subset only |
| `fa-solid-900-subset.woff2` | Font Awesome solid, cut to the `fa-*` classes the source actually uses |
| `fa-brands-400-subset.woff2` | Font Awesome brands, same treatment |
| `sniglet-wordmark-fb37db26.woff2` | Google Fonts, cut to `A-Z` — the `/arcade` wordmark's face and nothing else |

Why: two render-blocking third-party stylesheets (fonts.googleapis.com and
cdnjs) each delayed first paint and were independent single points of failure.
Measured with the CDNs stalling, first contentful paint was 3.2 s against
~250 ms for the site's own assets. Plus Jakarta Sans ships 16 faces across four
subsets; Font Awesome ships ~2000 icons in a 148 KB solid face. Subsetting cuts
the solid face to under 9 KB.

Sniglet is the exception to the "one typeface" rule and is scoped to earn it:
it sets the six letters of the arcade wordmark, so it is subset by glyph rather
than by language — 3.7 KB against 24 KB for the latin subset — and its
`unicode-range` stops at `Z`, so anything outside that falls through to Plus
Jakarta Sans rather than rendering as tofu. The SPA links the same `fonts.css`
and never uses the family, which costs it a rule and no request.

After adding an icon that is not already used anywhere:

```bash
python -m pip install "fonttools[woff]"
python scripts/vendor_fonts.py
```

It needs network access, so it is a maintenance step rather than part of the
build; its output is committed. `index.html` preloads the latin Plus Jakarta
face and the solid Font Awesome face — the build rewrites those preload paths to
the hashed copies esbuild emits.

---

## Vendored libraries

`frontend/vendor/` holds `purify.min.js` (DOMPurify 3.4.14) and `marked.min.js`
(marked 15.0.12), copied verbatim from the npm packages pinned in
`package.json`. They are vendored rather than CDN-loaded because they were the
last third-party origin in the page; with them local, `script-src` is `'self'`
alone.

To update: bump the version in `package.json`, `npm install`, then re-copy:

```bash
cp node_modules/dompurify/dist/purify.min.js frontend/vendor/purify.min.js
cp node_modules/marked/marked.min.js         frontend/vendor/marked.min.js
```

`renderBotHTML()` in `js/chat.js` degrades to escaped plain text if either is
missing, so a failed update is visible but not dangerous.

---

## Static assets

| Path | Notes |
| :--- | :--- |
| `profile-cutout-380.{png,webp}`, `profile-cutout-570.{png,webp}`, `profile-cutout.{png,webp}` | The landing portrait's **front** face — the outdoor shot, background-removed so the page's own gradient and plexus canvas show through the silhouette. Three widths × two formats, from `scripts/generate_profile_cutout.py`, which crops the bust out of a 3024×4032 master; 900 is the 2x of the 450px cap in `styles.css`, so the ladder now covers every width the `sizes` attribute can ask for. PNG rather than JPEG because the fallback has to carry an alpha channel. `profile-cutout-380.webp` is the LCP image: `index.html` preloads it and the build precaches it, and `scripts/tests/build.test.js` asserts those two stay the same file |
| `profile-cutout-back-380.{png,webp}`, `profile-cutout-back.{png,webp}` | The **back** face — the studio shot, which was the only landing portrait until the card learned to flip. Same generator, same shape (both mattes are held to one aspect ratio; see `SHARED_ASPECT`), two widths rather than three because its master is 1254px and 497 is all the bust there is. Nothing preloads it and it carries `fetchpriority="low"`, so it queues behind the LCP — see [The flip card](#the-flip-card) |
| `brush-backdrop.webp` | The painted panel the landing portrait stands in front of, used by `.home-portrait::before` as an *alpha mask* over a solid `--accent-fill` - it carries the shape, the theme carries the colour, so the customiser's accent paints it with nothing to re-tune. **Generated** by `scripts/generate_brush_backdrop.py` from the one photographed swipe in `assets/brush-stroke-master.jpg` - see [The painted panel](#the-painted-panel) |
| `profile-pic-160.{jpg,webp}`, `profile-pic-360.{jpg,webp}`, `profile-pic.{jpeg,webp}` | Three widths × two formats of the un-cut headshot, from `scripts/generate_profile_pics.py`. Only `profile-pic.jpeg` is still referenced — by the JSON-LD `Person` image — since the landing view moved to the cutout above |
| `android-chrome-192x192.png`, `android-chrome-512x512.png` | PWA icons, generated from `assets/master-icon.png` |
| `android-chrome-maskable-512x512.png` | The same badge inset into the maskable safe zone, on the manifest `background_color`. **Generated** by `scripts/generate_launch_images.py` — see [Launch screens](#launch-screens) |
| `launch/launch-<w>x<h>-<dpr>x.png` | 17 portrait `apple-touch-startup-image` bitmaps, one per iOS device resolution. **Generated** by the same script — see [Launch screens](#launch-screens) |
| `apple-touch-icon.png`, `favicon.ico` | iOS and browser icons |
| `social-preview.png`, `ucl-preview.png`, `arcade-preview.png`, `worldcup-preview.png` | The four 1200x630 Open Graph cards, one per shareable page. **Generated** by `scripts/generate_social_previews.py` — see [Open Graph cards](#open-graph-cards). `ucl-preview.png` and `arcade-preview.png` double as the display images for the two tiles in the Apps section |
| `rjasti_resume.pdf` | Downloadable résumé (the doubled extension is the actual filename) |
| `robots.txt` | Allows everything except `/api/`; points at the sitemap |
| `sitemap.xml` | Four URL entries — `/`, `/ucl`, `/arcade` and `/worldcup`, each with its Open Graph card as an image annotation |
| `arcade.html`, `arcade.css` | Standalone games page served at `/arcade` — 2048, Tetris, Flapper, Stack, Snake and Breaker, with the game code in `js/arcade/` and built as its own esbuild entry point. Unlike the two predictors it holds the SPA's line on third-party origins: it links the site's own `fonts.css` for Plus Jakarta Sans and, for the wordmark alone, Sniglet subset to the 26 letters it can set, and draws its icons as inline SVG, so it loads nothing the site does not already serve itself, and its own CSP is `script-src 'self'` with no inline script to hash. Two layouts, switched by `is-playing` on `<body>` from `shell.js`: the launcher scrolls normally, and a running game collapses the page to one viewport with a single play bar so the board takes the rest of the screen. Which game is on screen is the URL fragment, so `/arcade#snake` is a link straight into one and the browser's back button leaves a game rather than the site. Linked from the **Apps** section of the SPA as a tile in `.app-grid`; the game rules are covered by `frontend/tests/arcade.test.js` |
| `worldcup.html` | Standalone 2026 World Cup bracket predictor — a separate page with its own inline script and its own Google Fonts links. Not part of the SPA, in `.prettierignore`, copied verbatim by the build. The tournament is over, so `#worldcup-link` in the header is `display: none`. Served at `/worldcup`, with its own canonical and Open Graph tags — see [Apache configuration](#apache-configuration) |
| `ucl.html` | Standalone 2026/27 Champions League bracket predictor, built on the same pattern: one file, inline `<style>` and `<script>`, its own Google Fonts and Font Awesome links, flags from FlagCDN. Predicts the 36-club league phase table, the knockout play-offs and the bracket through to the final. State lives in `localStorage` under `ucl-predictor-state` and round-trips through a `?s=` share code. The bracket's connector lines are drawn into an SVG overlay from the cards' measured positions, redrawn on resize and when the panel becomes visible — a hidden panel measures zero. Served at `/ucl` — the `.html` never appears in a URL, so the share links `createShareableUrl()` builds from `location.pathname` read as `https://rjasti.com/ucl?s=…`; see [Apache configuration](#apache-configuration). Linked from the **Apps** section of the SPA as a tile in `.app-grid` — `#ucl-link` in the header is a second, hidden entry point kept only as a fallback; covered by `frontend/tests/ucl-bracket.test.js` |

Every generator source lives **outside** `frontend/`, in `assets/` -
`master-icon.png`, the headshot masters, and `brush-stroke-master.jpg` - so the
deploy's `rsync frontend/` never publishes any of them to the web root.

---

## The painted panel

`brush-backdrop.webp` is the block of paint behind the landing portrait. It is
not a picture of paint on the page - it is an **alpha mask**: a flat white
sheet whose alpha channel is opaque where the paint is, transparent where the
page shows through, and part-way between where the paint is thin.
`.home-portrait::before` fills the shape it describes with `var(--accent-fill)`.
That split is what lets the theme customiser recolour the paint. The file never
carries a colour.

**Alpha rather than luminance, and it has to stay that way.** A greyscale file
under `mask-mode: luminance` is the tidier way to write this and it is what
shipped first, but WebKit's CSS mask is an alpha mask - its `mask-mode:
luminance` is flagged partial by browser-compat-data ("does not always have
the expected effect", [webkit.org/b/282530](https://webkit.org/b/282530)), and
there is no `-webkit-mask-mode` to fall back on. A greyscale file with no
alpha channel is opaque everywhere, so Safari masked nothing and iOS drew a
hard-edged rectangle of accent behind the portrait where Android drew the
brush. Carrying the shape in alpha is the one reading every engine agrees on;
keeping the RGB plane flat white means a luminance read still lands on the
same values (luminance x alpha, luminance 1), so the file is correct whichever
mode an engine picks.

It is generated, and re-generating it is the way to change it:

```bash
python3 scripts/generate_brush_backdrop.py
```

The source is `assets/brush-stroke-master.jpg` - one photographed swipe of real
paint on black, which is what the landing view used to show unprocessed. One
swipe is a swipe: at 125% of the portrait's width it ran past the shoulder on
one side and stopped in mid-air on the other, so it read as a smear the
portrait happened to overlap. The script uses that same photograph as a
**brush** instead, laying it down eleven times - upright, rescaled, flipped,
cropped to its dry tail, at varying weights - and compositing lightest-wins.
Every edge in the output is therefore a real dry-brush edge and the interior
variation is real loaded-bristle variation, from a single source image.

The `STROKES` table at the top of the script is the whole design; coordinates
are fractions of the canvas, so the panel re-renders at any resolution and the
three `.home-portrait` width caps inherit the geometry with nothing to re-tune.
The CSS decides only where the panel sits and how big it is.

**The one coupling to know about** is the bottom fade. The portrait in front of
the panel does not end, it dissolves - `.home-portrait-img` carries
`mask-image: linear-gradient(to bottom, #000 68%, transparent 97%)` - so from
68% of its height down the figure is progressively transparent, and any paint
still opaque behind it shows *through* the jacket. Not as a wash: as the
panel's own bristle texture printed across the lapels in olive. The panel's
fade is therefore computed rather than chosen. The script mirrors the four CSS
values it needs (`::before` width and top, the box's aspect ratio, and that 68%
line), derives a fade that finishes just above it, and prints the band on every
run:

```
paint fades 39% -> 66% of the portrait box; the figure starts dissolving at 68%
```

Change the panel's `width` or `top` in `styles.css`, or the portrait's own mask
line, and the mirrors in the script have to move with them - re-run it and read
that line back.

Two encoding notes, because both look like mistakes and are not. The output is
**lossy** WebP: bristle texture is high-frequency noise, so the equivalent
greyscale PNG is 485 KB against 74 KB here, on a layer that paints under the
LCP element. And a lossy mask is normally a bad idea - ringing lifts the black
field off zero, and a mask that is 2/255 everywhere is a wash of accent across
the whole rectangle - but measured at q=80 the far corners come back at a mean
of 0.01-0.12 of 255, so the lift stays on the pixels touching a bristle edge.
Both figures are in the script's own comments; re-measure before lowering the
quality.

---

## The flip card

The landing portrait is a button. Clicking it rotates the card and the studio
shot on the back comes round; clicking again turns it back. There is no hover
glow, no pointer cursor and no glyph in the corner — the affordance is
deliberately absent, so the flip is something a visitor finds rather than
something the landing view advertises.

Three elements, each with one job, because collapsing any two of them breaks
something:

| Element | Owns |
| :--- | :--- |
| `.home-portrait-flip` | the `<button>`: the perspective, and the stacking that lifts the card over the paint panel |
| `.home-portrait-card` | the rotation, and `transform-style: preserve-3d` |
| `.home-portrait-face` | one side, and `backface-visibility: hidden` |

The faces are a layer of their own rather than the `<picture>` elements
themselves because `picture` carries the drop-shadow, and an element with a
`filter` is flattened out of its parent's 3D context — declared together,
`backface-visibility: hidden` is unreliable across engines.

**The paint panel does not rotate.** It is `.home-portrait::before`, a sibling
of the button rather than part of the card, so the figure turns in front of a
wall that stays put. That is also why its `left: 46%` is now a compromise: the
two silhouettes disagree on where the head is by 2.6% of the box width — the
hat's brim pulls the front face left — and the panel can only be centred on
one. The measurement and the reasoning are in the rule's own comment.

Three things about it are load-bearing and easy to undo by accident, so
`frontend/tests/home-portrait.test.js` asserts all three:

1. **The button ships `disabled`**, and `js/home-portrait.js` drops that on
   init. Nothing flips without JS, and a control that is focusable and
   announced but inert is worse than no control. It is the same reasoning as
   the `js-only` theme shuffle beside it, except the portrait itself has to
   keep rendering either way, so it cannot simply be hidden.
2. **`aria-pressed` is the state, not a mirror of it.** The CSS selector that
   rotates the card reads that attribute, so there is one source of truth and
   no class that can fall out of step with what a screen reader is told. Both
   faces are `alt=""` — neither photograph carries information the name beside
   it does not — so `#home-portrait-status` is the only place the change is
   announced, the same pattern as `#home-theme-status`.
3. **The back face stays out of the LCP's way**: not preloaded,
   `fetchpriority="low"`, `loading="lazy"`. The module raises it to `high` on
   the first hover or focus, which is the earliest honest signal that a click
   is coming and the difference between a turn that lands on a photograph and
   one that lands on nothing.

Nothing here animates under `prefers-reduced-motion: reduce`. The global block
in the ACCESSIBILITY & PRINT PREFERENCES region of `styles.css` clamps every
transition to 0.001ms, so the card swaps faces instantly instead of turning —
the right fallback, and it needs no rule of its own.

---

## Open Graph cards

`social-preview.png`, `ucl-preview.png` and `worldcup-preview.png` are the link
previews for `/`, `/ucl` and `/worldcup`. They are **generated**, not drawn:

```bash
python3 scripts/generate_social_previews.py            # all three
python3 scripts/generate_social_previews.py ucl        # just one
```

The source is `scripts/social-previews/` — one HTML file per card over a shared
`card.css`. Headless Chromium renders each at 1200x630 and Pillow trims and
flattens the result. The point of building them as HTML is that they cannot
drift: `card.css` pulls the typeface straight out of `frontend/fonts/`, and
each card's own `<style>` block carries the tokens copied from the page it
advertises — the portfolio card is the light amber/emerald palette down to the
hero's command prompt, the two predictor cards are their own dark grounds.

Two things to know before regenerating:

- The script needs a Chromium or Chrome binary. It searches `CHROME_BIN`, then
  the usual install paths; `--chrome` points it at one directly.
- The portfolio card's terminal panel resolves the site's own monospace stack,
  so the browser's fallback decides it. The checked-in PNG came from Liberation
  Mono.

The bracket and group-table motifs are deliberately abstract — a bracket
predictor should not ship a prediction in its own link preview.

`.htaccess` serves `.png` as `immutable` for a year, so **replacing** a card
under the same filename leaves stale copies in intermediary caches, and the
social networks cache their own scrape regardless. After changing one, re-scrape
it in the platform's debugger (Facebook Sharing Debugger, LinkedIn Post
Inspector, X Card Validator).

---

## Apache configuration

`frontend/.htaccess` ships with the site:

- **Canonical URLs** — `mod_rewrite` gives every page one address. A request
  for `/ucl.html` is `301`ed to `/ucl` (and `/index.html` to `/`), a request
  on `www.` is `301`ed to the apex, and `/ucl` is then rewritten *internally*
  to `ucl.html` so the address bar keeps the clean form. The redirect matches
  on `THE_REQUEST` — the raw request line — so it sees only what the browser
  asked for and never the internal rewrite, which is what keeps it from
  looping. mod_rewrite re-appends the query string, so a `?s=` share code
  survives. The internal rewrite is guarded on the `.html` file existing, so
  `/api` and every real asset fall straight through.
- **Compression** — gzip (`mod_deflate`) and Brotli (`mod_brotli`) for text types.
- **Expiry** — images and fonts one year; CSS/JS one hour; HTML zero.
- **Security headers** — `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Content-Security-Policy: frame-ancestors 'self'`.
- **Cache-Control** — fingerprintable media `immutable` for a year; plain
  `.css`/`.js` revalidating hourly; **content-hashed** `-XXXXXXXX.css|js`
  `immutable` for a year (declared after the general rule so it wins);
  `sw.js` and HTML `no-store`.

The hashed-filename rule is the payoff for the build: a returning visitor
previously revalidated ~30 files an hour because nothing could tell a changed
file from an unchanged one.

---

## The build

`npm run build` → `scripts/build.mjs` → `dist/`.

| Step | Detail |
| :--- | :--- |
| JS entries | `js/main.js` and `js/auth-ui.js`, bundled with `splitting: true`, ESM, minified, sourcemapped, `es2022`, into `dist/assets/[name]-[hash]` |
| Code splitting | Keeps `chat.js`, `activity.js` and `three-bg.js` as lazily-loaded chunks rather than folding them into the entry |
| `app-logic.js` | Built separately as an **IIFE** (it is a classic script). Its `module.exports` block, present for the Node test runner, is silenced via `logOverride` |
| `theme-bootstrap.js` | Built separately as an IIFE — it runs before first paint as a plain script |
| `js/arcade/shell.js` | Built separately as an ESM entry for `/arcade`. Kept out of the `splitting` group on purpose: it shares no module with the SPA, and the service worker's shell list is derived from the SPA's graph |
| CSS | `styles.css`, `auth-modal.css`, `fonts.css`, `arcade.css` bundled and minified, font and image assets emitted as hashed file assets with `url()` references rewritten |
| Static | Copied by extension allowlist; `tests/` skipped; `fonts/` and CSS assets skipped (the hashed copies come from the CSS build); vendor scripts, `.htaccess`, `worldcup.html`, `ucl.html` and `arcade.html` copied explicitly |
| `index.html` | Asset `src`/`href` attributes rewritten to hashed paths. **Inline `<script>` bodies are never touched.** Throws if no reference was rewritten |
| `sw.js` | `CACHE_NAME` and `PRECACHE_URLS` rewritten from what was actually built. Throws if neither substitution matched |

Two invariants the script protects:

1. `frontend/` stays runnable on its own — the build only reads from it.
2. Inline script bodies are byte-identical in `dist/`, so the CSP hashes still
   match. `check_csp_hashes.py` verifies the built page too.

`dist/` is gitignored; CI builds it on every run (in the quality gate **and**
again in the deploy job, so a build failure is caught before anything is
touched).

---

## Accessibility

- Skip link to `#main-content` as the first focusable element.
- `<noscript>` banner when JavaScript is unavailable.
- Focus trapping and focus restoration for every dialog (`js/modal.js`), with a
  reference-counted body scroll lock so nested opens behave.
- `aria-current="page"` on the active nav link; `role="status"` on toasts;
  `role="alert"` on the update banner; screen-reader announcements for streamed
  chat replies.
- The activity timeline is built from real focusable elements rather than a
  canvas, precisely so each bar is a labelled filter control reachable by
  keyboard and assistive tech.
- `prefers-reduced-motion` is honoured by every animated surface, and toggling it
  mid-session tears down the running layer.
- The command palette is a labelled `role="dialog"` with `aria-modal`.

---

## Local development

```bash
python -m http.server 8080 --directory frontend
```

Serve `frontend/` as the **document root**, not the repository root: `sw.js` is
registered at `/sw.js` and the manifest declares `start_url: "/"`.

On `localhost` the API base resolves to `http://localhost:8000` automatically
and falls back to production if the local health check fails, so no edit is
needed to develop against either.

Service-worker caching can mask changes during development. Use a hard reload,
or "Update on reload" in the browser's Application panel.

`http.server` does not read `.htaccess`, so the extensionless paths do not
exist locally: open the standalone pages at `/ucl.html`,
`/arcade.html` and `/worldcup.html` while developing. The links point at
`/ucl`, `/arcade` and `/worldcup` and will 404 on
the local server — that is expected, and the only part of the URL change that
cannot be exercised without Apache.

To exercise the built output instead:

```bash
npm run build && python -m http.server 8080 --directory dist
```
