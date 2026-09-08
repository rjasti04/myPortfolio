import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

/* Registration now confirms the address before login is allowed. Closes the
   "No email verification on registration" row in docs/SECURITY.md, whose stated
   path forward was to reuse the one_time_tokens table. */

describe('Email verification client', () => {
  let dom;
  let auth;
  let calls;
  let respond;

  before(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost:8080/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = dom.window.localStorage;
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), body: JSON.parse(options.body || '{}') });
      return respond(String(url));
    };
    auth = await import('../js/auth.js');
  });

  after(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.fetch;
  });

  beforeEach(() => {
    calls = [];
    respond = () => ({ ok: true, status: 200, json: async () => ({}) });
    dom.window.localStorage.clear();
  });

  it('tags a 403 login so the UI can offer a resend', async () => {
    respond = () => ({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Confirm your email address to finish setting up your account.' }),
    });
    const err = await auth.loginUser('a@b.co', 'pw').then(() => null, (e) => e);
    assert.ok(err, 'an unverified login must reject');
    // Tagged, not string-matched: the UI must not depend on server wording.
    assert.equal(err.needsEmailVerification, true);
  });

  it('does not tag a wrong password as needing verification', async () => {
    respond = () => ({ ok: false, status: 401, json: async () => ({ detail: 'Incorrect email or password' }) });
    const err = await auth.loginUser('a@b.co', 'pw').then(() => null, (e) => e);
    assert.equal(err.needsEmailVerification, undefined);
  });

  it('stores no tokens when login is refused for an unverified address', async () => {
    respond = () => ({ ok: false, status: 403, json: async () => ({ detail: 'Confirm your email address.' }) });
    await auth.loginUser('a@b.co', 'pw').catch(() => {});
    assert.equal(auth.getAuthToken(), null);
  });

  it('posts the token to verify-email', async () => {
    respond = () => ({ ok: true, status: 200, json: async () => ({ message: 'Email address confirmed.' }) });
    const result = await auth.verifyEmail('a-token');
    assert.match(calls[0].url, /\/auth\/verify-email$/);
    assert.equal(calls[0].body.token, 'a-token');
    assert.match(result.message, /confirmed/i);
  });

  it('surfaces a rejected verification link', async () => {
    respond = () => ({ ok: false, status: 400, json: async () => ({ detail: 'Invalid or expired verification link' }) });
    await assert.rejects(() => auth.verifyEmail('stale'), /Invalid or expired/);
  });

  it('trims the address before asking for a new link', async () => {
    await auth.resendVerification('  Ada@Example.com  ');
    assert.match(calls[0].url, /\/auth\/resend-verification$/);
    assert.equal(calls[0].body.email, 'Ada@Example.com');
  });
});
