// Cover for the Apps category filter and the collapsible Experience groups.
//
// Both replace a flat wall with something scannable, and both have a failure
// mode that is invisible until someone tries to use them: a filter whose
// category keys have drifted from the tiles shows an empty grid, and a
// collapsed experience group breaks the Ctrl+K palette's deep links, which
// resolve `#exp-...` and focus it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

/** A fresh document with globals wired, since both modules read from them. */
function mount() {
  const dom = new JSDOM(INDEX, { url: "https://rjasti.com/" });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom;
}

const click = (dom, el) =>
  el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

test("every app tile carries a category, and the chips cover them all", async () => {
  const dom = mount();
  const d = dom.window.document;

  const tiles = [...d.querySelectorAll(".app-grid .app-tile")];
  assert.ok(tiles.length >= 7, `expected the full shelf, found ${tiles.length}`);

  const uncategorised = tiles.filter((t) => !t.dataset.appCategory);
  assert.deepEqual(
    uncategorised.map((t) => t.getAttribute("href")),
    [],
    "a tile with no data-app-category can never be shown by a category chip"
  );

  // Every category present on a tile needs a chip, or those tiles are
  // unreachable through the filter.
  const chipKeys = new Set(
    [...d.querySelectorAll("[data-app-filter]")].map((c) => c.dataset.appFilter)
  );
  for (const tile of tiles) {
    assert.ok(
      chipKeys.has(tile.dataset.appCategory),
      `no chip for category "${tile.dataset.appCategory}"`
    );
  }
});

test("the filter shows the right tiles, and re-pressing clears it", async () => {
  const dom = mount();
  const { initAppsFilter } = await import("../js/apps-filter.js");
  const d = dom.window.document;
  initAppsFilter();

  const shown = () =>
    [...d.querySelectorAll("[data-app-category]")].filter((t) => !t.hasAttribute("hidden"));
  const chip = (key) => d.querySelector(`[data-app-filter="${key}"]`);
  const total = d.querySelectorAll("[data-app-category]").length;

  assert.equal(shown().length, total, "everything shows before a filter is applied");

  click(dom, chip("dev-tools"));
  assert.ok(shown().length > 0, "a category chip that shows nothing is a broken key");
  assert.ok(
    shown().every((t) => t.dataset.appCategory === "dev-tools"),
    "a filtered grid must contain only its own category"
  );
  assert.equal(chip("dev-tools").getAttribute("aria-pressed"), "true");
  assert.equal(chip("all").getAttribute("aria-pressed"), "false");

  // Exactly one chip is ever pressed.
  const pressed = [...d.querySelectorAll("[data-app-filter]")].filter(
    (c) => c.getAttribute("aria-pressed") === "true"
  );
  assert.equal(pressed.length, 1);

  click(dom, chip("dev-tools"));
  assert.equal(shown().length, total, "pressing the active chip again clears the filter");
  assert.equal(chip("all").getAttribute("aria-pressed"), "true");
});

test("filtering is announced, since the only other signal is tiles vanishing", async () => {
  const dom = mount();
  const { initAppsFilter } = await import("../js/apps-filter.js");
  const d = dom.window.document;
  initAppsFilter();

  const status = d.getElementById("app-filter-status");
  assert.equal(status.getAttribute("aria-live"), "polite");

  click(dom, d.querySelector('[data-app-filter="games"]'));
  assert.match(status.textContent, /^Showing 1 app in /, "singular, and names the category");

  click(dom, d.querySelector('[data-app-filter="football"]'));
  assert.match(status.textContent, /^Showing 2 apps in /, "plural");
});

test("chip counts match the tiles actually present", async () => {
  const dom = mount();
  const { initAppsFilter } = await import("../js/apps-filter.js");
  const d = dom.window.document;
  initAppsFilter();

  for (const chip of d.querySelectorAll("[data-app-filter]")) {
    const key = chip.dataset.appFilter;
    const expected =
      key === "all"
        ? d.querySelectorAll("[data-app-category]").length
        : d.querySelectorAll(`[data-app-category="${key}"]`).length;
    assert.equal(
      chip.querySelector(".app-filter-count").textContent,
      String(expected),
      `the "${key}" chip advertises the wrong count`
    );
  }
});

test("experience groups are collapsible, with the first one open", () => {
  const dom = mount();
  const d = dom.window.document;
  const groups = [...d.querySelectorAll("#resume details.exp-group")];

  assert.ok(groups.length >= 2, "progressive disclosure needs more than one group");
  assert.ok(groups[0].open, "the first group ships open, or the section reads as an empty index");
  assert.equal(
    groups.filter((g) => g.open).length,
    1,
    "exactly one group open by default"
  );

  // The anchor must be on the <details>, not the heading: the palette focuses
  // whatever getElementById returns, and it can only open a <details>.
  for (const group of groups) {
    assert.match(group.id, /^exp-/, "each group needs its palette anchor");
    assert.equal(
      group.querySelector("h4[id]"),
      null,
      "the id belongs on the <details>, not on the heading inside it"
    );
  }
});

test("every experience anchor in the search index resolves to a group", () => {
  const dom = mount();
  const d = dom.window.document;
  const index = fs.readFileSync(path.join(__dirname, "../js/search-index.js"), "utf8");

  const anchors = [...index.matchAll(/"anchor": "(exp-[^"]+)"/g)].map((m) => m[1]);
  assert.ok(anchors.length > 0, "the palette indexes experience groups; none found");

  for (const anchor of anchors) {
    const target = d.getElementById(anchor);
    assert.ok(target, `search-index.js points at #${anchor}, which is not in the document`);
    assert.equal(
      target.tagName,
      "DETAILS",
      `#${anchor} must be the <details> so the palette can open it`
    );
  }
});

test("expand-all toggles every group and reports the set's state", async () => {
  const dom = mount();
  const { initExperienceGroups } = await import("../js/experience-groups.js");
  const d = dom.window.document;
  initExperienceGroups();

  const groups = [...d.querySelectorAll("#resume details.exp-group")];
  const toggle = d.querySelector(".exp-toggle-all");
  assert.ok(toggle, "the expand-all control is injected by JS and was not found");

  assert.equal(toggle.textContent, "Expand all");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  click(dom, toggle);
  assert.ok(groups.every((g) => g.open), "expand all must open every group");
  assert.equal(toggle.textContent, "Collapse all", "the label states the NEXT action");
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "aria-expanded states the STATE");

  click(dom, toggle);
  assert.ok(groups.every((g) => !g.open), "collapse all must close every group");
  assert.equal(toggle.textContent, "Expand all");
});

test("expand-all lands in the section's controls row, after the resume pair", async () => {
  const dom = mount();
  const { initExperienceGroups } = await import("../js/experience-groups.js");
  const d = dom.window.document;
  initExperienceGroups();

  const actions = d.querySelector("#resume .section-actions");
  const toggle = d.querySelector(".exp-toggle-all");
  assert.ok(actions, "#resume must keep a .section-actions row for the toggle to join");
  assert.equal(
    toggle.parentElement,
    actions,
    "the toggle belongs in the controls row, not on a line of its own"
  );
  assert.equal(
    actions.lastElementChild,
    toggle,
    "it is the trailing control; the resume pair keeps the leading edge"
  );
});

test("focusing a closed group opens it, which is the palette's deep-link path", async () => {
  const dom = mount();
  const { initExperienceGroups } = await import("../js/experience-groups.js");
  const d = dom.window.document;
  initExperienceGroups();

  const closed = [...d.querySelectorAll("#resume details.exp-group")].find((g) => !g.open);
  assert.ok(closed, "expected at least one closed group to test against");

  // Exactly what palette.js does with a content hit.
  closed.setAttribute("tabindex", "-1");
  closed.focus();

  assert.ok(closed.open, "a palette jump into a closed group must open it");
});

test("sections with a lede feed it to the Ctrl+K index", () => {
  const dom = mount();
  const d = dom.window.document;
  const index = fs.readFileSync(path.join(__dirname, "../js/search-index.js"), "utf8");

  // Parsed rather than pattern-matched: the generated file is pretty-printed
  // and there are several entries per section, so a regex here tests the
  // formatting as much as the content.
  const entries = JSON.parse(index.slice(index.indexOf("["), index.lastIndexOf("]") + 1));
  const sectionText = new Map(
    entries.filter((e) => e.kind === "section").map((e) => [e.section, e.text])
  );

  const ledes = [...d.querySelectorAll(".section-lede")];
  assert.ok(ledes.length >= 4, `expected ledes on the content sections, found ${ledes.length}`);

  for (const lede of ledes) {
    const sectionId = lede.closest("section").id;
    assert.ok(
      (sectionText.get(sectionId) ?? "").length > 0,
      `#${sectionId} has a lede but the search index has no text for it - run npm run generate:resume`
    );
  }
});
