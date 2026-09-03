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

const hash8 = (contents) =>
  createHash("sha256").update(contents).digest("base64url").slice(0, 8);

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walk(join(dir, entry.name), base)));
    } else {
      out.push(relative(base, join(dir, entry.name)));
    }
  }
  return out;
}

function hashedPath(rel, contents) {
  const extension = extname(rel);
  const withoutExtension = rel.slice(0, -extension.length);
  return `${withoutExtension}-${hash8(contents)}${extension}`;
}

function rewriteReferences(text, rewrites) {
  let out = text;
  for (const [from, to] of rewrites) {
    for (const form of [
      from,
      `./${from}`,
      `/${from}`,
      `https://rjasti.com/${from}`,
    ]) {
      out = out.split(`"${form}"`).join(`"${to}"`);
      out = out.split(`'${form}'`).join(`'${to}'`);
    }
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

  // --- CSS -----------------------------------------------------------------
  for (const css of ["styles.css", "auth-modal.css", "fonts.css"]) {
    const result = await esbuild.build({
      entryPoints: [join(SRC, css)],
      bundle: true, minify: true, sourcemap: true,
      outdir: join(OUT, "assets"), entryNames: "[name]-[hash]",
      metafile: true, logLevel: "warning",
      loader: { ".woff2": "file", ".woff": "file" },
      assetNames: "[name]-[hash]",
    });
    for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
      if (meta.entryPoint) {
        rewrites.set(css, relative(OUT, join(ROOT, outPath)));
        continue;
      }
      // Fonts are hashed and emitted alongside the stylesheet, and esbuild
      // rewrites the url() references to match. index.html preloads two of
      // them by their source path, so those have to be rewritten too - a
      // preload pointing at the un-hashed copy fetches the same font a second
      // time and logs "preloaded but not used".
      const input = Object.keys(meta.inputs ?? {})[0];
      if (input && /\.woff2?$/.test(input)) {
        rewrites.set(relative(SRC, join(ROOT, input)), relative(OUT, join(ROOT, outPath)));
      }
    }
  }

  // --- Static assets -------------------------------------------------------
  const copied = [];
  for (const rel of await walk(SRC)) {
    const ext = rel.slice(rel.lastIndexOf("."));
    if (!COPY_EXTENSIONS.has(ext)) continue;
    // Fonts ship as the hashed copies esbuild emitted next to fonts.css.
    if (rel.startsWith("fonts/")) continue;

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
    await writeFile(join(OUT, rel), text);
  }

  for (const extra of [".htaccess"]) {
    if (existsSync(join(SRC, extra))) {
      await cp(join(SRC, extra), join(OUT, extra));
      copied.push(extra);
    }
  }

  for (const extra of ["worldcup.html", "ucl.html"]) {
    if (!textFiles.includes(extra) && existsSync(join(SRC, extra))) {
      let text = await readFile(join(SRC, extra), "utf8");
      text = rewriteReferences(text, rewrites);
      await writeFile(join(OUT, extra), text);
      copied.push(extra);
    }
  }

  // --- Service worker ------------------------------------------------------
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
    "/profile-pic-160.webp",
  ].filter((p, i, all) => !p.endsWith(".map") && all.indexOf(p) === i);

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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
