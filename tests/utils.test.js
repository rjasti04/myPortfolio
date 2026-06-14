import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";

describe("Utils Module", () => {
  let dom;
  let document;
  let window;

  before(() => {
    global.performance = { now: () => Date.now() };
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    document = dom.window.document;
    window = dom.window;
    global.document = document;
    global.window = window;
    global.HTMLElement = window.HTMLElement;
  });

  after(() => {
    delete global.document;
    delete global.window;
  });

  describe("escapeHTML", () => {
    it("should escape HTML special characters", async () => {
      const { escapeHTML } = await import("../js/utils.js");

      assert.strictEqual(
        escapeHTML('<script>alert("xss")</script>'),
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
      );

      assert.strictEqual(escapeHTML("Hello & goodbye"), "Hello &amp; goodbye");
    });

    it("should handle empty strings", async () => {
      const { escapeHTML } = await import("../js/utils.js");
      assert.strictEqual(escapeHTML(""), "");
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens for simple text", async () => {
      const { estimateTokens } = await import("../js/utils.js");

      const tokens = estimateTokens("Hello world");
      assert.ok(tokens > 0);
      assert.ok(tokens < 10);
    });

    it("should return 0 for empty text", async () => {
      const { estimateTokens } = await import("../js/utils.js");
      assert.strictEqual(estimateTokens(""), 0);
    });

    it("should estimate higher for code blocks", async () => {
      const { estimateTokens } = await import("../js/utils.js");

      const simpleText = "Hello world";
      const codeText = "```javascript\nconst x = 1;\n```";

      assert.ok(estimateTokens(codeText) > estimateTokens(simpleText));
    });
  });

  describe("debounce", () => {
    it("should debounce function calls", async (t) => {
      const { debounce } = await import("../js/utils.js");

      let callCount = 0;
      const fn = debounce(() => callCount++, 50);

      fn();
      fn();
      fn();

      assert.strictEqual(callCount, 0);

      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.strictEqual(callCount, 1);
    });
  });

  describe("throttle", () => {
    it("should throttle function calls", async () => {
      const { throttle } = await import("../js/utils.js");

      let callCount = 0;
      const fn = throttle(() => callCount++, 50);

      fn();
      fn();
      fn();

      assert.strictEqual(callCount, 1);

      await new Promise((resolve) => setTimeout(resolve, 100));
      fn();
      assert.strictEqual(callCount, 2);
    });
  });
});

describe("Modal Module", () => {
  let dom;
  let document;
  let window;

  before(() => {
    global.performance = { now: () => Date.now() };
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="modal" class="modal" aria-hidden="true">
            <button id="close-btn">Close</button>
          </div>
        </body>
      </html>
    `);
    document = dom.window.document;
    window = dom.window;
    global.document = document;
    global.window = window;
  });

  after(() => {
    delete global.document;
    delete global.window;
    delete global.performance;
  });

  describe("openModal", () => {
    it("should open modal and set aria attributes", async () => {
      const { openModal } = await import("../js/modal.js");

      const modal = document.getElementById("modal");
      openModal(modal);

      assert.ok(modal.classList.contains("active"));
      assert.strictEqual(modal.getAttribute("aria-hidden"), "false");
    });
  });

  describe("closeModal", () => {
    it("should close modal and restore aria attributes", async () => {
      const { openModal, closeModal } = await import("../js/modal.js");

      const modal = document.getElementById("modal");
      openModal(modal);
      closeModal(modal);

      assert.ok(!modal.classList.contains("active"));
      assert.strictEqual(modal.getAttribute("aria-hidden"), "true");
    });
  });
});
