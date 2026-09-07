import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The landing portrait is a flip card, and almost all of it is CSS. What is
// worth asserting here is the part that is not: the contract between the
// markup, the module and the stylesheet.
//
// Three things can break silently and none of them would fail a build.
//
//   1. The button ships `disabled` so that a page without JS never offers a
//      control that cannot work. If a future edit drops that attribute the
//      page looks identical and quietly regresses for every no-JS visitor.
//   2. The CSS selector that rotates the card reads `aria-pressed` directly,
//      so the accessible state IS the visual state. Swap it for a class and
//      the card still turns while screen readers are told nothing.
//   3. The back face must stay out of the LCP's way - not preloaded, and
//      explicitly low priority - because it is not on screen until someone
//      clicks. That is easy to undo by copying the front face's attributes.
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

  before(async () => {
    dom = new JSDOM(MARKUP, { url: 'https://rjasti.com/' });
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

  it('keeps the front face the LCP element and the back face out of its way', () => {
    assert.strictEqual(front.getAttribute('fetchpriority'), 'high');
    assert.strictEqual(front.getAttribute('loading'), 'eager');
    assert.strictEqual(back.getAttribute('fetchpriority'), 'low');
    assert.strictEqual(back.getAttribute('loading'), 'lazy');

    const preloads = [...doc.querySelectorAll('link[rel="preload"][as="image"]')]
      .map((link) => link.getAttribute('imagesrcset') || link.getAttribute('href'))
      .join(' ');
    assert.match(preloads, /profile-cutout-380\.webp/, 'the front face is preloaded');
    assert.doesNotMatch(preloads, /profile-cutout-back/, 'the back face must not be');
  });

  it('preloads exactly the srcset the front <picture> will pick from', () => {
    const preload = doc.querySelector('link[rel="preload"][as="image"][type="image/webp"]');
    const source = doc.querySelector('.home-portrait-face--front source[type="image/webp"]');
    const normalise = (value) => value.replace(/\s+/g, ' ').trim();

    assert.strictEqual(
      normalise(preload.getAttribute('imagesrcset')),
      normalise(source.getAttribute('srcset')),
      'a preload that does not match the <picture> costs a round trip instead of saving one'
    );
    assert.strictEqual(
      normalise(preload.getAttribute('imagesizes')),
      normalise(source.getAttribute('sizes'))
    );
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
