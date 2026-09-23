function getApiBaseUrl() {
  const defaultProd = "https://rjasti.com/api";
  if (typeof window === "undefined" || !window.location) {
    return defaultProd;
  }
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return "http://localhost:8000";
  }
  if (hostname.includes("staging")) {
    return "https://staging-api.rjasti.com/api";
  }
  // Ensure the API URL matches the site origin (www vs bare domain) to maintain same-origin status if possible
  if (window.location.origin.includes("www.")) {
    return "https://www.rjasti.com/api";
  }
  return defaultProd;
}

export let API_BASE = getApiBaseUrl();

// Dynamic health check to fallback to production API if local backend is down or unreachable
let healthCheckPromise = null;
if (API_BASE.includes("localhost")) {
  healthCheckPromise = fetch(`${API_BASE}/health`, { method: "GET" })
    .then(res => {
      if (!res.ok) throw new Error("Local API health check failed");
    })
    .catch(err => {
      console.warn("Local API health check failed, falling back to production API.", err);
      API_BASE = "https://rjasti.com/api";
    });
} else {
  healthCheckPromise = Promise.resolve();
}

// Constants
const MAX_QUEUE_SIZE = 200;
const QUEUE_FLUSH_THRESHOLD = 10;
// Without a timed flush the queue only drained at the size threshold or on
// unload, so a "live" dashboard sat silent until 10 events had accumulated and
// then painted them all at once. This bounds the wait instead.
const FLUSH_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 60000;
const HEARTBEAT_INITIAL_DELAY_MS = 1000;
const SCROLL_DEBOUNCE_MS = 500;
// Namespaced per session. The session id lives in sessionStorage (per tab) but
// the queue lives in localStorage (shared across tabs), and each queued event
// carries a baked-in session_id. Under one shared key, a second tab would
// restore the first tab's events, flush them with its own token, and get a 403
// for the whole batch - taking its own valid events with it.
const EVENT_QUEUE_STORAGE_PREFIX = 'rj_event_queue';
const LEGACY_EVENT_QUEUE_STORAGE_KEY = 'rj_event_queue';
const SESSION_START_STORAGE_KEY = 'rj_session_started_at';

let sessionId = null;
// Capability token handed out when the session is created. Every request scoped
// to this session must present it; without it the API cannot tell us apart from
// anyone else who happens to know the id.
let sessionToken = null;
// When this visit started, by the client's own clock. The dashboard's "Time on
// site" prefers the server's first event, but that only arrives with the
// summary; this is what lets the counter start ticking on the first frame, and
// what keeps it ticking when tracking is blocked entirely. It lives beside the
// id in sessionStorage so a reload continues the same visit rather than
// restarting it.
let sessionStartedAt = null;
try {
  sessionId = sessionStorage.getItem("rj_session_id");
  sessionToken = sessionStorage.getItem("rj_session_token");
  // A session stored before tokens existed can no longer be used. Drop it so a
  // fresh one is created rather than issuing calls that will be refused.
  if (sessionId && !sessionToken) {
    sessionStorage.removeItem("rj_session_id");
    sessionId = null;
  }
  const storedStart = Number(sessionStorage.getItem(SESSION_START_STORAGE_KEY));
  sessionStartedAt = sessionId && Number.isFinite(storedStart) && storedStart > 0 ? storedStart : null;
} catch (e) {
  console.warn("Analytics: sessionStorage not available");
}

function setSessionId(id, token) {
  sessionId = id;
  sessionToken = token || null;
  sessionStartedAt = Date.now();
  try {
    sessionStorage.setItem("rj_session_id", id);
    if (token) sessionStorage.setItem("rj_session_token", token);
    sessionStorage.setItem(SESSION_START_STORAGE_KEY, String(sessionStartedAt));
  } catch (e) {}
}

/**
 * Ties a request to this visit's session, for calls made outside apiFetch().
 * The chat goes through authenticatedFetch() for its bearer token, so it never
 * picked up the session and no chat turn was ever attributed to one. Empty
 * until a session exists; the server ignores the id without its token.
 */
export function sessionHeaders() {
  if (!sessionId || !sessionToken) return {};
  return { "X-Session-ID": sessionId, "X-Session-Token": sessionToken };
}

/** Client-clock start of this visit, or null if no session has begun. */
export function getSessionStartedAt() {
  return sessionStartedAt;
}

function clearSessionId() {
  // The queue is keyed by session, and its events can only ever be flushed by
  // the session that owns them, so it goes when the session does.
  try {
    if (sessionId) localStorage.removeItem(eventQueueKey());
  } catch (e) {}
  eventQueue.length = 0;
  sessionId = null;
  sessionToken = null;
  sessionStartedAt = null;
  try {
    sessionStorage.removeItem("rj_session_id");
    sessionStorage.removeItem("rj_session_token");
    sessionStorage.removeItem(SESSION_START_STORAGE_KEY);
  } catch (e) {}
}

/**
 * Kept as an identity function for the one caller that cannot send headers.
 *
 * This used to append `?session_token=<hmac>` to the SSE URL, because
 * EventSource has no way to set request headers. That put a bearer credential
 * for the visitor's entire behavioural trail into the web server's access log,
 * into browser history, and into any Referer the page emitted.
 *
 * The API now sets the same token as an HttpOnly, SameSite=Strict cookie when
 * the session is created, and the API is same-origin, so EventSource sends it
 * automatically. The signature stays so call sites read the same and so this
 * remains the single place that decides how the stream authenticates.
 */
export function withSessionToken(url) {
  return url;
}
const eventQueue = [];
let heartbeatInterval;
let flushInterval;

// Observers of per-request timing. The activity dashboard subscribes to split
// network round-trip from time actually spent in the API, which is the figure
// its FastAPI pipeline node reports.
const telemetryObservers = new Set();

/** Subscribes to request timing samples. Returns an unsubscribe function. */
export function onTelemetry(observer) {
  telemetryObservers.add(observer);
  return () => telemetryObservers.delete(observer);
}

/**
 * Parses the `app;dur=12.3` token out of a Server-Timing header.
 * Returns null when the header is absent - it is not CORS-safelisted, so a
 * misconfigured deployment simply yields no server-side figure.
 */
function parseServerTiming(response) {
  const header = response.headers.get("Server-Timing");
  if (!header) return null;
  const match = /app;dur=([\d.]+)/.exec(header);
  return match ? Number.parseFloat(match[1]) : null;
}

function publishTelemetry(sample) {
  telemetryObservers.forEach((observer) => {
    try {
      observer(sample);
    } catch (error) {
      console.warn("Analytics: telemetry observer failed", error);
    }
  });
}

function eventQueueKey(id = sessionId) {
  return `${EVENT_QUEUE_STORAGE_PREFIX}:${id}`;
}

/**
 * Removes queues belonging to sessions that are over: the unscoped key written
 * by earlier builds, and any namespaced queue that is not the live session's.
 * Those events can never be flushed - only the session that owns them holds the
 * token the API requires - so keeping them just consumes quota.
 */
function purgeForeignEventQueues() {
  try {
    localStorage.removeItem(LEGACY_EVENT_QUEUE_STORAGE_KEY);
    const mine = sessionId ? eventQueueKey() : null;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${EVENT_QUEUE_STORAGE_PREFIX}:`) && key !== mine) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.warn('Failed to purge stale event queues:', e);
  }
}

// Load this session's persisted event queue from localStorage.
function loadEventQueue() {
  if (!sessionId) return;
  try {
    const stored = localStorage.getItem(eventQueueKey());
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        // Belt and braces: a queue restored under this session's key should
        // only ever hold this session's events.
        eventQueue.push(
          ...parsed.filter((event) => event && event.session_id === sessionId).slice(0, MAX_QUEUE_SIZE)
        );
      }
    }
  } catch (e) {
    console.warn('Failed to load event queue from localStorage:', e);
  }
}

// Persist event queue to localStorage
function saveEventQueue() {
  if (!sessionId) return;
  try {
    localStorage.setItem(eventQueueKey(), JSON.stringify(eventQueue));
  } catch (e) {
    console.warn('Failed to save event queue to localStorage:', e);
  }
}

export function isApiConfigured() {
  return API_BASE.length > 0;
}

export function apiFetch(url, options = {}) {
  const defaultOptions = {
    mode: "cors"
  };
  const merged = { ...defaultOptions, ...options };
  // Attached centrally so no call site can forget it.
  if (sessionToken) {
    merged.headers = { ...(merged.headers || {}), "X-Session-Token": sessionToken };
  }
  return fetch(url, merged);
}

function getDeviceType() {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return "tablet";
  }
  if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
    return "mobile";
  }
  return "desktop";
}

let sessionPromise = null;

async function startSession() {
  if (sessionId) return sessionId;
  
  // Return existing promise if session creation in progress
  if (sessionPromise) return sessionPromise;
  
  if (!isApiConfigured()) {
    console.warn("Analytics: API base is not configured; tracking disabled.");
    return null;
  }

  sessionPromise = (async () => {
    try {
      await healthCheckPromise;
      const response = await apiFetch(`${API_BASE}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_agent: navigator.userAgent ? navigator.userAgent.slice(0, 500) : null,
          device_type: getDeviceType()
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSessionId(data.session_id, data.session_token);

        startHeartbeat();
        trackEvent("page_view", { referrer: document.referrer });
        return data.session_id;
      }
      return null;
    } catch (error) {
      console.warn("Analytics: Session could not be started (likely blocked or offline).", error);
      return null;
    } finally {
      sessionPromise = null;
    }
  })();
  
  return sessionPromise;
}

export async function ensureSession() {
  if (sessionId) {
    return true;
  }
  await startSession();
  // Return true to allow dependent features like AI chat to work even if tracking is blocked
  return true;
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  
  const ping = async () => {
    if (!sessionId) return;
    try {
      const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/heartbeat`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      });
      
      if (response.status === 404) {
        // If session is not found, stop heartbeating on this stale ID
        clearInterval(heartbeatInterval);
        console.warn("Analytics: Session expired or not found. Clearing stale ID and restarting.");
        
        // The most likely cause is the API's database was cleared or the session expired on the server.
        // We need to forget the old ID and generate a new one so tracking can resume.
        clearSessionId();
        startSession();
      }
    } catch (err) {
      console.warn("Analytics: Heartbeat network failure (likely blocked or offline).", err);
    }
  };

  heartbeatInterval = setInterval(ping, HEARTBEAT_INTERVAL_MS);

  // Bounded latency to the server for anything sitting under the size
  // threshold. Cheap: a no-op when the queue is empty.
  if (flushInterval) clearInterval(flushInterval);
  flushInterval = setInterval(() => flushEvents("timer"), FLUSH_INTERVAL_MS);
  
  // On resume/reload, trigger a quick verify ping shortly after initialization
  setTimeout(ping, HEARTBEAT_INITIAL_DELAY_MS);
}

export function trackEvent(eventType, eventData = {}) {
  // If session hasn't started yet, we queue the event for later
  // For simplicity, we just won't send it if sessionId is missing.
  // In a robust implementation, you could hold it until sessionId is ready.
  if (!sessionId) {
    return;
  }

  const event = {
    session_id: sessionId,
    event_type: eventType,
    page_path: window.location.pathname + window.location.hash,
    event_data: eventData
  };

  eventQueue.push(event);
  saveEventQueue();

  // Flush if queue gets to threshold
  if (eventQueue.length >= QUEUE_FLUSH_THRESHOLD) {
    flushEvents("threshold");
  }
}

/**
 * Holds the queue at MAX_QUEUE_SIZE by dropping its oldest entries.
 *
 * Both callers unshift a failed batch back onto the head, so the queue is
 * ordered oldest-first. `eventQueue.length = MAX_QUEUE_SIZE` truncates the
 * tail, which is the newest events - the opposite of the intent, and the same
 * inversion the server-side write buffer had.
 */
function trimQueueToCap() {
  if (eventQueue.length > MAX_QUEUE_SIZE) {
    eventQueue.splice(0, eventQueue.length - MAX_QUEUE_SIZE);
  }
}

async function flushEvents(flushReason = "threshold") {
  if (eventQueue.length === 0 || !sessionId) return;

  const eventsToSend = [...eventQueue];
  eventQueue.length = 0; // Clear the queue
  saveEventQueue();

  const startedAt = performance.now();
  try {
    const response = await apiFetch(`${API_BASE}/events/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: eventsToSend,
        client_ts: Date.now(),
        // Tells the dashboard how much data arrives via the unreliable unload
        // path versus a healthy timed flush.
        flush_reason: flushReason
      })
    });

    const roundTripMs = performance.now() - startedAt;
    const serverMs = parseServerTiming(response);
    publishTelemetry({
      roundTripMs,
      serverMs,
      // What is left after the server's own time is network plus queueing.
      networkMs: serverMs === null ? null : Math.max(0, roundTripMs - serverMs),
      count: eventsToSend.length,
      reason: flushReason,
      ok: response.ok,
      at: Date.now()
    });

    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        // Put events back at the start of the queue to retry later for temporary failures
        eventQueue.unshift(...eventsToSend);
        // Prevent unbounded growth when API is persistently down. Trimmed from
        // the front: the retried batch went back at the head, so truncating by
        // length discarded whatever the visitor had done most recently and kept
        // the stale backlog instead.
        trimQueueToCap();
        saveEventQueue();
        console.error(`Analytics: Server returned ${response.status}, retrying ${eventsToSend.length} event(s)`);
      } else {
        // A 4xx is not retryable, so these events are gone. Say which ones:
        // this branch used to log a bare status code, which is why a schema
        // mismatch could silently destroy batches for a long time without
        // anyone noticing what was being lost.
        console.error(
          `Analytics: Server returned ${response.status}, dropping ${eventsToSend.length} event(s)`,
          eventsToSend.map((event) => event.event_type)
        );
      }
      return;
    }

    // The API accepts a batch per row and reports the rows it declined, so a
    // client running ahead of a server deploy loses only the unknown events
    // rather than everything flushed alongside them.
    try {
      const body = await response.json();
      if (Array.isArray(body?.rejected) && body.rejected.length > 0) {
        console.warn("Analytics: server rejected some events", body.rejected);
      }
    } catch (parseError) {
      // A successful insert with an unreadable body is not worth surfacing.
    }
  } catch (error) {
    // Put events back in queue on network error
    eventQueue.unshift(...eventsToSend);
    // Prevent unbounded growth when offline. Drops the oldest, not the newest -
    // see trimQueueToCap.
    trimQueueToCap();
    saveEventQueue();
    console.warn("Analytics: Network error bulk sending events (likely blocked or offline).", error);
  }
}

function flushEventsOnUnload(isEndingSession = false) {
  if (eventQueue.length > 0 && sessionId) {
    const payload = JSON.stringify({
      events: eventQueue,
      client_ts: Date.now(),
      flush_reason: isEndingSession ? "unload" : "hidden"
    });

    // Use fetch with keepalive as it can reliably send data on unload and supports proper headers/methods
    apiFetch(`${API_BASE}/events/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    }).catch(err => console.warn("Analytics: Failed to bulk send events on unload", err));

    eventQueue.length = 0;
    saveEventQueue();
  }

  // Also send an end session call if we are explicitly closing the page/tab
  // API requires a PATCH method, which sendBeacon doesn't support
  if (sessionId && isEndingSession) {
    const endPayload = JSON.stringify({ end_reason: "tab_closed_or_hidden" });
    apiFetch(`${API_BASE}/sessions/${sessionId}/end`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: endPayload,
      keepalive: true
    }).catch(err => console.warn("Analytics: Failed to end session on unload", err));
  }
}

// Store global click handler reference to prevent duplicates
let globalClickHandler = null;
// BUG FIX ROOT CAUSE: Repeated calls to initAnalytics would register duplicate event listeners 
// on window/document, leading to event listener duplication. We now check this flag to attach once.
let globalListenersAttached = false;

// Set up event listeners for global behaviors
function attachGlobalListeners() {
  if (globalListenersAttached) return;
  globalListenersAttached = true;

  // Flush on tab hide/close, revive on show
  let visibilityTimeout;
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushEventsOnUnload(false);
    } else if (document.visibilityState === "visible") {
      clearTimeout(visibilityTimeout);
      visibilityTimeout = setTimeout(() => {
        if (sessionId) {
          // Immediately ping the heartbeat to revive the session in the backend
          apiFetch(`${API_BASE}/sessions/${sessionId}/heartbeat`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" }
          }).then(res => {
            if (res.status === 404) {
               console.warn("Analytics: Session expired during revive. Restarting.");
               clearSessionId();
               startSession();
            }
          }).catch(err => console.warn("Analytics: Revive error (likely blocked or offline).", err));
        }
      }, 250); // Debounce revive
    }
  });

  window.addEventListener("pagehide", () => {
    flushEventsOnUnload(true);
  });

  // Track global clicks on interactive elements (only attach once)
  if (!globalClickHandler) {
    globalClickHandler = (e) => {
      const target = e.target.closest("a, button, [data-track]");
      if (target) {
        trackEvent("click", {
          tag: target.tagName,
          tracked: Boolean(target.dataset.track),
          element_id_present: Boolean(target.id),
          link_origin: target.href ? new URL(target.href, window.location.href).origin : undefined,
        });
      }
    };
    document.addEventListener("click", globalClickHandler);
  }

  // Track hash changes (single page navigation)
  window.addEventListener("hashchange", () => {
    trackEvent("page_view", { hash: window.location.hash });
  });

  // Track max scroll depth
  const scrollDepths = new Set();
  let scrollTimeout;
  window.addEventListener("scroll", () => {
    if (scrollTimeout) return;
    scrollTimeout = setTimeout(() => {
      scrollTimeout = null;
      const root = document.documentElement;
      const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight);
      if (maxScroll === 0) return;
      
      const percent = (root.scrollTop / maxScroll) * 100;
      [25, 50, 75, 90, 100].forEach(depth => {
        if (percent >= depth && !scrollDepths.has(depth)) {
          scrollDepths.add(depth);
          trackEvent("scroll_depth", { percent: depth });
        }
      });
    }, SCROLL_DEBOUNCE_MS);
  }, { passive: true });
}

export function initAnalytics() {
  if (!isApiConfigured()) {
    clearSessionId();
    console.warn("Analytics: API base is not configured; tracking disabled.");
    return;
  }

  attachGlobalListeners();

  if (sessionId) {
    // Session already exists from this tab (e.g., page reload). Its queue can
    // only be restored now that we know which session it belongs to - loading
    // it before this point is what let one tab adopt another tab's events.
    purgeForeignEventQueues();
    loadEventQueue();
    startHeartbeat();
    trackEvent("page_view", { referrer: document.referrer, is_reload: true });
  } else {
    clearSessionId();
    purgeForeignEventQueues();
    // New tab, start session
    startSession();
  }
}
