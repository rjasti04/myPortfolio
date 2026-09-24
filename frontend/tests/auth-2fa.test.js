// Regression cover for the 2FA account surface.
//
// Two defects, one root: the nav item was the feature's only control and it did
// two contradictory jobs. Its label read "2FA Enabled" once `is_totp_enabled`
// came back true, but the click handler still dispatched the enrolment event
// unconditionally - so an enrolled user got the enrolment panel and the
// server's (correct) refusal to reissue a live secret. What rendered was an
// empty QR frame, a bare "Secret Key:" and an error telling them to disable 2FA
// through a control that did not exist: `disable2FA` was defined in auth.js and
// imported by nobody.
//
// A third defect sat underneath: nothing ever cleared `#2fa-qr-img.src` or
// `#2fa-secret-text`, so one successful enrolment left the TOTP secret in the
// document for the rest of the page's life.
//
// These drive the real index.html for the same reason auth-reset-password does:
// the bug was the markup and the module disagreeing about what state the panel
// was in, which only shows when the two are put together.
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PASSWORD = 'Correct-Horse9';
const CODE = '123456';
const QR_DATA_URI = 'data:image/png;base64,iVBORw0KGgo=';
const SECRET = 'JBSWY3DPEHPK3PXP';

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
  // modal.js restores the scroll position on close; jsdom has no layout and
  // throws "not implemented" rather than no-opping.
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

const $ = (id) => document.getElementById(id);

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/* The enable path schedules its modal close 1.5s out; holding the timers keeps
   that from firing after teardown has closed the window. */
async function settle(fn) {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    await fn();
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

const pathOf = (url) => String(url).replace(/^.*\/api/, '');

describe('Two-factor authentication UI', () => {
  let dom;
  let authUi;
  let calls = [];
  let totpEnabled = false;

  before(async () => {
    dom = installDom(
      fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8'),
      'https://rjasti.com/',
    );
    // setupNavUI bails without a token, and reads is_totp_enabled off /auth/me.
    localStorage.setItem('rj_access_token', 'header.payload.signature');

    global.fetch = async (url, options = {}) => {
      const route = pathOf(url);
      calls.push({ route, options });
      const body = (data) => ({ ok: true, status: 200, json: async () => data });

      if (route === '/auth/me') {
        return body({
          id: 'u1', email: 'owner@example.com', username: 'owner',
          created_at: new Date().toISOString(), is_active: true,
          is_totp_enabled: totpEnabled, email_verified_at: new Date().toISOString(),
        });
      }
      if (route === '/auth/2fa/setup') {
        // The server refuses to reissue a live secret; mirror that here so the
        // "enrolled user must not reach setup" case is a real 400, not a stub.
        if (totpEnabled) {
          return {
            ok: false, status: 400,
            json: async () => ({ detail: '2FA is already enabled. Disable it before enrolling a new authenticator.' }),
          };
        }
        return body({ secret: SECRET, qr_code: QR_DATA_URI });
      }
      if (route === '/auth/register') {
        return { ok: true, status: 202, json: async () => ({ message: 'Check your inbox to finish setting up your account.' }) };
      }
      if (route === '/auth/2fa/disable') return body({ message: '2FA successfully disabled' });
      if (route === '/auth/2fa/enable') return body({ message: '2FA successfully enabled' });
      return body({});
    };

    // auth-ui.js self-initialises on import: readyState is 'complete' under
    // jsdom, so initAuthUI runs straight through the form wiring.
    authUi = await import('../js/auth-ui.js');
  });

  after(() => {
    delete global.fetch;
    teardownDom(dom);
  });

  beforeEach(() => {
    calls = [];
  });

  // Not 2FA, but the same modal and the same harness. Registration answers the
  // same whether or not the address already has an account, so the page must
  // not claim one was created.
  it('reports a registration without claiming an account was created', async () => {
    type($('register-email'), 'someone@example.com');
    type($('register-password'), 'Str0ng-Passw0rd!');
    type($('register-confirm-password'), 'Str0ng-Passw0rd!');
    await settle(async () => {
      $('register-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });

    assert.ok(calls.some((c) => c.route === '/auth/register'), 'should have registered');
    assert.equal($('register-error').textContent, '');
    assert.equal($('register-success').textContent.startsWith(authUi.REGISTER_SENT_MESSAGE), true);
    assert.doesNotMatch($('register-success').textContent, /account created/i);
  });

  it('offers enrolment, and renders the QR and the secret, when 2FA is off', async () => {
    totpEnabled = false;
    await settle(async () => {
      window.dispatchEvent(new window.Event('auth-changed'));
    });

    const btn = $('nav-2fa-btn');
    assert.ok(btn, 'the nav dropdown should carry a 2FA control');
    assert.match(btn.textContent, /Setup 2FA/);

    calls = [];
    await settle(async () => {
      btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    });

    assert.ok(calls.some((c) => c.route === '/auth/2fa/setup'), 'should ask for a secret');
    assert.equal($('auth-tab-2fa-setup').classList.contains('active'), true);
    assert.equal($('2fa-qr-img').getAttribute('src'), QR_DATA_URI);
    assert.equal($('2fa-secret-text').textContent, SECRET);
    assert.equal($('2fa-setup-container').hidden, false, 'the QR block should be revealed');
  });

  it('routes an enrolled account to the manage panel instead of re-enrolling', async () => {
    totpEnabled = true;
    await settle(async () => {
      window.dispatchEvent(new window.Event('auth-changed'));
    });

    const btn = $('nav-2fa-btn');
    assert.match(btn.textContent, /Manage 2FA/, 'the label should name an action, not a status');

    calls = [];
    await settle(async () => {
      btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    });

    // The whole defect: this used to POST /auth/2fa/setup, take the 400, and
    // paint the error over an empty QR frame.
    assert.equal(
      calls.some((c) => c.route === '/auth/2fa/setup'), false,
      'an enrolled account must not ask to enrol again',
    );
    assert.equal($('auth-tab-2fa-manage').classList.contains('active'), true);
    assert.equal($('auth-tab-2fa-setup').classList.contains('active'), false);
    assert.ok($('2fa-disable-form'), 'the manage panel must offer a way off 2FA');
  });

  it('drops the enrolment secret out of the DOM when the panel is left', async () => {
    totpEnabled = false;
    await settle(async () => {
      window.dispatchEvent(new window.Event('auth-changed'));
    });
    await settle(async () => {
      $('nav-2fa-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
    });
    assert.equal($('2fa-secret-text').textContent, SECRET, 'precondition: secret is on screen');

    await settle(async () => {
      window.dispatchEvent(new window.Event('request-sessions-modal'));
    });

    assert.equal($('2fa-secret-text').textContent, '', 'the secret must not outlive the panel');
    assert.equal(
      $('2fa-qr-img').hasAttribute('src'), false,
      'an empty src resolves to the document URL and refetches index.html',
    );
    assert.equal($('2fa-setup-container').hidden, true);
  });

  it('sends the password and the code when disabling', async () => {
    totpEnabled = true;
    await settle(async () => {
      window.dispatchEvent(new window.Event('request-2fa-manage-modal'));
    });

    type($('2fa-disable-password'), PASSWORD);
    type($('2fa-disable-code'), CODE);

    calls = [];
    await settle(async () => {
      $('2fa-disable-form').dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    const disable = calls.find((c) => c.route === '/auth/2fa/disable');
    assert.ok(disable, 'the form must reach the endpoint that has existed all along');
    assert.deepEqual(JSON.parse(disable.options.body), {
      current_password: PASSWORD,
      code: CODE,
    });
  });

  it('keeps the disable button operable and explains what is missing', async () => {
    totpEnabled = true;
    await settle(async () => {
      window.dispatchEvent(new window.Event('request-2fa-manage-modal'));
    });

    const btn = $('2fa-disable-submit-btn');
    type($('2fa-disable-password'), '');
    type($('2fa-disable-code'), '');

    // The house rule: never `.disabled` on an auth submit - report on attempt.
    assert.equal(btn.disabled, false);
    assert.equal(btn.getAttribute('aria-disabled'), 'true');

    calls = [];
    await settle(async () => {
      $('2fa-disable-form').dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    assert.equal(calls.some((c) => c.route === '/auth/2fa/disable'), false);
    assert.match($('2fa-disable-error').textContent, /password/i);
  });

  it('sends a failed login challenge back to the login form', async () => {
    // Every verify failure is terminal: the server burns the single-use
    // pre-auth token before it checks the code, so retyping on this panel only
    // ever earned "this sign-in attempt has expired" with no way back.
    global.fetch = async (url, options = {}) => {
      calls.push({ route: pathOf(url), options });
      return {
        ok: false, status: 400,
        json: async () => ({ detail: 'Invalid 2FA code' }),
      };
    };

    $('2fa-pre-auth-token-input').value = 'spent.pre.auth';
    type($('2fa-verify-code'), '000000');

    await settle(async () => {
      $('2fa-verify-form').dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    assert.equal($('2fa-pre-auth-token-input').value, '', 'the spent token must be cleared');
    assert.equal($('auth-tab-login').classList.contains('active'), true);
    assert.match($('login-error').textContent, /sign in again/i);
  });
});
