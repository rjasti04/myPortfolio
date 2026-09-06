import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

/**
 * PullToRefresh replaces a browser gesture - the AI panel's shell blocks it,
 * and styles.css turns it off everywhere else so one implementation drives the
 * whole site. The guards ARE the feature: anything that arms on the wrong
 * gesture fires a page reload under the visitor mid-scroll.
 */
describe('PullToRefresh', () => {
  let dom;
  let scroller;
  let indicator;
  let ptr;
  let refreshes;

  // Enough of a Touch for the module: it reads identifier and clientY only.
  const finger = (identifier, clientY) => ({ identifier, clientY });

  function fire(type, touches, changedTouches) {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    event.touches = touches;
    event.changedTouches = changedTouches || touches;
    scroller.dispatchEvent(event);
    return event;
  }

  /** Drag from y0 to y1 on one finger and release. */
  function pull(y0, y1) {
    fire('touchstart', [finger(1, y0)]);
    const move = fire('touchmove', [finger(1, y1)]);
    fire('touchend', [], [finger(1, y1)]);
    return move;
  }

  const travel = () => indicator.style.getPropertyValue('--ptr-travel');
  const progress = () => indicator.style.getPropertyValue('--ptr-progress');

  // The reload is two rAFs out, so the spinner is painted before it runs.
  const settle = () => new Promise(resolve => {
    dom.window.requestAnimationFrame(() =>
      dom.window.requestAnimationFrame(() =>
        dom.window.requestAnimationFrame(resolve)));
  });

  beforeEach(async () => {
    dom = new JSDOM(
      '<!DOCTYPE html><body><div class="ai-main"><div class="ai-content-area"></div></div></body>',
      { pretendToBeVisual: true }
    );
    global.document = dom.window.document;
    global.window = dom.window;
    global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

    const { PullToRefresh } = await import('../js/swipe-handler.js');
    scroller = dom.window.document.querySelector('.ai-content-area');
    refreshes = 0;
    ptr = new PullToRefresh(scroller, () => { refreshes += 1; });
    indicator = dom.window.document.querySelector('.ptr-indicator');
  });

  afterEach(() => {
    ptr?.destroy();
    delete global.document;
    delete global.window;
    delete global.requestAnimationFrame;
  });

  it('mounts its indicator beside the scroller, not inside it', () => {
    // Inside the scroll box it would scroll away with the transcript.
    assert.ok(indicator);
    assert.strictEqual(indicator.parentElement, scroller.parentElement);
    assert.ok(indicator.querySelector('.ptr-spinner'));
  });

  it('refreshes on a drag past the threshold', async () => {
    pull(100, 200);
    await settle();
    assert.strictEqual(refreshes, 1);
    assert.ok(indicator.classList.contains('is-refreshing'));
  });

  it('does not refresh on a drag short of the threshold', async () => {
    pull(100, 150);
    await settle();
    assert.strictEqual(refreshes, 0);
    assert.strictEqual(travel(), '0px');
    assert.strictEqual(progress(), '0');
  });

  it('ignores a gesture that starts below the top of the scroller', async () => {
    // A fast flick back to the top would otherwise land on scrollTop 0 with a
    // large positive delta and read as a pull.
    scroller.scrollTop = 40;
    const move = pull(100, 300);
    await settle();
    assert.strictEqual(refreshes, 0);
    assert.strictEqual(move.defaultPrevented, false);
  });

  it('hands an upward drag back to the scroller', async () => {
    fire('touchstart', [finger(1, 300)]);
    const move = fire('touchmove', [finger(1, 200)]);
    fire('touchend', [], [finger(1, 200)]);
    await settle();
    assert.strictEqual(refreshes, 0);
    assert.strictEqual(move.defaultPrevented, false);
  });

  it('cancels the scroller\'s own scroll only while pulling', () => {
    fire('touchstart', [finger(1, 100)]);
    const move = fire('touchmove', [finger(1, 160)]);
    assert.strictEqual(move.defaultPrevented, true);
  });

  it('drops the pull when a second finger lands', async () => {
    fire('touchstart', [finger(1, 100)]);
    fire('touchmove', [finger(1, 160)]);
    fire('touchmove', [finger(1, 200), finger(2, 400)]);
    fire('touchend', [], [finger(1, 200)]);
    await settle();
    assert.strictEqual(refreshes, 0);
    assert.strictEqual(travel(), '0px');
  });

  it('tracks the finger it started with, not a later one', async () => {
    fire('touchstart', [finger(1, 100)]);
    // A touchend for a finger that was never steering must not end the pull.
    fire('touchend', [finger(1, 100)], [finger(9, 500)]);
    fire('touchmove', [finger(1, 200)]);
    fire('touchend', [], [finger(1, 200)]);
    await settle();
    assert.strictEqual(refreshes, 1);
  });

  it('caps how far the indicator follows the finger', () => {
    fire('touchstart', [finger(1, 0)]);
    fire('touchmove', [finger(1, 1000)]);
    assert.strictEqual(travel(), '96px');
    assert.strictEqual(progress(), '1');
  });

  it('refreshes once even if the gesture repeats', async () => {
    pull(100, 200);
    pull(100, 200);
    await settle();
    assert.strictEqual(refreshes, 1);
  });

  it('removes its listeners and its indicator on destroy', async () => {
    ptr.destroy();
    assert.strictEqual(dom.window.document.querySelector('.ptr-indicator'), null);
    fire('touchstart', [finger(1, 100)]);
    fire('touchmove', [finger(1, 300)]);
    fire('touchend', [], [finger(1, 300)]);
    await settle();
    assert.strictEqual(refreshes, 0);
  });

  it('marks its scroller for the document instance to skip', () => {
    assert.ok('ptrScroller' in scroller.dataset);
    ptr.destroy();
    assert.ok(!('ptrScroller' in scroller.dataset));
  });

  it('binds the scroll-blocking listener only while a pull is live', () => {
    // Left bound, a non-passive touchmove makes every scroll on the page wait
    // for JS. It is armed on touchstart and dropped the moment the pull ends.
    assert.strictEqual(ptr.moveBound, false);
    fire('touchstart', [finger(1, 100)]);
    assert.strictEqual(ptr.moveBound, true);
    fire('touchend', [], [finger(1, 100)]);
    assert.strictEqual(ptr.moveBound, false);
  });

  it('drops the listener when the pull is cancelled, not just released', () => {
    fire('touchstart', [finger(1, 300)]);
    fire('touchmove', [finger(1, 200)]);       // upward: hands the gesture back
    assert.strictEqual(ptr.moveBound, false);
  });

  it('keeps the listener when a stray finger ends', () => {
    fire('touchstart', [finger(1, 100)]);
    fire('touchend', [finger(1, 100)], [finger(9, 500)]);
    assert.strictEqual(ptr.moveBound, true);
  });
});

/**
 * Document mode. The page scroller is not an element with a positioned parent,
 * a page pull can start on anything, and the AI transcript runs its own
 * instance inside the same document - so all three have to be handled
 * differently from the nested case above.
 */
describe('PullToRefresh (document scroller)', () => {
  let dom;
  let ptr;
  let pageScroller;
  let nested;
  let nestedPtr;
  let indicator;
  let refreshes;
  let nestedRefreshes;

  const finger = (identifier, clientY) => ({ identifier, clientY });

  function fireOn(target, type, touches, changedTouches) {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    event.touches = touches;
    event.changedTouches = changedTouches || touches;
    target.dispatchEvent(event);
    return event;
  }

  const settle = () => new Promise(resolve => {
    dom.window.requestAnimationFrame(() =>
      dom.window.requestAnimationFrame(() =>
        dom.window.requestAnimationFrame(resolve)));
  });

  beforeEach(async () => {
    dom = new JSDOM(
      '<!DOCTYPE html><body><main><p id="prose">text</p></main>' +
      '<div class="ai-main"><div class="ai-content-area"><p id="turn">a</p></div></div></body>',
      { pretendToBeVisual: true }
    );
    global.document = dom.window.document;
    global.window = dom.window;
    global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

    const { PullToRefresh } = await import('../js/swipe-handler.js');
    // Same order as main.js: the nested scroller has to be marked before the
    // document instance can skip a touch inside it.
    nested = dom.window.document.querySelector('.ai-content-area');
    nestedRefreshes = 0;
    nestedPtr = new PullToRefresh(nested, () => { nestedRefreshes += 1; });
    refreshes = 0;
    // jsdom does not implement scrollingElement; main.js falls back the same way.
    pageScroller = dom.window.document.scrollingElement || dom.window.document.documentElement;
    ptr = new PullToRefresh(pageScroller, () => { refreshes += 1; });
    indicator = dom.window.document.querySelector('.ptr-indicator--viewport');
  });

  afterEach(() => {
    ptr?.destroy();
    nestedPtr?.destroy();
    delete global.document;
    delete global.window;
    delete global.requestAnimationFrame;
  });

  it('fixes its indicator to the body, not inside <html>', () => {
    assert.ok(indicator);
    assert.strictEqual(indicator.parentElement, dom.window.document.body);
    assert.ok(indicator.querySelector('.ptr-spinner'));
  });

  it('refreshes on a pull that starts anywhere on the page', async () => {
    const prose = dom.window.document.getElementById('prose');
    fireOn(prose, 'touchstart', [finger(1, 100)]);
    fireOn(prose, 'touchmove', [finger(1, 200)]);
    fireOn(prose, 'touchend', [], [finger(1, 200)]);
    await settle();
    assert.strictEqual(refreshes, 1);
  });

  it('leaves a pull inside the AI transcript to that scroller', async () => {
    // Both instances see this touch - the document one listens on `document`,
    // so it bubbles - and only the nested one may act on it.
    const turn = dom.window.document.getElementById('turn');
    fireOn(turn, 'touchstart', [finger(1, 100)]);
    fireOn(turn, 'touchmove', [finger(1, 200)]);
    fireOn(turn, 'touchend', [], [finger(1, 200)]);
    await settle();
    assert.strictEqual(refreshes, 0);
    assert.strictEqual(nestedRefreshes, 1);
  });

  it('ignores a pull that starts below the top of the page', async () => {
    pageScroller.scrollTop = 40;
    const prose = dom.window.document.getElementById('prose');
    fireOn(prose, 'touchstart', [finger(1, 100)]);
    const move = fireOn(prose, 'touchmove', [finger(1, 300)]);
    fireOn(prose, 'touchend', [], [finger(1, 300)]);
    await settle();
    assert.strictEqual(refreshes, 0);
    assert.strictEqual(move.defaultPrevented, false);
  });

  it('stands down while the document scroll is locked', async () => {
    // What the AI shell does to body, and what an open nav does. The panel and
    // the overlay own the gesture there; a second indicator must not appear.
    dom.window.document.body.style.overflowY = 'hidden';
    const prose = dom.window.document.getElementById('prose');
    fireOn(prose, 'touchstart', [finger(1, 100)]);
    const move = fireOn(prose, 'touchmove', [finger(1, 300)]);
    fireOn(prose, 'touchend', [], [finger(1, 300)]);
    await settle();
    assert.strictEqual(refreshes, 0);
    assert.strictEqual(move.defaultPrevented, false);
  });

  it('removes its listeners and its indicator on destroy', async () => {
    ptr.destroy();
    assert.strictEqual(dom.window.document.querySelector('.ptr-indicator--viewport'), null);
    const prose = dom.window.document.getElementById('prose');
    fireOn(prose, 'touchstart', [finger(1, 100)]);
    fireOn(prose, 'touchmove', [finger(1, 300)]);
    fireOn(prose, 'touchend', [], [finger(1, 300)]);
    await settle();
    assert.strictEqual(refreshes, 0);
  });
});
