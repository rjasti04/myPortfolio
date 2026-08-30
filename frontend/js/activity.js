import { API_BASE, apiFetch, ensureSession, isApiConfigured, onTelemetry } from "./analytics.js";
import { copyText, escapeHTML } from "./utils.js";
import { openModal, closeModal } from "./modal.js";
import {
  BURST_WINDOW_MS,
  drawBurstStrip,
  latencyBand,
  percentile,
  renderFunnel,
  renderLatencyMeter,
} from "./activity-charts.js";

// Constants
const PAGE_SIZE = 15;
const DEBOUNCE_DELAY_MS = 300;
const COPY_RESET_DELAY_MS = 1600;
// Mirrored by the card-mode @media block in styles.css. Below this width the
// table is hidden and cards are rendered instead.
const MOBILE_BREAKPOINT = 768;
const RELATIVE_TIME_TICK_MS = 10000;
const COUNT_UP_DURATION_MS = 600;
const DATA_PREVIEW_KEYS = 3;
// Date and Time collapsed into one "When" column.
const TABLE_COLSPAN = 4;
// Rolling reservoir of request timings behind the p50/p95/p99 meter.
const LATENCY_SAMPLE_LIMIT = 200;
const DENSITY_STORAGE_KEY = "rj_activity_density";

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
let drawerOpen = false;

// ── Formatting helpers ──

const CHIP_VALUE_MAX = 24;

function chipValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function chipValueText(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") return "{…}";
  const text = String(value);
  return text.length > CHIP_VALUE_MAX ? `${text.slice(0, CHIP_VALUE_MAX)}…` : text;
}

function chip(label, value, { type = "string", modifier = "" } = {}) {
  return `<span class="kv-chip${modifier ? ` kv-chip--${modifier}` : ""}" data-type="${escapeHTML(type)}">
    ${label ? `<b class="kv-chip-key">${escapeHTML(label)}</b>` : ""}
    <span class="kv-chip-value">${escapeHTML(value)}</span>
  </span>`;
}

/**
 * Per-event-type renderings for payloads whose shape is known.
 *
 * A scroll depth is a proportion and a theme change is a colour; rendering
 * either as `{percent: 75}` makes the reader parse JSON to recover a fact the
 * UI could simply show. Anything not listed falls through to generic chips.
 */
const CHIP_FORMATTERS = {
  scroll_depth: (data) => {
    const percent = Number(data.percent);
    if (!Number.isFinite(percent)) return null;
    return `<span class="kv-chip kv-chip--meter" data-type="number">
      <span class="kv-chip-meter" style="--chip-fill: ${Math.max(0, Math.min(100, percent))}%"></span>
      <span class="kv-chip-value">${escapeHTML(String(percent))}% scrolled</span>
    </span>`;
  },
  theme_change: (data) => {
    if (!data.theme) return null;
    return `<span class="kv-chip kv-chip--swatch" data-type="string">
      <span class="kv-chip-swatch" data-theme="${escapeHTML(String(data.theme))}"></span>
      <span class="kv-chip-value">${escapeHTML(String(data.theme))}</span>
    </span>`;
  },
  click: (data) => {
    const label = data.element_id || data.text || data.tag;
    if (!label) return null;
    const extra = data.text && data.element_id ? chip("text", chipValueText(data.text)) : "";
    return chip("", chipValueText(label), { type: "target", modifier: "target" }) + extra;
  },
  terminal_command: (data) => {
    if (!data.command) return null;
    const args = Array.isArray(data.args) ? ` ${data.args.join(" ")}` : "";
    return `<span class="kv-chip kv-chip--command" data-type="command">
      <span class="kv-chip-value">$ ${escapeHTML(`${data.command}${args}`)}</span>
    </span>`;
  },
  page_view: (data) => (data.referrer ? chip("from", chipValueText(data.referrer)) : null),
};

/**
 * Chip preview of an event payload for the collapsed table cell.
 * The panel below still shows the full pretty-printed JSON.
 */
function previewEventData(eventData, eventType) {
  if (!eventData || typeof eventData !== "object") return "";
  const keys = Object.keys(eventData);
  if (!keys.length) return chip("", "empty payload", { type: "null" });

  const formatted = CHIP_FORMATTERS[eventType]?.(eventData);
  if (formatted) return formatted;

  const shown = keys
    .slice(0, DATA_PREVIEW_KEYS)
    .map((key) => chip(key, chipValueText(eventData[key]), { type: chipValueType(eventData[key]) }))
    .join("");

  const overflow = keys.length - Math.min(keys.length, DATA_PREVIEW_KEYS);
  return shown + (overflow > 0 ? chip("", `+${overflow} more`, { type: "more", modifier: "more" }) : "");
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
    if (!activeTypeFilter && offset === 0) updateLatestEventLine();

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
  // Below the breakpoint the inline table is hidden entirely and the log lives
  // in the drawer, so the cards mount there instead.
  if (isMobileViewport()) {
    // Cards render inline by default - the log is this section's primary
    // content and should not sit behind a drawer tap on the most common
    // viewport. The drawer still hosts the type-filtered view opened from a
    // chip, and owns the render while it is open.
    const target = drawerOpen
      ? document.getElementById("activity-drawer-body")
      : document.querySelector(".activity-table-container");
    if (target) renderMobileCards(loadedEvents, target, currentOffset, stagger);
    return;
  }

  clearInlineMobileCards();
  const tbody = document.getElementById("activity-tbody");
  if (tbody) renderTableRows(loadedEvents, tbody, currentOffset, stagger);
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

  // The table and the drawer each carry their own controls; both track the one
  // shared offset, so both are written on every update.
  const prevBtns = ["activity-prev-btn", "activity-drawer-prev"].map((id) => document.getElementById(id));
  const nextBtns = ["activity-next-btn", "activity-drawer-next"].map((id) => document.getElementById(id));
  const pageInfos = ["activity-page-info", "activity-drawer-page-info"].map((id) => document.getElementById(id));

  prevBtns.forEach((btn) => {
    if (!btn) return;
    btn.disabled = currentOffset === 0;
    btn.title = currentOffset === 0 ? "No previous pages" : "Previous page";
  });
  nextBtns.forEach((btn) => {
    if (!btn) return;
    btn.disabled = atEnd;
    btn.title = atEnd ? "No more pages" : "Next page";
  });
  if (!pageInfos.some(Boolean)) return;

  const currentPage = Math.floor(currentOffset / PAGE_SIZE) + 1;
  // The summary endpoint is the only source of a true total, so "of N" only
  // appears when it is loaded and no per-type filter narrows the set.
  const total = !activeTypeFilter
    ? summaryState?.total_events
    : summaryState?.by_type?.find((row) => row.event_type === activeTypeFilter)?.count;

  let label;
  if (Number.isFinite(total) && total > 0) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    label = `Page ${currentPage} of ${totalPages} · ${total} event${total === 1 ? "" : "s"}`;
  } else {
    label = atEnd && pageCount === 0 ? `Page ${currentPage} (End)` : `Page ${currentPage}`;
  }
  pageInfos.forEach((node) => {
    if (node) node.textContent = label;
  });
}

function renderTableRows(events, tbody, offset, stagger = true) {
  const fragment = document.createDocumentFragment();

  events.forEach((e, i) => {
    const d = new Date(e.created_at);
    const timeStr = escapeHTML(d.toLocaleTimeString());
    const dateStr = escapeHTML(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    const relativeStr = escapeHTML(formatRelativeTime(e.created_at));
    const hasData = Boolean(e.event_data);
    // previewEventData returns markup (escaped internally), not text.
    const preview = hasData ? previewEventData(e.event_data, e.event_type) : "";
    const dataJson = hasData ? escapeHTML(formatEventJson(e.event_data)) : "";
    const detailRowId = `activity-data-${offset}-${i}`;

    const mainRow = document.createElement("tr");
    mainRow.dataset.eventType = e.event_type;
    const delay = rowAnimation(i, stagger);
    if (delay !== null) {
      mainRow.className = "activity-row-enter";
      mainRow.style.animationDelay = `${delay}ms`;
    }
    mainRow.innerHTML = `
      <td class="activity-when">
        <span class="activity-when-time">${timeStr}</span>
        <span class="activity-when-meta">
          <span class="activity-when-date">${dateStr}</span>
          <span class="activity-relative-time" data-created-at="${escapeHTML(e.created_at)}">${relativeStr}</span>
        </span>
      </td>
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

/** Renders the card layout into `container` - the drawer body on mobile. */
function clearInlineMobileCards() {
  document.querySelector(".activity-table-container .activity-mobile-cards")?.remove();
}

function renderMobileCards(events, container, offset, stagger = true) {
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
      const preview = hasData ? previewEventData(e.event_data, e.event_type) : "";
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
              <div class="activity-card-chips">${preview}</div>
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
  // The strip's window slides whether or not events arrive, so it has to be
  // repainted on the tick as well - otherwise a quiet minute freezes it.
  renderBurstStrip();
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

  // The hero grid starts aria-busy in the markup; without clearing it here a
  // failed summary leaves an empty region permanently announced as loading.
  const heroGrid = document.getElementById("activity-hero-grid");
  if (heroGrid) {
    heroGrid.removeAttribute("aria-busy");
    heroGrid.innerHTML = "";
    delete heroGrid.dataset.built;
  }

  grid.removeAttribute("aria-busy");
  grid.innerHTML = `<p class="activity-summary-error">${escapeHTML(message)}</p>`;
}

function renderSummaryTiles() {
  const grid = document.getElementById("activity-summary-grid");
  if (!grid || !summaryState) return;

  const total = summaryState.total_events || 0;
  renderHeroStats(total);

  const tiles = [];
  const byType = summaryState.by_type || [];
  const triggered = byType.filter((row) => (row.count || 0) > 0);
  const untriggered = byType.filter((row) => (row.count || 0) === 0);

  // Per-type counts render as chips rather than cards: eight equal-weight
  // cards spread four columns of whitespace across a desktop row, and the type
  // breakdown is secondary to the hero stats above it.
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
        <span class="activity-tile-label">${escapeHTML(meta.label)}</span>
        <span class="activity-tile-value" data-tile-count="${escapeHTML(row.event_type)}">0</span>
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

  // Untriggered types render into their own row, revealed by the chip.
  tiles.push(`
    <div class="activity-untriggered" id="activity-untriggered" ${untriggeredExpanded ? "" : "hidden"}>
      ${untriggered.map(typeTile).join("")}
    </div>
  `);

  grid.innerHTML = tiles.join("");

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

/**
 * The four headline figures, above the per-type chip bar.
 *
 * Total and Events/sec are the two the reader checks first, so they lead;
 * Session duration and Distinct paths give the run its shape. Events/sec is
 * measured client-side over the same rolling minute as the burst strip.
 */
function renderHeroStats(total) {
  const grid = document.getElementById("activity-hero-grid");
  if (!grid) return;

  const built = grid.dataset.built === "true";
  if (!built) {
    grid.innerHTML = `
      <button type="button" class="hero-stat is-total" id="activity-tile-total"
        title="View the full event log">
        <span class="hero-stat-icon"><i class="fas fa-database" aria-hidden="true"></i></span>
        <span class="hero-stat-value" data-tile-total>0</span>
        <span class="hero-stat-label">Total Events</span>
      </button>
      <div class="hero-stat">
        <span class="hero-stat-icon"><i class="fas fa-bolt" aria-hidden="true"></i></span>
        <span class="hero-stat-value" data-tile-eps>0.00</span>
        <span class="hero-stat-label">Events / sec</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-icon"><i class="fas fa-hourglass-half" aria-hidden="true"></i></span>
        <span class="hero-stat-value" data-tile-duration>-</span>
        <span class="hero-stat-label">Session Duration</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-icon"><i class="fas fa-sitemap" aria-hidden="true"></i></span>
        <span class="hero-stat-value" data-tile-paths>0</span>
        <span class="hero-stat-label">Distinct Paths</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-icon"><i class="fas fa-clock-rotate-left" aria-hidden="true"></i></span>
        <span class="hero-stat-value" data-tile-last>-</span>
        <span class="hero-stat-label">Last Event</span>
      </div>
    `;
    grid.dataset.built = "true";
  }
  grid.removeAttribute("aria-busy");

  countUp(grid.querySelector("[data-tile-total]"), total);
  renderDerivedTiles();
}

/** Compact "2m 14s" / "1h 03m" duration for the hero row. */
function formatDuration(fromIso, toIso) {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso || Date.now()).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "-";
  const seconds = Math.round((to - from) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function renderDerivedTiles() {
  const grid = document.getElementById("activity-hero-grid");
  if (!grid || !summaryState) return;

  const lastNode = grid.querySelector("[data-tile-last]");
  if (lastNode) {
    lastNode.textContent = summaryState.last_event_at ? formatRelativeTime(summaryState.last_event_at) : "-";
  }

  const pathsNode = grid.querySelector("[data-tile-paths]");
  if (pathsNode) pathsNode.textContent = String(summaryState.distinct_paths || 0);

  const durationNode = grid.querySelector("[data-tile-duration]");
  if (durationNode) {
    durationNode.textContent = summaryState.first_event_at
      ? formatDuration(summaryState.first_event_at, null)
      : "-";
  }

  const epsNode = grid.querySelector("[data-tile-eps]");
  if (epsNode) epsNode.textContent = currentEps().toFixed(2);
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
  const totalNode = document.querySelector("#activity-hero-grid [data-tile-total]");
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
  // Mobile has no inline table to filter, so the same click opens the drawer.
  // Desktop filters in place - a modal over a page with room to spare is worse.
  if (isMobileViewport()) {
    openLogDrawer(eventType);
    return;
  }

  activeTypeFilter = activeTypeFilter === eventType ? null : eventType;
  updateFilterChrome();
  currentOffset = 0;
  loadActivity(0, { immediate: true });
}

// ── Event log drawer (mobile) ──

function drawerEl() {
  return document.getElementById("activity-drawer");
}

/**
 * Opens the log drawer, optionally scoped to one event type.
 * Below the breakpoint this is the only route to the event log, so the Total
 * Events tile opens it unfiltered.
 */
function openLogDrawer(eventType = null) {
  const drawer = drawerEl();
  if (!drawer) return;

  activeTypeFilter = eventType;
  updateFilterChrome();

  const title = document.getElementById("activity-drawer-title");
  if (title) {
    title.textContent = eventType ? `${tileMeta(eventType).label} events` : "Event Log";
  }

  drawerOpen = true;
  clearInlineMobileCards();
  openModal(drawer, { initialFocus: document.getElementById("activity-drawer-close") });

  currentOffset = 0;
  loadActivity(0, { immediate: true });
}

function closeLogDrawer() {
  const drawer = drawerEl();
  if (!drawer || !drawerOpen) return;

  drawerOpen = false;
  closeModal(drawer);

  // The drawer is the filter's only UI on mobile, so closing it clears the filter.
  if (activeTypeFilter) {
    activeTypeFilter = null;
    updateFilterChrome();
    currentOffset = 0;
    loadActivity(0, { immediate: true });
  }
}

/** One-line live proof-of-life, standing in for the log on narrow screens. */
function updateLatestEventLine(event) {
  const line = document.getElementById("activity-latest");
  const body = document.getElementById("activity-latest-body");
  if (!line || !body) return;

  const source = event || loadedEvents[0];
  if (!source) {
    line.hidden = true;
    return;
  }

  line.hidden = false;
  body.textContent = `${source.event_type} · ${source.page_path || "-"} · ${formatRelativeTime(source.created_at)}`;
  body.dataset.createdAt = source.created_at || "";
}

// ── Pipeline visualizer ──

let pipelineAnimationTimers = [];
// Rolling window of client-observed events, used for a real EPS figure and to
// bucket the burst strip. Typed so the strip can break bars down per type.
let eventSamples = [];
// Reservoir of request timings for the p50/p95/p99 meter.
let latencySamples = [];
// Tracked separately from eventSamples: that list is pruned to the rolling
// window, so it can never report a gap longer than the window itself.
let lastEventAt = null;
let lastApiLatencyMs = null;
let lastServerMs = null;
// Most recent per-stage health pushed by the API on the `pipeline` channel.
let pipelineHealth = null;
let surgeTimer = null;

function recordApiLatency(ms, serverMs = null) {
  lastApiLatencyMs = ms;
  if (serverMs !== null) lastServerMs = serverMs;
  latencySamples.push(ms);
  if (latencySamples.length > LATENCY_SAMPLE_LIMIT) {
    latencySamples = latencySamples.slice(-LATENCY_SAMPLE_LIMIT);
  }
}

function clearPipelineTimers() {
  pipelineAnimationTimers.forEach(clearTimeout);
  pipelineAnimationTimers = [];
  if (surgeTimer) {
    clearTimeout(surgeTimer);
    surgeTimer = null;
  }
}

/** Events per second over the trailing minute, from client observations. */
function currentEps() {
  const now = Date.now();
  eventSamples = eventSamples.filter((sample) => now - sample.t <= BURST_WINDOW_MS);
  return eventSamples.length / (BURST_WINDOW_MS / 1000);
}

/**
 * Binds packet speed to the measured event rate.
 *
 * The previous behaviour restarted a fixed 3.2s node-to-node walk on every
 * arriving event, so a burst of ten restarted the same animation ten times in
 * one tick and only the last was ever seen. Here the connectors flow
 * continuously and the rate itself is the signal; a discrete arrival only adds
 * a brief surge highlight on top.
 */
function applyFlowRate(eps) {
  const flow = document.querySelector(".pipeline-flow");
  if (!flow) return;

  if (prefersReducedMotion || eps <= 0) {
    flow.classList.toggle("is-idle", true);
    return;
  }

  // One packet period per event, clamped so a single event is still visible
  // and a burst does not blur into a solid line.
  const period = Math.min(2, Math.max(0.15, 2.5 / eps));
  flow.style.setProperty("--pipe-packet-speed", `${period.toFixed(2)}s`);
  flow.classList.remove("is-idle");
  document.querySelectorAll(".pipeline-connector").forEach((c) => c.classList.add("flowing"));
}

/** Brief highlight when a discrete event lands. */
function pulseSurge() {
  if (prefersReducedMotion) return;
  const flow = document.querySelector(".pipeline-flow");
  if (!flow) return;
  flow.classList.add("is-surging");
  if (surgeTimer) clearTimeout(surgeTimer);
  surgeTimer = setTimeout(() => flow.classList.remove("is-surging"), 420);
}

/** Client-side health for stages the server does not report on. */
function clientHealth(eps) {
  const sinceLast = lastEventAt === null ? Infinity : Date.now() - lastEventAt;

  // No event yet is "idle", not "error" - a quiet session has not failed.
  let ingress = "idle";
  if (lastEventAt !== null) {
    if (eps > 0 && sinceLast < 30000) ingress = "ok";
    else if (sinceLast < 120000) ingress = "warn";
    else ingress = "error";
  }

  return { ingress, fastapi: latencyBand(percentile(latencySamples, 0.95)) };
}

function setNodeHealth(nodeId, health, badge) {
  const node = document.getElementById(nodeId);
  if (!node) return;
  node.dataset.health = health;

  const badgeNode = node.querySelector(".node-badge");
  if (!badgeNode) return;
  if (badge) {
    badgeNode.textContent = badge;
    badgeNode.hidden = false;
  } else {
    badgeNode.hidden = true;
  }
}

/**
 * Repaints the pipeline metrics from measured values only. Every figure here is
 * derived from real client observations, the summary endpoint, or the server's
 * own pipeline snapshot - nothing is synthesised, since the point of this panel
 * is to show the real pipeline.
 */
function updatePipelineVisualizer({ animate = true, surge = false } = {}) {
  const eps = currentEps();
  if (animate) applyFlowRate(eps);
  if (surge) pulseSurge();

  const health = clientHealth(eps);
  const stages = pipelineHealth?.stages;

  setText("val-ingress", `${eps.toFixed(2)} eps`);
  setNodeHealth("node-ingress", health.ingress, eps > 0 ? `${eventSamples.length}/min` : null);

  // The client cannot observe broker depth, so the Kafka stage reports what the
  // server says about itself. With no broker in the path it reads "Bypassed"
  // rather than a fabricated queue depth - an honest disabled stage is more
  // informative than an invented number.
  const kafka = stages?.kafka;
  if (kafka) {
    const mode = kafka.mode || "bypass";
    if (mode === "bypass") {
      setText("val-kafka", "Bypassed");
      setNodeHealth("node-kafka", "bypass", "direct to API");
    } else {
      setText("val-kafka", `${kafka.messages ?? 0} msg`);
      setNodeHealth(
        "node-kafka",
        kafka.health || "ok",
        kafka.lag === null || kafka.lag === undefined ? mode : `lag ${kafka.lag}`,
      );
    }
  } else {
    setText("val-kafka", "-");
    setNodeHealth("node-kafka", "idle", null);
  }

  setText("val-fastapi", lastApiLatencyMs === null ? "- ms" : `${lastApiLatencyMs.toFixed(0)} ms`);
  setNodeHealth(
    "node-fastapi",
    health.fastapi,
    lastServerMs === null ? null : `srv ${lastServerMs.toFixed(0)}ms`,
  );

  const pg = stages?.postgres;
  const rows = summaryState?.total_events;
  setText("val-postgres", Number.isFinite(rows) ? `${rows} rows` : "- rows");
  setNodeHealth(
    "node-postgres",
    pg?.health || (Number.isFinite(rows) ? "ok" : "idle"),
    pg?.last_flush_ms ? `flush ${pg.last_flush_ms}ms` : null,
  );

  renderBurstStrip();
  renderLatencyMeter(document.getElementById("latency-meter"), latencySamples);
}

export async function loadActivityFunnel() {
  const root = document.getElementById("activity-funnel");
  if (!root) return;

  const sessionId = sessionStorage.getItem("rj_session_id");
  if (!sessionId || !isApiConfigured()) return;

  try {
    const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/events/funnel`);
    if (!response.ok) return;
    renderFunnel(root, await response.json(), { escapeHTML });
  } catch (error) {
    console.warn("Activity funnel load failed", error);
  }
}

function renderBurstStrip() {
  const canvas = document.getElementById("activity-burst");
  if (!canvas) return;
  const result = drawBurstStrip(canvas, eventSamples, { reducedMotion: prefersReducedMotion });
  const peakNode = document.getElementById("burst-peak");
  if (peakNode && result) peakNode.textContent = `peak ${result.peak}/s`;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

// ── Density ──

function applyDensity(density) {
  const section = document.getElementById("activity");
  if (section) section.dataset.density = density;
  document.querySelectorAll(".activity-density-btn").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.density === density));
  });
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch (e) {
    // A blocked localStorage costs the preference, not the feature.
  }
}

function storedDensity() {
  try {
    const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
    return stored === "compact" ? "compact" : "comfortable";
  } catch (e) {
    return "comfortable";
  }
}

// ── Init ──

export function initActivity() {
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  prefersReducedMotion = motionQuery.matches;
  motionQuery.addEventListener("change", (e) => {
    prefersReducedMotion = e.matches;
  });

  applyDensity(storedDensity());
  document.querySelectorAll(".activity-density-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyDensity(btn.dataset.density));
  });

  // Every analytics flush is also a latency sample, which is what lets the
  // meter reflect real traffic rather than only the dashboard's own fetches.
  onTelemetry((sample) => {
    if (!sample.ok) return;
    recordApiLatency(sample.roundTripMs, sample.serverMs);
    if (document.getElementById("activity")?.classList.contains("active")) {
      updatePipelineVisualizer({ animate: false });
    }
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

      if (event.target.closest("#activity-tile-total")) {
        if (isMobileViewport()) {
          openLogDrawer(null);
        } else if (activeTypeFilter) {
          activeTypeFilter = null;
          updateFilterChrome();
          currentOffset = 0;
          loadActivity(0, { immediate: true });
        }
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

  const drawer = document.getElementById("activity-drawer");
  if (drawer) {
    // The drawer body hosts the same card markup as the table container, so it
    // needs the same copy / expand delegation.
    drawer.addEventListener("click", async (event) => {
      if (event.target === drawer) {
        closeLogDrawer();
        return;
      }
      if (event.target.closest("#activity-drawer-close")) {
        closeLogDrawer();
        return;
      }

      const copyButton = event.target.closest(".activity-copy-json");
      if (copyButton) {
        const jsonBlock = copyButton.closest(".activity-data-panel")?.querySelector(".activity-data-pre");
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

      const toggle = event.target.closest(".activity-mobile-toggle");
      if (!toggle) return;
      const panelId = toggle.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel) return;
      const isExpanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!isExpanded));
      panel.hidden = isExpanded;
    });
  }

  const latestLine = document.getElementById("activity-latest");
  if (latestLine) {
    latestLine.addEventListener("click", () => openLogDrawer(null));
  }

  document.getElementById("activity-drawer-prev")?.addEventListener("click", () => {
    if (currentOffset >= PAGE_SIZE) loadActivity(currentOffset - PAGE_SIZE);
  });
  document.getElementById("activity-drawer-next")?.addEventListener("click", () => {
    loadActivity(currentOffset + PAGE_SIZE);
  });

  const refreshBtn = document.getElementById("activity-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      currentOffset = 0;
      loadActivity(0, { immediate: true });
      loadActivitySummary();
      loadActivityFunnel();
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

  window.addEventListener(
    "resize",
    () => {
      if (!document.getElementById("activity")?.classList.contains("active")) return;
      renderBurstStrip();
    },
    { signal: resizeController.signal, passive: true },
  );

  const layoutQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
  layoutQuery.addEventListener(
    "change",
    () => {
      if (!activitySection?.classList.contains("active")) return;
      // Growing past the breakpoint reveals the inline table, which would leave
      // the drawer stranded on top of it.
      if (drawerOpen && !isMobileViewport()) {
        closeLogDrawer();
      }
      // Falls through deliberately: the newly revealed layout still has to be
      // painted, or growing past the breakpoint leaves an empty table behind.
      if (loadedEvents.length) renderEvents();
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
  loadActivityFunnel();
  startActivityStream();

  if (relativeTimeTimer) clearInterval(relativeTimeTimer);
  relativeTimeTimer = setInterval(refreshRelativeTimes, RELATIVE_TIME_TICK_MS);
}

function leaveActivitySection() {
  closeLogDrawer();
  stopActivityStream();
  clearPipelineTimers();
  pipelineHealth = null;
  lastEventAt = null;
  eventSamples = [];
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

  const parse = (event, handler) => {
    try {
      handler(JSON.parse(event.data));
    } catch (err) {
      console.error("Error parsing activity stream data:", err);
    }
  };

  // Named channels. The API also emits an unnamed frame per activity event so
  // a client still on `onmessage` keeps working across the deploy; both are
  // normalised to the same shape and deduplicated by event_id below, so
  // receiving both costs nothing.
  activityStreamSource.addEventListener("activity", (event) =>
    parse(event, (data) => handleIncomingStreamEvent(normalizeStreamEvent(data))),
  );

  activityStreamSource.addEventListener("pipeline", (event) =>
    parse(event, (snapshot) => {
      pipelineHealth = snapshot;
      updatePipelineVisualizer({ animate: true });
    }),
  );

  activityStreamSource.addEventListener("hello", (event) =>
    parse(event, (data) => {
      if (data.pipeline) pipelineHealth = data.pipeline;
      updatePipelineVisualizer({ animate: true });
    }),
  );

  activityStreamSource.onmessage = (event) => {
    parse(event, (data) => handleIncomingStreamEvent(normalizeStreamEvent(data)));
  };

  activityStreamSource.onerror = (err) => {
    console.warn("Activity stream connection lost, reconnecting...", err);
    updateStreamingStatus("connecting");
  };
}

/**
 * Accepts either stream shape and returns the verbose one.
 *
 * The `activity` channel carries a compact frame - `{i,t,e,p,d}` - which drops
 * the session_id already implied by the stream and sends epoch millis instead
 * of an ISO string. The unnamed back-compat frame is the verbose shape.
 */
function normalizeStreamEvent(data) {
  if (data && data.event_type !== undefined) return data;
  return {
    event_id: data.i,
    session_id: sessionStorage.getItem("rj_session_id"),
    event_type: data.e,
    page_path: data.p,
    event_data: data.d,
    created_at: new Date(data.t).toISOString(),
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

  lastEventAt = Date.now();
  eventSamples.push({ t: lastEventAt, type: eventData.event_type });
  incrementSummary(eventData.event_type);
  updateLatestEventLine(eventData);

  // Only page one shows live arrivals; deeper pages would shift under the reader.
  const matchesFilter = !activeTypeFilter || eventData.event_type === activeTypeFilter;
  if (currentOffset === 0 && matchesFilter) {
    loadedEvents.unshift(eventData);
    if (loadedEvents.length > PAGE_SIZE) {
      loadedEvents.pop();
    }
    renderEvents({ stagger: false });
  }

  updatePipelineVisualizer({ surge: true });
}
