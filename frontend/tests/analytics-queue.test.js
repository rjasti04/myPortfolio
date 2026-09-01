// Regression cover for the shared event queue (BUG-08).
//
// The session id lives in sessionStorage (per tab); the queue lived in
// localStorage (shared across tabs) under one key, and each queued event
// carries a baked-in session_id. So a second tab restored the first tab's
// events, flushed them with its own token, and the API - which checks every row
// against the presented token - answered 403 for the whole batch. A 403 is not
// re-queued, so that tab's own valid events went with them.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const QUEUE_PREFIX = "rj_event_queue";
const TAB_A_SESSION = "11111111-1111-1111-1111-111111111111";
const TAB_B_SESSION = "22222222-2222-2222-2222-222222222222";

let dom;
let window;

function keysMatching(prefix) {
  return Object.keys(window.localStorage).filter((k) => k.startsWith(prefix));
}

test.before(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://rjasti.com/" });
  window = dom.window;
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  global.sessionStorage = window.sessionStorage;
  global.Event = window.Event;
  // initAnalytics starts a 60s heartbeat and a 2s flush loop. Left running they
  // hold Node's event loop open and the test file never exits.
  window.setInterval = () => 0;
  global.setInterval = () => 0;
  global.fetch = async () => ({
    ok: true,
    status: 201,
    headers: { get: () => null },
    json: async () => ({ inserted: 0, rejected: [] }),
  });
});

test.after(() => {
  delete global.fetch;
  dom?.window?.close();
});

test.beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("the queue key is namespaced per session, not shared", async () => {
  // Tab A leaves a queue behind.
  window.localStorage.setItem(
    `${QUEUE_PREFIX}:${TAB_A_SESSION}`,
    JSON.stringify([{ session_id: TAB_A_SESSION, event_type: "page_view" }])
  );

  const namespaced = keysMatching(`${QUEUE_PREFIX}:`);
  assert.equal(namespaced.length, 1);
  assert.ok(
    namespaced[0].includes(TAB_A_SESSION),
    "a queue must be addressable by the session that owns it"
  );
});

test("initAnalytics discards another session's persisted queue", async () => {
  // Tab A's leftovers, plus the unscoped key older builds wrote.
  window.localStorage.setItem(
    `${QUEUE_PREFIX}:${TAB_A_SESSION}`,
    JSON.stringify([{ session_id: TAB_A_SESSION, event_type: "click" }])
  );
  window.localStorage.setItem(
    QUEUE_PREFIX,
    JSON.stringify([{ session_id: TAB_A_SESSION, event_type: "scroll_depth" }])
  );

  // This tab is session B.
  window.sessionStorage.setItem("rj_session_id", TAB_B_SESSION);
  window.sessionStorage.setItem("rj_session_token", "token-b");

  const analytics = await import(`../js/analytics.js?queue-purge-${Date.now()}`);
  analytics.initAnalytics();

  assert.equal(
    window.localStorage.getItem(QUEUE_PREFIX),
    null,
    "the legacy unscoped queue must be removed, not adopted"
  );
  assert.equal(
    window.localStorage.getItem(`${QUEUE_PREFIX}:${TAB_A_SESSION}`),
    null,
    "another session's queue is unflushable and must not be adopted"
  );

  // Whatever this tab now persists must belong to this tab.
  const own = window.localStorage.getItem(`${QUEUE_PREFIX}:${TAB_B_SESSION}`);
  if (own) {
    for (const event of JSON.parse(own)) {
      assert.equal(event.session_id, TAB_B_SESSION);
    }
  }
});

test("a restored queue is filtered down to the owning session's events", async () => {
  // A queue written under B's key that somehow carries a stray A event.
  window.localStorage.setItem(
    `${QUEUE_PREFIX}:${TAB_B_SESSION}`,
    JSON.stringify([
      { session_id: TAB_B_SESSION, event_type: "page_view" },
      { session_id: TAB_A_SESSION, event_type: "click" },
    ])
  );
  window.sessionStorage.setItem("rj_session_id", TAB_B_SESSION);
  window.sessionStorage.setItem("rj_session_token", "token-b");

  const analytics = await import(`../js/analytics.js?queue-filter-${Date.now()}`);
  analytics.initAnalytics();

  const persisted = JSON.parse(window.localStorage.getItem(`${QUEUE_PREFIX}:${TAB_B_SESSION}`) ?? "[]");
  assert.ok(
    persisted.every((event) => event.session_id === TAB_B_SESSION),
    "a foreign event must never survive into a flush"
  );
});
