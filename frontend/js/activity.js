import { API_BASE, apiFetch, ensureSession, isApiConfigured } from "./analytics.js";
import { copyText, escapeHTML } from "./utils.js";

// Constants
const PAGE_SIZE = 15;
const DEBOUNCE_DELAY_MS = 300;
const COPY_RESET_DELAY_MS = 1600;
// Mirrored by the card-mode @media block in styles.css. Below this width the
// table is hidden and cards are rendered instead.
const MOBILE_BREAKPOINT = 768;
const RELATIVE_TIME_TICK_MS = 10000;
const COUNT_UP_DURATION_MS = 600;
const DATA_PREVIEW_KEYS = 2;
const TABLE_COLSPAN = 5;

// Icon + label for every event type the API declares (server/schemas/event.py).
// Order drives tile order; unknown types fall back to GENERIC_TILE.
const TILE_META = {
  click: { icon: "fa-mouse-pointer", label: "Clicks" },
  page_view: { icon: "fa-eye", label: "Page Views" },
  scroll_depth: { icon: "fa-arrows-up-down", label: "Scroll Depth" },
  terminal_command: { icon: "fa-terminal", label: "Terminal Cmds" },
  theme_change: { icon: "fa-palette", label: "Theme Changes" },
  copy_email: { icon: "fa-envelope", label: "Email Copies" },
  contact_submission: { icon: "fa-paper-plane", label: "Contact Sends" },
};
const GENERIC_TILE = { icon: "fa-circle-dot", label: "Other" };

function tileMeta(eventType) {
  return TILE_META[eventType] || {
    icon: GENERIC_TILE.icon,
    label: eventType.replace(/_/g, " "),
  };
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
let activeTypeFilter = null;
let summaryState = null;
let relativeTimeTimer = null;
let prefersReducedMotion = false;
let lastPageState = { pageCount: 0, atEnd: true };
let untriggeredExpanded = false;

// ── Formatting helpers ──

/**
 * Human-readable preview of an event payload for the collapsed table cell.
 * The panel below still shows the full pretty-printed JSON.
 */
function previewEventData(eventData) {
  if (!eventData || typeof eventData !== "object") return "-";
  const keys = Object.keys(eventData);
  if (!keys.length) return "{}";

  const shown = keys.slice(0, DATA_PREVIEW_KEYS).map((key) => {
    const value = eventData[key];
    let rendered;
    if (typeof value === "string") {
      rendered = `"${value.length > 24 ? `${value.slice(0, 24)}…` : value}"`;
    } else if (value === null || typeof value !== "object") {
      rendered = String(value);
    } else {
      rendered = Array.isArray(value) ? `[${value.length}]` : "{…}";
    }
    return `${key}: ${rendered}`;
  });

  const overflow = keys.length - shown.length;
  return `{ ${shown.join(", ")} }${overflow > 0 ? ` +${overflow}` : ""}`;
}

function formatEventJson(eventData) {
  return JSON.stringify(eventData, null, 2);
}

function formatRelativeTime(isoString) {
  const then = new Date(isoString).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isMobileViewport() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function setTableMessage(tbody, message) {
  tbody.innerHTML = `<tr><td colspan="${TABLE_COLSPAN}" class="activity-message">${escapeHTML(message)}</td></tr>`;
}

// ── Event table ──

export async function loadActivity(offset = currentOffset, { immediate = false } = {}) {
  if (activityRefreshTimer) {
    clearTimeout(activityRefreshTimer);
    activityRefreshTimer = null;
  }

  // Only the rapid-fire paths (pagination, filter toggling) need debouncing.
  // Debouncing the first paint just delays it by DEBOUNCE_DELAY_MS.
  if (immediate) {
    return _loadActivityImpl(offset);
  }

  activityRefreshTimer = setTimeout(() => {
    activityRefreshTimer = null;
    _loadActivityImpl(offset);
  }, DEBOUNCE_DELAY_MS);
  return undefined;
}

function setRefreshBusy(isBusy) {
  const refreshBtn = document.getElementById("activity-refresh-btn");
  if (!refreshBtn) return;
  refreshBtn.disabled = isBusy;
  const icon = refreshBtn.querySelector("i");
  if (icon) {
    icon.className = isBusy ? "fas fa-circle-notch fa-spin" : "fas fa-sync-alt";
  }
}

async function _loadActivityImpl(offset) {
  const tbody = document.getElementById("activity-tbody");
  const tableContainer = document.querySelector(".activity-table-container");
  if (!tbody || !tableContainer) return;

  const paginationControls = document.getElementById("activity-pagination");
  const sessionId = sessionStorage.getItem("rj_session_id");

  const sessionIdSpan = document.getElementById("current-session-id");
  const sessionPill = document.getElementById("activity-session-pill");
  if (sessionIdSpan) {
    const displayId = sessionId ? sessionId.split("-").slice(0, 3).join("-") : "None";
    sessionIdSpan.textContent = displayId;
  }
  if (sessionPill) {
    sessionPill.dataset.sessionId = sessionId || "";
    sessionPill.disabled = !sessionId;
    if (sessionId) sessionPill.title = sessionId;
  }

  if (!isApiConfigured()) {
    setTableMessage(tbody, "Activity API is not configured.");
    if (paginationControls) paginationControls.style.display = "none";
    renderSummaryUnavailable("Totals unavailable - the activity API is not configured.");
    return;
  }

  if (!sessionId) {
    setTableMessage(tbody, "No active session found.");
    if (paginationControls) paginationControls.style.display = "none";
    renderSummaryUnavailable("Totals appear once a session starts.");
    return;
  }

  tableContainer.setAttribute("aria-busy", "true");
  clearMobileCards(tableContainer);
  tbody.innerHTML = Array.from({ length: 4 })
    .map(
      () => `
    <tr class="activity-skeleton-row">
      <td><div class="skeleton skeleton-text" style="width: 70px; height: 14px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 120px; height: 14px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 90px; height: 14px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 140px; height: 14px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 50px; height: 14px;"></div></td>
    </tr>
  `,
    )
    .join("");

  setRefreshBusy(true);

  const requestStartedAt = performance.now();

  try {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (activeTypeFilter) params.set("event_type", activeTypeFilter);

    const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/events?${params}`);
    recordApiLatency(performance.now() - requestStartedAt);

    if (!response.ok) {
      const message =
        response.status === 404
          ? "Session not found or expired."
          : `Failed to load activity. (Status: ${response.status})`;
      setTableMessage(tbody, message);
      if (paginationControls) paginationControls.style.display = "none";
      return;
    }

    const events = await response.json();
    if (!events || events.length === 0) {
      if (offset === 0) {
        setTableMessage(
          tbody,
          activeTypeFilter
            ? `No "${activeTypeFilter}" events in this session.`
            : "No events found for the current session.",
        );
        if (paginationControls) paginationControls.style.display = "none";
      } else {
        // User navigated past the end - go back to the last valid page.
        const lastValidOffset = Math.max(0, offset - PAGE_SIZE);
        if (lastValidOffset !== offset) {
          loadActivity(lastValidOffset, { immediate: true });
          return;
        }
        setTableMessage(tbody, "No more events.");
        if (paginationControls) {
          paginationControls.style.display = "flex";
          currentOffset = offset;
          updatePagination({ pageCount: 0, atEnd: true });
        }
      }
      return;
    }

    loadedEvents = events;
    currentOffset = offset;
    renderEvents();

    if (paginationControls) {
      paginationControls.style.display = "flex";
      updatePagination({ pageCount: events.length, atEnd: events.length < PAGE_SIZE });
    }

    updatePipelineVisualizer();
  } catch (error) {
    console.error("Activity load error", error);
    setTableMessage(tbody, "Network error loading activity.");
    if (paginationControls) paginationControls.style.display = "none";
  } finally {
    tableContainer.removeAttribute("aria-busy");
    setRefreshBusy(false);
  }
}

/**
 * Renders whichever layout the current viewport calls for from the in-memory
 * event list. Never refetches - the resize path relies on that.
 */
function renderEvents({ stagger = true } = {}) {
  const tbody = document.getElementById("activity-tbody");
  const tableContainer = document.querySelector(".activity-table-container");
  if (!tbody || !tableContainer) return;

  if (isMobileViewport()) {
    renderMobileCards(loadedEvents, tableContainer, currentOffset, stagger);
  } else {
    renderTableRows(loadedEvents, tbody, currentOffset, stagger);
  }
}

/**
 * Entrance animation for a row at position `index`.
 * A full page load staggers every row; a live insert animates only the new top
 * row, otherwise each arriving event restarts the fade on the whole table.
 */
function rowAnimation(index, stagger) {
  if (prefersReducedMotion) return null;
  if (stagger) return index * 50;
  return index === 0 ? 0 : null;
}

function updatePagination({ pageCount, atEnd } = lastPageState) {
  lastPageState = { pageCount, atEnd };

  const prevBtn = document.getElementById("activity-prev-btn");
  const nextBtn = document.getElementById("activity-next-btn");
  const pageInfo = document.getElementById("activity-page-info");

  if (prevBtn) {
    prevBtn.disabled = currentOffset === 0;
    prevBtn.title = currentOffset === 0 ? "No previous pages" : "Previous page";
  }
  if (nextBtn) {
    nextBtn.disabled = atEnd;
    nextBtn.title = atEnd ? "No more pages" : "Next page";
  }
  if (!pageInfo) return;

  const currentPage = Math.floor(currentOffset / PAGE_SIZE) + 1;
  // The summary endpoint is the only source of a true total, so "of N" only
  // appears when it is loaded and no per-type filter narrows the set.
  const total = !activeTypeFilter
    ? summaryState?.total_events
    : summaryState?.by_type?.find((row) => row.event_type === activeTypeFilter)?.count;

  if (Number.isFinite(total) && total > 0) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} · ${total} event${total === 1 ? "" : "s"}`;
  } else {
    pageInfo.textContent = atEnd && pageCount === 0 ? `Page ${currentPage} (End)` : `Page ${currentPage}`;
  }
}

function clearMobileCards(container) {
  container.querySelector(".activity-mobile-cards")?.remove();
}

function renderTableRows(events, tbody, offset, stagger = true) {
  clearMobileCards(tbody.closest(".activity-table-container"));

  const fragment = document.createDocumentFragment();

  events.forEach((e, i) => {
    const d = new Date(e.created_at);
    const dateStr = escapeHTML(d.toLocaleDateString());
    const timeStr = escapeHTML(d.toLocaleTimeString());
    const relativeStr = escapeHTML(formatRelativeTime(e.created_at));
    const hasData = Boolean(e.event_data);
    const preview = hasData ? escapeHTML(previewEventData(e.event_data)) : "";
    const dataJson = hasData ? escapeHTML(formatEventJson(e.event_data)) : "";
    const detailRowId = `activity-data-${offset}-${i}`;

    const mainRow = document.createElement("tr");
    const delay = rowAnimation(i, stagger);
    if (delay !== null) {
      mainRow.className = "activity-row-enter";
      mainRow.style.animationDelay = `${delay}ms`;
    }
    mainRow.innerHTML = `
      <td>${dateStr}</td>
      <td>${timeStr}<span class="activity-relative-time" data-created-at="${escapeHTML(e.created_at)}">${relativeStr}</span></td>
      <td><span class="activity-type-badge">${escapeHTML(e.event_type)}</span></td>
      <td>${escapeHTML(e.page_path || "-")}</td>
      <td>
        ${
          hasData
            ? `
          <button class="activity-data-toggle" type="button" aria-expanded="false" aria-controls="${detailRowId}">
            <span class="activity-data-summary">${preview}</span>
            <i class="fas fa-chevron-down" aria-hidden="true"></i>
          </button>
        `
            : `<span class="activity-data-empty">-</span>`
        }
      </td>
    `;
    fragment.appendChild(mainRow);

    if (hasData) {
      const detailRow = document.createElement("tr");
      detailRow.className = "activity-data-row";
      detailRow.id = detailRowId;
      detailRow.hidden = true;
      detailRow.innerHTML = `
        <td colspan="${TABLE_COLSPAN}">
          <div class="activity-data-panel">
            <div class="activity-data-toolbar">
              <span class="activity-data-label">Event JSON</span>
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

  tbody.innerHTML = "";
  tbody.appendChild(fragment);
}

function renderMobileCards(events, container, offset, stagger = true) {
  const tbody = container.querySelector("tbody");
  if (tbody) tbody.innerHTML = "";

  let mobileContainer = container.querySelector(".activity-mobile-cards");
  if (!mobileContainer) {
    mobileContainer = document.createElement("div");
    mobileContainer.className = "activity-mobile-cards";
    container.appendChild(mobileContainer);
  }

  mobileContainer.innerHTML = events
    .map((e, i) => {
      const d = new Date(e.created_at);
      const dateStr = escapeHTML(d.toLocaleDateString());
      const timeStr = escapeHTML(d.toLocaleTimeString());
      const relativeStr = escapeHTML(formatRelativeTime(e.created_at));
      const hasData = Boolean(e.event_data);
      const dataJson = hasData ? escapeHTML(formatEventJson(e.event_data)) : "";
      const detailPanelId = `activity-mobile-data-${offset}-${i}`;
      const delay = rowAnimation(i, stagger);
      const animation =
        delay === null
          ? ""
          : `animation: activityRowFade var(--motion-medium) var(--ease-enter) both; animation-delay: ${delay}ms;`;

      return `
      <div class="activity-card" style="${animation}">
        <div class="activity-card-header">
          <span class="activity-type-badge">${escapeHTML(e.event_type)}</span>
          <span class="activity-card-time"><i class="far fa-clock"></i> ${timeStr}</span>
        </div>
        <div class="activity-card-body">
          <div class="activity-card-meta">
            <span class="activity-card-date"><i class="far fa-calendar"></i> ${dateStr}
              <span class="activity-relative-time" data-created-at="${escapeHTML(e.created_at)}">${relativeStr}</span>
            </span>
            <span class="activity-card-path"><code>${escapeHTML(e.page_path || "-")}</code></span>
          </div>
          ${
            hasData
              ? `
            <div class="activity-card-data-section">
              <button class="activity-mobile-toggle" type="button" aria-expanded="false" aria-controls="${detailPanelId}">
                <span>View Event Data</span>
                <i class="fas fa-chevron-down" aria-hidden="true"></i>
              </button>
              <div id="${detailPanelId}" class="activity-mobile-data-panel" hidden>
                <div class="activity-data-panel">
                  <div class="activity-data-toolbar">
                    <span class="activity-data-label">Event JSON</span>
                    <button class="activity-copy-json" type="button" aria-label="Copy activity JSON">
                      <i class="fas fa-copy" aria-hidden="true"></i>
                      <span class="activity-copy-label">Copy</span>
                    </button>
                  </div>
                  <pre class="activity-data-pre">${dataJson}</pre>
                </div>
              </div>
            </div>
          `
              : `
            <div class="activity-card-data-section empty">
              <span class="activity-card-data-empty">No dynamic data payload</span>
            </div>
          `
          }
        </div>
      </div>
    `;
    })
    .join("");
}

function refreshRelativeTimes() {
  document.querySelectorAll(".activity-relative-time[data-created-at]").forEach((node) => {
    node.textContent = formatRelativeTime(node.dataset.createdAt);
  });
  renderDerivedTiles();
}

// ── Summary tiles ──

export async function loadActivitySummary() {
  const grid = document.getElementById("activity-summary-grid");
  if (!grid) return;

  const sessionId = sessionStorage.getItem("rj_session_id");
  if (!isApiConfigured()) {
    renderSummaryUnavailable("Totals unavailable - the activity API is not configured.");
    return;
  }
  if (!sessionId) {
    renderSummaryUnavailable("Totals appear once a session starts.");
    return;
  }

  grid.setAttribute("aria-busy", "true");
  try {
    const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/events/summary`);
    if (!response.ok) {
      renderSummaryUnavailable(`Totals unavailable. (Status: ${response.status})`);
      return;
    }
    summaryState = await response.json();
    renderSummaryTiles();
  } catch (error) {
    console.error("Activity summary load error", error);
    renderSummaryUnavailable("Totals unavailable - network error.");
  } finally {
    grid.removeAttribute("aria-busy");
  }
}

function renderSummaryUnavailable(message) {
  const grid = document.getElementById("activity-summary-grid");
  if (!grid) return;
  summaryState = null;
  grid.removeAttribute("aria-busy");
  grid.innerHTML = `<p class="activity-summary-error">${escapeHTML(message)}</p>`;
}

function renderSummaryTiles() {
  const grid = document.getElementById("activity-summary-grid");
  if (!grid || !summaryState) return;

  const total = summaryState.total_events || 0;
  const tiles = [
    `
    <div class="activity-tile is-total">
      <span class="activity-tile-icon"><i class="fas fa-database" aria-hidden="true"></i></span>
      <span class="activity-tile-value" data-tile-total>0</span>
      <span class="activity-tile-label">Total Events</span>
    </div>
  `,
  ];

  const byType = summaryState.by_type || [];
  const triggered = byType.filter((row) => (row.count || 0) > 0);
  const untriggered = byType.filter((row) => (row.count || 0) === 0);

  const typeTile = (row) => {
    const meta = tileMeta(row.event_type);
    const count = row.count || 0;
    const share = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <button
        type="button"
        class="activity-tile${count === 0 ? " is-empty" : ""}"
        data-event-type="${escapeHTML(row.event_type)}"
        aria-pressed="${activeTypeFilter === row.event_type ? "true" : "false"}"
        ${count === 0 ? "disabled" : ""}
        title="${escapeHTML(meta.label)}: ${count} of ${total} events${count === 0 ? "" : " - click to filter"}"
      >
        <span class="activity-tile-icon"><i class="fas ${escapeHTML(meta.icon)}" aria-hidden="true"></i></span>
        <span class="activity-tile-value" data-tile-count="${escapeHTML(row.event_type)}">0</span>
        <span class="activity-tile-label">${escapeHTML(meta.label)}</span>
        <span class="activity-tile-share" style="width: ${share}%"></span>
      </button>
    `;
  };

  triggered.forEach((row) => tiles.push(typeTile(row)));

  // A grid half-full of greyed zeros reads as a broken dashboard. Collapse the
  // untriggered types behind one chip the reader can open on demand.
  if (untriggered.length) {
    tiles.push(`
      <button type="button" class="activity-tile activity-tile-more" id="activity-tile-more"
        aria-expanded="${untriggeredExpanded ? "true" : "false"}"
        aria-controls="activity-untriggered">
        <span class="activity-tile-icon"><i class="fas fa-ellipsis" aria-hidden="true"></i></span>
        <span class="activity-tile-value">+${untriggered.length}</span>
        <span class="activity-tile-label">${untriggeredExpanded ? "Hide" : "Not triggered yet"}</span>
      </button>
    `);
  }

  // Derived tiles - computed from the summary, no extra request.
  tiles.push(`
    <div class="activity-tile is-derived">
      <span class="activity-tile-icon"><i class="fas fa-clock-rotate-left" aria-hidden="true"></i></span>
      <span class="activity-tile-value" data-tile-last>-</span>
      <span class="activity-tile-label">Last Event</span>
    </div>
    <div class="activity-tile is-derived">
      <span class="activity-tile-icon"><i class="fas fa-sitemap" aria-hidden="true"></i></span>
      <span class="activity-tile-value" data-tile-paths>0</span>
      <span class="activity-tile-label">Distinct Paths</span>
    </div>
  `);

  // Untriggered types render into their own row, revealed by the chip.
  tiles.push(`
    <div class="activity-untriggered" id="activity-untriggered" ${untriggeredExpanded ? "" : "hidden"}>
      ${untriggered.map(typeTile).join("")}
    </div>
  `);

  grid.innerHTML = tiles.join("");

  countUp(grid.querySelector("[data-tile-total]"), total);
  byType.forEach((row) => {
    countUp(grid.querySelector(`[data-tile-count="${CSS.escape(row.event_type)}"]`), row.count || 0);
  });
  renderDerivedTiles();
  updateFilterChrome();

  // Totals arrive after the first table paint, so refresh the panels that read
  // from them: "Page 1 of N" and the Postgres row count.
  updatePagination();
  updatePipelineVisualizer({ animate: false });
}

function renderDerivedTiles() {
  const grid = document.getElementById("activity-summary-grid");
  if (!grid || !summaryState) return;

  const lastNode = grid.querySelector("[data-tile-last]");
  if (lastNode) {
    lastNode.textContent = summaryState.last_event_at ? formatRelativeTime(summaryState.last_event_at) : "-";
  }

  const pathsNode = grid.querySelector("[data-tile-paths]");
  if (pathsNode) pathsNode.textContent = String(summaryState.distinct_paths || 0);
}

function countUp(node, target) {
  if (!node) return;
  if (prefersReducedMotion || target === 0) {
    node.textContent = String(target);
    return;
  }

  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / COUNT_UP_DURATION_MS);
    // easeOutCubic
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = String(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Applies a delta to the in-memory summary and repaints the affected tiles.
 * Keeps live SSE events from costing a round trip.
 */
function incrementSummary(eventType) {
  if (!summaryState) return;
  summaryState.total_events = (summaryState.total_events || 0) + 1;
  summaryState.last_event_at = new Date().toISOString();
  if (!summaryState.first_event_at) summaryState.first_event_at = summaryState.last_event_at;

  const row = (summaryState.by_type || []).find((r) => r.event_type === eventType);
  if (row) {
    row.count = (row.count || 0) + 1;
    row.last_at = summaryState.last_event_at;
  } else {
    summaryState.by_type = [...(summaryState.by_type || []), { event_type: eventType, count: 1 }];
    renderSummaryTiles();
    return;
  }

  const grid = document.getElementById("activity-summary-grid");
  if (!grid) return;

  const total = summaryState.total_events;
  const totalNode = grid.querySelector("[data-tile-total]");
  if (totalNode) totalNode.textContent = String(total);

  (summaryState.by_type || []).forEach((r) => {
    const tile = grid.querySelector(`[data-event-type="${CSS.escape(r.event_type)}"]`);
    if (!tile) return;
    const valueNode = tile.querySelector("[data-tile-count]");
    if (valueNode) valueNode.textContent = String(r.count || 0);
    const shareNode = tile.querySelector(".activity-tile-share");
    if (shareNode) shareNode.style.width = `${total > 0 ? Math.round(((r.count || 0) / total) * 100) : 0}%`;
    if (r.count > 0) {
      tile.classList.remove("is-empty");
      tile.disabled = false;
    }
  });

  renderDerivedTiles();
}

function updateFilterChrome() {
  const clearBtn = document.getElementById("activity-filter-clear");
  if (clearBtn) clearBtn.hidden = !activeTypeFilter;

  document.querySelectorAll(".activity-tile[data-event-type]").forEach((tile) => {
    tile.setAttribute("aria-pressed", tile.dataset.eventType === activeTypeFilter ? "true" : "false");
  });
}

function applyTypeFilter(eventType) {
  activeTypeFilter = activeTypeFilter === eventType ? null : eventType;
  updateFilterChrome();
  currentOffset = 0;
  loadActivity(0, { immediate: true });
}

// ── Pipeline visualizer ──

let pipelineAnimationTimers = [];
// Rolling window of client-side event timestamps, used for a real EPS figure.
let eventTimestamps = [];
let lastApiLatencyMs = null;

function recordApiLatency(ms) {
  lastApiLatencyMs = ms;
}

function clearPipelineTimers() {
  pipelineAnimationTimers.forEach(clearTimeout);
  pipelineAnimationTimers = [];
}

function animatePipelineFlow() {
  if (prefersReducedMotion) return;

  const connectors = Array.from(document.querySelectorAll(".pipeline-connector"));
  const nodes = ["node-ingress", "node-kafka", "node-fastapi", "node-postgres"].map((id) =>
    document.getElementById(id),
  );

  clearPipelineTimers();
  connectors.forEach((c) => c.classList.remove("flowing"));
  nodes.forEach((n) => n?.classList.remove("active-pulse"));

  // Walk node -> connector -> node down the chain on a fixed cadence.
  const NODE_MS = 300;
  const CONNECTOR_MS = 500;
  let elapsed = 0;

  nodes.forEach((node, index) => {
    const pulseAt = elapsed;
    pipelineAnimationTimers.push(
      setTimeout(() => node?.classList.add("active-pulse"), pulseAt),
      setTimeout(() => node?.classList.remove("active-pulse"), pulseAt + NODE_MS),
    );
    elapsed += NODE_MS;

    const connector = connectors[index];
    if (connector) {
      const flowAt = elapsed;
      pipelineAnimationTimers.push(
        setTimeout(() => connector.classList.add("flowing"), flowAt),
        setTimeout(() => connector.classList.remove("flowing"), flowAt + CONNECTOR_MS),
      );
      elapsed += CONNECTOR_MS;
    }
  });
}

/**
 * Repaints the pipeline metrics from measured values only. Every figure here is
 * derived from real client observations or the summary endpoint - nothing is
 * synthesised, since the point of this panel is to show the real pipeline.
 */
function updatePipelineVisualizer({ animate = true } = {}) {
  if (animate) animatePipelineFlow();

  const now = Date.now();
  eventTimestamps = eventTimestamps.filter((t) => now - t <= 60000);

  const eps = eventTimestamps.length / 60;
  setText("val-ingress", `${eps.toFixed(2)} eps`);

  // The client cannot observe broker depth; report what it does know - the
  // number of events it has buffered locally in the last minute.
  setText("val-kafka", `${eventTimestamps.length} msg/min`);

  setText("val-fastapi", lastApiLatencyMs === null ? "- ms" : `${lastApiLatencyMs.toFixed(0)} ms`);

  const rows = summaryState?.total_events;
  setText("val-postgres", Number.isFinite(rows) ? `${rows} rows` : "- rows");

}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

// ── Init ──

export function initActivity() {
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  prefersReducedMotion = motionQuery.matches;
  motionQuery.addEventListener("change", (e) => {
    prefersReducedMotion = e.matches;
  });

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

      const button =
        event.target.closest(".activity-data-toggle") || event.target.closest(".activity-mobile-toggle");
      if (!button) return;

      const detailRowId = button.getAttribute("aria-controls");
      const detailRow = detailRowId ? document.getElementById(detailRowId) : null;
      if (!detailRow) return;

      const isExpanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!isExpanded));
      detailRow.hidden = isExpanded;
    });
  }

  const summaryGrid = document.getElementById("activity-summary-grid");
  if (summaryGrid) {
    summaryGrid.addEventListener("click", (event) => {
      const moreBtn = event.target.closest("#activity-tile-more");
      if (moreBtn) {
        untriggeredExpanded = !untriggeredExpanded;
        const panel = document.getElementById("activity-untriggered");
        if (panel) panel.hidden = !untriggeredExpanded;
        moreBtn.setAttribute("aria-expanded", String(untriggeredExpanded));
        const label = moreBtn.querySelector(".activity-tile-label");
        if (label) label.textContent = untriggeredExpanded ? "Hide" : "Not triggered yet";
        return;
      }

      const tile = event.target.closest(".activity-tile[data-event-type]");
      if (!tile || tile.disabled) return;
      applyTypeFilter(tile.dataset.eventType);
    });
  }

  const clearFilterBtn = document.getElementById("activity-filter-clear");
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener("click", () => {
      if (!activeTypeFilter) return;
      activeTypeFilter = null;
      updateFilterChrome();
      currentOffset = 0;
      loadActivity(0, { immediate: true });
    });
  }

  const sessionPill = document.getElementById("activity-session-pill");
  if (sessionPill) {
    sessionPill.addEventListener("click", async () => {
      const fullId = sessionPill.dataset.sessionId;
      if (!fullId) return;
      try {
        await copyText(fullId);
        sessionPill.dataset.copyState = "copied";
      } catch (error) {
        console.error("Session ID copy failed", error);
        sessionPill.dataset.copyState = "failed";
      }
      setTimeout(() => delete sessionPill.dataset.copyState, COPY_RESET_DELAY_MS);
    });
  }

  const refreshBtn = document.getElementById("activity-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      currentOffset = 0;
      loadActivity(0, { immediate: true });
      loadActivitySummary();
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
        enterActivitySection();
      } else if (!isActive && wasActive) {
        leaveActivitySection();
      }
      wasActive = isActive;
    });
    observer.observe(activitySection, { attributes: true, attributeFilter: ["class"] });

    if (wasActive) {
      enterActivitySection();
    }
  }

  // Layout switches are a pure re-render of data already in memory - crossing
  // the breakpoint must never cost a network request.
  if (resizeController) {
    resizeController.abort();
  }
  resizeController = new AbortController();

  const layoutQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
  layoutQuery.addEventListener(
    "change",
    () => {
      if (activitySection?.classList.contains("active") && loadedEvents.length) {
        renderEvents();
      }
    },
    { signal: resizeController.signal },
  );
}

async function enterActivitySection() {
  currentOffset = 0;
  activeTypeFilter = null;
  updateFilterChrome();

  // Landing straight on #activity (a shared link, a reload on the hash) races
  // session creation: without this the page renders "no active session" and
  // never retries, because nothing re-runs when the id finally lands.
  if (isApiConfigured() && !sessionStorage.getItem("rj_session_id")) {
    await ensureSession();
  }

  loadActivity(0, { immediate: true });
  loadActivitySummary();
  startActivityStream();

  if (relativeTimeTimer) clearInterval(relativeTimeTimer);
  relativeTimeTimer = setInterval(refreshRelativeTimes, RELATIVE_TIME_TICK_MS);
}

function leaveActivitySection() {
  stopActivityStream();
  clearPipelineTimers();
  if (relativeTimeTimer) {
    clearInterval(relativeTimeTimer);
    relativeTimeTimer = null;
  }
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
  updateStreamingStatus("connecting");

  activityStreamSource = new EventSource(streamUrl);

  activityStreamSource.onopen = () => {
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

  // event_id is emitted by the API broadcast; fall back to a composite key for
  // any payload that predates it so a replay still cannot double-render.
  const identity = (e) =>
    e.event_id !== undefined && e.event_id !== null
      ? `id:${e.event_id}`
      : `${e.event_type}|${e.page_path}|${e.created_at}`;

  const incomingIdentity = identity(eventData);
  if (loadedEvents.some((e) => identity(e) === incomingIdentity)) return;

  eventTimestamps.push(Date.now());
  incrementSummary(eventData.event_type);

  // Only page one shows live arrivals; deeper pages would shift under the reader.
  const matchesFilter = !activeTypeFilter || eventData.event_type === activeTypeFilter;
  if (currentOffset === 0 && matchesFilter) {
    loadedEvents.unshift(eventData);
    if (loadedEvents.length > PAGE_SIZE) {
      loadedEvents.pop();
    }
    renderEvents({ stagger: false });
  }

  updatePipelineVisualizer();
}
