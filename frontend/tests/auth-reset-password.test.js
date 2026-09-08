// Regression cover for the reset-password flow.
//
// #195 reworked the four auth forms from "disable the submit button until the
// fields validate" to "keep it operable, explain on attempt": every
// `submitBtn.disabled = !(...)` became `setSubmitReadiness()`, which records
// `data-ready` / `aria-disabled` and deliberately never touches `.disabled`.
//
// index.html was not changed with it, so the four buttons still shipped the
// literal `disabled` attribute and nothing was left to clear it. A disabled
// <button type="submit"> fires neither `click` nor `submit`, so the handlers
// never ran: a visitor could open the emailed reset link, satisfy every rule
// on the checklist, watch it go green - and the greyed-out button did nothing.
// Register, Change Password and Delete Account were dead the same way.
//
// So these drive the real index.html rather than the helper in isolation: the
// defect was the markup disagreeing with the module, which only shows up when
// the two are put together.
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const RESET_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.e30.signature';
const GOOD_PASSWORD = 'Correct-Horse9';

const WINDOW_KEYS = ['HTMLElement', 'Element', 'Event', 'CustomEvent', 'Node',
                     'getComputedStyle', 'MutationObserver', 'DOMParser'];

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
  // The pre-boot inline script sets this; jsdom is not running scripts here.
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

/** Type the way a visitor does - every validator here listens on `input`. */
function type(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/* The success path schedules `switchTab('login')` two seconds out, which would
   otherwise fire long after teardown has closed the window. Hold the timers
   for the duration of the submit rather than sleeping through them. */
async function submitAndSettle(form) {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

describe('Reset password form', () => {
  let dom;
  let calls = [];

  before(async () => {
    dom = installDom(
      fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8'),
      `https://rjasti.com/?reset_token=${RESET_TOKEN}`,
    );
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: 'Password reset successfully.' }),
      };
    };
    // auth-ui.js self-initialises on import: readyState is already 'complete'
    // under jsdom, so initAuthUI runs straight through the form wiring.
    await import('../js/auth-ui.js');
  });

  after(() => {
    delete global.fetch;
    teardownDom(dom);
  });

  beforeEach(() => { calls = []; });

  // The bug itself. `disabled` in the markup with nothing left to clear it made
  // the button inert forever, whatever the visitor typed. Asserted across all
  // four because one markup edit broke all four at once.
  it('leaves every auth submit button operable after init', () => {
    for (const id of ['reset-pw-submit-btn', 'register-submit-btn',
                      'change-pw-submit-btn', 'delete-account-submit-btn']) {
      assert.equal($(id).disabled, false, `#${id} is disabled, so it can never be submitted`);
    }
  });

  it('takes the token from the emailed link and scrubs it from the address bar', () => {
    assert.equal($('reset-token-input').value, RESET_TOKEN);
    assert.equal(window.location.search, '');
    assert.equal($('auth-tab-reset-password').classList.contains('active'), true);
  });

  it('marks the button ready once the rules pass and the two entries match', () => {
    type($('reset-new-password'), GOOD_PASSWORD);
    type($('reset-confirm-password'), GOOD_PASSWORD);
    assert.equal($('reset-pw-submit-btn').dataset.ready, 'true');
    assert.equal($('reset-pw-submit-btn').getAttribute('aria-disabled'), 'false');
  });

  it('explains a mismatch in the error slot instead of posting it', async () => {
    type($('reset-new-password'), GOOD_PASSWORD);
    type($('reset-confirm-password'), `${GOOD_PASSWORD}-typo`);
    assert.equal($('reset-pw-submit-btn').dataset.ready, 'false');

    await submitAndSettle($('reset-password-form'));

    assert.equal(calls.length, 0, 'a mismatched pair must not reach the API');
    assert.match($('reset-pw-error').textContent, /do not match/i);
  });

  it('posts the token and the new password on a valid submit', async () => {
    type($('reset-new-password'), GOOD_PASSWORD);
    type($('reset-confirm-password'), GOOD_PASSWORD);

    await submitAndSettle($('reset-password-form'));

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/auth\/reset-password$/);
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      token: RESET_TOKEN,
      new_password: GOOD_PASSWORD,
    });
    assert.match($('reset-pw-success').textContent, /successfully/i);
  });
});
