import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

let dom;
let window;
let document;
let initResumePdf;

// Mutable so a test can pretend to be a touch device or an iPad.
const mediaState = { "(hover: hover) and (pointer: fine)": true };

function createResumeMarkup() {
  return `
    <div class="hero-buttons">
      <a href="#resume" data-target="resume" class="nav-cta btn">Resume</a>
      <div class="split-btn" id="hero-resume-split">
        <a href="rjasti_resume-cUvKStx_.pdf" class="btn split-btn-main" id="hero-pdf-view" data-pdf-view>View PDF</a>
        <button type="button" class="btn split-btn-toggle" id="hero-pdf-more" aria-haspopup="true"
          aria-expanded="false" aria-controls="hero-pdf-menu">Caret</button>
        <div class="split-btn-menu" id="hero-pdf-menu" role="menu" aria-hidden="true">
          <a href="rjasti_resume-cUvKStx_.pdf" download="Rajeev_Jasti_Resume.pdf" class="split-btn-item"
            role="menuitem">Download PDF</a>
        </div>
      </div>
    </div>
    <p class="section-actions">
      <a href="rjasti_resume-cUvKStx_.pdf" target="_blank" rel="noopener noreferrer" class="btn"
        id="resume-pdf-view" data-pdf-view>View PDF</a>
      <a href="rjasti_resume-cUvKStx_.pdf" download="Rajeev_Jasti_Resume.pdf" class="btn btn-outline">Download PDF</a>
    </p>
    <div class="pdf-modal" id="resume-pdf-modal" role="dialog" aria-modal="true" aria-hidden="true">
      <div class="pdf-modal-panel">
        <div class="pdf-modal-bar">
          <div class="pdf-modal-actions">
            <a class="pdf-modal-action" id="resume-pdf-modal-tab" href="rjasti_resume-cUvKStx_.pdf">Open in new tab</a>
            <button type="button" class="pdf-modal-close" id="resume-pdf-modal-close">Close</button>
          </div>
        </div>
        <div class="pdf-modal-frame" id="resume-pdf-frame"></div>
      </div>
    </div>
  `;
}

function resetResumeDom() {
  document.body.innerHTML = createResumeMarkup();
  initResumePdf();
}

const trigger = () => document.getElementById("resume-pdf-view");
const modal = () => document.getElementById("resume-pdf-modal");
const frame = () => document.getElementById("resume-pdf-frame");

function clickTrigger() {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  trigger().dispatchEvent(event);
  return event;
}

test.before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://rjasti.com/#resume",
    pretendToBeVisual: true,
  });
  window = dom.window;
  document = window.document;

  window.matchMedia = (query) => ({
    get matches() {
      return Boolean(mediaState[query]);
    },
    addEventListener() {},
    removeEventListener() {},
  });

  window.requestAnimationFrame = (cb) => { cb(); return 0; };

  global.window = window;
  global.document = document;
  global.HTMLElement = window.HTMLElement;
  global.requestAnimationFrame = window.requestAnimationFrame;
  Object.defineProperty(global, "navigator", {
    configurable: true,
    value: window.navigator,
  });

  ({ initResumePdf } = await import("../js/resume-pdf.js"));
});

test.after(() => {
  delete global.window;
  delete global.document;
  delete global.HTMLElement;
  delete global.requestAnimationFrame;
  dom?.window?.close();
});

test("resume pdf viewer", async (t) => {
  await t.test("opens the dialog and mounts an iframe at the link's href", () => {
    mediaState["(hover: hover) and (pointer: fine)"] = true;
    resetResumeDom();

    // Nothing is fetched until the visitor asks for it.
    assert.equal(frame().querySelector("iframe"), null);

    const event = clickTrigger();

    assert.equal(event.defaultPrevented, true, "the navigation is replaced by the dialog");
    assert.equal(modal().classList.contains("active"), true);
    assert.equal(modal().getAttribute("aria-hidden"), "false");
    // The build content-hashes the PDF, so the src has to come from the DOM.
    assert.equal(frame().querySelector("iframe").getAttribute("src"), "rjasti_resume-cUvKStx_.pdf");
  });

  await t.test("closing tears the iframe back down", () => {
    mediaState["(hover: hover) and (pointer: fine)"] = true;
    resetResumeDom();
    clickTrigger();

    document.getElementById("resume-pdf-modal-close").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true })
    );

    assert.equal(modal().classList.contains("active"), false);
    assert.equal(modal().getAttribute("aria-hidden"), "true");
    assert.equal(frame().querySelector("iframe"), null, "no viewer left rendering behind the dialog");
  });

  await t.test("a backdrop click closes, a click inside the panel does not", () => {
    mediaState["(hover: hover) and (pointer: fine)"] = true;
    resetResumeDom();
    clickTrigger();

    document.querySelector(".pdf-modal-panel").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true })
    );
    assert.equal(modal().classList.contains("active"), true, "the panel is not a backdrop");

    modal().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(modal().classList.contains("active"), false);
  });

  await t.test("Escape closes it", () => {
    mediaState["(hover: hover) and (pointer: fine)"] = true;
    resetResumeDom();
    clickTrigger();

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    assert.equal(modal().classList.contains("active"), false);
    assert.equal(frame().querySelector("iframe"), null);
  });

  await t.test("a touch pointer keeps the plain link", () => {
    mediaState["(hover: hover) and (pointer: fine)"] = false;
    resetResumeDom();

    const event = clickTrigger();

    assert.equal(event.defaultPrevented, false, "the browser navigates to the PDF itself");
    assert.equal(modal().classList.contains("active"), false);
    assert.equal(frame().querySelector("iframe"), null);
  });

  await t.test("the hero trigger opens the same dialog", () => {
    mediaState["(hover: hover) and (pointer: fine)"] = true;
    resetResumeDom();

    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("hero-pdf-view").dispatchEvent(event);

    assert.equal(event.defaultPrevented, true);
    assert.equal(modal().classList.contains("active"), true);
    assert.equal(frame().querySelector("iframe").getAttribute("src"), "rjasti_resume-cUvKStx_.pdf");
  });

  await t.test("iOS keeps the plain link even with a hovering pointer", () => {
    mediaState["(hover: hover) and (pointer: fine)"] = true;
    // iPadOS 13+ reports itself as a Mac; maxTouchPoints is what gives it away.
    Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
    Object.defineProperty(window.navigator, "maxTouchPoints", { value: 5, configurable: true });
    resetResumeDom();

    const event = clickTrigger();

    assert.equal(event.defaultPrevented, false, "iOS renders page 1 only in an iframe");
    assert.equal(modal().classList.contains("active"), false);

    Object.defineProperty(window.navigator, "maxTouchPoints", { value: 0, configurable: true });
  });
});

test("hero split button", async (t) => {
  const split = () => document.getElementById("hero-resume-split");
  const toggle = () => document.getElementById("hero-pdf-more");
  const menu = () => document.getElementById("hero-pdf-menu");

  function clickToggle() {
    toggle().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }

  await t.test("the caret toggles the menu and tracks it in aria", () => {
    mediaState["(hover: hover) and (pointer: fine)"] = true;
    resetResumeDom();

    assert.equal(toggle().getAttribute("aria-expanded"), "false");
    assert.equal(menu().getAttribute("aria-hidden"), "true");

    clickToggle();
    assert.equal(split().classList.contains("is-open"), true);
    assert.equal(toggle().getAttribute("aria-expanded"), "true");
    assert.equal(menu().getAttribute("aria-hidden"), "false");

    clickToggle();
    assert.equal(split().classList.contains("is-open"), false);
    assert.equal(toggle().getAttribute("aria-expanded"), "false");
  });

  await t.test("choosing the download closes it", () => {
    resetResumeDom();
    clickToggle();

    menu().querySelector("a").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    assert.equal(split().classList.contains("is-open"), false);
  });

  await t.test("a click outside closes it, one inside does not", () => {
    resetResumeDom();
    clickToggle();

    split().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(split().classList.contains("is-open"), true, "clicks within the control keep it open");

    document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(split().classList.contains("is-open"), false);
  });

  await t.test("opening the viewer from the main segment closes the menu", () => {
    mediaState["(hover: hover) and (pointer: fine)"] = true;
    resetResumeDom();
    clickToggle();

    document.getElementById("hero-pdf-view").dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true })
    );

    assert.equal(split().classList.contains("is-open"), false, "no menu left hanging behind the dialog");
    assert.equal(document.getElementById("resume-pdf-modal").classList.contains("active"), true);
  });

  await t.test("Escape closes it and hands focus back to the caret", () => {
    resetResumeDom();
    clickToggle();

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    assert.equal(split().classList.contains("is-open"), false);
    assert.equal(document.activeElement, toggle());
  });
});
