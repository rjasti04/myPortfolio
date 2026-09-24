// Regression cover for the Activity dashboard's lifecycle (codebase review C13).
//
// (1) Entry awaits the session and the first load. A visitor who left during
//     either came back to nothing, while the entry carried on and opened an
//     EventSource and a refetch timer on a hidden section.
// (2) An HTTP error answer closes an EventSource for good after one `error`
//     event, so counting towards the give-up threshold never got there and
//     the pill said "Connecting…" forever.
// (3) The error state says "use Refresh", and Refresh never restarted the
//     stream.
//
// Drives the real initActivity() through the `active` class the router
// toggles, with a fake EventSource standing in for the stream.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.readyState = FakeEventSource.CONNECTING;
    this.onopen = null;
    this.onerror = null;
    FakeEventSource.instances.push(this);
  }

  addEventListener() {}

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe('Activity section lifecycle', () => {
  let dom;
  let held = [];
  let holdEvents = false;
  let intervalsSince = null;
  const realSetInterval = globalThis.setInterval;

  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
  const section = () => document.getElementById('activity');
  const live = () => document.getElementById('act-live');
  const label = () => document.getElementById('act-live-label');

  before(async () => {
    dom = new JSDOM(`<!doctype html><html><body>
      <section id="activity" class="section">
        <span id="act-live"><span id="act-live-label"></span></span>
        <button id="activity-refresh-btn" type="button"><i></i></button>
      </section>
    </body></html>`, { url: 'https://rjasti.com/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.sessionStorage = dom.window.sessionStorage;
    global.MutationObserver = dom.window.MutationObserver;
    global.HTMLElement = dom.window.HTMLElement;
    global.EventSource = FakeEventSource;
    dom.window.matchMedia = () => ({
      matches: false,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    });
    // analytics.js reads these at import; with them set there is a session.
    sessionStorage.setItem('rj_session_id', '11111111-1111-4111-8111-111111111111');
    sessionStorage.setItem('rj_session_token', 'token');

    global.fetch = async (url) => {
      if (holdEvents && String(url).includes('/events')) {
        await new Promise((resolve) => held.push(resolve));
      }
      return { ok: true, status: 200, json: async () => ({ events: [], total: 0 }) };
    };
    // Recorded so the first test can see what an entry left running, and
    // unref'd because analytics.js and the dashboard both start intervals
    // that would otherwise hold Node's event loop open after the last test.
    globalThis.setInterval = (...args) => {
      if (intervalsSince) intervalsSince.push(args);
      const timer = realSetInterval(...args);
      timer.unref?.();
      return timer;
    };

    const { initActivity } = await import('../js/activity.js');
    initActivity();
  });

  after(() => {
    section()?.classList.remove('active');
    globalThis.setInterval = realSetInterval;
    for (const key of ['window', 'document', 'localStorage', 'sessionStorage',
                       'MutationObserver', 'HTMLElement', 'EventSource', 'fetch']) {
      delete global[key];
    }
    dom.window.close();
  });

  it('does not start the stream or its timers when the visitor leaves mid-load', async () => {
    FakeEventSource.instances = [];
    holdEvents = true;
    section().classList.add('active');
    await tick();
    assert.ok(held.length > 0, 'precondition: the first load is in flight');

    section().classList.remove('active');
    await tick();
    intervalsSince = [];
    held.splice(0).forEach((release) => release());
    holdEvents = false;
    await tick();

    assert.equal(FakeEventSource.instances.length, 0, 'no stream for a section nobody is on');
    assert.equal(intervalsSince.length, 0, 'and no refetch or clock timer left running');
    intervalsSince = null;
  });

  it('reports an error at once when the browser closes the stream for good', async () => {
    FakeEventSource.instances = [];
    section().classList.add('active');
    await tick();
    assert.equal(FakeEventSource.instances.length, 1, 'precondition: the stream is open');

    const [source] = FakeEventSource.instances;
    source.readyState = FakeEventSource.CLOSED; // an HTTP error answer
    source.onerror();

    assert.equal(live().dataset.status, 'error', 'one fatal error is enough to say so');
    assert.match(label().textContent, /Refresh/);
  });

  it('Refresh reopens a dead stream', async () => {
    document.getElementById('activity-refresh-btn')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await tick();

    assert.equal(FakeEventSource.instances.length, 2, 'the button the error names must do something');
    assert.equal(live().dataset.status, 'connecting');
  });

  it('Refresh leaves a healthy stream alone', async () => {
    const current = FakeEventSource.instances.at(-1);
    current.readyState = FakeEventSource.OPEN;
    current.onopen();

    document.getElementById('activity-refresh-btn')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await tick();

    assert.equal(FakeEventSource.instances.length, 2, 'no reconnect when nothing is wrong');
    assert.notEqual(current.readyState, FakeEventSource.CLOSED);
    section().classList.remove('active');
    await tick();
  });
});
