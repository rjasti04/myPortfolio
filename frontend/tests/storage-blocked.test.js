import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/*
 * Storage that THROWS, not storage that is empty.
 *
 * Safari with "Block All Cookies", Firefox with dom.storage.enabled=false and
 * strict privacy extensions all make `localStorage.getItem` raise rather than
 * return null. That distinction is the whole point of this file: every read in
 * the codebase already handled a missing value and several handled a failed
 * JSON.parse, but a throwing *accessor* went straight up the stack.
 *
 * `initTheme` is the first call in main.js's DOMContentLoaded sequence and
 * `.reveal` elements are invisible until `initAnimations` - five calls later -
 * marks them active, so one throw here used to leave a visitor looking at a
 * page with the contact form, both Apps tiles and the About cards rendered as
 * blank space, the router dead, and nothing on screen saying why.
 */
function throwingStorage() {
  const boom = () => { throw new Error('SecurityError: The operation is insecure.'); };
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom };
}

function installDom(html) {
  const dom = new JSDOM(html, { url: 'https://rjasti.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  for (const key of ['HTMLElement', 'Element', 'Event', 'CustomEvent', 'Node',
                     'getComputedStyle', 'MutationObserver', 'DOMParser']) {
    if (dom.window[key] !== undefined) global[key] = dom.window[key];
  }
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = (query = '') => ({
    matches: false, media: query,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  global.matchMedia = dom.window.matchMedia;

  const blocked = throwingStorage();
  global.localStorage = blocked;
  Object.defineProperty(dom.window, 'localStorage', { get: () => blocked, configurable: true });

  // The pre-boot inline script sets this; jsdom is not running scripts here.
  document.documentElement.classList.add('js-enabled');
  return dom;
}

function teardownDom(dom) {
  dom.window.close();
  for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Element',
                     'Event', 'CustomEvent', 'Node', 'getComputedStyle',
                     'MutationObserver', 'DOMParser']) {
    delete global[key];
  }
}

describe('Theme init against blocked localStorage', () => {
  let dom;

  before(() => {
    dom = installDom(fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8'));
  });

  after(() => teardownDom(dom));

  it('initTheme does not throw', async () => {
    const { initTheme } = await import('../js/theme.js');
    assert.doesNotThrow(() => initTheme());
  });

  it('reapplyCustomTheme does not throw', async () => {
    // The exact link that broke: initTheme calls applyTheme, applyTheme calls
    // reapplyCustomTheme, and reapplyCustomTheme calls readSavedPalette -
    // which used to guard only its JSON.parse, not the getItem that raises.
    const { reapplyCustomTheme } = await import('../js/theme-customizer.js');
    assert.doesNotThrow(() => reapplyCustomTheme(false));
    assert.doesNotThrow(() => reapplyCustomTheme(true));
  });
});

describe('Reveal activation', () => {
  let dom;

  before(() => {
    // A minimal document rather than index.html: initAnimations also wires
    // spring hovers, whose 30s will-change cleanup timers would keep the test
    // runner's process alive long after the assertions finish. Nothing here
    // carries [data-spring-hover], so none are scheduled.
    dom = installDom(`<!DOCTYPE html><html><body>
      <div class="reveal"></div><div class="reveal"></div><div class="reveal"></div>
    </body></html>`);
  });

  after(() => teardownDom(dom));

  it('marks every .reveal active even when storage is blocked', async () => {
    const { initAnimations } = await import('../js/animations.js');
    initAnimations();
    const all = document.querySelectorAll('.reveal');
    const active = document.querySelectorAll('.reveal.active');
    assert.ok(all.length > 0);
    assert.strictEqual(active.length, all.length,
      'no .reveal is stranded at opacity 0');
    // jsdom has no IntersectionObserver, so this is the path that reveals
    // everything up front. It must not arm the hiding rule on the way past:
    // the class and the code that clears it are a pair.
    assert.ok(!document.documentElement.classList.contains('reveals-armed'),
      'the hiding rule is not armed on the path that never observes');
  });
});

describe('Reveal visibility without JavaScript', () => {
  it('hides .reveal only under a class the reveal code sets itself', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'frontend', 'styles.css'), 'utf8');
    assert.match(css, /\.reveals-armed \.reveal \{\s*\n\s*opacity: 0;/,
      'the hiding rule is scoped to .reveals-armed');
    assert.doesNotMatch(css, /\n\.reveal \{\s*\n\s*opacity: 0;/,
      'no unscoped .reveal rule hides content when JS never runs');
    // .js-enabled is set by the pre-boot inline script, so scoping to it
    // covered JavaScript being OFF but not JavaScript loading and THROWING -
    // main.js try/catches every initialiser, so a throw before initAnimations
    // stranded all 20 .reveal elements, #resume's whole Experience card among
    // them. The arming class has to come from the module that also clears it.
    assert.doesNotMatch(css, /\.js-enabled \.reveal \{\s*\n\s*opacity: 0;/,
      'the hiding rule must not key off a pre-boot class');
    const js = fs.readFileSync(path.join(repoRoot, 'frontend', 'js', 'animations.js'), 'utf8');
    assert.match(js, /classList\.add\("reveals-armed"\)/,
      'initReveals arms the hiding rule itself');
  });
});
