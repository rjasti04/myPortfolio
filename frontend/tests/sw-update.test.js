// Regression cover for the service-worker update prompt and stale chunks
// (codebase review C15).
//
// (1) The update banner was offered only on an `updatefound` during the
//     current page's life. A worker that finished installing before the page
//     loaded - the usual case for a visitor returning after a deploy - was
//     already `waiting` and was never offered.
// (2) A deploy deletes the previous build's hashed chunks, and the lazily
//     loaded chat, activity and owner-analytics chunks are not precached. A
//     tab still on the old build 404'd on those imports, and the only trace
//     was a console.warn.
//
// Imports the real main.js. Its boot waits for DOMContentLoaded, which has
// already fired by the time a JSDOM exists, so only the module-level wiring
// and the exported helpers run here.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('Update prompt', () => {
  let dom;
  let main;
  let posted;

  const banners = () => document.querySelectorAll('.update-banner');
  const fakeRegistration = (overrides = {}) => ({
    waiting: null,
    installing: null,
    update() {},
    addEventListener() {},
    ...overrides,
  });

  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://rjasti.com/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.sessionStorage = dom.window.sessionStorage;
    global.HTMLElement = dom.window.HTMLElement;
    global.Event = dom.window.Event;
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    dom.window.matchMedia = () => ({
      matches: false,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    });
    global.matchMedia = dom.window.matchMedia;
    // A page this worker already controls - the only case an update applies to.
    Object.defineProperty(global, 'navigator', {
      value: {
        onLine: true,
        userAgent: 'node',
        serviceWorker: { controller: {}, addEventListener() {} },
      },
      configurable: true,
    });
    // watchServiceWorkerUpdates starts a 30-minute check; left running it
    // would hold the test process open for that long.
    global.setInterval = () => 0;
    global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) });

    main = await import('../js/main.js');
  });

  after(() => {
    delete global.fetch;
    dom.window.close();
  });

  beforeEach(() => {
    banners().forEach((banner) => banner.querySelector('.update-dismiss-btn').click());
    posted = [];
  });

  it('offers a worker that was already waiting when the page loaded', () => {
    main.watchServiceWorkerUpdates(fakeRegistration({
      waiting: { postMessage: (message) => posted.push(message) },
    }));

    assert.equal(banners().length, 1, 'no updatefound will ever fire for this worker');
    banners()[0].querySelector('.update-refresh-btn').click();
    assert.deepEqual(posted, [{ type: 'SKIP_WAITING' }], 'Refresh activates the waiting worker');
  });

  it('offers nothing when no worker is waiting', () => {
    main.watchServiceWorkerUpdates(fakeRegistration());
    assert.equal(banners().length, 0);
  });

  it('offers a reload, once, when a lazy chunk cannot be imported', async () => {
    const missingChunk = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
    await assert.rejects(main.loadLazyModule(missingChunk, () => {}));
    await assert.rejects(main.loadLazyModule(missingChunk, () => {}));

    assert.equal(banners().length, 1, 'a stale build is announced, and only once');
  });

  it('does not call a throwing initialiser a stale build', async () => {
    const loaded = () => Promise.resolve({ init() { throw new Error('a bug in init'); } });
    await assert.rejects(main.loadLazyModule(loaded, (module) => module.init()), /a bug in init/);

    assert.equal(banners().length, 0, 'a reload would not fix this, so it is not offered');
  });

  it('does not blame a new version for being offline', async () => {
    navigator.onLine = false;
    try {
      await assert.rejects(main.loadLazyModule(() => Promise.reject(new TypeError('offline')), () => {}));
    } finally {
      navigator.onLine = true;
    }
    assert.equal(banners().length, 0);
  });
});

/* S14 (docs/review/codebase_review_20260924.md): the worker cached every
   navigation under its full URL, so a link mailed as `/?magic_token=…` wrote
   the token into Cache Storage with no expiry, and every `?s=` share link
   added another whole copy of the page. Driven against the real sw.js in a
   bare VM context, with just enough of a worker around it. */
describe('Service worker navigation cache', () => {
  const load = async () => {
    const { readFileSync } = await import('node:fs');
    const vm = await import('node:vm');
    const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
    const listeners = {};
    const stored = new Map();
    const cache = {
      put: async (key, response) => { stored.set(typeof key === 'string' ? key : key.url, response); },
      match: async (key) => stored.get(typeof key === 'string' ? key : key.url),
    };
    const context = vm.createContext({
      self: { addEventListener: (type, fn) => { listeners[type] = fn; } },
      caches: { open: async () => cache, match: async (key) => cache.match(key) },
      fetch: async () => new Response('<!doctype html>', { status: 200 }),
      location: { origin: 'https://rjasti.com' },
      URL, Response, Headers, Promise, Date, console,
    });
    vm.runInContext(source, context);
    const navigate = async (href) => {
      let responded;
      listeners.fetch({
        request: { url: href, method: 'GET', mode: 'navigate', headers: new Headers() },
        respondWith: (promise) => { responded = promise; },
      });
      await responded;
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { navigate, stored };
  };

  it('caches a navigation under its path, never its query string', async () => {
    const { navigate, stored } = await load();
    await navigate('https://rjasti.com/?magic_token=eyJ.secret.sig');
    await navigate('https://rjasti.com/?s=abc123');
    await navigate('https://rjasti.com/');

    assert.deepEqual([...stored.keys()], ['https://rjasti.com/']);
    assert.ok(![...stored.keys()].some((key) => key.includes('token')), 'a token must not become a cache key');
  });
});
