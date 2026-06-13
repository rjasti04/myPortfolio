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

    it("should escape single and double quotes", async () => {
      const { escapeHTML } = await import("../js/utils.js");
      assert.strictEqual(
        escapeHTML(`'"test"'`),
        "&#039;&quot;test&quot;&#039;",
      );
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

describe("Animation Utils", () => {
  let dom;
  let document;
  let window;

  before(() => {
    global.performance = { now: () => Date.now() };
    dom = new JSDOM(
      '<!DOCTYPE html><html><body><div id="test"></div></body></html>',
    );
    document = dom.window.document;
    window = dom.window;
    global.document = document;
    global.window = window;
    global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  });

  after(() => {
    delete global.document;
    delete global.window;
    delete global.requestAnimationFrame;
    delete global.performance;
    delete global.performance;
  });

  describe("animateCounter", () => {
    it("should animate counter to target value", async () => {
      const { animateCounter } = await import("../js/animation-utils.js");

      const element = document.getElementById("test");
      animateCounter(element, 100, 100, "+");

      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.strictEqual(element.textContent, "100+");
    });
  });

  describe("smoothScrollTo", () => {
    it("should handle missing elements gracefully", async () => {
      const { smoothScrollTo } = await import("../js/animation-utils.js");

      // Should not throw
      assert.doesNotThrow(() => {
        smoothScrollTo("#nonexistent");
      });
    });
  });
});

describe("Modal Utils", () => {
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
  });

  describe("openModal", () => {
    it("should open modal and set aria attributes", async () => {
      const { openModal } = await import("../js/modal-utils.js");

      const modal = document.getElementById("modal");
      openModal(modal);

      assert.ok(modal.classList.contains("active"));
      assert.strictEqual(modal.getAttribute("aria-hidden"), "false");
    });
  });

  describe("closeModal", () => {
    it("should close modal and restore aria attributes", async () => {
      const { openModal, closeModal } = await import("../js/modal-utils.js");

      const modal = document.getElementById("modal");
      openModal(modal);
      closeModal(modal);

      assert.ok(!modal.classList.contains("active"));
      assert.strictEqual(modal.getAttribute("aria-hidden"), "true");
    });
  });

  describe("isModalOpen", () => {
    it("should return true when modal is open", async () => {
      const { openModal, isModalOpen } = await import("../js/modal-utils.js");

      const modal = document.getElementById("modal");
      openModal(modal);

      assert.strictEqual(isModalOpen(), true);
    });
  });
});
