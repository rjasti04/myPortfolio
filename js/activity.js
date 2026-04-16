import { API_BASE } from "./analytics.js";

export async function loadActivity() {
  const tbody = document.getElementById("activity-tbody");
  if (!tbody) return;

  const sessionId = sessionStorage.getItem("rj_session_id");

  const sessionIdSpan = document.getElementById("current-session-id");
  if (sessionIdSpan) {
    sessionIdSpan.textContent = sessionId || "None";
  }

  if (!sessionId) {
    tbody.innerHTML = `<tr><td colspan="4" class="activity-message">No active session found.</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="4" class="activity-message"><i class="fas fa-spinner fa-spin"></i> Loading activity...</td></tr>`;

  try {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}/events`);
    if (!response.ok) {
      if (response.status === 404) {
        tbody.innerHTML = `<tr><td colspan="4" class="activity-message">Session not found or expired.</td></tr>`;
      } else {
        tbody.innerHTML = `<tr><td colspan="4" class="activity-message">Failed to load activity. (Status: ${response.status})</td></tr>`;
      }
      return;
    }
    const events = await response.json();
    if (!events || events.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="activity-message">No events found for the current session.</td></tr>`;
      return;
    }

    tbody.innerHTML = events.map(e => {
        const date = new Date(e.created_at).toLocaleString();
        const dataStr = e.event_data ? JSON.stringify(e.event_data) : "-";
        return `
          <tr>
            <td>${date}</td>
            <td><strong>${e.event_type}</strong></td>
            <td>${e.page_path || '-'}</td>
            <td>${dataStr}</td>
          </tr>
        `;
    }).join("");
  } catch (error) {
    console.error("Activity load error", error);
    tbody.innerHTML = `<tr><td colspan="4" class="activity-message">Network error loading activity.</td></tr>`;
  }
}

export function initActivity() {
  const refreshBtn = document.getElementById("activity-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadActivity);
  }

  // Load activity whenever the user navigates into the #activity section
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#activity") {
      loadActivity();
    }
  });

  // Initial load if starting on the activity page
  if (window.location.hash === "#activity") {
    loadActivity();
  }
}
