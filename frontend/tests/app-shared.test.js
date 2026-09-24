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

/* --- Codebase review section 4: Dev Tools focus and semantics ------------- */

const DEV_TOOLS = ["cron", "crypto", "json", "diff"];

// U4: tab panels are Tab stops whose focus ring was removed with nothing in
// its place, and /crypto's hash and output fields did the same (WCAG 2.4.7).
test("every Dev Tools Tab stop shows where focus is", () => {
  for (const sheet of ["cron.css", "crypto.css"]) {
    const css = read(sheet);
    assert.doesNotMatch(css, /\.panel-container:focus\s*\{\s*outline:\s*none/, `${sheet} still hides panel focus outright`);
    assert.match(css, /\.panel-container:focus-visible\s*\{[^}]*outline:\s*2px solid/, `${sheet} has no visible panel focus`);
  }
  const crypto = read("crypto.css");
  assert.match(crypto, /\.hash-input:focus-visible/);
  assert.match(crypto, /\.field-output:focus-visible/);
});

// U6 (1): a hidden file input nested in a role="button" dropzone was a
// nameless Tab stop inside another control. diff.html had it right.
test("no file input is a Tab stop of its own", () => {
  for (const app of DEV_TOOLS) {
    const d = new JSDOM(read(`${app}.html`)).window.document;
    for (const input of d.querySelectorAll('input[type="file"]')) {
      assert.equal(input.getAttribute("tabindex"), "-1", `${app}: #${input.id}`);
      assert.equal(input.getAttribute("aria-hidden"), "true", `${app}: #${input.id}`);
    }
  }
});

// U6 (3): aria-modal="true" with nothing keeping Tab inside.
test("the shortcuts sheet keeps Tab inside itself", () => {
  const dom = mount("diff.html", "https://rjasti.com/diff");
  initAppShortcuts({ focusPrimary: "#input-left", doc: dom.window.document });
  const d = dom.window.document;
  const panel = d.getElementById("shortcuts-sheet");

  key(dom, { key: "?" });
  assert.equal(panel.hidden, false);
  const tab = (shiftKey) => d.activeElement.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }),
  );
  assert.equal(tab(false), false, "Tab from the last control is taken back");
  assert.ok(panel.contains(d.activeElement));
  assert.equal(tab(true), false, "and so is Shift+Tab from the first");
  assert.ok(panel.contains(d.activeElement));
});

// U6 (4): role="menu" promised arrow keys and a single Tab stop it never had.
test("the Apps switcher is a disclosure of links, not an ARIA menu", () => {
  const dom = mount("cron.html", "https://rjasti.com/cron");
  const switcher = initAppSwitcher({ current: "cron", doc: dom.window.document });
  const d = dom.window.document;
  const menu = d.getElementById("app-switcher-menu");

  assert.equal(menu.tagName, "NAV");
  assert.equal(d.querySelector('[role="menu"], [role="menuitem"]'), null);
  assert.equal(d.getElementById("app-switcher-trigger").hasAttribute("aria-haspopup"), false);
  switcher.open();
  assert.equal(d.activeElement, menu.querySelector("a"), "opening moves focus to the first link");
});

// U11: three apps had no <h1> and /json's was a card title; arcade had no
// <main>; a control's name has to contain what it shows (WCAG 2.5.3).
test("each app has one top-level heading and a main landmark", () => {
  for (const app of [...DEV_TOOLS, "arcade"]) {
    const d = new JSDOM(read(`${app}.html`)).window.document;
    assert.equal(d.querySelectorAll("h1").length, 1, `${app}.html`);
    assert.equal(d.querySelectorAll("main").length, 1, `${app}.html`);
  }
  const json = new JSDOM(read("json.html")).window.document;
  assert.equal(json.querySelector("h1").textContent.trim(), "JSON Workbench");
});

test("a labelled control's name contains the words on it", () => {
  for (const app of [...DEV_TOOLS, "arcade"]) {
    const d = new JSDOM(read(`${app}.html`)).window.document;
    for (const label of d.querySelectorAll(".action-label, .back-label-long, .back-label-short")) {
      const control = label.closest("[aria-label]");
      if (!control) continue;
      const name = control.getAttribute("aria-label").toLowerCase();
      assert.ok(
        name.includes(label.textContent.trim().toLowerCase()),
        `${app}: "${control.getAttribute("aria-label")}" does not contain "${label.textContent.trim()}"`,
      );
    }
  }
});

function mountApp(page, url) {
  const dom = mount(page, url);
  global.localStorage = dom.window.localStorage;
  global.history = dom.window.history;
  global.location = dom.window.location;
  global.navigator ??= dom.window.navigator;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  global.matchMedia = dom.window.matchMedia;
  return dom;
}

// U6 (2): Split/Unified showed its state by colour alone.
test("Diff's layout toggle exposes which layout is on", async () => {
  const dom = mountApp("diff.html", "https://rjasti.com/diff");
  const { initWorkbench } = await import("../js/diff/diff-ui.js");
  initWorkbench();
  const d = dom.window.document;
  const split = d.getElementById("btn-view-split");
  const unified = d.getElementById("btn-view-unified");
  assert.equal(split.getAttribute("aria-pressed"), "true");

  unified.click();
  assert.equal(unified.getAttribute("aria-pressed"), "true");
  assert.equal(split.getAttribute("aria-pressed"), "false");
});

// U6 (5): /crypto's results and errors landed in a read-only field that
// nothing announced.
test("a /crypto error is announced once, not on every keystroke", async () => {
  const dom = mountApp("crypto.html", "https://rjasti.com/crypto");
  const { initCryptoUI } = await import("../js/crypto/crypto-ui.js");
  // The Unix-time panel ticks on a global interval, which would hold the
  // test process open.
  const realSetInterval = global.setInterval;
  global.setInterval = () => 0;
  try {
    initCryptoUI();
  } finally {
    global.setInterval = realSetInterval;
  }
  const d = dom.window.document;
  const status = d.getElementById("crypto-status");
  const input = d.getElementById("encoder-input");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

  d.getElementById("encoder-format").value = "base64";
  d.getElementById("encoder-decode-btn").click();
  input.value = "%%%";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await settle();
  assert.match(status.textContent, /^Error:/);

  status.textContent = "unchanged";
  input.value = "%%%%";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await settle();
  assert.equal(status.textContent, "unchanged", "the same error is not re-announced per keystroke");
});

/* --- Codebase review section 4: Dev Tools resilience and consistency ------ */

/** Mounts an app page with its entry module's DOMContentLoaded handler run. */
async function bootApp(page, url, entry, { blockStorage = false, reduceMotion = false } = {}) {
  const dom = mountApp(page, url);
  if (blockStorage) {
    const blocked = () => { throw new dom.window.DOMException("The operation is insecure.", "SecurityError"); };
    Object.defineProperty(global, "localStorage", { get: blocked, configurable: true });
    Object.defineProperty(dom.window, "localStorage", { get: blocked, configurable: true });
  }
  dom.window.matchMedia = (query = "") => ({
    matches: reduceMotion && query.includes("reduced-motion"),
    addEventListener() {}, removeEventListener() {},
  });
  global.matchMedia = dom.window.matchMedia;
  const scrolls = [];
  dom.window.scrollTo = (opts) => scrolls.push(opts?.behavior);
  dom.window.Element.prototype.scrollIntoView = (opts) => scrolls.push(opts?.behavior);
  const realSetInterval = global.setInterval;
  global.setInterval = () => 0;
  try {
    // A fresh module instance per boot: each registers its own
    // DOMContentLoaded handler against the document mounted for it.
    await import(`../js/${entry}?boot=${Math.random()}`);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  } finally {
    global.setInterval = realSetInterval;
    if (blockStorage) delete global.localStorage;
  }
  return { dom, d: dom.window.document, scrolls };
}

// U5: /crypto never wired its tabs and /cron lost its theme toggle when
// reading the saved theme threw.
test("/crypto and /cron still work with browser storage blocked", async () => {
  const crypto = await bootApp("crypto.html", "https://rjasti.com/crypto", "crypto/crypto-main.js", { blockStorage: true });
  crypto.d.querySelector('.mode-tabs [data-tab="hasher"]').click();
  assert.equal(crypto.d.getElementById("panel-hasher").hidden, false, "the tabs are wired");

  const cron = await bootApp("cron.html", "https://rjasti.com/cron", "cron/cron-main.js", { blockStorage: true });
  const before = cron.d.documentElement.getAttribute("data-theme");
  cron.d.getElementById("theme-toggle-btn").click();
  assert.notEqual(cron.d.documentElement.getAttribute("data-theme"), before, "the theme toggle is wired");
});

// U8: JS smooth scrolling ignores the stylesheet's reduced-motion rule.
test("tab switches do not animate the scroll under reduced motion", async () => {
  for (const [page, entry, tab] of [
    ["crypto.html", "crypto/crypto-main.js", "hasher"],
    ["cron.html", "cron/cron-main.js", "regex"],
  ]) {
    const { d, scrolls } = await bootApp(page, `https://rjasti.com/${page}`, entry, { reduceMotion: true });
    scrolls.length = 0;
    d.querySelector(`.mode-tabs [data-tab="${tab}"]`).click();
    assert.ok(scrolls.length > 0, `${page}: precondition - the tab switch scrolls`);
    assert.ok(scrolls.every((b) => b === "auto"), `${page}: ${scrolls.join(", ")}`);
  }
});

// U10: "Copied!" showed whatever execCommand returned.
test("a copy that failed says so", async () => {
  const { d } = await bootApp("cron.html", "https://rjasti.com/cron", "cron/cron-main.js");
  Object.defineProperty(global, "navigator", { value: { clipboard: undefined }, configurable: true });
  d.execCommand = () => false;
  try {
    d.getElementById("cron-copy-btn").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(d.getElementById("cron-copy-btn").textContent, /Copy failed/);
    assert.equal(d.getElementById("cron-copy-btn").classList.contains("copied"), false);

    const { copyWithFeedback } = await import("../js/crypto/crypto-ui.js");
    const btn = d.createElement("button");
    await copyWithFeedback("secret", btn);
    assert.match(btn.textContent, /Copy failed/);
  } finally {
    delete global.navigator;
  }
});

test("the /cron toast can be dismissed and holds while hovered", async () => {
  const { d, dom } = await bootApp("cron.html", "https://rjasti.com/cron", "cron/cron-main.js");
  d.getElementById("theme-toggle-btn").click();
  const toast = d.getElementById("toast-notification");
  assert.ok(toast.classList.contains("show"));
  toast.dispatchEvent(new dom.window.MouseEvent("mouseenter"));
  toast.querySelector('button[aria-label="Dismiss notification"]').click();
  assert.equal(toast.classList.contains("show"), false);
});

// U10: /diff raised alert() for a large file and showed nothing for a file
// that failed to read.
test("/diff explains a refused or unreadable file in the pane", async () => {
  const dom = mountApp("diff.html", "https://rjasti.com/diff");
  dom.window.alert = () => { throw new Error("alert() is not how this page talks"); };
  const { initWorkbench } = await import(`../js/diff/diff-ui.js?notes=${Math.random()}`);
  initWorkbench();
  const d = dom.window.document;
  const drop = (file) => {
    const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    d.getElementById("input-left").dispatchEvent(event);
  };

  drop({ size: 6 * 1024 * 1024, text: async () => "" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(d.getElementById("note-left").textContent, /limit is 5 MB/);

  drop({ size: 10, text: async () => { throw new Error("NotReadableError"); } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(d.getElementById("note-left").textContent, "Couldn't read that file.");
});

// U10: `/` claimed the key even when its input sat in a hidden tab panel.
test("`/` lets the key through when the primary input is hidden", () => {
  const dom = new JSDOM('<!doctype html><body><section hidden><input id="primary"></section></body>');
  global.window = dom.window;
  global.document = dom.window.document;
  initAppShortcuts({ focusPrimary: "#primary", doc: dom.window.document });
  const event = new dom.window.KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
  dom.window.document.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.notEqual(dom.window.document.activeElement.id, "primary");
});

// U12: arcade's Back link lacked .back-btn, so the switcher silently mounted
// nothing there; the trigger it mounts needs arcade's own styling.
test("/arcade gets the Apps switcher, styled in its own vocabulary", () => {
  const dom = mount("arcade.html", "https://rjasti.com/arcade");
  const switcher = initAppSwitcher({ current: "arcade", doc: dom.window.document });
  assert.ok(switcher, "initAppSwitcher found no Back control on /arcade");
  assert.equal(dom.window.document.querySelector(".back-btn").getAttribute("href"), "/");
  assert.match(read("arcade.css"), /\.app-switcher-trigger\s*\{/);
});

// U12: the four Dev Tools pages flashed dark before applying a saved light
// theme.
test("the pre-paint script applies the saved theme, or the system's", () => {
  const source = read("js/app-shared/theme-prepaint.js");
  const run = ({ stored, systemLight, blocked = false }) => {
    const dom = new JSDOM('<!doctype html><html data-theme="dark"><head></head></html>', {
      runScripts: "outside-only", url: "https://rjasti.com/cron",
    });
    if (blocked) {
      Object.defineProperty(dom.window, "localStorage", { get() { throw new Error("blocked"); } });
    } else if (stored) {
      dom.window.localStorage.setItem("theme", stored);
    }
    dom.window.matchMedia = () => ({ matches: systemLight });
    dom.window.eval(source);
    return dom.window.document.documentElement.getAttribute("data-theme");
  };
  assert.equal(run({ stored: "light", systemLight: false }), "light");
  assert.equal(run({ stored: "bogus", systemLight: true }), "light");
  assert.equal(run({ blocked: true, systemLight: true }), "light");
  assert.equal(run({ blocked: true, systemLight: false }), "dark");
  for (const app of DEV_TOOLS) {
    assert.match(read(`${app}.html`), /<script src="js\/app-shared\/theme-prepaint\.js"><\/script>/, app);
  }
});

// U6 and U12: one confirm pattern - the same class, the same 4s, and an
// armed state a screen reader hears.
test("the Dev Tools two-press confirms match each other", () => {
  for (const file of ["js/diff/diff-ui.js", "js/json/json-main.js", "js/crypto/crypto-ui.js"]) {
    const code = read(file);
    assert.match(code, /"is-confirming"/, file);
    assert.doesNotMatch(code, /"confirming"/, `${file} still uses the old class`);
    assert.match(code, /press again to confirm/, `${file} does not announce the armed state`);
    assert.doesNotMatch(code, /\}, 3000\);/, `${file} still stands down after 3s`);
  }
});
