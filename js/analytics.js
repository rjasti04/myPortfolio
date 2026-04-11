export const API_BASE = "https://rjasti.com/api";
let sessionId = sessionStorage.getItem("rj_session_id");
const eventQueue = [];
let heartbeatInterval;

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

async function startSession() {
  if (sessionId) return; // Already have a session for this tab

  try {
    const response = await fetch(`${API_BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_agent: navigator.userAgent,
        device_type: getDeviceType()
      })
    });

    if (response.ok) {
      const data = await response.json();
      sessionId = data.session_id;
      sessionStorage.setItem("rj_session_id", sessionId);

      startHeartbeat();
      trackEvent("page_view", { referrer: document.referrer });
    }
  } catch (error) {
    console.error("Analytics: Failed to start session", error);
  }
}

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  // Send heartbeat every 60 seconds
  heartbeatInterval = setInterval(async () => {
    if (!sessionId) return;

    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}/heartbeat`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      });

      if (response.status === 404) {
        console.warn("Analytics: Session expired or not found. Stopping heartbeat.");
        clearInterval(heartbeatInterval);
        return;
      }
      
      if (!response.ok) throw new Error(`Status: ${response.status}`);
    } catch (err) {
      console.error("Analytics: Heartbeat failed", err);
    }
  }, 60000);
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

  // Flush if queue gets to 10
  if (eventQueue.length >= 10) {
    flushEvents();
  }
}

async function flushEvents() {
  if (eventQueue.length === 0 || !sessionId) return;

  const eventsToSend = [...eventQueue];
  eventQueue.length = 0; // Clear the queue

  try {
    const response = await fetch(`${API_BASE}/events/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: eventsToSend })
    });

    if (!response.ok) {
      console.error("Analytics: Failed to push events");
    }
  } catch (error) {
    console.error("Analytics: Error bulk sending events", error);
  }
}

function flushEventsOnUnload() {
  if (eventQueue.length > 0 && sessionId) {
    const payload = JSON.stringify({ events: eventQueue });

    // Use fetch with keepalive as it can reliably send data on unload and supports proper headers/methods
    fetch(`${API_BASE}/events/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    }).catch(console.error);

    eventQueue.length = 0;
  }

  // Also send an end session call
  // API requires a PATCH method, which sendBeacon doesn't support
  if (sessionId) {
    const endPayload = JSON.stringify({ end_reason: "tab_closed_or_hidden" });
    fetch(`${API_BASE}/sessions/${sessionId}/end`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: endPayload,
      keepalive: true
    }).catch(console.error);
  }
}

// Set up event listeners for global behaviors
function attachGlobalListeners() {
  // Flush on tab hide/close
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushEventsOnUnload();
    }
  });

  // Track global clicks on interactive elements
  document.addEventListener("click", (e) => {
    const target = e.target.closest("a, button, .project-card, [data-track]");
    if (target) {
      const classStr = target.className || "";
      const className = typeof classStr === "string" ? classStr : "";

      trackEvent("click", {
        tag: target.tagName,
        text: target.textContent?.trim().substring(0, 50),
        href: target.href,
        id: target.id,
        className: className
      });
    }
  });

  // Track hash changes (single page navigation)
  window.addEventListener("hashchange", () => {
    trackEvent("page_view", { hash: window.location.hash });
  });
}

export function initAnalytics() {
  if (sessionId) {
    // Session already exists from this tab (e.g., page reload)
    startHeartbeat();
    trackEvent("page_view", { referrer: document.referrer, is_reload: true });
  } else {
    // New tab, start session
    startSession();
  }

  attachGlobalListeners();
}
