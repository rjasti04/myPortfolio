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
    <p class="section-actions">
      <a href="rjasti_resume-cUvKStx_.pdf" target="_blank" rel="noopener noreferrer" class="btn"
        id="resume-pdf-view">View PDF</a>
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

  global.window = window;
  global.document = document;
  global.HTMLElement = window.HTMLElement;
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
