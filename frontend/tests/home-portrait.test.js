import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The landing portrait is a flip card, and almost all of it is CSS. What is
// worth asserting here is the part that is not: the contract between the
// markup, the module and the stylesheet.
//
// Four things can break silently and none of them would fail a build.
//
//   1. The button ships `disabled` so that a page without JS never offers a
//      control that cannot work. If a future edit drops that attribute the
//      page looks identical and quietly regresses for every no-JS visitor.
//   2. The CSS selector that rotates the card reads `aria-pressed` directly,
//      so the accessible state IS the visual state. Swap it for a class and
//      the card still turns while screen readers are told nothing.
//   3. Each face has to be preloaded for exactly the widths it actually leads
//      at, and for no others. Above 900px the stylesheet rests the card on the
//      BACK face, so the two preloads are media-scoped and swapping or
//      dropping a `media` attribute spends the connection's first bytes on a
//      photograph nobody has asked to see - which is invisible in every test
//      that only checks a file is preloaded at all.
//   4. `aria-pressed` means "turned from rest", and rest is not the same face
//      at every width, so the status line has to resolve one against the
//      other. Get this backwards and the card looks right while a screen
//      reader is told the opposite of what is on screen - the one failure
//      mode nobody sighted will ever catch.
//
// The rotation itself, the perspective and the reduced-motion fallback are
// left to the browser; jsdom computes no transforms and asserting on the
// declarations would only restate the stylesheet.

const MARKUP = `<!DOCTYPE html><html><body>
  <div class="home-portrait">
    <button type="button" id="home-portrait-flip" class="home-portrait-flip" aria-pressed="false"
      aria-label="Show a different photo of Rajeev Jasti" disabled>
      <span class="home-portrait-card">
        <span class="home-portrait-face home-portrait-face--front"><picture><img alt=""
          src="profile-cutout-380.png" /></picture></span>
        <span class="home-portrait-face home-portrait-face--back"><picture><img alt=""
          src="profile-cutout-back-380.png" /></picture></span>
      </span>
    </button>
    <p class="sr-only" role="status" id="home-portrait-status"></p>
  </div>
</body></html>`;

describe('Home portrait flip', () => {
  let dom;
  let initHomePortrait;

  // The module resolves the rest face through `matchMedia` at import time and
  // reads `.matches` live on every click. jsdom evaluates no media queries and
  // reports `matches: false` for everything, which is the phone - reachable,
  // but only half the contract. A stub whose answer this suite owns is what
  // makes the desktop half reachable at all.
  let studioLeads = false;

  before(async () => {
    dom = new JSDOM(MARKUP, { url: 'https://rjasti.com/' });
    dom.window.matchMedia = (query) => ({
      media: query,
      get matches() {
        return studioLeads;
      },
      addEventListener() {},
      removeEventListener() {},
    });
    global.document = dom.window.document;
    global.window = dom.window;
    ({ initHomePortrait } = await import('../js/home-portrait.js'));
  });

  after(() => {
    dom.window.close();
    delete global.document;
    delete global.window;
  });

  beforeEach(() => {
    studioLeads = false;
    dom.window.document.body.innerHTML = new JSDOM(MARKUP).window.document.body.innerHTML;
  });

  const button = () => dom.window.document.getElementById('home-portrait-flip');
  const status = () => dom.window.document.getElementById('home-portrait-status');

  it('ships disabled and is enabled only by the module', () => {
    assert.strictEqual(button().disabled, true, 'markup must ship the button disabled');
    initHomePortrait();
    assert.strictEqual(button().disabled, false, 'initHomePortrait must enable it');
  });

  it('toggles aria-pressed, which is what the stylesheet rotates on', () => {
    initHomePortrait();
    assert.strictEqual(button().getAttribute('aria-pressed'), 'false');

    button().click();
    assert.strictEqual(button().getAttribute('aria-pressed'), 'true');

    button().click();
    assert.strictEqual(button().getAttribute('aria-pressed'), 'false');
  });

  it('announces which photo is showing after every flip', () => {
    initHomePortrait();
    assert.strictEqual(status().textContent, '', 'says nothing before anything has happened');

    button().click();
    const back = status().textContent;
    button().click();
    const front = status().textContent;

    assert.ok(back.length > 0 && front.length > 0, 'both faces announce something');
    assert.notStrictEqual(back, front, 'the two faces must not announce the same thing');
  });

  it('names the face the width actually rests on, not the pressed state', () => {
    // On a phone the card rests on the outdoor shot, so the first turn lands on
    // the studio one. Above 900px the stylesheet trades the faces over and the
    // same turn lands on the outdoor shot instead. `aria-pressed` is identical
    // in both runs - only the announcement may differ, and it must.
    initHomePortrait();
    button().click();
    const phone = status().textContent;
    assert.strictEqual(button().getAttribute('aria-pressed'), 'true');

    studioLeads = true;
    button().click();
    button().click();
    const desktop = status().textContent;
    assert.strictEqual(button().getAttribute('aria-pressed'), 'true');

    assert.notStrictEqual(
      phone,
      desktop,
      'the same pressed state shows a different photograph on either side of 900px'
    );
  });

  it('raises the back face priority on the first hover, once', () => {
    initHomePortrait();
    const back = dom.window.document.querySelector('.home-portrait-face--back img');
    // The fixture gives both faces a `src` on purpose: an <img> with no src is
    // "completely available" per spec, so jsdom reports `complete === true` and
    // the warm-up correctly declines to touch an image it thinks has arrived.
    // With a src and no loader configured it stays false - the state the
    // warm-up exists for, and the one a real slow connection produces.
    assert.strictEqual(back.complete, false);

    button().dispatchEvent(new dom.window.Event('pointerenter'));
    assert.strictEqual(back.fetchPriority, 'high');

    // The listener is `once`, so a second hover must not re-register work.
    back.fetchPriority = 'low';
    button().dispatchEvent(new dom.window.Event('pointerenter'));
    assert.strictEqual(back.fetchPriority, 'low', 'warm-up must not run twice');
  });

  it('does not blow up when the portrait is not on the page', () => {
    dom.window.document.body.innerHTML = '';
    assert.doesNotThrow(() => initHomePortrait());
  });
});

describe('Home portrait markup contract', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const doc = new JSDOM(html).window.document;

  const front = doc.querySelector('.home-portrait-face--front img');
  const back = doc.querySelector('.home-portrait-face--back img');

  it('renders both faces of the card', () => {
    assert.ok(front, 'front face image');
    assert.ok(back, 'back face image');
  });

  // `loading` and `fetchpriority` have no media-conditional form, so they stay
  // written for the phone - where the front face leads and the back one is off
  // screen until a click. Above 900px the rest face is the other way round and
  // the media-scoped preload below is the only lever there is; these four
  // attributes are deliberately NOT the place that gets fixed.
  it('keeps the phone attributes written for the phone', () => {
    assert.strictEqual(front.getAttribute('fetchpriority'), 'high');
    assert.strictEqual(front.getAttribute('loading'), 'eager');
    assert.strictEqual(back.getAttribute('fetchpriority'), 'low');
    assert.strictEqual(back.getAttribute('loading'), 'lazy');
  });

  const imagePreloads = () => [...doc.querySelectorAll('link[rel="preload"][as="image"]')];
  const preloadFor = (pattern) =>
    imagePreloads().find((link) => pattern.test(link.getAttribute('imagesrcset') || ''));

  it('preloads each face only for the widths that face leads at', () => {
    const frontPreload = preloadFor(/^profile-cutout-380\.webp/);
    const backPreload = preloadFor(/^profile-cutout-back-380\.webp/);

    assert.ok(frontPreload, 'the front face is preloaded');
    assert.ok(backPreload, 'so is the back face, which leads above 900px');

    // Scoped, and scoped the right way round. Without `media` both fire at
    // every width and one of them is always the wrong photograph; swapped,
    // every visitor waits on a face they cannot see.
    assert.strictEqual(frontPreload.getAttribute('media'), '(width <= 900px)');
    assert.strictEqual(backPreload.getAttribute('media'), '(width >= 901px)');

    // The front preload has to stay first: scripts/tests/build.test.js reads
    // the first image preload in dist/index.html and asserts the service
    // worker precaches that same file.
    assert.strictEqual(imagePreloads()[0], frontPreload, 'the front preload comes first');
  });

  it('preloads exactly the srcset each <picture> will pick from', () => {
    const normalise = (value) => value.replace(/\s+/g, ' ').trim();

    for (const [face, pattern] of [
      ['front', /^profile-cutout-380\.webp/],
      ['back', /^profile-cutout-back-380\.webp/],
    ]) {
      const preload = preloadFor(pattern);
      const source = doc.querySelector(`.home-portrait-face--${face} source[type="image/webp"]`);

      assert.strictEqual(
        normalise(preload.getAttribute('imagesrcset')),
        normalise(source.getAttribute('srcset')),
        `the ${face} preload does not match its <picture>, which costs a round trip instead of saving one`
      );
      assert.strictEqual(
        normalise(preload.getAttribute('imagesizes')),
        normalise(source.getAttribute('sizes')),
        `the ${face} preload and its <picture> disagree on sizes`
      );
    }
  });

  it('ships the flip button disabled, for the no-JS page', () => {
    const flip = doc.getElementById('home-portrait-flip');
    assert.ok(flip.hasAttribute('disabled'));
    assert.strictEqual(flip.getAttribute('aria-pressed'), 'false');
    assert.ok(flip.getAttribute('aria-label'), 'the button carries its own accessible name');
    assert.strictEqual(front.getAttribute('alt'), '', 'faces stay decorative inside the button');
    assert.strictEqual(back.getAttribute('alt'), '');
  });
});
