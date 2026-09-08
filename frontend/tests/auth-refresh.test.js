// Regression cover for the token-refresh race (BUG-03).
//
// The server rotates refresh tokens: refresh_user_token revokes the presented
// token and issues a new one. authenticatedFetch had no single-flight guard, so
// concurrent 401s each spent the same refresh token. The first won; the rest
// were told the token was revoked and signed the user out mid-session.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

let dom;
let window;
let auth;
let refreshCalls;
let revokedTokens;
let authChangedEvents;

/** Stands in for the rotating /auth/refresh endpoint. */
function installFetchStub({ protectedCalls }) {
  refreshCalls = [];
  revokedTokens = new Set();
  let issued = 0;

  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/auth/refresh")) {
      const presented = JSON.parse(options.body).refresh_token;
      refreshCalls.push(presented);

      if (revokedTokens.has(presented)) {
        // Exactly what the server does on a reused token.
        return {
          ok: false,
          status: 401,
          json: async () => ({ detail: "Refresh token has been revoked or expired" }),
        };
      }
      revokedTokens.add(presented);
      issued += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: `access-${issued}`,
          refresh_token: `refresh-${issued}`,
        }),
      };
    }

    // A protected endpoint: 401 on the original token, 200 on anything newer.
    const sent = options.headers?.Authorization ?? "";
    protectedCalls.push(sent);
    if (sent === "Bearer expired-access") {
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
}

test.before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://rjasti.com/" });
  window = dom.window;
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  global.sessionStorage = window.sessionStorage;
  // auth.js dispatches `new Event(...)`, which in Node resolves to the global
  // Event rather than jsdom's, and window.dispatchEvent rejects a foreign
  // realm's object. Same realm in a real browser; this is a harness detail.
  global.Event = window.Event;

  authChangedEvents = 0;
  window.addEventListener("auth-changed", () => {
    authChangedEvents += 1;
  });

  auth = await import("../js/auth.js");
});

test.after(() => {
  delete global.fetch;
  dom?.window?.close();
});

test.beforeEach(() => {
  localStorage.setItem("rj_access_token", "expired-access");
  localStorage.setItem("rj_refresh_token", "refresh-0");
  authChangedEvents = 0;
});

test("concurrent 401s share a single refresh instead of racing rotation", async () => {
  const protectedCalls = [];
  installFetchStub({ protectedCalls });

  // The AI page fires these together on load.
  const responses = await Promise.all([
    auth.authenticatedFetch("https://rjasti.com/api/chat/history"),
    auth.authenticatedFetch("https://rjasti.com/api/auth/me"),
    auth.authenticatedFetch("https://rjasti.com/api/auth/sessions"),
  ]);

  assert.equal(refreshCalls.length, 1, "refresh must be attempted exactly once");
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200, 200],
    "every caller should get the retried, authorised response"
  );
  assert.equal(authChangedEvents, 0, "nobody should be signed out");
  assert.equal(localStorage.getItem("rj_access_token"), "access-1");
  assert.equal(localStorage.getItem("rj_refresh_token"), "refresh-1");
});

test("a later 401 starts a fresh refresh rather than reusing a settled one", async () => {
  const protectedCalls = [];
  installFetchStub({ protectedCalls });

  await auth.authenticatedFetch("https://rjasti.com/api/auth/me");
  assert.equal(refreshCalls.length, 1);

  // Second round: the access token has expired again.
  localStorage.setItem("rj_access_token", "expired-access");
  await auth.authenticatedFetch("https://rjasti.com/api/auth/me");
  assert.equal(refreshCalls.length, 2, "the in-flight promise must not be reused after it settles");
  assert.equal(authChangedEvents, 0);
});

test("a genuinely failed refresh still signs the user out once", async () => {
  refreshCalls = [];
  global.fetch = async (url) => {
    if (String(url).endsWith("/auth/refresh")) {
      refreshCalls.push(url);
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  };

  const responses = await Promise.all([
    auth.authenticatedFetch("https://rjasti.com/api/auth/me"),
    auth.authenticatedFetch("https://rjasti.com/api/chat/history"),
  ]);

  assert.equal(refreshCalls.length, 1, "still only one refresh attempt");
  assert.deepEqual(responses.map((r) => r.status), [401, 401]);
  assert.equal(localStorage.getItem("rj_access_token"), null, "tokens are cleared");
});

/* A transient failure is not a signal about the credential.
   Everything that read a token used to end in clearTokens() on *any* non-ok
   response, so a 429 from the shared per-minute budget - which a couple of
   hard refreshes on the activity page is enough to reach - destroyed a refresh
   token still valid for thirty days, and the visitor had to log in again. */
for (const status of [429, 500, 502, 503]) {
  test(`a ${status} on refresh keeps the session instead of signing the user out`, async () => {
    refreshCalls = [];
    global.fetch = async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshCalls.push(url);
        return { ok: false, status, json: async () => ({}) };
      }
      return { ok: false, status: 401, json: async () => ({}) };
    };

    const response = await auth.authenticatedFetch("https://rjasti.com/api/auth/me");

    assert.equal(refreshCalls.length, 1);
    assert.equal(response.status, 401, "the caller still sees the failure");
    assert.equal(
      localStorage.getItem("rj_refresh_token"),
      "refresh-0",
      `a ${status} says the server could not answer, not that the credential is bad`
    );
    assert.equal(authChangedEvents, 0, "and nothing announces a sign-out");
  });
}

test("a dropped connection during refresh keeps the session", async () => {
  refreshCalls = [];
  global.fetch = async (url) => {
    if (String(url).endsWith("/auth/refresh")) {
      refreshCalls.push(url);
      throw new TypeError("Failed to fetch");
    }
    return { ok: false, status: 401, json: async () => ({}) };
  };

  await auth.authenticatedFetch("https://rjasti.com/api/auth/me");

  assert.equal(localStorage.getItem("rj_refresh_token"), "refresh-0", "offline is not signed out");
  assert.equal(authChangedEvents, 0);
});

test("a 403 on refresh is a real rejection and does sign the user out", async () => {
  refreshCalls = [];
  global.fetch = async (url) => {
    if (String(url).endsWith("/auth/refresh")) {
      refreshCalls.push(url);
      return { ok: false, status: 403, json: async () => ({}) };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  };

  await auth.authenticatedFetch("https://rjasti.com/api/auth/me");

  assert.equal(localStorage.getItem("rj_refresh_token"), null, "a refused credential is cleared");
});

test("isCredentialRejection separates a refused credential from an unanswered request", () => {
  for (const status of [401, 403]) {
    assert.equal(auth.isCredentialRejection(status), true, `${status} is a rejection`);
  }
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(auth.isCredentialRejection(status), false, `${status} is not a rejection`);
  }
});
