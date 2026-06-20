import { describe, it } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

describe('Modal Fixes Module', () => {
  it('should not leak keydown listeners when opened multiple times', async () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="modal" class="modal" aria-hidden="true"></div>
        </body>
      </html>
    `);

    let addedCount = 0;
    let removedCount = 0;

    global.document = {
      addEventListener: (evt) => {
        if (evt === 'keydown') addedCount++;
      },
      removeEventListener: (evt) => {
        if (evt === 'keydown') removedCount++;
      },
      activeElement: dom.window.document.body
    };

    global.window = dom.window;
    global.HTMLElement = dom.window.HTMLElement;

    const { openModal } = await import('../js/modal.js');
    const modalEl = dom.window.document.getElementById('modal');

    openModal(modalEl);
    assert.strictEqual(addedCount, 1);
    assert.strictEqual(removedCount, 0);

    // Open again, should remove the old one
    openModal(modalEl);
    assert.strictEqual(addedCount, 2);
    assert.strictEqual(removedCount, 1);

    delete global.document;
    delete global.window;
    delete global.HTMLElement;
  });
});
