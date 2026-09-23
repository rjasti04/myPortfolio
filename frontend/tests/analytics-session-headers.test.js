// The chat posts through authenticatedFetch() for its bearer token, so it never
// went through apiFetch() and never carried the analytics session. No chat turn
// was attributed to a session: the telemetry row the server writes for one was
// never written, and there was no session id to hand to Bedrock.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const SESSION = "33333333-3333-3333-3333-333333333333";

let dom;
let window;

test.before(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://rjasti.com/" });
  window = dom.window;
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  global.sessionStorage = window.sessionStorage;
});

test.after(() => {
  dom?.window?.close();
});

test.beforeEach(() => {
  window.sessionStorage.clear();
});

test("sessionHeaders carries the session id and its token", async () => {
  window.sessionStorage.setItem("rj_session_id", SESSION);
  window.sessionStorage.setItem("rj_session_token", "token-c");

  const analytics = await import(`../js/analytics.js?session-headers-${Date.now()}`);

  assert.deepEqual(analytics.sessionHeaders(), {
    "X-Session-ID": SESSION,
    "X-Session-Token": "token-c",
  });
});

test("sessionHeaders is empty before a session exists", async () => {
  const analytics = await import(`../js/analytics.js?session-headers-none-${Date.now()}`);

  assert.deepEqual(analytics.sessionHeaders(), {});
});
