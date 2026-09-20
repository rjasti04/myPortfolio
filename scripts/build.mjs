#!/usr/bin/env node
/**
 * Produces an optimised `dist/` from `frontend/`.
 *
 * The repository had no build step at all: the deploy rsynced source verbatim,
 * so the site shipped unminified CSS and ~30 separate ES module requests, and
 * because filenames were not content-hashed, .htaccess had to hold CSS and JS
 * at `max-age=3600, must-revalidate` - every returning visitor revalidating
 * every file, every hour.
 *
 * Two rules shape this script:
 *
 *  1. `frontend/` stays the source of truth and stays runnable on its own.
 *     `python -m http.server --directory frontend` must keep working, so the
 *     build only ever reads from it. Nothing here writes back.
 *
 *  2. Inline <script> bodies are never touched. index.html pins them by sha256
 *     in its CSP, so reformatting one silently stops it running. The build
 *     rewrites `src`/`href` attributes only, and verifies the hashes afterwards.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "frontend");
const OUT = join(ROOT, "dist");

/** Files copied verbatim. Everything else is either built or deliberately skipped. */
const COPY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".ico", ".svg", ".pdf",
  ".json", ".txt", ".xml", ".woff", ".woff2",
]);

/** Binary/static files whose URLs can safely carry content hashes. */
const HASHED_COPY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".ico", ".svg", ".pdf",
]);

/** Never shipped: tests are excluded from the deploy already, .htaccess is copied explicitly. */
const SKIP_DIRS = new Set(["tests"]);

/* Size budgets, in KiB, over the minified code the browser actually executes
   and parses on the critical path.

   CI had thirteen frontend gates and not one of them was about weight: lint,
   tests, CSP hashes, doc counts, resume, audit. The build was already
   computing every number a budget needs - each esbuild call passes
   `metafile: true` - and printing a single total to a log nobody reads.

   Code only. Images, fonts and sourcemaps are excluded deliberately: they are
   content rather than critical-path bytes, and a budget that fires whenever a
   photo is added is a budget people learn to raise reflexively. The ceilings
   sit roughly 20% above the measured baseline, so ordinary work fits and a
   dependency landing in the bundle does not. Raise them on purpose, in a
   commit that says why - that argument is the whole point of the gate.

   Raised 300/240 -> 305/250 for the /cron and /crypto main-content redesign:
   the two-column workspaces, the cron field-map strip, the encoder transform
   rail and the empty states are new UI, not a dependency, and both stylesheets
   were already trimmed of the selectors the redesign orphaned. The standing
   fat is elsewhere: arcade.css, cron.css and crypto.css each carry their own
   copy of the same app chrome (header, brand, mode tabs, action buttons,
   footer and their responsive rules), roughly 10 KiB of triplication that a
   shared chrome stylesheet would reclaim. That is its own change.

   Raised 305/250 -> 355/265 for /json, the sixth standalone app, measured at
   46.2 KiB of JS and 16.5 KiB of CSS. The JS cost is six hand-written parsers
   and emitters, not a dependency: a tolerant JSON scanner with a repair log,
   a JSONPath engine whose filter expressions are tokenised and walked rather
   than eval'd (the page ships no 'unsafe-eval', so there was no library
   option), a YAML emitter and subset parser, a CSV reader/writer, a
   TypeScript interface inferencer and a lazy tree renderer. It is the largest
   app on the shelf and also the one that does the most: /cron is 28.2 KiB for
   two parsers, this is 46.2 KiB for six.

   The CSS ceiling moves less than the JS one because json.css came in under
   estimate. It is a fourth copy of the app chrome described above, which
   makes that shared-stylesheet reclaim worth more than it was - still its own
   change, and still the first place to look before raising these again.

   Raised 355/265 -> 390/285 for /diff, the seventh standalone app, measured
   at 29.3 KiB of JS and 14.1 KiB of CSS. The JS is Myers' O(ND) algorithm in
   its linear-space divide-and-conquer form, a histogram fallback for the case
   where Myers' edit distance explodes, a token-level refiner that reuses the
   same engine one scale down, a unified-patch writer and parser, a generic
   syntax lexer and the renderer. No dependency: jsdiff was considered and
   rejected at ~12 KiB, a third vendored library to audit, and the loss of the
   written-from-scratch claim the rest of the Dev Tools shelf makes.

   diff.css was a third copy of the app chrome, and that extraction has since
   been done: app-chrome.css is emitted as its own asset and linked by
   /crypto, /json and /diff. It reclaimed 3.0 KiB - less than the ~10 KiB
   guessed here before anyone measured it, because only three of the apps were
   ever really copies. /arcade never wore this chrome (its masthead is a
   different component) and /cron only looks like it does: it breaks to two
   tiers at 860px rather than 960px and to its smallest tier at 480px rather
   than 430px, so adopting the shared file would move two of its breakpoints.
   Both stay out, deliberately. The real win was removing three hand-synced
   copies of a 200-line block, not the bytes. */
/* CSS raised 285 -> 288 for the Apps category filter, the collapsible
   Experience groups and the section ledes. The reclaim this note asks for
   first was done before raising: `.act-fam` and the new `.app-filter-chip`
   were declaration-for-declaration identical apart from one transition
   duration, and the Experience expand-all control was about to become a third
   copy. All three now share one filter-pill rule in the SECTION TITLES & CARD
   PRIMITIVES region, which gave back 1.0 KiB of the 1.5 KiB the features
   cost. The remaining 0.5 KiB is new surface, not duplication.

   Worth knowing for whoever raises this next: the ceiling was already at 99%
   before that work, so there was never 1.5 KiB to spend. The next reclaim of
   this kind is /cron and /arcade, both of which sit outside app-chrome.css
   deliberately (see above) - so the one after that is probably a real audit of
   the ACTIVITY and AI PAGE regions, which are the two largest by a wide
   margin. */
/* CSS lowered 292 -> 288, back to where it sat before the #home schematic
   backdrop. That raise bought room for the coordinate grid, the sheet rulers
   and the plan's stroke weights; the backdrop has now been removed along with
   the animated plexus, so the room it was given goes back rather than becoming
   silent headroom for the next feature.

   The note above still holds and its advice is unchanged: the reclaim it
   points at - a real audit of the ACTIVITY and AI PAGE regions, the two
   largest by a wide margin - has still not been done, and is the right next
   move for whoever needs room. */
/* CSS raised 288 -> 291 for the landing hero's glass frame. 288 was not 99%
   this time, it was 100.0% exactly - there was literally nothing to spend, so
   the raise is the whole of the room.

   What it bought, measured: 2.2 KiB. Five theme tokens in both themes, the
   frame rule itself, the masked rim pseudo-element, a re-derived portrait
   height bound, and four blocks the frame owes the rest of the system -
   forced-colors, prefers-contrast, print and the @supports backdrop-filter
   fallback. There is no new markup and no new JavaScript; the change is CSS
   and one media query around the paint panel, which is unchanged and now
   paints below 901px only.

   Trimmed before raising, which is the order this file asks for, though the
   reclaim was small: the specular sheen is a background LAYER on the frame
   rather than a second pseudo-element, and the rim and glow are built out of
   --accent-fill/--accent-soft/--accent-mild instead of six color-mix() calls.
   Together 0.4 KiB - and the tokens are the better code regardless, since a
   custom palette now reaches them through the ramp.

   The advice in the two notes above is unchanged and is now two raises old:
   nobody has audited the ACTIVITY and AI PAGE regions, which are still the
   two largest by a wide margin, and that is still the right move for whoever
   needs room next. 291 leaves ~0.8 KiB, which is not room - it is the margin
   that keeps a one-line fix from failing the build. */
const BUDGETS_KIB = { js: 390, css: 291 };

const hash8 = (contents) =>
  createHash("sha256").update(contents).digest("base64url").slice(0, 8);

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walk(join(dir, entry.name), base)));
    } else {
      out.push(relative(base, join(dir, entry.name)).replace(/\\/g, "/"));
    }
  }
  return out;
}

function hashedPath(rel, contents) {
  const extension = extname(rel);
  const withoutExtension = rel.slice(0, -extension.length);
  return `${withoutExtension}-${hash8(contents)}${extension}`;
}

/**
 * Drop HTML comments from a page that ships, leaving `frontend/` untouched.
 *
 * index.html carries ~20 KB of architectural commentary - why the portrait is
 * a flip card, why the app grid uses auto-fill, why the router resolves a
 * fragment the way it does. That is deliberate: the repo is itself a
 * portfolio piece and those notes are part of it. But index.html is also the
 * render-blocking document, and a visitor downloads and parses every byte of
 * prose written for a reader of the source. Stripping here keeps both: the
 * commentary stays in the source of truth, `dist/` ships without it.
 *
 * Everything inside <script>, <style>, <pre> and <textarea> is passed through
 * byte for byte. That is rule 2 at the top of this file and it is load
 * bearing: index.html pins three inline scripts by sha256 in its CSP, so
 * touching one stops it running. `scripts/check_csp_hashes.py` runs against
 * dist/ and is what proves this held.
 *
 * Conditional comments (`<!--[if ...]>`) are kept - they are markup, not
 * commentary - as is anything starting `<!--!`, the usual "preserve me"
 * convention for licence headers.
 */
function stripHtmlComments(text) {
  const PROTECTED = /<(script|style|pre|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  const COMMENT = /<!--(?!\[if|!)[\s\S]*?-->/g;

  // Comment removal leaves behind the blank lines the comment sat between, so
  // each cleaned slice is collapsed too - but ONLY the cleaned slices. Running
  // that over the whole result would reach inside the protected blocks and
  // reflow the inline scripts, which is exactly what their sha256 pins forbid.
  const clean = (slice) =>
    slice.replace(COMMENT, "").replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n");

  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(PROTECTED)) {
    result += clean(text.slice(cursor, match.index));
    result += match[0];
    cursor = match.index + match[0].length;
  }
  return result + clean(text.slice(cursor));
}

function rewriteReferences(text, rewrites) {
  let out = text;
  for (const [from, to] of rewrites) {
    out = out.split(`https://rjasti.com/${from}`).join(`https://rjasti.com/${to}`);
    out = out.split(`./${from}`).join(to);
    out = out.split(`/${from}`).join(`/${to}`);
    out = out.split(from).join(to);
  }
  return out;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const rewrites = new Map(); // source path -> hashed output path

  // --- JavaScript ----------------------------------------------------------
  // Bundled, so the ~30 module requests collapse into an entry plus the chunks
  // the dynamic imports in main.js genuinely need. `splitting` keeps chat.js,
  // activity.js and three-bg.js lazily loaded rather than folding them into the
  // entry and undoing the work main.js does to defer them.
  const jsResult = await esbuild.build({
    entryPoints: {
      main: join(SRC, "js/main.js"),
      "auth-ui": join(SRC, "js/auth-ui.js"),
    },
    bundle: true,
    splitting: true,
    format: "esm",
    minify: true,
    sourcemap: true,
    target: ["es2022"],
    outdir: join(OUT, "assets"),
    entryNames: "[name]-[hash]",
    chunkNames: "chunk-[hash]",
    assetNames: "[name]-[hash]",
    metafile: true,
    logLevel: "warning",
  });

  const jsOutputs = jsResult.metafile.outputs;
  for (const [outPath, meta] of Object.entries(jsOutputs)) {
    if (!meta.entryPoint) continue;
    const src = relative(SRC, join(ROOT, meta.entryPoint));
    // Only the two real entry points get referenced from index.html. Everything
    // else with an `entryPoint` here is a dynamic-import chunk, which the
    // browser resolves through the entry.
    if (src === "js/main.js" || src === "js/auth-ui.js") {
      rewrites.set(src, relative(OUT, join(ROOT, outPath)));
    }
  }

  // The app shell is the two entries plus everything they reach through
  // *static* imports. Dynamic-import chunks - chat, activity, three-bg - are
  // deliberately excluded: precaching those is exactly what the old
  // hand-maintained 40-entry list did, and it undid the lazy-loading main.js
  // goes to some trouble to arrange. They still get cached on first use by the
  // worker's runtime strategy.
  const shellChunks = new Set();
  const followStatic = (outPath) => {
    if (shellChunks.has(outPath)) return;
    shellChunks.add(outPath);
    for (const imp of jsOutputs[outPath]?.imports ?? []) {
      if (imp.kind === "import-statement" && jsOutputs[imp.path]) followStatic(imp.path);
    }
  };
  for (const [outPath, meta] of Object.entries(jsOutputs)) {
    const src = meta.entryPoint && relative(SRC, join(ROOT, meta.entryPoint));
    if (src === "js/main.js" || src === "js/auth-ui.js") followStatic(outPath);
  }

  // app-logic.js is a classic script that assigns window.AppLogic, not a
  // module. It is loaded with `defer` before the module entries and has to stay
  // a separate, non-module file.
  const appLogic = await esbuild.build({
    entryPoints: [join(SRC, "js/app-logic.js")],
    bundle: true, minify: true, sourcemap: true, format: "iife",
    outdir: join(OUT, "assets"), entryNames: "[name]-[hash]", metafile: true, logLevel: "warning",
    // app-logic.js carries a `module.exports` block so the Node test runner can
    // require it. That is intentional, and harmless once wrapped in an IIFE.
    logOverride: { "commonjs-variable-in-esm": "silent" },
  });
  for (const [outPath, meta] of Object.entries(appLogic.metafile.outputs)) {
    if (meta.entryPoint) rewrites.set("js/app-logic.js", relative(OUT, join(ROOT, outPath)));
  }

  // theme-bootstrap.js runs before first paint and is loaded as a plain script.
  const bootstrap = await esbuild.build({
    entryPoints: [join(SRC, "js/theme-bootstrap.js")],
    bundle: true, minify: true, format: "iife",
    outdir: join(OUT, "assets"), entryNames: "[name]-[hash]", metafile: true, logLevel: "warning",
  });
  for (const [outPath, meta] of Object.entries(bootstrap.metafile.outputs)) {
    if (meta.entryPoint) rewrites.set("js/theme-bootstrap.js", relative(OUT, join(ROOT, outPath)));
  }

  // The arcade at /arcade is a separate page with a separate entry point, and
  // it is built on its own rather than joining the `splitting` group above. It
  // shares no module with the SPA, so bundling them together could only produce
  // a shared chunk that each page half-uses - and it would put game code inside
  // the portfolio's dependency graph, which is where the service worker derives
  // its shell list from.
  const arcade = await esbuild.build({
    entryPoints: [join(SRC, "js/arcade/shell.js")],
    bundle: true, minify: true, sourcemap: true, format: "esm", target: ["es2022"],
    outdir: join(OUT, "assets"), entryNames: "arcade-[hash]", metafile: true, logLevel: "warning",
  });
  for (const [outPath, meta] of Object.entries(arcade.metafile.outputs)) {
    if (outPath.endsWith(".map")) continue;
    if (meta.entryPoint) {
      rewrites.set("js/arcade/shell.js", relative(OUT, join(ROOT, outPath)).replace(/\\/g, "/"));
    }
  }

  // The logic inspector at /cron is a separate standalone page with its own entry.
  const cron = await esbuild.build({
    entryPoints: [join(SRC, "js/cron/cron-main.js")],
    bundle: true, minify: true, sourcemap: true, format: "esm", target: ["es2022"],
    outdir: join(OUT, "assets"), entryNames: "cron-[hash]", metafile: true, logLevel: "warning",
  });
  for (const [outPath, meta] of Object.entries(cron.metafile.outputs)) {
    if (outPath.endsWith(".map")) continue;
    if (meta.entryPoint) {
      rewrites.set("js/cron/cron-main.js", relative(OUT, join(ROOT, outPath)).replace(/\\/g, "/"));
    }
  }

  // The crypto & encoders workbench at /crypto is a separate standalone page with its own entry.
  const cryptoApp = await esbuild.build({
    entryPoints: [join(SRC, "js/crypto/crypto-main.js")],
    bundle: true, minify: true, sourcemap: true, format: "esm", target: ["es2022"],
    outdir: join(OUT, "assets"), entryNames: "crypto-[hash]", metafile: true, logLevel: "warning",
  });
  for (const [outPath, meta] of Object.entries(cryptoApp.metafile.outputs)) {
    if (outPath.endsWith(".map")) continue;
    if (meta.entryPoint) {
      rewrites.set("js/crypto/crypto-main.js", relative(OUT, join(ROOT, outPath)).replace(/\\/g, "/"));
    }
  }

  // The JSON workbench at /json is a separate standalone page with its own entry.
  const jsonApp = await esbuild.build({
    entryPoints: [join(SRC, "js/json/json-main.js")],
    bundle: true, minify: true, sourcemap: true, format: "esm", target: ["es2022"],
    outdir: join(OUT, "assets"), entryNames: "json-[hash]", metafile: true, logLevel: "warning",
  });
  for (const [outPath, meta] of Object.entries(jsonApp.metafile.outputs)) {
    if (outPath.endsWith(".map")) continue;
    if (meta.entryPoint) {
      rewrites.set("js/json/json-main.js", relative(OUT, join(ROOT, outPath)).replace(/\\/g, "/"));
    }
  }

  // The code difference checker at /diff is a separate standalone page with its own entry.
  const diffApp = await esbuild.build({
    entryPoints: [join(SRC, "js/diff/diff-main.js")],
    bundle: true, minify: true, sourcemap: true, format: "esm", target: ["es2022"],
    outdir: join(OUT, "assets"), entryNames: "diff-[hash]", metafile: true, logLevel: "warning",
  });
  for (const [outPath, meta] of Object.entries(diffApp.metafile.outputs)) {
    if (outPath.endsWith(".map")) continue;
    if (meta.entryPoint) {
      rewrites.set("js/diff/diff-main.js", relative(OUT, join(ROOT, outPath)).replace(/\\/g, "/"));
    }
  }

  // --- CSS -----------------------------------------------------------------
  const cssAssets = new Set();
  for (const css of ["styles.css", "auth-modal.css", "fonts.css", "app-chrome.css", "arcade.css", "cron.css", "crypto.css", "json.css", "diff.css"]) {
    const result = await esbuild.build({
      entryPoints: [join(SRC, css)],
      bundle: true, minify: true, sourcemap: true,
      outdir: join(OUT, "assets"), entryNames: "[name]-[hash]",
      metafile: true, logLevel: "warning",
      loader: {
        ".woff2": "file",
        ".woff": "file",
        ".png": "file",
        ".jpg": "file",
        ".jpeg": "file",
        ".webp": "file",
        ".svg": "file",
        ".ico": "file",
      },
      assetNames: "[name]-[hash]",
    });
    for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
      if (outPath.endsWith(".map")) continue;
      if (meta.entryPoint) {
        rewrites.set(css, relative(OUT, join(ROOT, outPath)).replace(/\\/g, "/"));
        continue;
      }
      // Fonts and assets referenced via url() in CSS are hashed and emitted
      // alongside the stylesheet, and esbuild rewrites the url() references to
      // match. index.html preloads two of them by their source path, so those
      // have to be rewritten too - a preload pointing at the un-hashed copy
      // fetches the same font a second time and logs "preloaded but not used".
      for (const input of Object.keys(meta.inputs ?? {})) {
        const relInput = relative(SRC, join(ROOT, input)).replace(/\\/g, "/");
        cssAssets.add(relInput);
        rewrites.set(relInput, relative(OUT, join(ROOT, outPath)).replace(/\\/g, "/"));
      }
    }
  }

  // --- Static assets -------------------------------------------------------
  const copied = [];
  for (const rel of await walk(SRC)) {
    const ext = rel.slice(rel.lastIndexOf("."));
    if (!COPY_EXTENSIONS.has(ext)) continue;
    // Fonts and CSS-referenced assets ship as the hashed copies esbuild emitted next to stylesheets.
    const normalizedRel = rel.replace(/\\/g, "/");
    if (normalizedRel.startsWith("fonts/") || cssAssets.has(normalizedRel)) continue;

    const source = join(SRC, rel);
    const contents = await readFile(source);
    const outputRel = HASHED_COPY_EXTENSIONS.has(ext) ? hashedPath(rel, contents) : rel;
    const dest = join(OUT, outputRel);
    await mkdir(dirname(dest), { recursive: true });
    await cp(source, dest);
    copied.push(outputRel);

    if (outputRel !== rel) rewrites.set(rel, outputRel);
  }
  // Vendored third-party scripts, copied verbatim: they are already minified
  // and their filenames are referenced from index.html unchanged.
  for (const rel of ["vendor/purify.min.js", "vendor/marked.min.js"]) {
    await mkdir(dirname(join(OUT, rel)), { recursive: true });
    await cp(join(SRC, rel), join(OUT, rel));
    copied.push(rel);
  }

  // --- Text references -----------------------------------------------------
  // Rewrite every HTML page that ships, not just index.html. This is required
  // because hashed image/PDF URLs can be referenced from the shareable pages.
  const textFiles = [
    "index.html",
    "manifest.json",
    ...(await walk(SRC)).filter((rel) => rel.endsWith(".html") && rel !== "index.html"),
  ].filter((rel, i, all) => all.indexOf(rel) === i && existsSync(join(SRC, rel)));

  for (const rel of textFiles) {
    let text = await readFile(join(SRC, rel), "utf8");
    const before = text;
    text = rewriteReferences(text, rewrites);
    if (rel === "index.html") {
      // The module entries are hashed, so the browser can hold them forever.
      text = text.replace(
        /<link rel="preload" href="(assets\/styles-[^"]+\.css)" as="style" \/>/,
        '<link rel="preload" href="$1" as="style" />'
      );
      if (text === before) throw new Error("index.html: no asset references were rewritten");
    }
    if (rel.endsWith(".html")) text = stripHtmlComments(text);
    await writeFile(join(OUT, rel), text);
  }

  for (const extra of [".htaccess"]) {
    if (existsSync(join(SRC, extra))) {
      await cp(join(SRC, extra), join(OUT, extra));
      copied.push(extra);
    }
  }

  // --- Service worker ------------------------------------------------------
  // Copied assets are content-hashed now, so a precache entry for one cannot be
  // written as a literal path - it has to be looked up. Throws rather than
  // returning undefined: a bad entry is otherwise invisible (see the check
  // below).
  const shellUrl = (rel) => {
    const out = rewrites.get(rel);
    if (!out) throw new Error(`sw.js: no build output for precache entry '${rel}'`);
    return `/${out}`;
  };

  // The precache list is generated from what was actually built, rather than
  // hand-maintained. The old list named 40 files by hand, which both defeated
  // the lazy-loading in main.js and made a single renamed file able to fail
  // `cache.addAll` and stop the worker installing at all.
  const shell = [
    "/",
    "/index.html",
    // Entry points, their static chunks, the stylesheets, and the two classic
    // scripts that run before them.
    ...[...shellChunks].map((p) => `/${relative(OUT, join(ROOT, p))}`),
    ...["js/app-logic.js", "js/theme-bootstrap.js", "styles.css", "auth-modal.css", "fonts.css"]
      .map((k) => rewrites.get(k))
      .filter(Boolean)
      .map((p) => `/${p}`),
    "/vendor/purify.min.js",
    "/vendor/marked.min.js",
    "/manifest.json",
    // The LCP images, and the only hashed static assets in the shell. These are
    // the landing portrait's two faces, and each has to stay the width
    // index.html preloads for its own side of the 901px boundary - precaching
    // a width the page never requests costs the install a fetch and still
    // leaves the real LCP image cold. Two entries rather than one because the
    // card rests on the front face below that boundary and on the back face
    // above it, so an offline desktop and an offline phone open on different
    // photographs.
    shellUrl("profile-cutout-380.webp"),
    shellUrl("profile-cutout-back-380.webp"),
  ].filter((p, i, all) => !p.endsWith(".map") && all.indexOf(p) === i);

  // A precache URL with no file behind it is silent in production: the worker
  // adds each entry separately under Promise.allSettled specifically so one
  // 404 cannot fail the install, which also means one 404 reports nothing and
  // the shell just quietly loses a file. Fail the build instead.
  for (const url of shell) {
    if (url === "/") continue;
    if (!existsSync(join(OUT, url.slice(1)))) {
      throw new Error(`sw.js: precache URL '${url}' has no matching file in dist/`);
    }
  }

  const swSource = await readFile(join(SRC, "sw.js"), "utf8");
  // Version the worker from the bytes of every generated shipped file. This
  // means a change to an un-hashed metadata file or vendored script bumps the
  // worker even when the precache URL list itself is unchanged.
  const shippedFiles = (await walk(OUT))
    .filter((rel) => rel !== "sw.js")
    .sort();
  const shippedFingerprints = [];
  for (const rel of shippedFiles) {
    const contents = await readFile(join(OUT, rel));
    shippedFingerprints.push(`${rel}:${hash8(contents)}`);
  }
  const version = hash8(`${swSource}|${shippedFingerprints.join("|")}`).toLowerCase();

  const sw = swSource
    .replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'rj-portfolio-${version}';`)
    .replace(
      /const PRECACHE_URLS = \[[\s\S]*?\];/,
      `const PRECACHE_URLS = ${JSON.stringify(shell, null, 2)};`
    );
  if (sw === swSource) throw new Error("sw.js: CACHE_NAME or PRECACHE_URLS was not rewritten");
  await writeFile(join(OUT, "sw.js"), sw);

  // --- Report --------------------------------------------------------------
  const sizes = async (dir) => {
    let total = 0;
    for (const rel of await walk(dir)) total += (await stat(join(dir, rel))).size;
    return total;
  };
  console.log("Built dist/");
  for (const [from, to] of rewrites) console.log(`  ${from.padEnd(24)} -> ${to}`);
  console.log(`  ${copied.length} static files copied`);
  console.log(`  precache entries: ${shell.length} (was 40 hand-maintained)`);
  console.log(`  dist total: ${((await sizes(OUT)) / 1024 / 1024).toFixed(2)} MB`);

  // --- Budget --------------------------------------------------------------
  const assets = join(OUT, "assets");
  const byExtension = async (extension) => {
    let total = 0;
    for (const rel of await walk(assets)) {
      if (rel.endsWith(".map") || !rel.endsWith(extension)) continue;
      total += (await stat(join(assets, rel))).size;
    }
    return total / 1024;
  };

  const overspent = [];
  for (const [kind, ceiling] of Object.entries(BUDGETS_KIB)) {
    const used = await byExtension(`.${kind}`);
    const share = ((used / ceiling) * 100).toFixed(0);
    console.log(
      `  ${kind.toUpperCase().padEnd(4)} ${used.toFixed(1).padStart(7)} KiB` +
      ` of ${ceiling} KiB budget (${share}%)`
    );
    if (used > ceiling) overspent.push(`${kind} is ${used.toFixed(1)} KiB, over its ${ceiling} KiB budget`);
  }
  if (overspent.length > 0) {
    throw new Error(
      `Size budget exceeded:\n  ${overspent.join("\n  ")}\n` +
      "Trim the bundle, or raise BUDGETS_KIB in scripts/build.mjs and say why in the commit."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
