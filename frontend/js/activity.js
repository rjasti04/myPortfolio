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
let activityStreamSource = null;
let loadedEvents = [];

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

    loadedEvents = events;

    // Render mobile cards or table rows based on viewport
    if (isMobile) {
      renderMobileCards(loadedEvents, tableContainer, offset);
    } else {
      renderTableRows(loadedEvents, tbody, offset);
    }

    // Update live visualizer metrics
    updatePipelineVisualizer(loadedEvents);

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
    const encodedData = hasData ? encodeBase64Text(JSON.stringify(e.event_data)) : "";
    const dataJson = hasData ? escapeHTML(formatDecodedJson(encodedData)) : "";
    const detailPanelId = `activity-mobile-data-${offset}-${i}`;

    return `
      <div class="activity-card" style="animation: activityRowFade var(--motion-medium) var(--ease-enter) both; animation-delay: ${i * 50}ms;">
        <div class="activity-card-header">
          <span class="activity-type-badge">${escapeHTML(e.event_type)}</span>
          <span class="activity-card-time"><i class="far fa-clock"></i> ${timeStr}</span>
        </div>
        <div class="activity-card-body">
          <div class="activity-card-meta">
            <span class="activity-card-date"><i class="far fa-calendar"></i> ${dateStr}</span>
            <span class="activity-card-path"><code>${escapeHTML(e.page_path || '-')}</code></span>
          </div>
          ${hasData ? `
            <div class="activity-card-data-section">
              <button class="activity-mobile-toggle" type="button" aria-expanded="false" aria-controls="${detailPanelId}">
                <span>View Event Data</span>
                <i class="fas fa-chevron-down" aria-hidden="true"></i>
              </button>
              <div id="${detailPanelId}" class="activity-mobile-data-panel" hidden>
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
              </div>
            </div>
          ` : `
            <div class="activity-card-data-section empty">
              <span class="activity-card-data-empty">No dynamic data payload</span>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

let pipelineAnimationTimer = null;

function animatePipelineFlow() {
  const connectors = document.querySelectorAll('.pipeline-connector');
  const nodes = document.querySelectorAll('.pipeline-node');
  
  // Clear any existing active classes
  connectors.forEach(c => c.classList.remove('flowing'));
  nodes.forEach(n => n.classList.remove('active-pulse'));
  
  if (pipelineAnimationTimer) clearTimeout(pipelineAnimationTimer);

  // Sequential data flow animation
  // Node 1 (Ingress) pulses
  const nodeIngress = document.getElementById('node-ingress');
  if (nodeIngress) nodeIngress.classList.add('active-pulse');
  
  pipelineAnimationTimer = setTimeout(() => {
    if (nodeIngress) nodeIngress.classList.remove('active-pulse');
    // Connector 1 flows
    const con1 = connectors[0];
    if (con1) con1.classList.add('flowing');
    
    pipelineAnimationTimer = setTimeout(() => {
      if (con1) con1.classList.remove('flowing');
      // Node 2 (Kafka) pulses
      const nodeKafka = document.getElementById('node-kafka');
      if (nodeKafka) nodeKafka.classList.add('active-pulse');
      
      pipelineAnimationTimer = setTimeout(() => {
        if (nodeKafka) nodeKafka.classList.remove('active-pulse');
        // Connector 2 flows
        const con2 = connectors[1];
        if (con2) con2.classList.add('flowing');
        
        pipelineAnimationTimer = setTimeout(() => {
          if (con2) con2.classList.remove('flowing');
          // Node 3 (FastAPI) pulses
          const nodeFastapi = document.getElementById('node-fastapi');
          if (nodeFastapi) nodeFastapi.classList.add('active-pulse');
          
          pipelineAnimationTimer = setTimeout(() => {
            if (nodeFastapi) nodeFastapi.classList.remove('active-pulse');
            // Connector 3 flows
            const con3 = connectors[2];
            if (con3) con3.classList.add('flowing');
            
            pipelineAnimationTimer = setTimeout(() => {
              if (con3) con3.classList.remove('flowing');
              // Node 4 (Postgres) pulses
              const nodePostgres = document.getElementById('node-postgres');
              if (nodePostgres) nodePostgres.classList.add('active-pulse');
              
              pipelineAnimationTimer = setTimeout(() => {
                if (nodePostgres) nodePostgres.classList.remove('active-pulse');
              }, 400);
            }, 500);
          }, 300);
        }, 500);
      }, 300);
    }, 500);
  }, 300);
}

function updatePipelineVisualizer(events) {
  if (!events || !events.length) return;

  const valIngress = document.getElementById('val-ingress');
  const valKafka = document.getElementById('val-kafka');
  const valFastapi = document.getElementById('val-fastapi');
  const valPostgres = document.getElementById('val-postgres');

  const metricThroughput = document.getElementById('metric-throughput');
  const metricLoad = document.getElementById('metric-load');
  const metricHealth = document.getElementById('metric-health');

  // Trigger flow animation sequence
  animatePipelineFlow();

  // Ingress EPS
  const eventCount = events.length;
  const mockEps = (eventCount * 0.15 + Math.random() * 0.3).toFixed(1);
  if (valIngress) valIngress.textContent = `${mockEps} eps`;
  if (metricThroughput) metricThroughput.textContent = `${mockEps} eps`;

  // Kafka Queue Queue lag
  const mockKafkaMsg = Math.floor(Math.random() * 4);
  if (valKafka) valKafka.textContent = `${mockKafkaMsg} msg`;

  // FastAPI Worker latency
  const mockLatency = (3.5 + Math.random() * 5).toFixed(1);
  if (valFastapi) valFastapi.textContent = `${mockLatency} ms`;
  if (metricLoad) {
    const mockCpu = (20 + Math.random() * 30 + eventCount * 3).toFixed(1);
    metricLoad.textContent = `${mockCpu}%`;
  }

  // Postgres count
  const mockRows = events.length + 15;
  if (valPostgres) valPostgres.textContent = `${mockRows} rows`;

  if (metricHealth) {
    metricHealth.textContent = '100%';
  }
}

export function initActivity() {
  const tableContainer = document.querySelector(".activity-table-container");
  if (tableContainer) {
    tableContainer.addEventListener("click", async (event) => {
      const copyButton = event.target.closest(".activity-copy-json");
      if (copyButton) {
        const panel = copyButton.closest(".activity-data-panel");
        const jsonBlock = panel?.querySelector(".activity-data-pre");
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

      const button = event.target.closest(".activity-data-toggle") || event.target.closest(".activity-mobile-toggle");
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
        startActivityStream();
      } else if (!isActive && wasActive) {
        stopActivityStream();
      }
      wasActive = isActive;
    });
    observer.observe(activitySection, { attributes: true, attributeFilter: ["class"] });

    // Initial load if starting on the activity page
    if (wasActive) {
      loadActivity();
      startActivityStream();
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

// ── Real-Time Streaming Controllers ──

function startActivityStream() {
  if (activityStreamSource) {
    return; // Stream already active
  }

  const sessionId = sessionStorage.getItem("rj_session_id");
  if (!sessionId || !isApiConfigured()) {
    updateStreamingStatus("disconnected");
    return;
  }

  const streamUrl = `${API_BASE}/sessions/${sessionId}/stream`;
  console.log("Connecting to activity stream:", streamUrl);
  updateStreamingStatus("connecting");

  activityStreamSource = new EventSource(streamUrl);

  activityStreamSource.onopen = () => {
    console.log("Activity stream connection established");
    updateStreamingStatus("connected");
  };

  activityStreamSource.onmessage = (event) => {
    try {
      const eventData = JSON.parse(event.data);
      handleIncomingStreamEvent(eventData);
    } catch (err) {
      console.error("Error parsing activity stream data:", err);
    }
  };

  activityStreamSource.onerror = (err) => {
    console.warn("Activity stream connection lost, reconnecting...", err);
    updateStreamingStatus("connecting");
  };
}

function stopActivityStream() {
  if (activityStreamSource) {
    console.log("Closing activity stream connection");
    activityStreamSource.close();
    activityStreamSource = null;
  }
  updateStreamingStatus("disconnected");
}

function updateStreamingStatus(status) {
  const statusBadge = document.querySelector(".pipeline-status-badge");
  if (!statusBadge) return;

  if (status === "connected") {
    statusBadge.className = "pipeline-status-badge connected";
    statusBadge.innerHTML = `<span class="pulse-dot active-green"></span> Streaming`;
  } else if (status === "connecting") {
    statusBadge.className = "pipeline-status-badge connecting";
    statusBadge.innerHTML = `<span class="pulse-dot active-orange"></span> Connecting`;
  } else {
    statusBadge.className = "pipeline-status-badge disconnected";
    statusBadge.innerHTML = `<span class="pulse-dot active-red"></span> Offline`;
  }
}

function handleIncomingStreamEvent(eventData) {
  const currentSessionId = sessionStorage.getItem("rj_session_id");
  if (!currentSessionId || eventData.session_id !== currentSessionId) {
    return;
  }

  // Prepend event data only if viewing the first page of activity events
  if (currentOffset === 0) {
    // Avoid double-prepending if the event already got added
    const exists = loadedEvents.some(e => e.event_id === eventData.event_id && eventData.event_id !== undefined);
    if (!exists) {
      loadedEvents.unshift(eventData);
      if (loadedEvents.length > PAGE_SIZE) {
        loadedEvents.pop();
      }

      const tbody = document.getElementById("activity-tbody");
      const tableContainer = document.querySelector(".activity-table-container");
      if (tbody && tableContainer) {
        const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
        if (isMobile) {
          renderMobileCards(loadedEvents, tableContainer, currentOffset);
        } else {
          renderTableRows(loadedEvents, tbody, currentOffset);
        }
      }
    }
  }

  // Animate the pipeline flow visualizer and update dashboard metrics
  updatePipelineVisualizer([eventData]);
}

