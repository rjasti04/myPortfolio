import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

// Updating a saved theme, which used to be a path only a visitor who guessed it
// could take. Overwriting by name has always worked in `saveTheme`, but nothing
// in the panel said so: the Save field opened empty, no chip looked loaded, and
// Apply - the one button that reads like a commit - writes the ACTIVE palette
// and leaves the named theme on the colours it was first saved with. Editing a
// saved theme and pressing Apply therefore looked like a save that did nothing.
//
// Driven through the real panel rather than through `saveTheme`: everything
// this file is about lives in the wiring, not in the library functions, which
// theme-library.test.js already covers on their own.
const FIXTURE = `<!DOCTYPE html><html><body>
  <div class="header-dropdown" id="theme-customizer-dropdown">
    <button type="button" id="palette-toggle" aria-expanded="false"></button>
    <div class="header-dropdown-menu" aria-hidden="true">
      <div class="header-dropdown-container customizer-content">
        <button type="button" id="theme-customizer-save"></button>
        <div id="theme-save-form" hidden>
          <input type="text" id="theme-save-name" />
          <button type="button" id="theme-save-confirm">Save</button>
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

// The panel's rollback hangs off a MutationObserver, whose callback is a
// microtask, and the resize reposition is a timer - a macrotask turn is what
// makes "the panel has finished opening or closing" true.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const RADIUM = { primary: '#CCD425', secondary: '#3381E1', accent: '#891DE2' };

describe('Updating a saved theme', () => {
  let dom;
  let customizer;
  let instance = 0;

  const $ = (id) => document.getElementById(id);
  const dropdown = () => $('theme-customizer-dropdown');
  const chips = () => [...document.querySelectorAll('.theme-chip-apply')];
  const chipNamed = (name) => chips().find((chip) => chip.textContent === name);
  const library = () => JSON.parse(localStorage.getItem('rj_theme_library') || '[]');
  const controls = () => ({
    primary: $('color-primary').dataset.colorValue,
    secondary: $('color-secondary').dataset.colorValue,
    accent: $('color-accent').dataset.colorValue
  });

  async function openPanel() {
    // The class comes from the generic dropdown handler in navigation.js, which
    // is not loaded here; the panel's own click handler fills the controls.
    dropdown().classList.add('is-open');
    $('palette-toggle').click();
    await settle();
  }

  /**
   * Type one hex through the popover, the way the panel's colour editor does.
   * The control is only clicked when its popover is shut - clicking the control
   * that is already open closes it, which is the panel's own toggle.
   */
  function editColor(key, hex) {
    const control = $(`color-${key}`);
    if (control.getAttribute('aria-expanded') !== 'true') control.click();
    const field = $('color-popover-hex');
    field.value = hex;
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }

  /** Open the save form, type a name if one is given, and confirm. */
  function save(name) {
    $('theme-customizer-save').click();
    if (name !== undefined) $('theme-save-name').value = name;
    $('theme-save-confirm').click();
  }

  beforeEach(async () => {
    dom = new JSDOM(FIXTURE, { url: 'https://rjasti.com/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.MutationObserver = dom.window.MutationObserver;
    global.getComputedStyle = (...args) => dom.window.getComputedStyle(...args);
    global.Element = dom.window.Element;

    // A fresh module per test: the unsaved palette is module state by design.
    customizer = await import(`../js/theme-customizer.js?case=${instance++}`);
    customizer.initThemeCustomizer();

    await openPanel();
    editColor('primary', RADIUM.primary);
    editColor('secondary', RADIUM.secondary);
    editColor('accent', RADIUM.accent);
    save('radium');
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.MutationObserver;
    delete global.getComputedStyle;
    delete global.Element;
  });

  it('saves the theme it was told to, and marks it as the one being edited', () => {
    assert.deepStrictEqual(library().map((entry) => entry.name), ['radium']);
    assert.deepStrictEqual(library()[0].raw, RADIUM);
    assert.strictEqual(chipNamed('radium').getAttribute('aria-pressed'), 'true');
  });

  it('writes an edit back to the loaded theme instead of adding a second one', () => {
    const before = library()[0];

    editColor('accent', '#12E2A5');
    save();

    const after = library();
    assert.strictEqual(after.length, 1, 'one theme, updated - not two called radium');
    assert.strictEqual(after[0].id, before.id, 'the same entry, so a rendered delete still points at it');
    assert.strictEqual(after[0].raw.accent, '#12E2A5');
    assert.strictEqual(after[0].raw.primary, RADIUM.primary, 'the untouched colours are carried over');
    assert.match($('theme-customizer-status').textContent, /Updated saved theme radium/);
  });

  it('prefills the save field with the loaded theme, so Enter updates it', () => {
    $('theme-customizer-save').click();
    assert.strictEqual($('theme-save-name').value, 'radium');
    assert.strictEqual($('theme-save-confirm').textContent, 'Update',
      'the button says what it is about to do before it does it');
  });

  it('reads Save again once the name is typed over', () => {
    $('theme-customizer-save').click();
    const field = $('theme-save-name');
    field.value = 'radium two';
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.strictEqual($('theme-save-confirm').textContent, 'Save');

    $('theme-save-confirm').click();
    assert.deepStrictEqual(library().map((entry) => entry.name), ['radium', 'radium two']);
    assert.strictEqual(chipNamed('radium two').getAttribute('aria-pressed'), 'true',
      'the panel follows the theme it just wrote');
    assert.strictEqual(chipNamed('radium').getAttribute('aria-pressed'), 'false');
  });

  it('marks the chip while the controls hold something the theme does not', () => {
    const chip = chipNamed('radium');
    assert.strictEqual(chip.classList.contains('is-edited'), false);

    editColor('accent', '#12E2A5');
    assert.strictEqual(chip.classList.contains('is-edited'), true, 'the edit is visible as unsaved');
    assert.strictEqual(chip.title, 'Save to update radium');

    editColor('accent', RADIUM.accent);
    assert.strictEqual(chip.classList.contains('is-edited'), false, 'and clears when it is put back');
  });

  it('reloads the theme after a reopen, so the update path survives a page load', async () => {
    // Apply is what a visitor presses to keep the colours, and it closes the
    // panel. Reopening on those colours has to find the theme they came from -
    // this is the state after a reload, where nothing is remembered but storage.
    $('theme-customizer-apply').click();
    await settle();

    await openPanel();
    assert.strictEqual(chipNamed('radium').getAttribute('aria-pressed'), 'true');
    $('theme-customizer-save').click();
    assert.strictEqual($('theme-save-name').value, 'radium');
  });

  it('keeps Apply a palette commit rather than a write to the saved theme', async () => {
    // The boundary this whole feature is drawn around: Apply is "paint the site
    // with these colours", Save is "change what radium means". An edit made
    // from a loaded theme and applied must not rewrite the theme behind the
    // visitor's back - it is the only copy, and there is no undo.
    editColor('accent', '#12E2A5');
    $('theme-customizer-apply').click();
    await settle();

    assert.strictEqual(library()[0].raw.accent, RADIUM.accent, 'the saved theme is untouched');
    assert.strictEqual(
      JSON.parse(localStorage.getItem('rj_theme_palette')).raw.accent,
      '#12E2A5',
      'and the edit is live as the active palette'
    );
  });

  it('drops the loaded theme when a built-in preset takes over', () => {
    document.querySelector('[data-preset="matrix"]').click();
    assert.strictEqual(chipNamed('radium').getAttribute('aria-pressed'), 'false');

    // Save must ask for a name here rather than offering to overwrite radium
    // with Matrix's colours.
    $('theme-customizer-save').click();
    assert.strictEqual($('theme-save-name').value, '');
    assert.strictEqual($('theme-save-confirm').textContent, 'Save');
  });

  it('drops it when the theme is deleted, leaving its colours on screen', () => {
    document.querySelector('[data-remove-id]').click();
    assert.deepStrictEqual(library(), []);
    assert.deepStrictEqual(controls(), RADIUM, 'deleting a theme is not a repaint');

    $('theme-customizer-save').click();
    assert.strictEqual($('theme-save-name').value, '', 'nothing left to update');
  });
});
