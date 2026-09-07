// Regression cover for the inline pre-boot section router in index.html.
//
// The fragment never reaches the server, so `/#resume` is served the same
// document as `/`, with #home carrying `active` in the markup. The router that
// knows better - navigation.js - arrives through main.js, a module, so it runs
// at DOMContentLoaded, and a document paints long before that. The inline
// script closes the gap.
//
// It used to sit after `</main>`, which looked early enough and is not: #home
// is the FIRST section in the document, so a document that paints while it is
// still streaming paints the landing hero - the LCP image, preloaded and
// fetchpriority="high" - for as long as the remaining ~1,500 lines take to
// arrive. Measured on a chunked response, that was the whole hero at 165ms on a
// deep link to #resume. So the two things this file pins are that the script
// runs ABOVE <main>, and that it stands #home down the moment #home exists
// rather than once the document is complete.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

/** The pre-boot router's own source, lifted out of index.html. */
const ROUTER_SOURCE = (() => {
  const scripts = [...INDEX.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = scripts.filter((body) => body.includes("is-boot-target"));
  assert.equal(found.length, 1, "expected exactly one inline pre-boot router in index.html");
  return found[0];
})();

const SECTIONS = ["home", "about", "resume", "hobbies", "apps", "activity", "contact", "ai"];

/** Lets queued MutationObserver callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Boots the router against a document holding nothing but the header nav, then
 * hands back a `parse` that appends markup the way the HTML parser would - a
 * piece at a time, each one followed by the microtask checkpoint that delivers
 * the observer records.
 *
 * jsdom fires DOMContentLoaded as soon as it has built the document it was
 * handed, so the router is evaluated one tick later: it must not see that event
 * until the test says the parse is over, the way a browser only fires it once
 * the last section has arrived.
 */
async function bootRouter(hash) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <nav>${SECTIONS.map(
         (id) =>
           `<a href="#${id}" data-target="${id}"${
             id === "home" ? ' class="active" aria-current="page"' : ""
           }></a>`
       ).join("")}</nav>
     </body></html>`,
    { url: `https://rjasti.com/${hash}`, runScripts: "outside-only" }
  );

  const { document } = dom.window;
  await settle();
  dom.window.eval(ROUTER_SOURCE);

  return {
    document,
    async parse(build) {
      build(document);
      await settle();
    },
    async domContentLoaded() {
      document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
      await settle();
    },
    state() {
      const active = [...document.querySelectorAll("section.active")].map((s) => s.id);
      return {
        active,
        boot: [...document.querySelectorAll(".is-boot-target")].map((s) => s.id),
        nav: [...document.querySelectorAll("nav a.active")].map((a) => a.dataset.target),
        aria: [...document.querySelectorAll("nav a[aria-current=page]")].map((a) => a.dataset.target),
      };
    },
  };
}

const appendMain = (document) => {
  const main = document.createElement("main");
  main.id = "main-content";
  document.body.append(main);
};

const appendSection = (document, id) => {
  const section = document.createElement("section");
  section.id = id;
  if (id === "home") section.className = "active";
  document.getElementById("main-content").append(section);
};

test("the pre-boot router runs above <main>, not after it", () => {
  const script = INDEX.indexOf(ROUTER_SOURCE);
  const main = INDEX.indexOf('<main id="main-content"');

  assert.ok(main > -1, "index.html should still have <main id=\"main-content\">");
  assert.ok(
    script < main,
    "the pre-boot router has to be in place before <main> is parsed - below it, " +
      "#home paints first on every deep link that arrives over a slow connection"
  );
});

test("every nav target is a section, so the router can validate against the nav", () => {
  const navTargets = new Set(
    [...INDEX.matchAll(/<a[^>]*\sdata-target="([a-z-]+)"/g)].map((m) => m[1])
  );
  const sectionIds = new Set([...INDEX.matchAll(/<section id="([a-z-]+)"/g)].map((m) => m[1]));

  for (const target of navTargets) {
    assert.ok(sectionIds.has(target), `nav link #${target} has no matching <section>`);
  }
  assert.deepEqual([...sectionIds].sort(), [...SECTIONS].sort());
});

test("the runtime router validates a fragment the same way, against sections", () => {
  // getValidHashTarget only asks its resolver "is there something with this
  // id?", so handing it document.getElementById answered yes for <main
  // id="main-content"> - the skip link's own target. Following the skip link
  // and reloading then deactivated all eight sections and left the page blank,
  // while this file's router had already fallen back to home. They have to
  // agree, so navigation.js resolves against its section list instead.
  const source = fs.readFileSync(path.join(__dirname, "../js/navigation.js"), "utf8");

  assert.match(source, /getValidHashTarget\(hash, resolveSection, current\?\.id \?\? "home"\)/);
  assert.doesNotMatch(source, /getValidHashTarget\([^)]*document\.getElementById/);
  assert.match(source, /function resolveSection\(id\) \{\s*return sections\?\./);
});

test("#home is stood down as soon as it is parsed, before the target arrives", async () => {
  const page = await bootRouter("#resume");

  await page.parse(appendMain);
  await page.parse((d) => appendSection(d, "home"));

  // This is the paint that used to show the landing hero.
  assert.deepEqual(page.state(), { active: [], boot: [], nav: ["resume"], aria: ["resume"] });

  await page.parse((d) => appendSection(d, "about"));
  assert.deepEqual(page.state().active, [], "an intervening section is not the target");

  await page.parse((d) => appendSection(d, "resume"));
  assert.deepEqual(page.state(), {
    active: ["resume"],
    boot: ["resume"],
    nav: ["resume"],
    aria: ["resume"],
  });
});

test("the target activates even when it arrives in the same parse as #home", async () => {
  const page = await bootRouter("#ai");

  await page.parse((d) => {
    appendMain(d);
    appendSection(d, "home");
    appendSection(d, "ai");
  });

  assert.deepEqual(page.state(), { active: ["ai"], boot: ["ai"], nav: ["ai"], aria: ["ai"] });
});

for (const hash of ["", "#home", "#main-content", "#nope", "#Resume"]) {
  test(`${hash || "(no fragment)"} leaves home exactly as the markup has it`, async () => {
    const page = await bootRouter(hash);

    await page.parse(appendMain);
    for (const id of SECTIONS) await page.parse((d) => appendSection(d, id));
    await page.domContentLoaded();

    assert.deepEqual(page.state(), { active: ["home"], boot: [], nav: ["home"], aria: ["home"] });
  });
}

test("home comes back if the fragment names a nav link with no section", async () => {
  const page = await bootRouter("#resume");

  await page.parse(appendMain);
  await page.parse((d) => appendSection(d, "home"));
  assert.deepEqual(page.state().active, [], "home stands down while the target is still expected");

  // #resume never arrives. Rather than leave the page empty, put home back.
  await page.domContentLoaded();
  assert.deepEqual(page.state(), { active: ["home"], boot: [], nav: ["home"], aria: ["home"] });
});
