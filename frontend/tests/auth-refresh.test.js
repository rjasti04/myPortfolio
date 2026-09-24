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

/* Cross-tab refresh (C1). `refreshInFlight` is a module variable, so it only
   ever de-duplicated within one tab. Two tabs share localStorage: both read
   the same refresh token, both POSTed it, exactly one won the server's atomic
   claim, and the loser's clearTokens() deleted the pair the winner had just
   stored - signing out both. A second import of auth.js under a different URL
   is a second module instance over the same storage, which is what a second
   tab is. */

/** Serialises callbacks per lock the way navigator.locks does across tabs. */
function withFakeLockManager(fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let tail = Promise.resolve();
  const locks = {
    request(_name, callback) {
      const run = tail.then(() => callback());
      tail = run.then(() => {}, () => {});
      return run;
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete globalThis.navigator;
    });
}

test("two tabs whose tokens expired together share one refresh under the lock", async () => {
  const otherTab = await import("../js/auth.js?tab=second");
  const protectedCalls = [];
  installFetchStub({ protectedCalls });

  await withFakeLockManager(async () => {
    const responses = await Promise.all([
      auth.authenticatedFetch("https://rjasti.com/api/auth/me"),
      otherTab.authenticatedFetch("https://rjasti.com/api/auth/me"),
    ]);

    assert.deepEqual(refreshCalls, ["refresh-0"], "the second tab must not spend the token again");
    assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  });

  assert.equal(authChangedEvents, 0, "neither tab is signed out");
  assert.equal(localStorage.getItem("rj_access_token"), "access-1");
  assert.equal(localStorage.getItem("rj_refresh_token"), "refresh-1");
});

test("without a lock manager, losing the race to another tab adopts its pair", async () => {
  const protectedCalls = [];
  refreshCalls = [];
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/auth/refresh")) {
      refreshCalls.push(JSON.parse(options.body).refresh_token);
      // The other tab presented the same token first, won, and stored its
      // new pair; the server tells this one the token is already revoked.
      localStorage.setItem("rj_access_token", "access-other");
      localStorage.setItem("rj_refresh_token", "refresh-other");
      return { ok: false, status: 401, json: async () => ({}) };
    }
    const sent = options.headers?.Authorization ?? "";
    protectedCalls.push(sent);
    return sent === "Bearer expired-access"
      ? { ok: false, status: 401, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({}) };
  };

  const response = await auth.authenticatedFetch("https://rjasti.com/api/auth/me");

  assert.equal(response.status, 200, "the request is retried with the other tab's token");
  assert.equal(protectedCalls.at(-1), "Bearer access-other");
  assert.equal(authChangedEvents, 0, "a lost race is not a sign-out");
  assert.equal(localStorage.getItem("rj_refresh_token"), "refresh-other", "the winner's pair survives");
});

test("a request that failed before another tab rotated adopts the rotation without refreshing", async () => {
  const protectedCalls = [];
  refreshCalls = [];
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/auth/refresh")) {
      refreshCalls.push(JSON.parse(options.body).refresh_token);
      return { ok: true, status: 200, json: async () => ({ access_token: "x", refresh_token: "y" }) };
    }
    const sent = options.headers?.Authorization ?? "";
    protectedCalls.push(sent);
    if (sent === "Bearer expired-access") {
      // Another tab refreshes while this request is on the wire.
      localStorage.setItem("rj_access_token", "access-other");
      localStorage.setItem("rj_refresh_token", "refresh-other");
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const response = await auth.authenticatedFetch("https://rjasti.com/api/auth/me");

  assert.equal(response.status, 200);
  assert.deepEqual(refreshCalls, [], "the freshly rotated token must not be spent again");
  assert.equal(protectedCalls.at(-1), "Bearer access-other");
});

/* C4: authenticatedFetch keeps the tokens when the refresh behind a 401 was
   rate-limited or failed, and hands back the original 401. The header's
   setupNavUI read that status alone and cleared them anyway. */
test("isRejectedResponse tells a transient 401 from a refused credential", async () => {
  global.fetch = async (url) =>
    String(url).endsWith("/auth/refresh")
      ? { ok: false, status: 429, json: async () => ({}) }
      : { ok: false, status: 401, json: async () => ({}) };
  const transient = await auth.authenticatedFetch("https://rjasti.com/api/auth/me");
  assert.equal(transient.status, 401);
  assert.equal(auth.isRejectedResponse(transient), false, "a 429 on refresh is not a rejection");
  assert.equal(localStorage.getItem("rj_refresh_token"), "refresh-0");

  localStorage.setItem("rj_access_token", "expired-access");
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const refused = await auth.authenticatedFetch("https://rjasti.com/api/auth/me");
  assert.equal(auth.isRejectedResponse(refused), true, "a refused refresh token is");

  const forbidden = { status: 403 };
  assert.equal(auth.isRejectedResponse(forbidden), true, "a plain 403 is still a rejection");
});

/* C2: a wrong re-authentication password is a 400 now. A 401 here used to be
   read as an expired bearer: the client rotated the refresh token and re-sent
   the same wrong password, so one typo on the 2FA routes counted twice. */
test("a 400 from a re-authenticated route is returned without a refresh or a retry", async () => {
  const seen = [];
  global.fetch = async (url) => {
    seen.push(String(url));
    return { ok: false, status: 400, json: async () => ({ detail: "Incorrect current password" }) };
  };

  await assert.rejects(auth.enable2FA("wrong-password", "123456"), /Incorrect current password/);
  assert.deepEqual(seen, ["https://rjasti.com/api/auth/2fa/enable"], "exactly one request");
  assert.equal(localStorage.getItem("rj_refresh_token"), "refresh-0");
});

/* C3: logout sends the refresh token it is ending, not the access token. After
   thirty minutes of reading the access token had expired, the server answered
   401, nothing was revoked, and the refresh token outlived "Signed out." */
test("logout sends the refresh token in the body and no bearer", async () => {
  const seen = [];
  global.fetch = async (url, options = {}) => {
    seen.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  await auth.logoutUser();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://rjasti.com/api/auth/logout");
  assert.deepEqual(JSON.parse(seen[0].options.body), { refresh_token: "refresh-0" });
  assert.equal(seen[0].options.headers.Authorization, undefined);
  assert.equal(localStorage.getItem("rj_refresh_token"), null);
  assert.equal(authChangedEvents, 1);
});

test("logout still signs this device out when the request cannot be sent", async () => {
  global.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  await auth.logoutUser();

  assert.equal(localStorage.getItem("rj_access_token"), null);
  assert.equal(localStorage.getItem("rj_refresh_token"), null);
  assert.equal(authChangedEvents, 1);
});

test("logout falls back to the bearer only when there is no refresh token", async () => {
  const seen = [];
  global.fetch = async (url, options = {}) => {
    seen.push(options);
    return { ok: true, status: 200, json: async () => ({}) };
  };

  localStorage.removeItem("rj_refresh_token");
  await auth.logoutUser();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.Authorization, "Bearer expired-access");
  assert.equal(seen[0].body, undefined);

  seen.length = 0;
  await auth.logoutUser();
  assert.equal(seen.length, 0, "with no token at all there is nothing to end");
});
