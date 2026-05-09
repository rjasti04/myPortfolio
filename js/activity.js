import { API_BASE, apiFetch, isApiConfigured } from "./analytics.js";

function escapeHTML(str) {
  const d = document.createElement("div");
  d.textContent = String(str);
  return d.innerHTML;
}

function encodeBase64Text(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64Text(encodedText) {
  const binary = atob(encodedText);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function formatDecodedJson(encodedText) {
  const decodedText = decodeBase64Text(encodedText);
  return JSON.stringify(JSON.parse(decodedText), null, 2);
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  return copied ? Promise.resolve() : Promise.reject(new Error("Copy command failed"));
}

const copyResetTimers = new WeakMap();

function setCopyButtonState(button, state) {
  const label = button.querySelector(".activity-copy-label");
  const defaultLabel = button.dataset.defaultLabel || label?.textContent || "Copy";
  button.dataset.defaultLabel = defaultLabel;
  button.dataset.copyState = state;
  if (label) label.textContent = state === "copied" ? "Copied" : "Failed";

  const existingTimer = copyResetTimers.get(button);
  if (existingTimer) clearTimeout(existingTimer);

  const resetTimer = setTimeout(() => {
    delete button.dataset.copyState;
    if (label) label.textContent = defaultLabel;
    copyResetTimers.delete(button);
  }, 1600);
  copyResetTimers.set(button, resetTimer);
}

let currentOffset = 0;
const PAGE_SIZE = 5;
let activityRefreshTimer = null;

export async function loadActivity(offset = currentOffset) {
  // Debounce rapid refresh calls
  if (activityRefreshTimer) {
    clearTimeout(activityRefreshTimer);
  }
  
  activityRefreshTimer = setTimeout(() => {
    activityRefreshTimer = null;
    _loadActivityImpl(offset);
  }, 300);
}

async function _loadActivityImpl(offset) {
  const tbody = document.getElementById("activity-tbody");
  const tableContainer = document.querySelector(".activity-table-container");
  if (!tbody || !tableContainer) return;

  const paginationControls = document.getElementById("activity-pagination");
  const prevBtn = document.getElementById("activity-prev-btn");
  const nextBtn = document.getElementById("activity-next-btn");
  const pageInfo = document.getElementById("activity-page-info");

  const sessionId = sessionStorage.getItem("rj_session_id");

  const sessionIdSpan = document.getElementById("current-session-id");
  if (sessionIdSpan) {
    const displayId = sessionId ? sessionId.split('-').slice(0, 3).join('-') : "None";
    sessionIdSpan.textContent = displayId;
  }

  // Check if we're on mobile
  const isMobile = window.innerWidth <= 480;

  if (!isApiConfigured()) {
    const message = `<tr><td colspan="5" class="activity-message">Activity API is not configured.</td></tr>`;
    tbody.innerHTML = message;
    if (paginationControls) paginationControls.style.display = "none";
    return;
  }

  if (!sessionId) {
    const message = `<tr><td colspan="5" class="activity-message">No active session found.</td></tr>`;
    tbody.innerHTML = message;
    if (paginationControls) paginationControls.style.display = "none";
    return;
  }

  tbody.innerHTML = `<tr><td colspan="5" class="activity-message"><i class="fas fa-spinner fa-spin"></i> Loading activity...</td></tr>`;

  try {
    const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/events?limit=${PAGE_SIZE}&offset=${offset}`);
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

    // Render mobile cards or table rows based on viewport
    if (isMobile) {
      renderMobileCards(events, tableContainer, offset);
    } else {
      renderTableRows(events, tbody, offset);
    }

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

function renderTableRows(events, tbody, offset) {
  tbody.innerHTML = events.map((e, i) => {
    const d = new Date(e.created_at);
    const dateStr = escapeHTML(d.toLocaleDateString());
    const timeStr = escapeHTML(d.toLocaleTimeString());
    const hasData = Boolean(e.event_data);
    const encodedData = hasData ? encodeBase64Text(JSON.stringify(e.event_data)) : "";
    const dataJson = hasData ? escapeHTML(formatDecodedJson(encodedData)) : "";
    const detailRowId = `activity-data-${offset}-${i}`;
    return `
        <tr class="activity-row-enter" style="animation-delay: ${i * 50}ms">
          <td>${dateStr}</td>
          <td>${timeStr}</td>
          <td><span class="activity-type-badge">${escapeHTML(e.event_type)}</span></td>
          <td>${escapeHTML(e.page_path || '-')}</td>
          <td>
            ${hasData ? `
              <button class="activity-data-toggle" type="button" aria-expanded="false" aria-controls="${detailRowId}">
                <span class="activity-data-summary">${escapeHTML(encodedData)}</span>
                <i class="fas fa-chevron-down" aria-hidden="true"></i>
              </button>
            ` : `<span class="activity-data-empty">-</span>`}
          </td>
        </tr>
        ${hasData ? `
          <tr class="activity-data-row" id="${detailRowId}" hidden>
            <td colspan="5">
              <div class="activity-data-panel">
                <div class="activity-data-toolbar">
                  <span class="activity-data-label">Decoded JSON</span>
                  <button class="activity-copy-json" type="button" aria-label="Copy activity JSON">
                    <i class="fas fa-copy" aria-hidden="true"></i>
                    <span class="activity-copy-label">Copy</span>
                  </button>
                </div>
                <pre class="activity-data-pre">${dataJson}</pre>
              </div>
            </td>
          </tr>
        ` : ""}
      `;
  }).join("");
}

function renderMobileCards(events, container, offset) {
  // Remove existing mobile cards container if it exists
  let mobileContainer = container.querySelector('.activity-mobile-cards');
  if (!mobileContainer) {
    mobileContainer = document.createElement('div');
    mobileContainer.className = 'activity-mobile-cards';
    container.appendChild(mobileContainer);
  }

  mobileContainer.innerHTML = events.map((e, i) => {
    const d = new Date(e.created_at);
    const dateStr = escapeHTML(d.toLocaleDateString());
    const timeStr = escapeHTML(d.toLocaleTimeString());
    const hasData = Boolean(e.event_data);
    const dataPreview = hasData ? escapeHTML(JSON.stringify(e.event_data).substring(0, 50) + '...') : '-';
    
    return `
      <div class="activity-card" style="animation: activityRowFade var(--motion-medium) var(--ease-enter) both; animation-delay: ${i * 50}ms;">
        <div class="activity-card-row">
          <span class="activity-card-label">Date</span>
          <span class="activity-card-value">${dateStr}</span>
        </div>
        <div class="activity-card-row">
          <span class="activity-card-label">Time</span>
          <span class="activity-card-value">${timeStr}</span>
        </div>
        <div class="activity-card-row">
          <span class="activity-card-label">Type</span>
          <span class="activity-card-value"><span class="activity-type-badge">${escapeHTML(e.event_type)}</span></span>
        </div>
        <div class="activity-card-row">
          <span class="activity-card-label">Path</span>
          <span class="activity-card-value"><code>${escapeHTML(e.page_path || '-')}</code></span>
        </div>
        <div class="activity-card-row">
          <span class="activity-card-label">Data</span>
          <span class="activity-card-value"><code>${dataPreview}</code></span>
        </div>
      </div>
    `;
  }).join('');
}

export function initActivity() {
  const tbody = document.getElementById("activity-tbody");
  if (tbody) {
    tbody.addEventListener("click", async (event) => {
      const copyButton = event.target.closest(".activity-copy-json");
      if (copyButton) {
        const detailRow = copyButton.closest(".activity-data-row");
        const jsonBlock = detailRow?.querySelector(".activity-data-pre");
        if (!jsonBlock) return;

        try {
          await copyText(jsonBlock.textContent || "");
          setCopyButtonState(copyButton, "copied");
        } catch (error) {
          console.error("Activity JSON copy failed", error);
          setCopyButtonState(copyButton, "failed");
        }
        return;
      }

      const button = event.target.closest(".activity-data-toggle");
      if (!button) return;

      const detailRowId = button.getAttribute("aria-controls");
      const detailRow = detailRowId ? document.getElementById(detailRowId) : null;
      if (!detailRow) return;

      const isExpanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!isExpanded));
      detailRow.hidden = isExpanded;
    });
  }

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

  const activitySection = document.getElementById("activity");
  if (activitySection) {
    let wasActive = activitySection.classList.contains("active");
    const observer = new MutationObserver(() => {
      const isActive = activitySection.classList.contains("active");
      if (isActive && !wasActive) {
        currentOffset = 0;
        loadActivity(0);
      }
      wasActive = isActive;
    });
    observer.observe(activitySection, { attributes: true, attributeFilter: ["class"] });

    // Initial load if starting on the activity page
    if (wasActive) {
      loadActivity();
    }
  }

  // Handle responsive layout changes
  let resizeTimeout;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const newWidth = window.innerWidth;
      const crossedMobileThreshold = (lastWidth > 480 && newWidth <= 480) || (lastWidth <= 480 && newWidth > 480);
      
      if (crossedMobileThreshold && activitySection?.classList.contains('active')) {
        loadActivity(currentOffset);
      }
      
      lastWidth = newWidth;
    }, 300);
  });
}
