import { API_BASE } from "./analytics.js";

let currentOffset = 0;
const PAGE_SIZE = 5;

export async function loadActivity(offset = currentOffset) {
  const tbody = document.getElementById("activity-tbody");
  if (!tbody) return;

  const paginationControls = document.getElementById("activity-pagination");
  const prevBtn = document.getElementById("activity-prev-btn");
  const nextBtn = document.getElementById("activity-next-btn");
  const pageInfo = document.getElementById("activity-page-info");

  const sessionId = sessionStorage.getItem("rj_session_id");

  const sessionIdSpan = document.getElementById("current-session-id");
  if (sessionIdSpan) {
    sessionIdSpan.textContent = sessionId || "None";
  }

  if (!sessionId) {
    tbody.innerHTML = `<tr><td colspan="5" class="activity-message">No active session found.</td></tr>`;
    if (paginationControls) paginationControls.style.display = "none";
    return;
  }

  tbody.innerHTML = `<tr><td colspan="5" class="activity-message"><i class="fas fa-spinner fa-spin"></i> Loading activity...</td></tr>`;

  try {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}/events?limit=${PAGE_SIZE}&offset=${offset}`);
    if (!response.ok) {
      if (response.status === 404) {
        tbody.innerHTML = `<tr><td colspan="5" class="activity-message">Session not found or expired.</td></tr>`;
        if (paginationControls) paginationControls.style.display = "none";
      } else {
        tbody.innerHTML = `<tr><td colspan="5" class="activity-message">Failed to load activity. (Status: ${response.status})</td></tr>`;
        if (paginationControls) paginationControls.style.display = "none";
      }
      return;
    }
    const events = await response.json();
    if (!events || events.length === 0) {
      if (offset === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="activity-message">No events found for the current session.</td></tr>`;
        if (paginationControls) paginationControls.style.display = "none";
      } else {
        tbody.innerHTML = `<tr><td colspan="5" class="activity-message">No more events.</td></tr>`;
        if (paginationControls) {
          paginationControls.style.display = "flex";
          prevBtn.disabled = false;
          nextBtn.disabled = true;
          currentOffset = offset;
          const currentPage = Math.floor(currentOffset / PAGE_SIZE) + 1;
          if (pageInfo) pageInfo.textContent = `Page ${currentPage} (End)`;
        }
      }
      return;
    }

    tbody.innerHTML = events.map(e => {
        const d = new Date(e.created_at);
        const dateStr = d.toLocaleDateString();
        const timeStr = d.toLocaleTimeString();
        const dataStr = e.event_data ? JSON.stringify(e.event_data) : "-";
        return `
          <tr>
            <td>${dateStr}</td>
            <td>${timeStr}</td>
            <td><strong>${e.event_type}</strong></td>
            <td>${e.page_path || '-'}</td>
            <td>${dataStr}</td>
          </tr>
        `;
    }).join("");
    
    currentOffset = offset;
    
    if (paginationControls) {
      paginationControls.style.display = "flex";
      prevBtn.disabled = currentOffset === 0;
      nextBtn.disabled = events.length < PAGE_SIZE;
      
      const currentPage = Math.floor(currentOffset / PAGE_SIZE) + 1;
      if (pageInfo) pageInfo.textContent = `Page ${currentPage}`;
    }

  } catch (error) {
    console.error("Activity load error", error);
    tbody.innerHTML = `<tr><td colspan="5" class="activity-message">Network error loading activity.</td></tr>`;
    if (paginationControls) paginationControls.style.display = "none";
  }
}

export function initActivity() {
  const refreshBtn = document.getElementById("activity-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      currentOffset = 0;
      loadActivity(0);
    });
  }

  const prevBtn = document.getElementById("activity-prev-btn");
  const nextBtn = document.getElementById("activity-next-btn");
  
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (currentOffset >= PAGE_SIZE) {
        loadActivity(currentOffset - PAGE_SIZE);
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      loadActivity(currentOffset + PAGE_SIZE);
    });
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
