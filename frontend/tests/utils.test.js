import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

describe('Utils Module', () => {
  let dom;
  let document;
  let window;

  before(() => {
    global.performance = { now: () => Date.now() };
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    document = dom.window.document;
    window = dom.window;
    global.document = document;
    global.window = window;
  });

  after(() => {
    delete global.document;
    delete global.window;
  });

  describe('escapeHTML', () => {
    it('should escape HTML special characters', async () => {
      const { escapeHTML } = await import('../js/utils.js');

      assert.strictEqual(
        escapeHTML('<script>alert("xss")</script>'),
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );

      assert.strictEqual(
        escapeHTML('Hello & goodbye'),
        'Hello &amp; goodbye'
      );
    });

    it('should handle empty strings', async () => {
      const { escapeHTML } = await import('../js/utils.js');
      assert.strictEqual(escapeHTML(''), '');
    });

    // Regression: escapeHTML left `"` untouched, and six call sites interpolate
    // it inside a double-quoted attribute. A value containing a quote closed the
    // attribute and everything after it parsed as further attributes.
    it('should escape both quote forms so attribute contexts cannot be broken', async () => {
      const { escapeHTML } = await import('../js/utils.js');

      assert.strictEqual(escapeHTML('a"b'), 'a&quot;b');
      assert.strictEqual(escapeHTML("a'b"), 'a&#39;b');
    });

    it('should not allow an injected event handler to escape an attribute', async () => {
      const { escapeHTML } = await import('../js/utils.js');

      const payload = 'hi" onmouseover="alert(1)';
      const host = document.createElement('div');
      host.innerHTML = `<button data-retry-text="${escapeHTML(payload)}">R</button>`;

      const button = host.querySelector('button');
      assert.deepStrictEqual(button.getAttributeNames(), ['data-retry-text']);
      assert.strictEqual(button.hasAttribute('onmouseover'), false);
      // The payload survives intact as data, which is what the retry button reads back.
      assert.strictEqual(button.getAttribute('data-retry-text'), payload);
    });

    it('should escape a visitor-controlled page_path used in attribute position', async () => {
      const { escapeHTML } = await import('../js/utils.js');

      // page_path is `pathname + hash`, set by the client and persisted server side.
      const path = '/#"><img src=x onerror="alert(1)">';
      const host = document.createElement('div');
      host.innerHTML = `<button class="act-path" data-path="${escapeHTML(path)}" title="${escapeHTML(path)}"></button>`;

      assert.strictEqual(host.querySelectorAll('img').length, 0);
      assert.deepStrictEqual(host.querySelector('button').getAttributeNames(), [
        'class',
        'data-path',
        'title',
      ]);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for simple text', async () => {
      const { estimateTokens } = await import('../js/utils.js');
      
      const tokens = estimateTokens('Hello world');
      assert.ok(tokens > 0);
      assert.ok(tokens < 10);
    });

    it('should return 0 for empty text', async () => {
      const { estimateTokens } = await import('../js/utils.js');
      assert.strictEqual(estimateTokens(''), 0);
    });

    it('should estimate higher for code blocks', async () => {
      const { estimateTokens } = await import('../js/utils.js');
      
      const simpleText = 'Hello world';
      const codeText = '```javascript\nconst x = 1;\n```';
      
      assert.ok(estimateTokens(codeText) > estimateTokens(simpleText));
    });
  });

  describe('debounce', () => {
    it('should debounce function calls', async (t) => {
      const { debounce } = await import('../js/utils.js');
      
      let callCount = 0;
      const fn = debounce(() => callCount++, 50);
      
      fn();
      fn();
      fn();
      
      assert.strictEqual(callCount, 0);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.strictEqual(callCount, 1);
    });
  });

  describe('throttle', () => {
    it('should throttle function calls', async () => {
      const { throttle } = await import('../js/utils.js');
      
      let callCount = 0;
      const fn = throttle(() => callCount++, 50);
      
      fn();
      fn();
      fn();
      
      assert.strictEqual(callCount, 1);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      fn();
      assert.strictEqual(callCount, 2);
    });
  });
});

describe('Modal Module', () => {
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
    global.HTMLElement = window.HTMLElement;
    global.Element = window.Element;
    global.Node = window.Node;
    global.getComputedStyle = window.getComputedStyle.bind(window);
  });

  after(() => {
    delete global.document;
    delete global.window;
    delete global.HTMLElement;
    delete global.Element;
    delete global.Node;
    delete global.getComputedStyle;
    delete global.performance;
  });

  describe('openModal', () => {
    it('should open modal and set aria attributes', async () => {
      const { openModal } = await import('../js/modal.js');
      
      const modal = document.getElementById('modal');
      openModal(modal);
      
      assert.ok(modal.classList.contains('active'));
      assert.strictEqual(modal.getAttribute('aria-hidden'), 'false');
    });
  });

  describe('closeModal', () => {
    it('should close modal and restore aria attributes', async () => {
      const { openModal, closeModal } = await import('../js/modal.js');
      
      const modal = document.getElementById('modal');
      openModal(modal);
      closeModal(modal);
      
      assert.ok(!modal.classList.contains('active'));
      assert.strictEqual(modal.getAttribute('aria-hidden'), 'true');
    });
  });
});
