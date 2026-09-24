/**
 * Guards the caching contract between the build, .htaccess and the service
 * worker. These three have to agree on one thing: a URL may be served
 * `immutable` only if its filename carries a content hash.
 *
 * Nothing here mocks the build - each case runs `scripts/build.mjs` for real
 * and inspects `dist/`, because every bug this file exists to catch was a
 * mismatch between what the build emitted and what something else assumed it
 * had emitted.
 *
 * It also guards the size budget, for the same reason: the budget is only worth
 * having if breaching it actually stops the build, and that is a property of
 * the build script rather than of any number written down beside it.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
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

/* The un-hashed copies the build ships on purpose (scripts/build.mjs,
   isStableAlias). Restated rather than imported: the test is the contract,
   and a pattern widened in the build by accident should fail here. */
const isStableAlias = (rel) =>
  rel === "rjasti_resume.pdf" || rel === "favicon.ico" || /^[\w-]+-preview\.png$/.test(rel);

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
    else out.push(relative(base, full).replace(/\\/g, "/"));
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

    // Every image and PDF has a hashed copy that pages point at. An un-hashed
    // one ships only for the stable aliases, and .htaccess gives those the
    // one-hour must-revalidate rule, never a year of immutable.
    it("every shipped image and PDF is hashed, apart from the stable aliases", () => {
      const immutable = immutablePattern();
      for (const rel of files) {
        if (!HASHED_EXTENSIONS.has(extname(rel))) continue;
        if (isStableAlias(rel)) {
          assert.ok(!immutable.test(basename(rel)), `${rel} is an alias and must not be immutable`);
          continue;
        }
        assert.ok(
          immutable.test(basename(rel)),
          `${rel} ships un-hashed at a stable URL - its bytes can change under a cached copy`,
        );
      }
    });
  });

  /* A recruiter's bookmark to the résumé, the favicon browsers request
     unprompted, and the sitemap's image URLs all name un-hashed paths the
     build cannot rewrite. Shipped only under hashed names, every one of them
     404'd in production. */
  describe("stable public URLs", () => {
    for (const rel of ["rjasti_resume.pdf", "favicon.ico"]) {
      it(`ships /${rel} at its stable URL`, () => {
        assert.ok(existsSync(join(DIST, rel)), `dist/${rel} is missing - its public URL 404s`);
      });
    }

    it("serves every alias with the same bytes as its hashed copy", () => {
      const aliases = files.filter(isStableAlias);
      assert.ok(aliases.length >= 3, `expected the résumé, the favicon and the preview cards, got ${aliases}`);
      for (const alias of aliases) {
        const ext = extname(alias);
        const stem = alias.slice(0, -ext.length);
        const hashed = files.filter((f) => new RegExp(`^${stem}-[A-Za-z0-9_-]{8}\\${ext}$`).test(f));
        assert.equal(hashed.length, 1, `${alias} has no single hashed copy (${hashed})`);
        assert.ok(
          readFileSync(join(DIST, alias)).equals(readFileSync(join(DIST, hashed[0]))),
          `${alias} and ${hashed[0]} differ - the two URLs would serve different files`,
        );
      }
    });

    it("every image the sitemap lists is a shipped file", () => {
      const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
      const images = [...sitemap.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((m) => m[1]);
      assert.ok(images.length > 0, "sitemap.xml lists no images");
      for (const url of images) {
        const rel = new URL(url).pathname.slice(1);
        assert.ok(existsSync(join(DIST, rel)), `sitemap image ${url} has no file in dist/ - it 404s`);
      }
    });

    it("every page the sitemap lists is a shipped page", () => {
      const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
      const pages = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      assert.ok(pages.length > 0, "sitemap.xml lists no pages");
      for (const url of pages) {
        const path = new URL(url).pathname.slice(1);
        const rel = path === "" ? "index.html" : `${path}.html`;
        assert.ok(existsSync(join(DIST, rel)), `sitemap page ${url} has no ${rel} in dist/`);
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

  // Codebase review U12: the four Dev Tools pages painted dark, then switched
  // to a saved light theme at DOMContentLoaded. The pre-paint script has to
  // ship hashed, and run before the first stylesheet.
  describe("Dev Tools theme pre-paint", () => {
    it("each Dev Tools page loads a hashed pre-paint script ahead of its CSS", () => {
      for (const page of ["cron.html", "crypto.html", "json.html", "diff.html"]) {
        const text = readFileSync(join(DIST, page), "utf8");
        const script = text.match(/<script src="(assets\/theme-prepaint-[A-Za-z0-9_-]{8}\.js)"><\/script>/);
        assert.ok(script, `${page} does not load the hashed pre-paint script`);
        assert.ok(existsSync(join(DIST, script[1])), `${page} names ${script[1]}, which did not ship`);
        const head = text.slice(0, text.indexOf("</head>"));
        assert.ok(
          head.indexOf(script[0]) !== -1 && head.indexOf(script[0]) < head.indexOf('rel="stylesheet"'),
          `${page}: the pre-paint script must run before the first stylesheet`,
        );
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

describe("build: size budget", () => {
  const readBudgets = () =>
    readFileSync(join(ROOT, "scripts", "build.mjs"), "utf8")
      .match(/const BUDGETS_KIB = (\{[^}]*\});/)[1];

  const shippedKib = (extension) =>
    walk(join(DIST, "assets"))
      .filter((rel) => rel.endsWith(extension) && !rel.endsWith(".map"))
      .reduce((total, rel) => total + statSync(join(DIST, "assets", rel)).size, 0) / 1024;

  before(() => {
    build();
  });

  // Sourcemaps are four times the size of the code they describe. Counting them
  // would make the budget a measure of how much debug information ships, which
  // is not what anyone is trying to hold the line on.
  it("measures minified code only, not sourcemaps or images", () => {
    const budgets = JSON.parse(readBudgets().replace(/(\w+):/g, '"$1":'));
    for (const [kind, ceiling] of Object.entries(budgets)) {
      const used = shippedKib(`.${kind}`);
      assert.ok(used > 0, `no shipped .${kind} found under dist/assets`);
      assert.ok(
        used <= ceiling,
        `${kind} is ${used.toFixed(1)} KiB, over its ${ceiling} KiB budget`,
      );
    }
  });

  // The gate is the point. A budget the build reports but does not enforce is a
  // log line, and this is the case that would have caught it being one.
  it("fails the build when a budget is breached", () => {
    const source = join(ROOT, "scripts", "build.mjs");
    const original = readFileSync(source, "utf8");
    try {
      writeFileSync(source, original.replace(/const BUDGETS_KIB = \{[^}]*\};/, "const BUDGETS_KIB = { js: 1, css: 1 };"));
      assert.throws(build, /Size budget exceeded/);
    } finally {
      writeFileSync(source, original);
    }
  });
});

/* The shipped copies of DOMPurify and marked are copied out of node_modules by
   hand (frontend/vendor/README.md), and nothing checked they were still the
   same bytes. CI's blocking `npm audit --omit=dev` audits node_modules, so
   without this it would be auditing versions that do not ship. */
describe("vendored libraries", () => {
  for (const [shipped, source] of [
    ["frontend/vendor/purify.min.js", "node_modules/dompurify/dist/purify.min.js"],
    ["frontend/vendor/marked.min.js", "node_modules/marked/marked.min.js"],
  ]) {
    it(`${shipped} is byte-identical to ${source}`, () => {
      assert.ok(
        readFileSync(join(ROOT, shipped)).equals(readFileSync(join(ROOT, source))),
        `${shipped} has drifted from ${source}: re-copy it (frontend/vendor/README.md)`
      );
    });
  }
});

/* S15 and S16 (docs/review/codebase_review_20260924.md). The shipped page's CSP
   named `http://localhost:8000` and `http://127.0.0.1:8000` - origins for
   serving frontend/ on a developer's machine - and let images load from any
   HTTPS origin. The build strips the first from dist/ only, and the source
   narrows the second. */
describe("build: shipped Content-Security-Policy", () => {
  const cspOf = (file) =>
    readFileSync(file, "utf8").match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)[1];
  const directive = (csp, name) =>
    csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) || "";

  let shipped;
  let source;
  before(() => {
    build();
    shipped = cspOf(join(DIST, "index.html"));
    source = cspOf(join(ROOT, "frontend", "index.html"));
  });

  it("drops the loopback API origins from the page that ships", () => {
    const connect = directive(shipped, "connect-src");
    assert.doesNotMatch(connect, /localhost|127\.0\.0\.1/);
    assert.match(connect, /'self'/);
    assert.match(connect, /https:\/\/formsubmit\.co/, "the contact form's fallback still needs it");
  });

  it("keeps them in the source, which is what local development serves", () => {
    assert.match(directive(source, "connect-src"), /http:\/\/localhost:8000 http:\/\/127\.0\.0\.1:8000/);
  });

  it("allows images from this origin and data: URIs only", () => {
    assert.equal(directive(shipped, "img-src"), "img-src 'self' data:");
  });

  it("still pins every inline script the shipped page carries", async () => {
    const { createHash } = await import("node:crypto");
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    const bodies = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(bodies.length > 0);
    for (const body of bodies) {
      const pin = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
      assert.ok(directive(shipped, "script-src").includes(pin), `unpinned inline script: ${body.slice(0, 40)}`);
    }
  });
});
