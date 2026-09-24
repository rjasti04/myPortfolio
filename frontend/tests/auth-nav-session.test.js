// Regression cover for the header's session handling (codebase review C4,
// C14(b)).
//
// C4: when the access token had expired and /auth/refresh answered 429, 5xx or
// never completed, authenticatedFetch deliberately kept both tokens and handed
// back the original 401 from /auth/me. setupNavUI read that status alone,
// called it a rejected credential and cleared them anyway - so a rate-limited
// refresh, which the Activity page can provoke on its own, signed the visitor
// out.
//
// C14(b): setupNavUI runs on every `auth-changed` and added a document-level
// outside-click listener each time without removing the last one.
//
// Drives the real index.html, as auth-2fa.test.js does: setupNavUI builds the
// header against markup the page owns.
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// AbortController too: setupNavUI scopes its document listener with a signal,
// and jsdom's addEventListener rejects an AbortSignal from Node's realm.
const WINDOW_KEYS = ['HTMLElement', 'Element', 'Event', 'CustomEvent', 'Node',
                     'getComputedStyle', 'MutationObserver', 'DOMParser', 'AbortController'];

function installDom(html, url) {
  const dom = new JSDOM(html, { url });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.sessionStorage = dom.window.sessionStorage;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  for (const key of WINDOW_KEYS) {
    if (dom.window[key] !== undefined) global[key] = dom.window[key];
  }
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.matchMedia = (query = '') => ({
    matches: false, media: query,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  global.matchMedia = dom.window.matchMedia;
  dom.window.scrollTo = () => {};
  document.documentElement.classList.add('js-enabled');
  return dom;
}

function teardownDom(dom) {
  dom.window.close();
  for (const key of ['window', 'document', 'localStorage', 'sessionStorage', ...WINDOW_KEYS]) {
    delete global[key];
  }
}

/* setupNavUI awaits /auth/me and, on a 401, the refresh behind it. A few
   macrotask turns is enough for both mocked round trips to settle. */
async function renderHeader() {
  window.dispatchEvent(new window.Event('auth-changed'));
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const pathOf = (url) => String(url).replace(/^.*\/api/, '');

describe('Header session handling', () => {
  let dom;
  // What /auth/refresh answers; /auth/me answers 401 unless `signedIn`.
  let refreshStatus = 429;
  let signedIn = false;
  let username = 'owner';

  before(async () => {
    dom = installDom(
      fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8'),
      'https://rjasti.com/',
    );

    global.fetch = async (url) => {
      const route = pathOf(url);
      if (route === '/auth/refresh') {
        return { ok: false, status: refreshStatus, json: async () => ({}) };
      }
      if (route === '/auth/me') {
        if (!signedIn) return { ok: false, status: 401, json: async () => ({}) };
        return {
          ok: true, status: 200,
          json: async () => ({
            id: 'u1', email: 'owner@example.com', username,
            is_totp_enabled: false, is_active: true,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    await import('../js/auth-ui.js');
  });

  after(() => {
    delete global.fetch;
    teardownDom(dom);
  });

  beforeEach(() => {
    localStorage.setItem('rj_access_token', 'expired-access');
    localStorage.setItem('rj_refresh_token', 'refresh-0');
    signedIn = false;
    username = 'owner';
  });

  for (const status of [429, 500, 503]) {
    it(`keeps both tokens when /auth/me 401s and the refresh behind it answers ${status}`, async () => {
      refreshStatus = status;
      await renderHeader();

      assert.equal(localStorage.getItem('rj_access_token'), 'expired-access');
      assert.equal(
        localStorage.getItem('rj_refresh_token'), 'refresh-0',
        'a refresh the server could not answer says nothing about the credential',
      );
    });
  }

  it('still clears the tokens when the server refuses the refresh token', async () => {
    refreshStatus = 401;
    await renderHeader();

    assert.equal(localStorage.getItem('rj_access_token'), null);
    assert.equal(localStorage.getItem('rj_refresh_token'), null);
  });

  it('keeps one outside-click listener however often the header re-renders', async () => {
    signedIn = true;
    const clickListeners = [];
    const realAdd = document.addEventListener.bind(document);
    document.addEventListener = (type, listener, options) => {
      if (type === 'click') clickListeners.push(options?.signal ?? null);
      return realAdd(type, listener, options);
    };
    try {
      await renderHeader();
      await renderHeader();
      await renderHeader();
    } finally {
      delete document.addEventListener;
    }

    assert.ok(document.getElementById('nav-user-btn'), 'precondition: the signed-in header rendered');
    const scoped = clickListeners.filter(Boolean);
    assert.equal(scoped.length, 3, 'each render registers its listener with a signal');
    assert.deepEqual(
      scoped.map((signal) => signal.aborted),
      [true, true, false],
      'every render but the last has had its listener removed',
    );
  });

  // Codebase review U1: the account control was a <div aria-haspopup> with no
  // role, no tab stop and a one-letter name, so Logout and every account
  // action were out of reach from a keyboard.
  describe('account menu (U1)', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const key = (target, name, init = {}) => target.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }),
    );

    beforeEach(async () => {
      signedIn = true;
    });

    it('is a named disclosure button, not a div', async () => {
      await renderHeader();
      const btn = document.getElementById('nav-user-btn');
      assert.equal(btn.tagName, 'BUTTON');
      assert.equal(btn.getAttribute('type'), 'button');
      assert.equal(btn.getAttribute('aria-expanded'), 'false');
      assert.equal(btn.getAttribute('aria-controls'), 'nav-user-dropdown');
      assert.equal(btn.hasAttribute('aria-haspopup'), false, 'a disclosure, not an ARIA menu');
      assert.match(btn.getAttribute('aria-label'), /owner/);
      for (const icon of document.querySelectorAll('#nav-auth-container i')) {
        assert.equal(icon.getAttribute('aria-hidden'), 'true');
      }
    });

    it('takes the username as text, never as markup', async () => {
      username = '"><img src=x onerror=alert(1)>';
      await renderHeader();
      const container = document.getElementById('nav-auth-container');
      assert.equal(container.querySelector('img'), null);
      assert.equal(
        document.getElementById('nav-user-btn').getAttribute('aria-label'),
        `Account menu for ${username}`,
      );
    });

    it('opens into the menu, walks it with arrows, and Escape returns to the button', async () => {
      await renderHeader();
      const btn = document.getElementById('nav-user-btn');
      const dropdown = document.getElementById('nav-user-dropdown');
      btn.focus();
      btn.click();
      await flush();

      assert.equal(btn.getAttribute('aria-expanded'), 'true');
      assert.ok(dropdown.classList.contains('show'));
      assert.equal(document.activeElement.id, 'nav-2fa-btn');

      for (let i = 0; i < 5; i += 1) key(document.activeElement, 'ArrowDown');
      assert.equal(document.activeElement.id, 'nav-2fa-btn', 'ArrowDown wraps after the last item');
      key(document.activeElement, 'ArrowUp');
      assert.equal(document.activeElement.id, 'nav-logout-btn', 'ArrowUp wraps before the first');
      key(document.activeElement, 'Home');
      assert.equal(document.activeElement.id, 'nav-2fa-btn');
      key(document.activeElement, 'End');
      assert.equal(document.activeElement.id, 'nav-logout-btn');

      key(document.activeElement, 'Escape');
      assert.equal(btn.getAttribute('aria-expanded'), 'false');
      assert.ok(!dropdown.classList.contains('show'));
      assert.equal(document.activeElement, btn);
    });

    it('Tab out closes it; a blur that goes nowhere (a Safari click) does not', async () => {
      await renderHeader();
      const btn = document.getElementById('nav-user-btn');
      const dropdown = document.getElementById('nav-user-dropdown');
      btn.click();
      await flush();

      document.activeElement.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      assert.ok(dropdown.classList.contains('show'), 'no relatedTarget: stay open so the click can land');

      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      assert.ok(!dropdown.classList.contains('show'));
      assert.equal(btn.getAttribute('aria-expanded'), 'false');
      assert.equal(document.activeElement, outside, 'Tab carries on; focus is not pulled back');
      outside.remove();
    });

    it('choosing an item reports the menu closed, and its dialog returns focus to the button', async () => {
      await renderHeader();
      const btn = document.getElementById('nav-user-btn');
      btn.click();
      await flush();
      document.getElementById('nav-change-pw-btn').click();
      await flush();

      assert.equal(btn.getAttribute('aria-expanded'), 'false');
      assert.notEqual(document.activeElement, btn, 'precondition: the dialog took focus');
      // openModal recorded the active element when the item asked for the
      // dialog. That used to be the item, hidden by now, so focus fell to
      // <body>; closing the menu first makes it the button.
      key(document.activeElement, 'Escape');
      await flush();
      await flush();
      assert.equal(document.activeElement, btn);
    });
  });
});
