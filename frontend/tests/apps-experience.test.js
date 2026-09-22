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

/* --- The shelf's images, filter and per-tile signals -----------------------
 *
 * The shelf shipped seven 1200x630 PNGs into a grid track that floors at 320px
 * and rarely exceeds ~420px - and each of those PNGs was a marketing card
 * whose baked-in eyebrow, title and blurb repeated the tile text underneath
 * it. Both of those are what these assert against.
 */

test("every tile serves WebP through <picture>, not a bare PNG", () => {
  const dom = mount();
  const tiles = [...dom.window.document.querySelectorAll(".app-grid .app-tile")];
  assert.ok(tiles.length >= 7);

  for (const tile of tiles) {
    const media = tile.querySelector(".app-tile-media");
    const picture = media.querySelector("picture");
    assert.ok(picture, `${tile.getAttribute("href")} still serves a bare <img>`);

    const source = picture.querySelector('source[type="image/webp"]');
    assert.ok(source, `${tile.getAttribute("href")} offers no WebP`);
    assert.match(source.getAttribute("srcset"), /-tile-640\.webp 640w/);
    assert.match(source.getAttribute("srcset"), /-tile-1280\.webp 1280w/);
    assert.ok(source.getAttribute("sizes"), "srcset without sizes cannot choose");

    const img = picture.querySelector("img");
    assert.match(img.getAttribute("src"), /-tile-640\.webp$/, "the fallback is still the full-size card");
    assert.equal(img.getAttribute("alt"), "", "the tile's own title is the label");
    assert.equal(img.getAttribute("loading"), "lazy");
    assert.ok(img.getAttribute("width") && img.getAttribute("height"), "an unsized image reflows the grid");
  }
});

test("every tile image the markup names actually ships, and is small", () => {
  const dom = mount();
  const sources = [...dom.window.document.querySelectorAll(".app-tile-media source")]
    .flatMap((s) => s.getAttribute("srcset").split(",").map((part) => part.trim().split(/\s+/)[0]));

  assert.equal(sources.length, 14, "seven apps, two widths each");
  let total = 0;
  for (const file of sources) {
    const full = path.join(__dirname, "..", file);
    assert.ok(fs.existsSync(full), `${file} is referenced but not shipped`);
    total += fs.statSync(full).size;
  }
  // The seven PNGs they replaced were ~1.93 MB between them.
  assert.ok(total < 600 * 1024, `the shelf ships ${Math.round(total / 1024)} KB of thumbnails`);
});

test("the OG cards stay PNG - a social card is a different job", () => {
  const index = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(index, /og:image" content="https:\/\/rjasti\.com\/social-preview\.png"/);
  for (const app of ["ucl", "worldcup", "arcade", "cron", "crypto", "json", "diff"]) {
    assert.ok(
      fs.existsSync(path.join(__dirname, `../${app}-preview.png`)),
      `${app}'s OG card was deleted with its tile`,
    );
  }
});

test("the scrim that held the baked-in copy back is gone with it", () => {
  const css = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");
  assert.doesNotMatch(css, /--app-media-scrim:/, "the token outlived the veil it drove");
  assert.doesNotMatch(css, /\.app-tile-media::after\s*\{/, "the veil is still painted");
});

test("the filter is addressable, and a chip press says so in the URL", async () => {
  const dom = mount();
  const { initAppsFilter } = await import(`../js/apps-filter.js?tile=${Math.random()}`);
  initAppsFilter();

  const devTools = dom.window.document.querySelector('[data-app-filter="dev-tools"]');
  click(dom, devTools);
  assert.equal(dom.window.location.hash, "#apps/dev-tools");

  // Pressing it again clears the filter, and the URL goes back with it.
  click(dom, devTools);
  assert.equal(dom.window.location.hash, "#apps");
});

test("landing on #apps/dev-tools opens the shelf filtered", async () => {
  const dom = new JSDOM(INDEX, { url: "https://rjasti.com/#apps/dev-tools" });
  global.window = dom.window;
  global.document = dom.window.document;

  const { initAppsFilter } = await import(`../js/apps-filter.js?deep=${Math.random()}`);
  initAppsFilter();

  const d = dom.window.document;
  assert.equal(d.querySelector('[data-app-filter="dev-tools"]').getAttribute("aria-pressed"), "true");
  const shown = [...d.querySelectorAll(".app-grid .app-tile")].filter((t) => !t.hidden);
  assert.ok(shown.length > 0 && shown.length < 7);
  assert.ok(shown.every((t) => t.dataset.appCategory === "dev-tools"));
});

test("an unknown slug falls back to All rather than an empty grid", async () => {
  const dom = new JSDOM(INDEX, { url: "https://rjasti.com/#apps/retired-category" });
  global.window = dom.window;
  global.document = dom.window.document;

  const { initAppsFilter } = await import(`../js/apps-filter.js?bad=${Math.random()}`);
  initAppsFilter();

  const shown = [...dom.window.document.querySelectorAll(".app-grid .app-tile")].filter((t) => !t.hidden);
  assert.equal(shown.length, 7, "a stale bookmark emptied the shelf");
});

test("the router resolves a section from the first segment only", async () => {
  const { getValidHashTarget } = await import(`../js/app-logic.js?seg=${Math.random()}`)
    .then(() => globalThis.AppLogic);
  const exists = (id) => (["apps", "home", "about"].includes(id) ? {} : null);

  assert.equal(getValidHashTarget("#apps/dev-tools", exists, "home"), "apps");
  assert.equal(getValidHashTarget("#apps", exists, "home"), "apps");
  assert.equal(getValidHashTarget("#nope/dev-tools", exists, "home"), "home");
});

test("every tile says what it costs to try, in the place the choice is made", () => {
  const dom = mount();
  for (const tile of dom.window.document.querySelectorAll(".app-grid .app-tile")) {
    const traits = [...tile.querySelectorAll(".app-tile-trait")].map((t) => t.textContent.trim());
    assert.ok(traits.length >= 2 && traits.length <= 3, `${tile.getAttribute("href")} has ${traits.length} traits`);
    assert.ok(traits.includes("No sign-in"), "every one of these runs without an account");
    assert.equal(new Set(traits).size, traits.length, "a tile repeats itself");

    // The row sits above the Launch pill, which is what it is qualifying.
    const body = tile.querySelector(".app-tile-body");
    const kids = [...body.children];
    assert.ok(
      kids.indexOf(tile.querySelector(".app-tile-traits")) < kids.indexOf(tile.querySelector(".app-tile-cta")),
    );
  }
});

test("a tile that says nothing is stored is one that stores nothing by default", () => {
  const dom = mount();
  for (const tile of dom.window.document.querySelectorAll(".app-grid .app-tile")) {
    const traits = [...tile.querySelectorAll(".app-tile-trait")].map((t) => t.textContent.trim());
    if (!traits.includes("Nothing stored")) continue;

    const page = `${tile.getAttribute("href").replace(/^\//, "")}.html`;
    const markup = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
    assert.match(
      markup,
      /Remember my (document|panes)/,
      `${page} claims nothing is stored but has no opt-in to be the exception`,
    );
  }
});
