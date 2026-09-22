// Cover for the About tab on /cron, /crypto and /json, and the option grouping
// and swap/sample controls on /diff.
//
// /diff's About tab was the best writing in the shelf - what the engine is,
// where it stops, what it is knowingly wrong about - and three apps had
// nothing like it. For the site as a work sample that tab is the page that
// shows judgement, so "does it exist and is it wired" is worth a guard.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const doc = (name) => new JSDOM(read(name)).window.document;

const APPS_WITH_ABOUT = ["cron", "crypto", "json", "diff"];

for (const app of APPS_WITH_ABOUT) {
  test(`/${app} has an About tab wired to a panel`, () => {
    const d = doc(`${app}.html`);

    const tab = d.querySelector('[role="tab"][data-tab="about"]');
    assert.ok(tab, "no About tab");
    assert.equal(tab.getAttribute("aria-controls"), "panel-about");

    const panel = d.getElementById("panel-about");
    assert.ok(panel, "the tab controls a panel that does not exist");
    assert.equal(panel.getAttribute("role"), "tabpanel");
    assert.equal(panel.getAttribute("aria-labelledby"), tab.id);
    assert.equal(panel.hidden, true, "About should not be the tab the app opens on");
  });

  test(`/${app}'s About says what it does, where it stops, and what it stores`, () => {
    const panel = doc(`${app}.html`).getElementById("panel-about");
    const text = panel.textContent;

    assert.ok(text.length > 800, "an About tab that says almost nothing");
    assert.match(panel.innerHTML, /prose-card/, "it should use the shared prose treatment");
    assert.ok(
      [...panel.querySelectorAll(".prose-heading")].some((h) => /limits/i.test(h.textContent)),
      "no Limits section - the part that shows judgement",
    );
    assert.match(text, /connect-src 'none'/, "the zero-egress claim should be stated, not implied");
  });

  test(`/${app} registers about as a valid tab`, () => {
    const entry = {
      cron: "js/cron/cron-main.js",
      crypto: "js/crypto/crypto-main.js",
      json: "js/json/json-main.js",
      diff: "js/diff/diff-main.js",
    }[app];
    assert.match(read(entry), /VALID_TABS = \[[^\]]*"about"/, `${entry} cannot route to About`);
  });
}

test("the prose treatment lives in one place, not four", () => {
  assert.match(read("app-chrome.css"), /\.prose-card \{/);
  assert.doesNotMatch(read("diff.css"), /\.prose-card \{/, "diff.css kept its private copy");
});

test("/json's Compare tab is wired, and reads the source document", () => {
  const d = doc("json.html");

  const tab = d.querySelector('[role="tab"][data-tab="compare"]');
  assert.ok(tab);
  assert.ok(d.getElementById("panel-compare"));
  assert.ok(d.getElementById("compare-input"), "nowhere to paste the other document");
  assert.ok(d.getElementById("compare-ignore-key-order"), "no control for the thing the tab exists to do");
  assert.ok(d.getElementById("btn-compare-swap"));
  assert.match(read("js/json/json-ui.js"), /compareDocuments/);
});

test("/json's source card can get out of the way once a document parses", () => {
  const d = doc("json.html");
  const button = d.getElementById("btn-source-collapse");

  assert.ok(button, "no collapse control");
  assert.equal(button.getAttribute("aria-controls"), "source-body");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(button.hidden, true, "there is nothing to collapse before a document arrives");
  assert.ok(d.getElementById("source-body").contains(d.getElementById("source-input")));

  // The status strip stays outside the collapsing part - it is the summary a
  // collapsed card shows.
  assert.equal(d.getElementById("source-body").contains(d.getElementById("source-status")), false);
});

test("/diff's options are three named groups, not one wrap row", () => {
  const d = doc("diff.html");
  const groups = [...d.querySelectorAll(".options-row .opt-group")];

  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((g) => g.querySelector("legend").textContent.trim()),
    ["Compare", "View", "Session"],
  );

  // The four "ignores" change what counts as a difference; they belong together.
  const compare = groups[0];
  for (const id of ["opt-ignore-whitespace", "opt-trim-trailing", "opt-ignore-case", "opt-ignore-blank"]) {
    assert.ok(compare.querySelector(`#${id}`), `${id} is not under Compare`);
  }
  // "Remember my panes" is a privacy choice, not another comparison flag.
  assert.ok(groups[2].querySelector("#opt-remember"));
  assert.ok(groups[1].querySelector("#btn-view-split"));
  assert.ok(groups[1].querySelector("#opt-context"));
});

test("/diff can swap its panes and open with something to look at", () => {
  const d = doc("diff.html");
  assert.ok(d.getElementById("btn-swap"), "no swap control on a diff tool");
  assert.ok(d.getElementById("btn-sample"), "the app still opens with two empty boxes");

  const ui = read("js/diff/diff-ui.js");
  assert.match(ui, /SAMPLE_LEFT/);
  assert.match(ui, /SAMPLE_RIGHT/);
  // A sample that is identical on both sides would demo nothing.
  const left = ui.match(/const SAMPLE_LEFT = `([\s\S]*?)`;/)[1];
  const right = ui.match(/const SAMPLE_RIGHT = `([\s\S]*?)`;/)[1];
  assert.notEqual(left, right);
  assert.ok(left.trim().length > 0 && right.trim().length > 0);
});

test("/diff's j and k are registered through the shortcuts table, not bound twice", () => {
  const ui = read("js/diff/diff-ui.js");
  const main = read("js/diff/diff-main.js");

  assert.doesNotMatch(ui, /event\.key === "j"/, "diff-ui still binds j itself");
  assert.match(ui, /return \{ stepChange \}/, "the stepper is not exported");
  assert.match(main, /label: "Next change"/);
  assert.match(main, /workbench\.stepChange\(1\)/);
});

test("the brand names now stand alone below 960px, where the tag is hidden", () => {
  const chrome = read("app-chrome.css");
  assert.match(chrome, /@media \(max-width: 960px\)[\s\S]*?\.brand-tag \{\s*display: none;/);

  for (const [app, title] of [["diff", "Diff Checker"], ["cron", "Cron &amp; Regex"]]) {
    const brand = doc(`${app}.html`).querySelector(".brand-title").textContent.trim();
    assert.equal(brand, title.replace("&amp;", "&"));
    // A title that is a noun phrase missing its noun is what this fixes.
    assert.ok(brand.split(" ").length >= 2);
  }
});

test("the cron brand matches the tile that launches it", () => {
  // The markup carries the entity; textContent below has already decoded it.
  const tile = read("index.html")
    .match(/<h3 class="app-tile-title">(Cron[^<]*)<\/h3>/)[1]
    .replace(/&amp;/g, "&");
  const d = doc("cron.html");
  const brand = `${d.querySelector(".brand-title").textContent.trim()} ${d.querySelector(".brand-tag").textContent.trim()}`;
  assert.equal(brand, tile, "the tile and the page still disagree about the app's name");
});

test("Minify wears no directional glyph", () => {
  const icon = doc("json.html").querySelector("#btn-minify i");
  assert.doesNotMatch(icon.className, /arrow/, "two left-pointing glyphs meaning unrelated things");
  assert.match(icon.className, /fa-layer-group/);
});

test("every icon the apps ask for is one the vendored font actually carries", () => {
  // The five local-font apps render an unvendored class as blank space with no
  // error, which is exactly the kind of thing that ships unnoticed. /ucl and
  // /worldcup load Font Awesome from cdnjs, so they are excluded - that is the
  // standing exception in AGENTS.md, not an oversight here.
  const vendored = new Set(
    [...read("fonts.css").matchAll(/^\.(fa-[a-z0-9-]+)::before/gm)].map((m) => m[1]),
  );

  const sources = ["cron.html", "crypto.html", "json.html", "diff.html", "arcade.html",
    "js/app-shared/app-switcher.js", "js/app-shared/app-shortcuts.js",
    "js/json/json-ui.js", "js/crypto/crypto-ui.js", "js/diff/diff-ui.js"];

  for (const file of sources) {
    const used = new Set(
      [...read(file).matchAll(/\bfa-[a-z0-9-]+/g)].map((m) => m[0]),
    );
    for (const icon of used) {
      if (["fa-solid", "fa-regular", "fa-brands"].includes(icon)) continue;
      assert.ok(vendored.has(icon), `${file} uses ${icon}, which fonts.css does not carry`);
    }
  }
});
