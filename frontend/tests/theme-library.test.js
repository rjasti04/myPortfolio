import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

// The saved-theme library: a visitor's own named palettes in localStorage, with
// no account behind them. What is worth testing here is not the happy path but
// the storage boundary — the value is a string a user can hand-edit, quota can
// refuse a write, and the read is called on every panel open, so it has to fail
// to an empty list rather than take the customiser down with it.
describe('Theme library', () => {
  let dom;
  let lib;

  before(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://rjasti.com/' });
    global.document = dom.window.document;
    global.window = dom.window;
    global.localStorage = dom.window.localStorage;
    lib = await import('../js/theme-customizer.js');
  });

  after(() => {
    delete global.document;
    delete global.window;
    delete global.localStorage;
  });

  beforeEach(() => localStorage.clear());

  const RAW = { primary: '#F59E0B', secondary: '#10B981', accent: '#0284C7' };

  it('saves, reads back, and deletes by id', () => {
    const saved = lib.saveTheme('Sunset', RAW);
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.replaced, false);

    const [entry] = lib.readThemeLibrary();
    assert.strictEqual(entry.name, 'Sunset');
    assert.deepStrictEqual(entry.raw, RAW);
    assert.ok(entry.id, 'entry carries an id to delete by');

    assert.deepStrictEqual(lib.deleteTheme(entry.id), []);
    assert.deepStrictEqual(lib.readThemeLibrary(), []);
  });

  it('overwrites a name instead of duplicating it, keeping the original id', () => {
    // Two chips both reading "Sunset" tell the visitor nothing about which is
    // which, and re-saving under a name you already used almost always means
    // "update it". The id is kept so a delete button rendered before the
    // overwrite still points at the right entry.
    const first = lib.readThemeLibrary()[0] || (lib.saveTheme('Sunset', RAW), lib.readThemeLibrary()[0]);
    const next = { primary: '#111111', secondary: '#222222', accent: '#333333' };

    const result = lib.saveTheme('sunset', next);
    assert.strictEqual(result.replaced, true, 'matched case-insensitively');

    const entries = lib.readThemeLibrary();
    assert.strictEqual(entries.length, 1);
    assert.deepStrictEqual(entries[0].raw, next);
    assert.strictEqual(entries[0].id, first.id);
    assert.strictEqual(entries[0].name, 'sunset', 'the name as newly typed wins');
  });

  it('rejects an empty or whitespace-only name', () => {
    for (const name of ['', '   ', '\t', undefined, null]) {
      assert.deepStrictEqual(lib.saveTheme(name, RAW), { ok: false, reason: 'empty' });
    }
    assert.deepStrictEqual(lib.readThemeLibrary(), []);
  });

  it('truncates a long name rather than refusing it', () => {
    lib.saveTheme('x'.repeat(200), RAW);
    assert.strictEqual(lib.readThemeLibrary()[0].name.length, lib.THEME_NAME_MAX);
  });

  it('refuses a new name once full, but still allows overwriting an existing one', () => {
    for (let i = 0; i < lib.THEME_LIBRARY_LIMIT; i += 1) {
      assert.strictEqual(lib.saveTheme(`theme ${i}`, RAW).ok, true);
    }
    assert.deepStrictEqual(lib.saveTheme('one more', RAW), { ok: false, reason: 'full' });

    // The cap is on how many chips the row can hold, not on editing what is
    // already there — a full library that cannot be updated is a dead end.
    const overwrite = lib.saveTheme('theme 0', { primary: '#AAAAAA', secondary: '#BBBBBB', accent: '#CCCCCC' });
    assert.strictEqual(overwrite.ok, true);
    assert.strictEqual(overwrite.replaced, true);
    assert.strictEqual(lib.readThemeLibrary().length, lib.THEME_LIBRARY_LIMIT);
  });

  it('reads corrupt or hand-edited storage as an empty library', () => {
    for (const junk of ['not json', '{}', 'null', '42', '"a string"', '[']) {
      localStorage.setItem('rj_theme_library', junk);
      assert.deepStrictEqual(lib.readThemeLibrary(), [], `for ${junk}`);
    }
  });

  it('drops entries that are not three usable hex colours', () => {
    localStorage.setItem('rj_theme_library', JSON.stringify([
      { id: 'a', name: 'good', raw: RAW },
      { id: 'b', name: 'no raw' },
      { id: 'c', name: 'short hex', raw: { primary: '#FFF', secondary: '#10B981', accent: '#0284C7' } },
      { id: 'd', name: 'not a colour', raw: { primary: 'red', secondary: '#10B981', accent: '#0284C7' } },
      { id: 'e', raw: RAW },
      null
    ]));
    assert.deepStrictEqual(lib.readThemeLibrary().map((e) => e.name), ['good']);
  });

  it('reports a refused write rather than reporting success', () => {
    // Private browsing and "block site data" both throw on setItem. A save that
    // silently fails is indistinguishable from a broken button.
    //
    // The whole global is swapped rather than its `setItem` patched: jsdom's
    // Storage is proxy-backed, so assigning to a method name quietly writes a
    // storage ITEM called "setItem" and leaves the real method in place - the
    // stub does nothing and the test passes for the wrong reason.
    const real = global.localStorage;
    global.localStorage = {
      getItem: () => '[]',
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {}
    };
    try {
      assert.deepStrictEqual(lib.saveTheme('Nope', RAW), { ok: false, reason: 'storage' });
    } finally {
      global.localStorage = real;
    }
  });
});
