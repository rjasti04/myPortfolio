import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

// `<meta name="theme-color">` is what the mobile browser paints its toolbar
// with, and what tints the top bar of the installed PWA. It is a plain DOM
// attribute: nothing re-derives it from the custom properties, so whatever was
// written to it last simply stays there.
//
// That is the bug this file pins. Randomising a theme repainted the whole page
// and left the bar on the previous colour, because only `applyTheme()` and the
// Apply button ever wrote the tag - so the bar caught up when the visitor
// pressed Apply, one deliberate act later. The tag is now synced from inside
// the two functions every paint path goes through, which is what makes the
// preview cases below (a roll, a cancel) work at all.
//
// The stylesheet in the fixture is small but load-bearing: `--accent-fill` is
// declared on `:root` AND overridden on `body.dark-theme`, exactly as
// styles.css declares them, so a sync that reads the wrong element resolves to
// the light accent on a dark page and fails here.
const FIXTURE = `<!DOCTYPE html><html><head>
  <meta name="theme-color" content="#C5CF3F" />
  <style>
    :root { --accent-fill: #c5cf3f; }
    body.dark-theme { --accent-fill: hsl(64,60%,55%); }
  </style>
</head><body>
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
        <button type="button" id="color-primary" data-color-value="#C5CF3F" aria-expanded="false">
          <span id="hex-primary">#C5CF3F</span>
        </button>
        <button type="button" id="color-secondary" data-color-value="#3C82DD" aria-expanded="false">
          <span id="hex-secondary">#3C82DD</span>
        </button>
        <button type="button" id="color-accent" data-color-value="#830FDB" aria-expanded="false">
          <span id="hex-accent">#830FDB</span>
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

// The observer's callback is a microtask, so a macrotask turn is what makes
// "the panel has finished closing" true.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let instance = 0;

function installDom() {
  const dom = new JSDOM(FIXTURE, { url: 'https://rjasti.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.MutationObserver = dom.window.MutationObserver;
  global.getComputedStyle = (...args) => dom.window.getComputedStyle(...args);
  global.Element = dom.window.Element;
  return dom;
}

function uninstallDom() {
  delete global.window;
  delete global.document;
  delete global.localStorage;
  delete global.MutationObserver;
  delete global.getComputedStyle;
  delete global.Element;
}

const themeColor = () => document.querySelector('meta[name="theme-color"]').getAttribute('content');
const accentFill = () => document.body.style.getPropertyValue('--accent-fill');

describe('theme-color meta tag', () => {
  let customizer;

  const dropdown = () => document.getElementById('theme-customizer-dropdown');

  async function openPanel() {
    dropdown().classList.add('is-open');
    document.getElementById('palette-toggle').click();
    await settle();
  }

  async function closePanel() {
    dropdown().classList.remove('is-open');
    await settle();
  }

  beforeEach(async () => {
    installDom();
    // A fresh module per test: the unsaved palette is module state by design.
    customizer = await import(`../js/theme-customizer.js?meta=${instance++}`);
    customizer.initHomeThemeShuffle();
    customizer.initThemeCustomizer();
  });

  afterEach(uninstallDom);

  it('follows a landing-view roll immediately, with no Apply in between', () => {
    const shipped = themeColor();
    document.getElementById('home-theme-shuffle').click();

    assert.notStrictEqual(themeColor(), shipped, 'the browser bar moves on the roll itself');
    assert.strictEqual(themeColor(), accentFill(), 'and lands on the accent the page is wearing');
  });

  it('follows an in-panel shuffle, which is a preview and not a commit', async () => {
    await openPanel();
    document.getElementById('theme-customizer-shuffle').click();

    assert.strictEqual(themeColor(), accentFill(), 'a preview moves the bar too');
    assert.strictEqual(localStorage.getItem('rj_theme_palette'), null, 'without being saved');
  });

  it('rolls back with the palette when the panel is cancelled', async () => {
    document.getElementById('home-theme-shuffle').click();
    const rolled = themeColor();

    await openPanel();
    document.querySelector('[data-preset="matrix"]').click();
    assert.notStrictEqual(themeColor(), rolled, 'the preset previews into the bar');

    await closePanel();
    assert.strictEqual(themeColor(), rolled, 'cancel takes the bar back with the palette');
    assert.strictEqual(themeColor(), accentFill(), 'leaving the two in agreement');
  });

  it('survives the close that Apply performs', async () => {
    await openPanel();
    document.querySelector('[data-preset="matrix"]').click();
    const applied = themeColor();

    document.getElementById('theme-customizer-apply').click();
    await settle();

    assert.strictEqual(themeColor(), applied, 'the applied accent stays on the bar');
  });

  it('returns to the theme default on Reset, read off body rather than the root', async () => {
    // The distinction is invisible in light mode and wrong in dark: the dark
    // `--accent-fill` is declared on `body.dark-theme`, so the root element
    // still resolves to the light accent on a dark page.
    document.body.classList.add('dark-theme');
    document.getElementById('home-theme-shuffle').click();

    await openPanel();
    document.getElementById('theme-customizer-reset').click();
    await settle();

    assert.strictEqual(accentFill(), '', 'Reset strips the inline palette');
    assert.strictEqual(themeColor(), 'hsl(64,60%,55%)', 'and the bar returns to the DARK accent');
  });

  it('exposes the fallback pair for a page with no palette resolved at all', () => {
    // jsdom without the fixture stylesheet is the shape of a first paint before
    // styles.css has landed: nothing resolves, and the tag must still be a
    // colour rather than an empty attribute.
    document.querySelector('style').remove();

    customizer.syncThemeColorMeta(true);
    assert.strictEqual(themeColor(), '#0a0a0b');
    customizer.syncThemeColorMeta(false);
    assert.strictEqual(themeColor(), '#C5CF3F');
  });
});

describe('theme-color meta tag at first paint', () => {
  let dom;

  beforeEach(() => {
    dom = installDom();
  });

  afterEach(uninstallDom);

  // theme-bootstrap.js runs in <head>, before first paint, and restores the
  // saved palette so a custom theme does not flash the shipped one. It repainted
  // the custom properties but not the meta tag, so every launch showed the
  // shipped citron bar until applyTheme() ran at DOMContentLoaded - most visible
  // in the installed PWA, straight after the splash screen.
  async function runBootstrap() {
    await import(`../js/theme-bootstrap.js?meta=${instance++}`);
  }

  it('paints the saved accent onto the bar before applyTheme runs', async () => {
    localStorage.setItem('rj_theme_palette', JSON.stringify({
      version: 1,
      raw: { primary: '#7C3AED', secondary: '#10B981', accent: '#0284C7' },
      light: { '--accent-fill': 'hsl(263, 70%, 50%)' },
      dark: { '--accent-fill': 'hsl(263, 70%, 60%)' }
    }));

    await runBootstrap();
    assert.strictEqual(themeColor(), 'hsl(263, 70%, 50%)');
  });

  it('takes the variant matching the theme the inline bootstrap already chose', async () => {
    document.body.classList.add('dark-theme');
    localStorage.setItem('rj_theme_palette', JSON.stringify({
      version: 1,
      raw: { primary: '#7C3AED', secondary: '#10B981', accent: '#0284C7' },
      light: { '--accent-fill': 'hsl(263, 70%, 50%)' },
      dark: { '--accent-fill': 'hsl(263, 70%, 60%)' }
    }));

    await runBootstrap();
    assert.strictEqual(themeColor(), 'hsl(263, 70%, 60%)');
  });

  it('leaves the shipped value alone when there is no saved palette', async () => {
    await runBootstrap();
    assert.strictEqual(themeColor(), '#C5CF3F');
  });
});
