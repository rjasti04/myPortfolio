import { API_BASE, apiFetch, isApiConfigured } from "./analytics.js";
import { copyText, escapeHTML } from "./utils.js";

// Constants
const PAGE_SIZE = 5;
const DEBOUNCE_DELAY_MS = 300;
const COPY_RESET_DELAY_MS = 1600;
const MOBILE_BREAKPOINT = 480;
const RESIZE_DEBOUNCE_MS = 300;

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
  }, COPY_RESET_DELAY_MS);
  copyResetTimers.set(button, resetTimer);
}

let currentOffset = 0;
let activityRefreshTimer = null;
let resizeController = null;

export async function loadActivity(offset = currentOffset) {
  // Debounce rapid refresh calls
  if (activityRefreshTimer) {
    clearTimeout(activityRefreshTimer);
  }
  
  activityRefreshTimer = setTimeout(() => {
    activityRefreshTimer = null;
    _loadActivityImpl(offset);
  }, DEBOUNCE_DELAY_MS);
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
  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;

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

  tbody.innerHTML = `
    <tr><td colspan="5">
      <div style="padding: 20px;">
        <div class="skeleton skeleton-text" style="width: 60%; margin-bottom: 12px;"></div>
        <div class="skeleton skeleton-text" style="width: 80%; margin-bottom: 12px;"></div>
        <div class="skeleton skeleton-text" style="width: 70%; margin-bottom: 12px;"></div>
        <div class="skeleton skeleton-text" style="width: 90%;"></div>
      </div>
    </td></tr>
  `;
  
  // Add loading state to refresh button
  const refreshBtn = document.getElementById('activity-refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    const icon = refreshBtn.querySelector('i');
    if (icon) {
      icon.className = 'fas fa-circle-notch fa-spin';
    }
  }

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
        // User navigated past the end - go back to last valid page
        const lastValidOffset = Math.max(0, offset - PAGE_SIZE);
        if (lastValidOffset !== offset) {
          loadActivity(lastValidOffset);
          return;
        }
        tbody.innerHTML = `<tr><td colspan="5" class="activity-message">No more events.</td></tr>`;
        if (paginationControls) {
          paginationControls.style.display = "flex";
          prevBtn.disabled = false;
          prevBtn.title = "Previous page";
          nextBtn.disabled = true;
          nextBtn.title = "No more pages";
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
      prevBtn.title = currentOffset === 0 ? "No previous pages" : "Previous page";
      nextBtn.disabled = events.length < PAGE_SIZE;
      nextBtn.title = events.length < PAGE_SIZE ? "No more pages" : "Next page";

      const currentPage = Math.floor(currentOffset / PAGE_SIZE) + 1;
      if (pageInfo) pageInfo.textContent = `Page ${currentPage}`;
    }

  } catch (error) {
    console.error("Activity load error", error);
    tbody.innerHTML = `<tr><td colspan="5" class="activity-message">Network error loading activity.</td></tr>`;
    if (paginationControls) paginationControls.style.display = "none";
  } finally {
    // Reset refresh button state
    const refreshBtn = document.getElementById('activity-refresh-btn');
    if (refreshBtn) {
      refreshBtn.disabled = false;
      const icon = refreshBtn.querySelector('i');
      if (icon) {
        icon.className = 'fas fa-sync-alt';
      }
    }
  }
}

function renderTableRows(events, tbody, offset) {
  tbody.closest('.activity-table-container')?.querySelector('.activity-mobile-cards')?.remove();

  // Use DocumentFragment for better performance
  const fragment = document.createDocumentFragment();
  
  events.forEach((e, i) => {
    const d = new Date(e.created_at);
    const dateStr = escapeHTML(d.toLocaleDateString());
    const timeStr = escapeHTML(d.toLocaleTimeString());
    const hasData = Boolean(e.event_data);
    const encodedData = hasData ? encodeBase64Text(JSON.stringify(e.event_data)) : "";
    const dataJson = hasData ? escapeHTML(formatDecodedJson(encodedData)) : "";
    const detailRowId = `activity-data-${offset}-${i}`;
    
    // Create main row
    const mainRow = document.createElement('tr');
    mainRow.className = 'activity-row-enter';
    mainRow.style.animationDelay = `${i * 50}ms`;
    mainRow.innerHTML = `
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
    `;
    fragment.appendChild(mainRow);
    
    // Create detail row if has data
    if (hasData) {
      const detailRow = document.createElement('tr');
      detailRow.className = 'activity-data-row';
      detailRow.id = detailRowId;
      detailRow.hidden = true;
      detailRow.innerHTML = `
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
      `;
      fragment.appendChild(detailRow);
    }
  });
  
  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}

function renderMobileCards(events, container, offset) {
  const tbody = container.querySelector("tbody");
  if (tbody) tbody.innerHTML = "";

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
  if (resizeController) {
    resizeController.abort();
  }
  
  resizeController = new AbortController();
  let resizeTimeout;
  let lastWidth = window.innerWidth;
  
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const newWidth = window.innerWidth;
      const crossedMobileThreshold = (lastWidth > MOBILE_BREAKPOINT && newWidth <= MOBILE_BREAKPOINT) || (lastWidth <= MOBILE_BREAKPOINT && newWidth > MOBILE_BREAKPOINT);
      
      if (crossedMobileThreshold && activitySection?.classList.contains('active')) {
        loadActivity(currentOffset);
      }
      
      lastWidth = newWidth;
    }, RESIZE_DEBOUNCE_MS);
  }, { signal: resizeController.signal, passive: true });
}
