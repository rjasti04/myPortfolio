// Cover for the per-view page semantics the section router owes.
//
// The router renders one section at a time - `.js-enabled main > section` is
// `display: none` and only `.active` is shown - so each of the eight views is
// a page in every sense. Three things never treated it as one: the title, the
// canonical URL and og:url were frozen at the home values, and only #home
// carried an <h1>, leaving the other seven views with no level-1 heading at
// all. A screen-reader user who activated "Resume" got no announcement, no
// focus move and no title change; `aria-current` on the nav link was the only
// signal that anything had happened.
//
// These assertions are all against the markup and the ROUTE_META table, which
// is what actually drifts: a ninth section added without an entry, or a title
// quietly demoted back to <h2>, both fail here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const NAVIGATION = fs.readFileSync(path.join(__dirname, "../js/navigation.js"), "utf8");

const SECTION_IDS = ["home", "about", "resume", "hobbies", "apps", "activity", "contact", "ai"];

/** The keys ROUTE_META declares, read out of navigation.js's source. */
function routeMetaKeys() {
  const block = NAVIGATION.match(/const ROUTE_META = \{([\s\S]*?)\n\};/);
  assert.ok(block, "ROUTE_META not found in navigation.js");
  return [...block[1].matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]);
}

test("every section has exactly one <h1>", () => {
  const dom = new JSDOM(INDEX);
  const { document } = dom.window;

  for (const id of SECTION_IDS) {
    const section = document.getElementById(id);
    assert.ok(section, `#${id} is missing`);
    const headings = section.querySelectorAll("h1");
    assert.equal(
      headings.length,
      1,
      `#${id} has ${headings.length} <h1> elements; each view is a page and needs exactly one`
    );
    assert.ok(
      headings[0].textContent.trim().length > 0,
      `#${id}'s <h1> is empty, so the view has no accessible name`
    );
  }
});

test("no view title is left on an <h2>", () => {
  const dom = new JSDOM(INDEX);
  const { document } = dom.window;
  // .section-title / .contact-title style the view's own heading, so one left
  // on an h2 means a section was demoted back below the h1 it should be.
  //
  // .skills-title is the documented exception and not a loophole: "Technical
  // Skills" is a SUBSECTION inside #about, under that view's own (visually
  // hidden) h1, and h2 is the right level for it. It borrows the title
  // treatment on purpose - restyling it is a visual change, and this pass is
  // about semantics. The `#about has exactly one h1` assertion above is what
  // actually pins that relationship.
  const strays = document.querySelectorAll(
    "h2.section-title:not(.skills-title), h2.contact-title"
  );
  assert.equal(
    strays.length,
    0,
    `these are view titles and must be <h1>: ${[...strays].map((el) => el.textContent.trim()).join(", ")}`
  );
});

test("every section is a focus target for the router", () => {
  const dom = new JSDOM(INDEX);
  const { document } = dom.window;
  for (const id of SECTION_IDS) {
    assert.equal(
      document.getElementById(id).getAttribute("tabindex"),
      "-1",
      `#${id} needs tabindex="-1" so setActiveSection can move focus into it`
    );
  }
});

test("the route announcer exists and is a polite live region", () => {
  const dom = new JSDOM(INDEX);
  const { document } = dom.window;
  const announcer = document.getElementById("route-announcer");

  assert.ok(announcer, "#route-announcer is missing; route changes are silent without it");
  assert.equal(announcer.getAttribute("aria-live"), "polite");
  assert.equal(announcer.getAttribute("role"), "status");
  assert.equal(
    announcer.textContent.trim(),
    "",
    "it must ship empty, or the first navigation has nothing to announce as a change"
  );
  assert.equal(
    announcer.closest("main"),
    null,
    "it must sit outside <main>, or swapping a section can take the live region with it"
  );
});

test("ROUTE_META covers every section, and nothing else", () => {
  assert.deepEqual(
    routeMetaKeys().slice().sort(),
    SECTION_IDS.slice().sort(),
    "ROUTE_META and the sections in index.html have drifted apart"
  );
});

test("each route declares a distinct title", () => {
  const titles = [...NAVIGATION.matchAll(/title: "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(titles.length, SECTION_IDS.length);
  assert.equal(
    new Set(titles).size,
    titles.length,
    "two routes share a title, which is the bug this table exists to fix"
  );
});

test("the document ships the home title and a bare-origin canonical", () => {
  const dom = new JSDOM(INDEX);
  const { document } = dom.window;
  // The shipped values are the home ones: the pre-boot router may route
  // elsewhere, but applyRouteMeta corrects the metadata once navigation.js
  // loads, and home must stay the canonical for the site root.
  assert.equal(document.title, "Rajeev Jasti | Principal Data Engineer");
  assert.equal(
    document.querySelector('link[rel="canonical"]').getAttribute("href"),
    "https://rjasti.com/"
  );
  assert.equal(
    document.querySelector('meta[property="og:url"]').getAttribute("content"),
    "https://rjasti.com/"
  );
});

// Codebase review U11: five views jumped from their <h1> straight to <h3>, so
// a screen reader's heading list implied a missing level in each. The
// Experience markup comes from scripts/generate_resume.py, which is where its
// levels are set.
test("no view skips a heading level", () => {
  const dom = new JSDOM(INDEX);
  const { document } = dom.window;
  for (const id of SECTION_IDS) {
    let previous = 0;
    for (const heading of document.getElementById(id).querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      const level = Number(heading.tagName[1]);
      assert.ok(
        level <= previous + 1,
        `#${id}: <${heading.tagName.toLowerCase()}> "${heading.textContent.trim()}" follows an h${previous}`
      );
      previous = level;
    }
  }
});

test("every Font Awesome icon in the page is hidden from assistive technology", () => {
  const dom = new JSDOM(INDEX);
  const exposed = [...dom.window.document.querySelectorAll('i[class*="fa-"]')].filter(
    (icon) => icon.getAttribute("aria-hidden") !== "true"
  );
  assert.equal(
    exposed.length,
    0,
    `decorative glyphs a screen reader would read out: ${exposed.slice(0, 5).map((i) => i.className).join(", ")}`
  );
});

test("nothing that acts is dressed as a link to nowhere", () => {
  const dom = new JSDOM(INDEX);
  const dead = dom.window.document.querySelectorAll('a[href="#"]');
  assert.equal(dead.length, 0, `use a <button> for: ${[...dead].map((a) => a.id || a.textContent.trim()).join(", ")}`);
});

// WCAG 2.5.3: a voice-control user says what they see. A control whose
// accessible name does not begin with its visible label cannot be activated
// by speaking that label.
test("a labelled control's name begins with its visible text", () => {
  const dom = new JSDOM(INDEX);
  for (const label of dom.window.document.querySelectorAll(".home-social-label, .action-label")) {
    const control = label.closest("[aria-label]");
    if (!control) continue;
    const visible = label.textContent.trim().toLowerCase();
    assert.ok(
      control.getAttribute("aria-label").toLowerCase().startsWith(visible),
      `"${control.getAttribute("aria-label")}" does not begin with its visible label "${label.textContent.trim()}"`
    );
  }
});
