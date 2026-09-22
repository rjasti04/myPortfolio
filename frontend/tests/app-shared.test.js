// Cover for the two modules every standalone app now runs: the header app
// switcher and the `?` shortcuts sheet.
//
// Both replace something that was invisible rather than broken - seven apps
// that were dead ends, and /diff's j/k bindings that nothing documented - so
// the failure mode is also invisible: a switcher that quietly lists six apps,
// or a sheet that lists a key nothing is bound to. Those are what these
// assert.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

import { initAppSwitcher, APPS } from "../js/app-shared/app-switcher.js";
import { initAppShortcuts } from "../js/app-shared/app-shortcuts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

/** The seven apps the shelf lists, from the shelf itself. */
const SHELF_HREFS = [...read("index.html").matchAll(/<a class="app-tile[^"]*"[^>]*href="([^"]+)"/g)]
  .map((m) => m[1]);

function mount(page, url) {
  const dom = new JSDOM(read(page), { url, pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  return dom;
}

const key = (dom, init) =>
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, ...init }));

test("the switcher lists every app the shelf does, and no others", () => {
  assert.deepEqual(
    APPS.map((app) => app.href).sort(),
    SHELF_HREFS.slice().sort(),
    "the switcher and the shelf have drifted apart",
  );
});

test("the switcher marks exactly one entry as current", () => {
  const dom = mount("json.html", "https://rjasti.com/json");
  initAppSwitcher({ current: "json", doc: dom.window.document });

  const items = dom.window.document.querySelectorAll(".app-switcher-item");
  // Seven apps, plus Portfolio home and All apps.
  assert.equal(items.length, APPS.length + 2);

  const current = dom.window.document.querySelectorAll('.app-switcher-item[aria-current="page"]');
  assert.equal(current.length, 1);
  assert.equal(current[0].getAttribute("href"), "/json");
});

test("the Back link survives - it was one press and it stays one press", () => {
  const dom = mount("diff.html", "https://rjasti.com/diff");
  initAppSwitcher({ current: "diff", doc: dom.window.document });

  const back = dom.window.document.querySelector(".back-btn");
  assert.ok(back, "the back control was replaced rather than kept");
  assert.equal(back.getAttribute("href"), "/");
  assert.equal(back.parentElement.className, "app-switcher");
});

test("the menu opens, closes on Escape, and returns focus to its trigger", () => {
  const dom = mount("cron.html", "https://rjasti.com/cron");
  const switcher = initAppSwitcher({ current: "cron", doc: dom.window.document });
  const d = dom.window.document;
  const trigger = d.getElementById("app-switcher-trigger");
  const menu = d.getElementById("app-switcher-menu");

  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");

  switcher.open();
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");

  menu.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(menu.hidden, true);
  assert.equal(d.activeElement, trigger, "focus was left inside a closed menu");
});

test("every app the switcher lists is a page that actually ships", () => {
  for (const app of APPS) {
    const file = `${app.href.replace(/^\//, "")}.html`;
    assert.ok(
      fs.existsSync(path.join(__dirname, "..", file)),
      `${app.href} is listed but ${file} does not exist`,
    );
  }
});

test("the shortcuts sheet is generated from the bindings, not written beside them", () => {
  const dom = mount("diff.html", "https://rjasti.com/diff");
  let stepped = 0;
  const sheet = initAppShortcuts({
    focusPrimary: "#input-left",
    tabs: ".mode-tabs .tab-btn",
    extra: [
      { keys: ["j"], label: "Next change", run: () => { stepped += 1; } },
      { keys: ["k"], label: "Previous change", run: () => { stepped -= 1; } },
    ],
    doc: dom.window.document,
  });

  const rows = dom.window.document.querySelectorAll(".shortcuts-list dt");
  // Every registered binding, plus Esc and `?` which this module owns.
  assert.equal(rows.length, sheet.shortcuts.length + 2);

  const labels = [...dom.window.document.querySelectorAll(".shortcuts-list dd")].map((d) => d.textContent);
  assert.ok(labels.includes("Next change"), "a bound key is missing from the sheet");
  assert.ok(labels.includes("Show or hide this sheet"));
});

test("`?` opens and closes the sheet; Escape closes it", () => {
  const dom = mount("diff.html", "https://rjasti.com/diff");
  initAppShortcuts({ focusPrimary: "#input-left", doc: dom.window.document });
  const panel = dom.window.document.getElementById("shortcuts-sheet");

  assert.equal(panel.hidden, true);
  key(dom, { key: "?" });
  assert.equal(panel.hidden, false);
  key(dom, { key: "Escape" });
  assert.equal(panel.hidden, true);
});

test("shortcuts stay out of the way while you are typing", () => {
  const dom = mount("diff.html", "https://rjasti.com/diff");
  initAppShortcuts({ focusPrimary: "#input-left", doc: dom.window.document });
  const d = dom.window.document;
  const panel = d.getElementById("shortcuts-sheet");

  d.getElementById("input-left").focus();
  d.getElementById("input-left").dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "?", bubbles: true }),
  );
  assert.equal(panel.hidden, true, "`?` opened the sheet from inside a textarea");

  // And a modifier combination is the browser's, not ours.
  key(dom, { key: "?", metaKey: true });
  assert.equal(panel.hidden, true);
});

test("`/` focuses the app's primary input", () => {
  const dom = mount("json.html", "https://rjasti.com/json");
  initAppShortcuts({ focusPrimary: "#source-input", doc: dom.window.document });
  key(dom, { key: "/" });
  assert.equal(dom.window.document.activeElement.id, "source-input");
});

test("a digit switches tab", () => {
  const dom = mount("json.html", "https://rjasti.com/json");
  initAppShortcuts({ tabs: ".mode-tabs .tab-btn", doc: dom.window.document });

  let clicked = null;
  for (const btn of dom.window.document.querySelectorAll(".mode-tabs .tab-btn")) {
    btn.addEventListener("click", () => { clicked = btn.dataset.tab; });
  }

  key(dom, { key: "3" });
  assert.equal(clicked, "tree", "3 should reach the third tab");
});

test("suppress hands the keyboard back to the app entirely", () => {
  const dom = mount("arcade.html", "https://rjasti.com/arcade");
  let playing = false;
  initAppShortcuts({ suppress: () => playing, doc: dom.window.document });
  const panel = dom.window.document.getElementById("shortcuts-sheet");

  key(dom, { key: "?" });
  assert.equal(panel.hidden, false);

  // A game starts while the sheet is up: the sheet gets out of the way rather
  // than answering Escape alongside the shell.
  playing = true;
  key(dom, { key: "Escape" });
  assert.equal(panel.hidden, true);

  key(dom, { key: "?" });
  assert.equal(panel.hidden, true, "the sheet opened while the app owned the keyboard");
});

test("a documentation-only entry is listed and binds nothing", () => {
  const dom = mount("arcade.html", "https://rjasti.com/arcade");
  initAppShortcuts({
    extra: [{ keys: ["Esc"], label: "Pause, resume, or leave a game" }],
    doc: dom.window.document,
  });

  const labels = [...dom.window.document.querySelectorAll(".shortcuts-list dd")].map((d) => d.textContent);
  assert.ok(labels.includes("Pause, resume, or leave a game"));
  // No `run`, so nothing throws when the key arrives.
  assert.doesNotThrow(() => key(dom, { key: "Esc" }));
});

test("every app links the stylesheet the shared chrome is drawn with", () => {
  for (const app of APPS) {
    const markup = read(`${app.href.replace(/^\//, "")}.html`);
    assert.match(
      markup,
      /href="app-shared\.css"/,
      `${app.href} runs js/app-shared/ but does not link app-shared.css`,
    );
  }
});

test("app-shared.css names only the seven-token chrome contract", () => {
  const css = read("app-shared.css");
  const tokens = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const allowed = new Set([
    "--chrome-bg", "--chrome-border", "--chrome-text", "--chrome-muted",
    "--chrome-accent", "--chrome-action-bg", "--chrome-action-hover",
  ]);
  for (const token of tokens) {
    assert.ok(
      allowed.has(token),
      `${token} is not in the chrome contract, so it will be undefined on some app`,
    );
  }
  // And every app publishes all of them.
  for (const app of APPS) {
    const file = app.href.replace(/^\//, "");
    const source = fs.existsSync(path.join(__dirname, "..", `${file}.css`))
      ? read(`${file}.css`)
      : read(`${file}.html`);
    for (const token of tokens) {
      assert.match(source, new RegExp(`${token}:`), `${file} never defines ${token}`);
    }
  }
});
