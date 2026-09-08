import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

import { initPalette } from '../js/terminal/palette.js';
import { CONTENT_INDEX } from '../js/search-index.js';

const HTML = `<!DOCTYPE html><html><body>
  <main>
    <section id="about" class="active"><div id="terminal-panel"></div></section>
    <section id="resume">
      <h4 id="exp-backend-middleware">Backend &amp; Middleware</h4>
    </section>
  </main>
</body></html>`;

/* A registry with one command, so a content hit and a command hit can be told
   apart in the same result list. */
const registry = {
  visible: () => [{ name: 'help', summary: 'List available commands', usage: 'help [command]' }],
  get: (name) => (name === 'help' ? { name: 'help', navigates: false } : null),
};

describe('Command palette content search', () => {
  let dom;
  let navigated;
  let ran;

  before(() => {
    dom = new JSDOM(HTML, { url: 'https://rjasti.com/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    navigated = [];
    ran = [];
    initPalette({
      registry,
      run: (line) => { ran.push(line); },
      panel: dom.window.document.getElementById('terminal-panel'),
      navigate: (section) => { navigated.push(section); },
    });
  });

  after(() => {
    delete global.window;
    delete global.document;
    delete global.HTMLElement;
  });

  function openWith(query) {
    const doc = dom.window.document;
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    const field = doc.querySelector('.cmd-palette-input');
    field.value = query;
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    return doc.querySelectorAll('.cmd-palette-item');
  }

  function close() {
    const doc = dom.window.document;
    doc.querySelector('.cmd-palette-input').dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
  }

  it('ships a generated index with resume content in it', () => {
    assert.ok(CONTENT_INDEX.length > 0);
    const redshift = CONTENT_INDEX.filter((e) => JSON.stringify(e).includes('Redshift'));
    assert.ok(redshift.length > 0, 'expected Redshift somewhere in the index');
  });

  it('finds page content that matches no command', () => {
    const items = openWith('redshift');
    const contentItems = [...items].filter((li) => li.classList.contains('cmd-palette-item--content'));
    assert.ok(contentItems.length > 0, 'expected at least one content result for "redshift"');
    // No command is named or summarised "redshift", so this result could only
    // have come from the content index.
    assert.equal([...items].filter((li) => !li.classList.contains('cmd-palette-item--content')).length, 0);
    close();
  });

  it('still lists commands, and lists them before content', () => {
    const items = openWith('help');
    assert.ok(items.length >= 1);
    assert.ok(!items[0].classList.contains('cmd-palette-item--content'));
    close();
  });

  it('keeps every result a listbox option', () => {
    const items = openWith('redshift');
    for (const li of items) assert.equal(li.getAttribute('role'), 'option');
    close();
  });

  it('caps content results so commands cannot be crowded out', () => {
    // "a" appears in essentially every entry.
    const items = openWith('a');
    const content = [...items].filter((li) => li.classList.contains('cmd-palette-item--content'));
    assert.ok(content.length <= 6, `expected at most 6 content results, got ${content.length}`);
    close();
  });

  it('navigates to the section on Enter and focuses the anchor', async () => {
    const doc = dom.window.document;
    // A heading-level match, so the entry carries an anchor.
    const items = openWith('middleware');
    const first = [...items].find((li) => li.classList.contains('cmd-palette-item--content'));
    assert.ok(first, 'expected a content result for "middleware"');
    first.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    // submit() awaits navigate() so the section is rendered before the anchor
    // is focused, which puts the focus step on a later microtask than the click.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(navigated, ['resume']);
    assert.equal(ran.length, 0, 'a content result must not run a command');
    assert.equal(doc.getElementById('exp-backend-middleware').getAttribute('tabindex'), '-1');
  });

  it('reports the absence of both kinds when nothing matches', () => {
    openWith('zzzzznotathing');
    assert.match(dom.window.document.querySelector('.cmd-palette-empty').textContent, /content/);
    close();
  });
});
