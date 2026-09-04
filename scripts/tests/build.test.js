/**
 * Guards the caching contract between the build, .htaccess and the service
 * worker. These three have to agree on one thing: a URL may be served
 * `immutable` only if its filename carries a content hash.
 *
 * Nothing here mocks the build - each case runs `scripts/build.mjs` for real
 * and inspects `dist/`, because every bug this file exists to catch was a
 * mismatch between what the build emitted and what something else assumed it
 * had emitted.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DIST = join(ROOT, "dist");

/** Extensions .htaccess is willing to mark immutable, and that the build hashes. */
const HASHED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ico",
  ".svg",
  ".pdf",
]);

const build = () =>
  execFileSync("node", [join(ROOT, "scripts/build.mjs")], {
    cwd: ROOT,
    stdio: "pipe",
  });

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

const readSw = () => {
  const text = readFileSync(join(DIST, "sw.js"), "utf8");
  return {
    cacheName: text.match(/const CACHE_NAME = '([^']*)';/)[1],
    precache: JSON.parse(
      text.match(/const PRECACHE_URLS = (\[[\s\S]*?\]);/)[1],
    ),
  };
};

describe("build: caching contract", () => {
  let files;
  let sw;

  before(() => {
    build();
    files = walk(DIST);
    sw = readSw();
  });

  describe("service worker precache", () => {
    // The worker adds precache entries individually under Promise.allSettled so
    // that one 404 cannot fail the whole install. That also means a 404 reports
    // nothing at all - the shell silently loses a file. This is the only place
    // it gets caught.
    it("every precache URL resolves to a shipped file", () => {
      for (const url of sw.precache) {
        const target = url === "/" ? "index.html" : url.slice(1);
        assert.ok(
          existsSync(join(DIST, target)),
          `precache URL ${url} has no file in dist/ (expected ${target})`,
        );
      }
    });

    it("precaches the hashed LCP image, not a bare filename", () => {
      const lcp = sw.precache.filter((u) => u.includes("profile-cutout-380"));
      assert.strictEqual(
        lcp.length,
        1,
        "expected exactly one profile-cutout-380 precache entry",
      );
      assert.match(lcp[0], /^\/profile-cutout-380-[A-Za-z0-9_-]{8}\.webp$/);
    });

    // The precached width and the preloaded width have to be the same file:
    // they are two halves of one optimisation, and they drifted apart once
    // already - the build precached the 160w headshot while index.html
    // preloaded the 360w one, so the shell warmed a file the page never asked
    // for and the LCP image was fetched cold on every first paint.
    //
    // Asserted against `href` rather than the whole tag: the preload also
    // carries an `imagesrcset` naming every width, so a substring match over
    // the tag passes no matter which one `href` points at - which is exactly
    // the drift this case exists to catch.
    it("precaches the width index.html preloads", () => {
      const html = readFileSync(join(DIST, "index.html"), "utf8");
      const preload = html.match(/<link rel="preload"[^>]*as="image"[^>]*>/);
      assert.ok(preload, "expected an image preload in dist/index.html");
      const href = preload[0].match(/\shref="([^"]+)"/);
      assert.ok(href, "image preload has no href");
      const lcp = sw.precache.find((u) => u.includes("profile-cutout-380"));
      assert.strictEqual(
        `/${href[1]}`,
        lcp,
        `preload href ${href[1]} is not the precached ${lcp}`,
      );
    });
  });

  describe(".htaccess immutable rule", () => {
    // Read the live pattern rather than restating it, so the test tracks the
    // rule the deploy actually ships.
    const immutablePattern = () => {
      const htaccess = readFileSync(join(DIST, ".htaccess"), "utf8");
      const match = htaccess.match(
        /<FilesMatch "([^"]+)">\s*Header set Cache-Control "public, max-age=31536000, immutable"/,
      );
      assert.ok(match, ".htaccess has no immutable FilesMatch rule");
      return new RegExp(match[1]);
    };

    it("only matches filenames carrying a content hash", () => {
      const immutable = immutablePattern();
      for (const name of [
        "manifest.json",
        "robots.txt",
        "sitemap.xml",
        "sw.js",
        "purify.min.js",
      ]) {
        assert.ok(
          !immutable.test(name),
          `${name} is not content-hashed but would be served immutable for a year`,
        );
      }
    });

    it("every shipped image and PDF is hashed, so none gets a year of silence", () => {
      const immutable = immutablePattern();
      for (const rel of files) {
        if (!HASHED_EXTENSIONS.has(extname(rel))) continue;
        assert.ok(
          immutable.test(basename(rel)),
          `${rel} ships un-hashed at a stable URL - its bytes can change under a cached copy`,
        );
      }
    });
  });

  describe("shipped references", () => {
    it("no page or manifest points at an un-hashed image or PDF", () => {
      const pages = files.filter(
        (f) => f.endsWith(".html") || f === "manifest.json",
      );
      assert.ok(pages.length > 0, "no shipped pages found");

      for (const rel of pages) {
        const text = readFileSync(join(DIST, rel), "utf8");
        // URL-bearing attributes only. `download="Rajeev_Jasti_Resume.pdf"` is a
        // save-as name, not a URL, and is deliberately left un-hashed.
        const urls = [...text.matchAll(/(?:href|src|content)="([^"]+)"/g)].map(
          (m) => m[1],
        );
        for (const url of urls) {
          const ext = extname(url.split("?")[0]);
          if (!HASHED_EXTENSIONS.has(ext)) continue;
          assert.match(
            url,
            /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/,
            `${rel} references un-hashed asset ${url}`,
          );
        }
      }
    });
  });

  describe("CACHE_NAME versioning", () => {
    it("is stable when nothing changes", () => {
      build();
      assert.strictEqual(readSw().cacheName, sw.cacheName);
    });

    // The worker's expiry sweep and old-cache purge only run on activate, and
    // activate only runs when sw.js changes. Versioning off the precache URL
    // list alone left un-hashed files (a vendored library, the manifest) able
    // to ship without bumping the worker at all.
    for (const target of ["vendor/purify.min.js", "manifest.json"]) {
      it(`changes when only ${target} changes`, () => {
        const source = join(ROOT, "frontend", target);
        const original = readFileSync(source);
        try {
          writeFileSync(source, Buffer.concat([original, Buffer.from("\n")]));
          build();
          assert.notStrictEqual(
            readSw().cacheName,
            sw.cacheName,
            `a deploy changing only ${target} produced a byte-identical worker`,
          );
        } finally {
          writeFileSync(source, original);
        }
      });
    }
  });
});
