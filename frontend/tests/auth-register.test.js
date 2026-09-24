// Regression cover for the registration flow.
//
// registerUser() called loginUser() straight after a 201 - "auto-login after
// successful registration". That was right when registration handed back a
// usable account, but `authenticate_user` refuses an address that has not been
// confirmed and every registration now creates exactly that, so the login
// could never succeed. It returned 403, registerUser rethrew it, and the modal
// painted "Confirm your email address" into the *error* slot of a form whose
// account had in fact just been created - no success toast, dialog still open,
// and "Email already registered" if the visitor tried again.
//
// It also spent a second request on /auth/login, which shares the strict
// 5-per-minute auth budget with /auth/register, on a call certain to fail.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

let dom;
let auth;
let calls;
let sentBodies;

test.before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://rjasti.com/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.sessionStorage = dom.window.sessionStorage;
  global.Event = dom.window.Event;
  auth = await import("../js/auth.js");
});

test.after(() => {
  delete global.fetch;
  dom?.window?.close();
});

test.beforeEach(() => {
  calls = [];
  sentBodies = [];
  localStorage.clear();
});

/** The server as it actually behaves: 202 on register - the same answer for
    an address that already has an account - and 403 on login until the
    address is confirmed. */
function installServerStub() {
  global.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^.*\/api/, "");
    calls.push(path);
    if (path === "/auth/register") {
      sentBodies.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 202,
        json: async () => ({ message: "Check your inbox to finish setting up your account." }),
      };
    }
    if (path === "/auth/login") {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          detail: "Confirm your email address to finish setting up your account.",
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test("registering does not attempt a login that cannot succeed", async () => {
  installServerStub();

  const created = await auth.registerUser("New@Example.com ", "Str0ngPassw0rd!");

  assert.deepEqual(
    calls,
    ["/auth/register"],
    "the auto-login was guaranteed to 403 and burned a strict-budget request"
  );
  assert.equal(sentBodies[0].email, "New@Example.com", "the client trims; the server normalises");
  assert.match(created.message, /check your inbox/i, "the server's message is returned to the caller");
});

test("a successful registration does not report a failure", async () => {
  installServerStub();

  // The bug: this threw "Confirm your email address…", which the modal painted
  // into the register form's error slot and treated as a failed registration.
  await assert.doesNotReject(
    () => auth.registerUser("someone@example.com", "Str0ngPassw0rd!"),
    "a 202 from /auth/register is a success, whatever /auth/login would say"
  );
});

test("registering signs nobody in - the address is unconfirmed", async () => {
  installServerStub();

  await auth.registerUser("someone@example.com", "Str0ngPassw0rd!");

  assert.equal(auth.getAuthToken(), null, "no access token may be stored");
  assert.equal(localStorage.getItem("rj_refresh_token"), null);
});

test("a real registration failure still throws with the server's reason", async () => {
  global.fetch = async (url) => {
    calls.push(String(url).replace(/^.*\/api/, ""));
    return { ok: false, status: 429, json: async () => ({ detail: "Too many requests" }) };
  };

  await assert.rejects(
    () => auth.registerUser("someone@example.com", "Str0ngPassw0rd!"),
    /Too many requests/
  );
});

// Codebase review U7: the show/hide-password toggle inside the register and
// login fields was 20x20px - under WCAG 2.5.8's 24px, with no spacing
// exception because it sits inside the field. It now takes the app's touch
// floor, and the fields that hold one make room for it.
test("the password toggle is a full touch target, and its field makes room", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../auth-modal.css", import.meta.url), "utf8");
  const rule = css.match(/\n\.password-toggle-btn\s*\{([^}]*)\}/);
  assert.ok(rule, ".password-toggle-btn rule not found");
  assert.match(rule[1], /\bwidth:\s*var\(--min-touch-target\)/);
  assert.match(rule[1], /\bheight:\s*var\(--min-touch-target\)/);
  assert.match(
    css,
    /\.input-wrapper:has\(> \.password-toggle-btn\) input\s*\{[^}]*padding-right:\s*calc\(var\(--min-touch-target\)/,
  );
});
