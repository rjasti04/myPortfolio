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
   `'self'` plus two pinned inline hashes.
3. **`frontend/` is the source of truth and stays runnable standalone.** The
   build reads from it and never writes back.
4. **Degrade, don't fail.** Every backend-dependent feature is wrapped so an
   unreachable API is a quiet no-op. `<noscript>` gets a banner; motion respects
   `prefers-reduced-motion`; markdown rendering falls back to escaped text if
   marked or DOMPurify is missing.

---

## `index.html`

One page, ~1570 lines. It contains the DOM for **all six sections**, which are
shown and hidden by class rather than fetched:

| Section id | Content |
| :--- | :--- |
| `about` | Hero, profile, stat counters, skills carousel, the interactive command prompt |
| `resume` | Experience timeline, downloadable résumé |
| `hobbies` | Personal interests |
| `activity` | The session activity dashboard (live stream, timeline strip, path funnel, pipeline DAG) |
| `contact` | Contact form, prompt chips, copy-email control |
| `ai` | Full-page AI chat with a conversation sidebar |

`about` carries `class="active"` in the markup so the first paint is correct
before any JavaScript runs.

**Head, in order:** meta CSP → viewport/robots/author/theme-color → Open Graph
and Twitter cards → canonical → JSON-LD `Person` structured data → icons and
manifest → `js-enabled` marker script → preloads (`profile-pic-160.webp`,
`styles.css`) → stylesheets (`styles.css`, `auth-modal.css`, `fonts.css`) →
two font preloads.

**Body tail, in order:**

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
                  'sha256-xQj/yp5+mHgSmC/IFw1oam/lHOJe6+eJ6Zlhzs7vQPE=';
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

### The two pinned inline scripts

1. **`document.documentElement.classList.add("js-enabled")`** — the CSS hook
   that reveals JS-only affordances.
2. **The theme bootstrap** — reads `localStorage.theme`, falls back to
   `prefers-color-scheme`, and applies `.dark-theme` before first paint.

**Editing either — even reindenting — invalidates its hash, and the browser then
refuses to run it silently.** For the theme bootstrap the only symptom is the
flash-of-wrong-theme it exists to prevent, with nothing in the console.

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
accessibility & print · hobbies · section router & view transitions · chat
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

| Storage key | Holds |
| :--- | :--- |
| `theme` | `"dark"` or `"light"` — an explicit user choice |
| `rj_theme_palette` | `{light: {...}, dark: {...}}` custom accent palette |

---

## Progressive Web App

### `manifest.json`

`name`, `short_name: "RJ"`, `start_url: "/"`, `display: standalone`,
`background_color: #0a0e14`, `theme_color: #05a8e6`, `orientation: any`, and the
two `android-chrome-*` icons.

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

Why: two render-blocking third-party stylesheets (fonts.googleapis.com and
cdnjs) each delayed first paint and were independent single points of failure.
Measured with the CDNs stalling, first contentful paint was 3.2 s against
~250 ms for the site's own assets. Plus Jakarta Sans ships 16 faces across four
subsets; Font Awesome ships ~2000 icons in a 148 KB solid face. Subsetting cuts
the solid face to under 9 KB.

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

`frontend/vendor/` holds `purify.min.js` (DOMPurify 3.2.5) and `marked.min.js`
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
| `profile-pic-160.{jpg,webp}`, `profile-pic-360.{jpg,webp}`, `profile-pic.{jpeg,webp}` | Three widths × two formats, from `scripts/generate_profile_pics.py` |
| `android-chrome-192x192.png`, `android-chrome-512x512.png` | PWA icons, generated from `assets/master-icon.png` |
| `apple-touch-icon.png`, `favicon.ico` | iOS and browser icons |
| `social-preview.png` | Open Graph / Twitter card image |
| `rajeev_jasti.pdf.pdf` | Downloadable résumé (the doubled extension is the actual filename) |
| `robots.txt` | Allows everything except `/api/`; points at the sitemap |
| `sitemap.xml` | Single URL entry with an image annotation |
| `worldcup.html` | Standalone 2026 World Cup bracket predictor — a separate page with its own inline script and its own Google Fonts links. Not part of the SPA, in `.prettierignore`, copied verbatim by the build. The tournament is over, so `#worldcup-link` in the header is `display: none` |
| `ucl.html` | Standalone 2026/27 Champions League bracket predictor, built on the same pattern: one file, inline `<style>` and `<script>`, its own Google Fonts and Font Awesome links, flags from FlagCDN. Predicts the 36-club league phase table, the knockout play-offs and the bracket through to the final. State lives in `localStorage` under `ucl-predictor-state` and round-trips through a `?s=` share code. Linked from the header as `#ucl-link`; covered by `frontend/tests/ucl-bracket.test.js` |

`assets/master-icon.png` lives **outside** `frontend/` deliberately, so the
deploy's `rsync` never publishes it to the web root.

---

## Apache configuration

`frontend/.htaccess` ships with the site:

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
| CSS | `styles.css`, `auth-modal.css`, `fonts.css` bundled and minified, `.woff2` emitted as hashed file assets with `url()` references rewritten |
| Static | Copied by extension allowlist; `tests/` skipped; `fonts/` skipped (the hashed copies come from the CSS build); vendor scripts, `.htaccess`, `worldcup.html` and `ucl.html` copied explicitly |
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

To exercise the built output instead:

```bash
npm run build && python -m http.server 8080 --directory dist
```
