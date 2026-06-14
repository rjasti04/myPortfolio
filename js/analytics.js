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
const HEARTBEAT_INTERVAL_MS = 60000;
const HEARTBEAT_INITIAL_DELAY_MS = 1000;
const SCROLL_DEBOUNCE_MS = 500;
const EVENT_QUEUE_STORAGE_KEY = 'rj_event_queue';

let sessionId = null;
try {
  sessionId = sessionStorage.getItem("rj_session_id");
} catch (e) {
  console.warn("Analytics: sessionStorage not available");
}

function setSessionId(id) {
  sessionId = id;
  try {
    sessionStorage.setItem("rj_session_id", id);
  } catch (e) {}
}

function clearSessionId() {
  sessionId = null;
  try {
    sessionStorage.removeItem("rj_session_id");
  } catch (e) {}
}
const eventQueue = [];
let heartbeatInterval;

// Load persisted event queue from localStorage
function loadEventQueue() {
  try {
    const stored = localStorage.getItem(EVENT_QUEUE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        eventQueue.push(...parsed.slice(0, MAX_QUEUE_SIZE));
      }
    }
  } catch (e) {
    console.warn('Failed to load event queue from localStorage:', e);
  }
}

// Persist event queue to localStorage
function saveEventQueue() {
  try {
    localStorage.setItem(EVENT_QUEUE_STORAGE_KEY, JSON.stringify(eventQueue));
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
  return fetch(url, { ...defaultOptions, ...options });
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
        setSessionId(data.session_id);

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
    flushEvents();
  }
}

async function flushEvents() {
  if (eventQueue.length === 0 || !sessionId) return;

  const eventsToSend = [...eventQueue];
  eventQueue.length = 0; // Clear the queue
  saveEventQueue();

  try {
    const response = await apiFetch(`${API_BASE}/events/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: eventsToSend })
    });

    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        // Put events back at the start of the queue to retry later for temporary failures
        eventQueue.unshift(...eventsToSend);
        // Prevent unbounded growth when API is persistently down
        if (eventQueue.length > MAX_QUEUE_SIZE) {
          eventQueue.length = MAX_QUEUE_SIZE;
        }
        saveEventQueue();
      }
      console.error(`Analytics: Server returned ${response.status}`);
    }
  } catch (error) {
    // Put events back in queue on network error
    eventQueue.unshift(...eventsToSend);
    // Prevent unbounded growth when offline
    if (eventQueue.length > MAX_QUEUE_SIZE) {
      eventQueue.length = MAX_QUEUE_SIZE;
    }
    saveEventQueue();
    console.warn("Analytics: Network error bulk sending events (likely blocked or offline).", error);
  }
}

function flushEventsOnUnload() {
  if (eventQueue.length > 0 && sessionId) {
    const payload = JSON.stringify({ events: eventQueue });

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

  // Also send an end session call
  // API requires a PATCH method, which sendBeacon doesn't support
  if (sessionId) {
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

// Set up event listeners for global behaviors
function attachGlobalListeners() {
  // Flush on tab hide/close, revive on show
  let visibilityTimeout;
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushEventsOnUnload();
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
    flushEventsOnUnload();
  });

  // Track global clicks on interactive elements (only attach once)
  if (!globalClickHandler) {
    globalClickHandler = (e) => {
      const target = e.target.closest("a, button, .project-card, [data-track]");
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

  // Load persisted event queue
  loadEventQueue();

  attachGlobalListeners();

  if (sessionId) {
    // Session already exists from this tab (e.g., page reload)
    startHeartbeat();
    trackEvent("page_view", { referrer: document.referrer, is_reload: true });
  } else {
    clearSessionId();
    // New tab, start session
    startSession();
  }
}
