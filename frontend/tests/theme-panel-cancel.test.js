import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

// Closing the customiser panel is a cancel, and what a cancel undoes is the
// question this file pins down. It used to undo everything unsaved, including a
// roll made on the landing view before the panel was ever opened - so opening
// the panel to look at a randomised theme and closing it without touching
// anything threw that theme away. A cancel now rolls back to whatever the panel
// opened showing, which is the only reading under which "I did not change
// anything" leaves the screen unchanged.
//
// The panel is driven through its real DOM rather than by calling internals:
// the rollback hangs off a MutationObserver watching `is-open`, so a test that
// never opens and closes the panel would not exercise it at all.
const FIXTURE = `<!DOCTYPE html><html><body>
  <button type="button" id="home-theme-shuffle">Randomize</button>
  <p id="home-theme-status"></p>

  <div class="header-dropdown" id="theme-customizer-dropdown">
    <button type="button" id="palette-toggle" aria-expanded="false"></button>
    <div class="header-dropdown-menu" aria-hidden="true">
      <div class="header-dropdown-container customizer-content">
        <button type="button" id="theme-customizer-save"></button>
        <div id="theme-save-form" hidden>
          <input type="text" id="theme-save-name" />
          <button type="button" id="theme-save-confirm"></button>
          <button type="button" id="theme-save-cancel"></button>
        </div>
        <div id="theme-chips">
          <button type="button" class="preset-btn" data-preset="matrix">Matrix</button>
        </div>
        <button type="button" id="theme-customizer-shuffle"></button>
        <p id="theme-customizer-status"></p>
        <button type="button" id="color-primary" data-color-value="#F59E0B" aria-expanded="false">
          <span id="hex-primary">#F59E0B</span>
        </button>
        <button type="button" id="color-secondary" data-color-value="#10B981" aria-expanded="false">
          <span id="hex-secondary">#10B981</span>
        </button>
        <button type="button" id="color-accent" data-color-value="#0284C7" aria-expanded="false">
          <span id="hex-accent">#0284C7</span>
        </button>
        <div id="theme-color-popover" hidden>
          <span id="color-popover-title"></span>
          <span id="color-popover-preview"></span>
          <input type="text" id="color-popover-hex" />
          <button type="button" id="color-popover-close"></button>
          <div id="color-popover-swatches"></div>
        </div>
        <button type="button" id="theme-customizer-reset">Reset</button>
        <button type="button" id="theme-customizer-apply">Apply</button>
      </div>
    </div>
  </div>
</body></html>`;

// The observer's callback is a microtask, and the resize debounce is a timer,
// so a macrotask turn is what makes "the panel has finished closing" true.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Theme panel cancel', () => {
  let dom;
  let customizer;
  let instance = 0;

  const dropdown = () => document.getElementById('theme-customizer-dropdown');
  const accentFill = () => document.body.style.getPropertyValue('--accent-fill');

  async function openPanel() {
    // The class comes from the generic dropdown handler in navigation.js, which
    // is not loaded here; the panel's own click handler is what fills the
    // controls. Both happen on one click in the browser.
    dropdown().classList.add('is-open');
    document.getElementById('palette-toggle').click();
    await settle();
  }

  async function closePanel() {
    dropdown().classList.remove('is-open');
    await settle();
  }

  beforeEach(async () => {
    dom = new JSDOM(FIXTURE, { url: 'https://rjasti.com/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.MutationObserver = dom.window.MutationObserver;
    global.getComputedStyle = (...args) => dom.window.getComputedStyle(...args);
    // The delegated chip handler narrows with `instanceof Element`, which is a
    // window global in a browser and nothing at all in Node.
    global.Element = dom.window.Element;

    // A fresh module per test: the unsaved palette is module state by design,
    // and one test's roll must not be the next one's starting point.
    customizer = await import(`../js/theme-customizer.js?case=${instance++}`);
    customizer.initHomeThemeShuffle();
    customizer.initThemeCustomizer();
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.MutationObserver;
    delete global.getComputedStyle;
    delete global.Element;
  });

  it('keeps a landing-view roll when the panel is opened and closed untouched', async () => {
    document.getElementById('home-theme-shuffle').click();
    const rolled = accentFill();
    assert.ok(rolled, 'the shuffle paints an accent onto the body');

    await openPanel();
    assert.strictEqual(accentFill(), rolled, 'opening the panel does not repaint');

    await closePanel();
    assert.strictEqual(accentFill(), rolled, 'closing an untouched panel keeps the roll');
  });

  it('fills the controls with the roll, so Apply saves what is on screen', async () => {
    document.getElementById('home-theme-shuffle').click();

    // The roll is only announced, never written into the panel until it opens,
    // so the announcement is where the expected value has to come from - and
    // reading it here means a status line that stops naming the colours fails
    // this test too.
    const announced = document.getElementById('home-theme-status').textContent;
    const rolledPrimary = announced.match(/Primary (#[0-9A-F]{6})/)?.[1];
    assert.ok(rolledPrimary, `the roll is announced with its hex codes: "${announced}"`);

    await openPanel();
    assert.strictEqual(
      document.getElementById('color-primary').dataset.colorValue,
      rolledPrimary,
      'the panel opens showing the roll rather than the shipped defaults'
    );
    assert.strictEqual(
      document.getElementById('hex-primary').textContent,
      rolledPrimary,
      'and the hex label agrees with the control behind it'
    );
  });

  it('discards an edit made inside the panel back to the roll, not to the defaults', async () => {
    document.getElementById('home-theme-shuffle').click();
    const rolled = accentFill();

    await openPanel();
    document.querySelector('[data-preset="matrix"]').click();
    const previewed = accentFill();
    assert.notStrictEqual(previewed, rolled, 'the preset repaints the panel preview');

    await closePanel();
    assert.strictEqual(accentFill(), rolled, 'cancel undoes the preset, not the roll behind it');
  });

  it('does not undo Apply on the way out', async () => {
    document.getElementById('home-theme-shuffle').click();

    await openPanel();
    document.querySelector('[data-preset="matrix"]').click();
    const applied = accentFill();

    // Apply closes the panel itself, so this is the close path that used to be
    // the dangerous one: the snapshot is still there to be restored.
    document.getElementById('theme-customizer-apply').click();
    await settle();

    assert.strictEqual(accentFill(), applied, 'the applied palette survives the close');
    assert.ok(localStorage.getItem('rj_theme_palette'), 'and it is the saved one now');
  });

  it('returns to the shipped defaults on Reset, with no roll left to come back', async () => {
    document.getElementById('home-theme-shuffle').click();

    await openPanel();
    document.getElementById('theme-customizer-reset').click();
    await settle();

    assert.strictEqual(accentFill(), '', 'Reset strips the inline palette');
    assert.strictEqual(localStorage.getItem('rj_theme_palette'), null, 'and clears storage');
  });

  it('restores the saved palette when the panel is cancelled with no roll behind it', async () => {
    await openPanel();
    document.querySelector('[data-preset="matrix"]').click();
    document.getElementById('theme-customizer-apply').click();
    await settle();
    const saved = accentFill();

    await openPanel();
    document.getElementById('theme-customizer-shuffle').click();
    assert.notStrictEqual(accentFill(), saved, 'the in-panel shuffle previews something new');

    await closePanel();
    assert.strictEqual(accentFill(), saved, 'cancel falls through to the saved palette');
  });
});
