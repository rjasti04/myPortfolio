// Regression cover for the hide/unload flush (codebase review C10).
//
// flushEventsOnUnload() emptied the queue - in memory and in localStorage -
// straight after firing its keepalive request, without waiting for the answer.
// A tab hidden while offline therefore wiped the persisted queue the offline
// design exists to keep. And a backlog near the 200-event cap went out as one
// body over Fetch's 64 KiB keepalive limit, which the browser refuses outright.
//
// Each test builds its own window: initAnalytics() attaches its visibility and
// pagehide listeners to whatever `window` is current, and a second module
// instance on a shared window would flush its own queue into the same key.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const SESSION = "33333333-3333-4333-8333-333333333333";
const QUEUE_KEY = `rj_event_queue:${SESSION}`;
const KEEPALIVE_BUDGET_BYTES = 60 * 1024;

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const persisted = () => JSON.parse(window.localStorage.getItem(QUEUE_KEY) || "[]");
const pathsIn = (events) => events.map((event) => event.page_path);
// page_path alone is ambiguous: initAnalytics' own page_view and anything
// tracked later both sit at "/".
const idsIn = (events) => events.map((event) => `${event.event_type} ${event.page_path}`);

function queued(count, pad = 0) {
  return Array.from({ length: count }, (_, i) => ({
    session_id: SESSION,
    event_type: "click",
    page_path: `/q-${i}`,
    event_data: pad ? { pad: "x".repeat(pad) } : {},
  }));
}

/** A fresh window with a live session and `events` already persisted. */
async function boot(events, fetchImpl) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://rjasti.com/" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.sessionStorage = dom.window.sessionStorage;
  global.Event = dom.window.Event;
  // initAnalytics starts a heartbeat and a flush loop; left running they hold
  // Node's event loop open. Nothing here depends on them.
  dom.window.setInterval = () => 0;
  global.setInterval = () => 0;
  global.fetch = fetchImpl;

  dom.window.sessionStorage.setItem("rj_session_id", SESSION);
  dom.window.sessionStorage.setItem("rj_session_token", "token");
  dom.window.localStorage.setItem(QUEUE_KEY, JSON.stringify(events));

  const analytics = await import(`../js/analytics.js?unload-${Math.random()}`);
  analytics.initAnalytics();
  await tick();
  return { dom, analytics };
}

function hide(dom) {
  Object.defineProperty(dom.window.document, "visibilityState", { value: "hidden", configurable: true });
  dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange", { bubbles: true }));
}

const isKeepaliveBulk = (url, options) => String(url).includes("/events/bulk") && options?.keepalive;
const ok = () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ rejected: [] }) });

test.after(() => {
  delete global.fetch;
  window?.close?.();
});

test("a hidden flush that cannot be sent keeps the queue, in memory and persisted", async () => {
  const events = queued(3);
  const { dom } = await boot(events, async (url, options) => {
    if (String(url).includes("/events/bulk")) throw new TypeError("Failed to fetch");
    return ok();
  });

  hide(dom);
  await tick();

  const kept = pathsIn(persisted());
  for (const path of pathsIn(events)) {
    assert.ok(kept.includes(path), `${path} was wiped by a send that never arrived`);
  }
});

test("a hidden flush removes only what it sent, once the send succeeds", async () => {
  let release;
  let sentBody = null;
  const { dom, analytics } = await boot(queued(3), async (url, options) => {
    if (isKeepaliveBulk(url, options)) {
      sentBody = JSON.parse(options.body);
      await new Promise((resolve) => { release = resolve; });
      return ok();
    }
    return ok();
  });

  hide(dom);
  await tick();
  assert.ok(sentBody, "precondition: the hidden flush went out");
  assert.ok(pathsIn(persisted()).includes("/q-0"), "still persisted while the answer is outstanding");

  // Something happens while the request is in flight.
  analytics.trackEvent("theme_change", { theme: "during-flight" });
  release();
  await tick();

  const kept = persisted();
  for (const id of idsIn(sentBody.events)) {
    assert.ok(!idsIn(kept).includes(id), `${id} was sent and acknowledged, so it should be gone`);
  }
  assert.ok(
    kept.some((event) => event.event_data?.theme === "during-flight"),
    "an event queued during the flight was not part of it and must survive"
  );
});

test("a second hide while the first is in flight does not send its events again", async () => {
  const bodies = [];
  const { dom } = await boot(queued(3), async (url, options) => {
    if (isKeepaliveBulk(url, options)) {
      bodies.push(JSON.parse(options.body));
      return new Promise(() => {}); // never answers
    }
    return ok();
  });

  hide(dom);
  await tick();
  hide(dom);
  await tick();

  const sentTwice = pathsIn(bodies[0].events).filter((path) => bodies.slice(1).some((b) => pathsIn(b.events).includes(path)));
  assert.deepEqual(sentTwice, []);
});

test("an unload keeps its body under the keepalive limit and leaves the rest persisted", async () => {
  let body = null;
  // About 150 KiB of backlog. The ordinary flushes fail, as they would for
  // anyone offline long enough to build one, so it is all still queued when
  // the page goes away. (Under the 200-event cap, so none is trimmed first.)
  const { dom } = await boot(queued(150, 1000), async (url, options) => {
    if (isKeepaliveBulk(url, options)) {
      body = options.body;
      return ok();
    }
    if (String(url).includes("/events/bulk")) {
      return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) };
    }
    return ok();
  });

  dom.window.dispatchEvent(new dom.window.Event("pagehide"));
  await tick();

  assert.ok(body, "precondition: the unload flush went out");
  const bytes = new TextEncoder().encode(body).length;
  assert.ok(bytes <= KEEPALIVE_BUDGET_BYTES, `a ${bytes}-byte keepalive body is refused by the browser`);

  const sent = pathsIn(JSON.parse(body).events);
  const kept = pathsIn(persisted());
  assert.ok(sent.length > 0 && sent.length < 150, "the backlog does not fit in one body");
  assert.deepEqual(sent, pathsIn(queued(sent.length)), "the oldest events go first");
  for (const path of sent) assert.ok(!kept.includes(path), `${path} was sent on unload and must not be sent again`);
  assert.ok(kept.includes("/q-149"), "what did not fit stays for the next page load");
});
