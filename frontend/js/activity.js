/**
 * The Session Activity dashboard.
 *
 * The section answers one question for the reader: what has this site recorded
 * about my visit? Everything here is ordered by that question - the shape of
 * the visit first, then the events themselves - rather than by the shape of
 * the pipeline that produced the data.
 *
 * The whole session is fetched once (the API caps a page at 500 events, which
 * is far beyond any real browsing session) and held in memory. Every filter -
 * search, family, time slice, path - is therefore local and instant, and the
 * session strip has the complete series it needs to draw a shape.
 */

import { API_BASE, apiFetch, ensureSession, isApiConfigured, onTelemetry } from "./analytics.js";
import { copyText, escapeHTML } from "./utils.js";
import {
  TIMELINE_BUCKETS,
  bucketSession,
  latencyBand,
  moveTimelineFocus,
  percentile,
  renderPaths,
  renderTimeline,
} from "./activity-charts.js";

// One request covers the session: 500 is the API's own page ceiling.
const SESSION_FETCH_LIMIT = 500;
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 140;
const COPY_RESET_DELAY_MS = 1600;
const CLOCK_TICK_MS = 15000;
// Rolling reservoir of request timings behind the chain's latency figure.
const LATENCY_SAMPLE_LIMIT = 200;
// Floor on the strip's span. Without it a session seconds old draws its whole
// history into bucket 0 and leaves 47 empty ones, which reads as one spike a
// long time ago rather than as a visit that has only just started.
const MIN_TIMELINE_SPAN_MS = 5 * 60 * 1000;

/**
 * Seven event types, four families.
 *
 * Four hues are learnable at a glance; seven are a legend. The grouping is the
 * one a reader would make unprompted - moving through the site, acting on it,
 * setting a preference, getting in touch - which is the test for whether an
 * abstraction is real rather than convenient.
 */
const EVENT_FAMILY = {
  page_view: "nav",
  scroll_depth: "nav",
  click: "tap",
  terminal_command: "tap",
  theme_change: "pref",
  copy_email: "reach",
  contact_submission: "reach",
};

const FAMILY_META = {
  nav: { label: "Navigation", icon: "fa-compass" },
  tap: { label: "Interaction", icon: "fa-hand-pointer" },
  pref: { label: "Preference", icon: "fa-sliders" },
  reach: { label: "Contact", icon: "fa-paper-plane" },
};
const FAMILY_IDS = Object.keys(FAMILY_META);

function familyOf(eventType) {
  return EVENT_FAMILY[eventType] || "nav";
}

// ── State ──

let sessionEvents = [];
let summaryState = null;
let funnelState = null;
let visibleCount = PAGE_SIZE;
let truncated = false;
let loadState = "idle"; // idle | loading | ready | error
let loadMessage = "";
let loadDetail = "";

const filters = { query: "", families: new Set(), bucket: null, path: null };
const expandedRows = new Set();

let searchDebounce = null;
let clockTimer = null;
let prefersReducedMotion = false;
let activityStreamSource = null;
let latencySamples = [];
let lastApiLatencyMs = null;
let lastServerMs = null;
let lastEventAt = null;
let pipelineHealth = null;
let liveArrivals = 0;
// Set for exactly one repaint, so only a genuinely new row animates in.
let arrivingIdentity = null;

// ── Formatting ──

function eventTime(event) {
  return new Date(event.created_at).getTime();
}

function clockLabel(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Compact "2m 14s" / "1h 03m" duration. */
function formatDuration(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return "-";
  const seconds = Math.round((toMs - fromMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatRelativeTime(ms) {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Compact count so a large figure cannot stretch a fixed-width slot. */
function formatCount(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}

function code(value) {
  return `<code class="act-ev-code">${escapeHTML(value)}</code>`;
}

/** Bare host, so a referrer reads as a place rather than a URL. */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    return null;
  }
}

const CLICK_TAGS = { A: "a link", BUTTON: "a button", INPUT: "a field" };

/**
 * One sentence per event, plus an optional aside.
 *
 * Every branch reads from the payload the client actually sends (see the
 * `trackEvent` calls across the frontend), so nothing here invents a field.
 * The raw JSON stays one keystroke away on the row itself.
 */
function describeEvent(event) {
  const data = event.event_data && typeof event.event_data === "object" ? event.event_data : {};
  const path = event.page_path ? code(event.page_path) : "the page";

  switch (event.event_type) {
    case "page_view": {
      if (data.is_reload) return { text: `Reloaded ${path}` };
      if (data.hash !== undefined) return { text: `Moved to ${path}` };
      const host = data.referrer ? hostOf(data.referrer) : null;
      return { text: `Arrived on ${path}`, aside: host ? `via ${host}` : "direct" };
    }
    case "scroll_depth": {
      const percent = Number(data.percent);
      return Number.isFinite(percent)
        ? { text: `Read <b>${percent}%</b> of ${path}` }
        : { text: `Scrolled ${path}` };
    }
    case "click": {
      const what = CLICK_TAGS[data.tag] || (data.tag ? `a ${String(data.tag).toLowerCase()}` : "something");
      const origin = data.link_origin ? hostOf(data.link_origin) : null;
      const offsite = origin && origin !== hostOf(window.location.origin);
      return { text: `Clicked ${what} on ${path}`, aside: offsite ? `→ ${origin}` : "" };
    }
    case "terminal_command": {
      const args = Array.isArray(data.args) && data.args.length ? ` ${data.args.join(" ")}` : "";
      return data.command
        ? { text: `Ran ${code(`${data.command}${args}`)} in the terminal` }
        : { text: "Used the terminal" };
    }
    case "theme_change":
      return data.theme
        ? { text: `Switched to the <b>${escapeHTML(data.theme)}</b> theme` }
        : { text: "Changed the theme" };
    case "copy_email":
      return data.success === false
        ? { text: "Tried to copy the email address", aside: "copy blocked" }
        : { text: "Copied the email address" };
    case "contact_submission":
      if (data.success === false) {
        return { text: "Started the contact form", aside: data.native_fallback ? "opened mail app" : "not sent" };
      }
      return { text: "Sent the contact form" };
    default:
      return { text: `${escapeHTML(String(event.event_type).replace(/_/g, " "))} on ${path}` };
  }
}

/** Stable identity for dedupe and for expand state across repaints. */
function identityOf(event) {
  return event.event_id !== undefined && event.event_id !== null
    ? `id:${event.event_id}`
    : `${event.event_type}|${event.page_path}|${event.created_at}`;
}

// ── Session window ──

/**
 * The span the strip covers: the first event the session knows about, to now.
 * The summary is authoritative because it sees rows this client may have
 * paged past; the loaded set is the fallback before it lands.
 */
function sessionWindow() {
  const summaryStart = summaryState?.first_event_at
    ? new Date(summaryState.first_event_at).getTime()
    : NaN;
  const oldestLoaded = sessionEvents.length ? eventTime(sessionEvents[sessionEvents.length - 1]) : NaN;

  const to = Date.now();
  const candidates = [summaryStart, oldestLoaded].filter(Number.isFinite);
  const earliest = candidates.length ? Math.min(...candidates) : to;
  return { from: Math.min(earliest, to - MIN_TIMELINE_SPAN_MS), to };
}

function bucketIndexOf(ms) {
  const { from, to } = sessionWindow();
  const span = to - from;
  if (span <= 0) return 0;
  return Math.min(TIMELINE_BUCKETS - 1, Math.max(0, Math.floor(((ms - from) / span) * TIMELINE_BUCKETS)));
}

// ── Filtering ──

function matchesFilters(event) {
  if (filters.families.size && !filters.families.has(familyOf(event.event_type))) return false;
  if (filters.path && event.page_path !== filters.path) return false;
  if (filters.bucket !== null && bucketIndexOf(eventTime(event)) !== filters.bucket) return false;

  if (filters.query) {
    const haystack = [
      event.event_type.replace(/_/g, " "),
      event.page_path || "",
      describeEvent(event).text.replace(/<[^>]+>/g, ""),
      event.event_data ? JSON.stringify(event.event_data) : "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(filters.query.toLowerCase())) return false;
  }
  return true;
}

function filteredEvents() {
  return sessionEvents.filter(matchesFilters);
}

function hasActiveFilter() {
  return Boolean(filters.query || filters.families.size || filters.path || filters.bucket !== null);
}

function clearFilters() {
  filters.query = "";
  filters.families.clear();
  filters.path = null;
  filters.bucket = null;
  visibleCount = PAGE_SIZE;
  const input = document.getElementById("act-search-input");
  if (input) input.value = "";
}

// ── Data loading ──

function setBusy(isBusy) {
  const refreshBtn = document.getElementById("activity-refresh-btn");
  if (!refreshBtn) return;
  refreshBtn.disabled = isBusy;
  const icon = refreshBtn.querySelector("i");
  if (icon) icon.className = isBusy ? "fas fa-circle-notch fa-spin" : "fas fa-sync-alt";
}

function currentSessionId() {
  try {
    return sessionStorage.getItem("rj_session_id");
  } catch (error) {
    return null;
  }
}

function paintSessionPill(sessionId) {
  const value = document.getElementById("current-session-id");
  const pill = document.getElementById("activity-session-pill");
  if (value) value.textContent = sessionId || "None";
  if (pill) {
    pill.dataset.sessionId = sessionId || "";
    pill.disabled = !sessionId;
    if (sessionId) pill.title = "Click to copy this session ID";
  }
}

export async function loadActivity() {
  const sessionId = currentSessionId();
  paintSessionPill(sessionId);

  if (!isApiConfigured()) {
    loadState = "error";
    loadMessage = "The activity API is not configured.";
    loadDetail = "Nothing is being recorded, so there is nothing to show yet.";
    render();
    return;
  }
  if (!sessionId) {
    loadState = "error";
    loadMessage = "No session yet.";
    loadDetail = "Your events appear here as soon as one starts.";
    render();
    return;
  }

  loadState = sessionEvents.length ? "ready" : "loading";
  setBusy(true);
  render();

  const startedAt = performance.now();
  try {
    const params = new URLSearchParams({ limit: String(SESSION_FETCH_LIMIT), offset: "0" });
    const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/events?${params}`);
    recordApiLatency(performance.now() - startedAt);

    if (!response.ok) {
      loadState = "error";
      loadDetail =
        response.status === 404
          ? "Reload the page to start a fresh session."
          : "Refresh to try again - your events keep recording either way.";
      loadMessage =
        response.status === 404
          ? "This session has expired, so its events are no longer available."
          : `Could not load your events. The API replied ${response.status}.`;
      render();
      return;
    }

    const events = await response.json();
    sessionEvents = Array.isArray(events) ? events : [];
    truncated = sessionEvents.length >= SESSION_FETCH_LIMIT;
    loadState = "ready";
    loadMessage = "";
    loadDetail = "";
    render();
  } catch (error) {
    console.error("Activity load error", error);
    loadState = "error";
    loadMessage = "Could not reach the activity API.";
    loadDetail = "Check your connection, then use Refresh - your events keep recording either way.";
    render();
  } finally {
    setBusy(false);
  }
}

export async function loadActivitySummary() {
  const sessionId = currentSessionId();
  if (!sessionId || !isApiConfigured()) return;

  try {
    const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/events/summary`);
    if (!response.ok) return;
    summaryState = await response.json();
    render();
  } catch (error) {
    console.warn("Activity summary load failed", error);
  }
}

export async function loadActivityFunnel() {
  const sessionId = currentSessionId();
  if (!sessionId || !isApiConfigured()) return;

  try {
    const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/events/funnel`);
    if (!response.ok) return;
    funnelState = await response.json();
    paintPaths();
  } catch (error) {
    console.warn("Activity funnel load failed", error);
  }
}

// ── Painting ──

function paintHeadline() {
  const total = summaryState?.total_events ?? sessionEvents.length;
  const { from } = sessionWindow();
  const started = summaryState?.first_event_at
    ? new Date(summaryState.first_event_at).getTime()
    : sessionEvents.length
      ? from
      : NaN;
  const paths = summaryState?.distinct_paths ?? new Set(sessionEvents.map((e) => e.page_path)).size;

  setText("act-stat-total", formatCount(total));
  setText("act-stat-duration", Number.isFinite(started) ? formatDuration(started, Date.now()) : "-");
  setText("act-stat-paths", String(paths || 0));

  const grid = document.getElementById("act-stats");
  if (grid) grid.removeAttribute("aria-busy");
}

function paintTimeline() {
  const root = document.getElementById("act-timeline");
  if (!root) return;

  const { from, to } = sessionWindow();
  const samples = sessionEvents.map((event) => ({
    t: eventTime(event),
    fam: familyOf(event.event_type),
  }));
  const buckets = bucketSession(samples, from, to);
  const width = (to - from) / TIMELINE_BUCKETS;

  renderTimeline(root, buckets, {
    selected: filters.bucket,
    label: (index, bucket) =>
      `${bucket.total} ${bucket.total === 1 ? "event" : "events"} around ${clockLabel(from + index * width)}`,
  });

  setText("act-tl-from", `${formatDuration(from, to)} ago`);
  root.dataset.empty = sessionEvents.length ? "false" : "true";
}

function paintFamilies() {
  const root = document.getElementById("act-families");
  if (!root) return;

  const counts = { nav: 0, tap: 0, pref: 0, reach: 0 };
  sessionEvents.forEach((event) => {
    counts[familyOf(event.event_type)] += 1;
  });

  const chips = [
    `<button type="button" class="act-fam act-fam-all" data-family=""
       aria-pressed="${filters.families.size === 0}">All
       <span class="act-fam-count">${formatCount(sessionEvents.length)}</span></button>`,
  ];

  FAMILY_IDS.forEach((family) => {
    const meta = FAMILY_META[family];
    const count = counts[family];
    chips.push(`
      <button type="button" class="act-fam" data-family="${family}"
        aria-pressed="${filters.families.has(family)}"
        ${count === 0 ? "disabled" : ""}
        title="${meta.label}: ${count} of ${sessionEvents.length} events">
        <i class="fas ${meta.icon}" aria-hidden="true"></i>
        ${meta.label}
        <span class="act-fam-count">${formatCount(count)}</span>
      </button>
    `);
  });

  root.innerHTML = chips.join("");
}

function paintPaths() {
  const root = document.getElementById("activity-funnel");
  if (!root) return;
  renderPaths(root, funnelState, { escapeHTML, selected: filters.path });
}

function paintActiveFilters() {
  const root = document.getElementById("act-active-filters");
  if (!root) return;

  if (!hasActiveFilter()) {
    root.innerHTML = "";
    return;
  }

  const bits = [];
  if (filters.query) bits.push(`matching <b>${escapeHTML(filters.query)}</b>`);
  filters.families.forEach((family) => bits.push(`<b>${FAMILY_META[family].label}</b>`));
  if (filters.path) bits.push(`on <b>${escapeHTML(filters.path)}</b>`);
  if (filters.bucket !== null) {
    const { from, to } = sessionWindow();
    const width = (to - from) / TIMELINE_BUCKETS;
    bits.push(`around <b>${clockLabel(from + filters.bucket * width)}</b>`);
  }

  root.innerHTML = `
    <div class="act-active">
      <i class="fas fa-filter" aria-hidden="true"></i>
      <span>Showing events ${bits.join(", ")}</span>
      <button type="button" class="act-active-clear" id="act-clear-filters">Clear all</button>
    </div>
  `;
}

const TIME_GROUPS = [
  { max: 2, label: "Just now" },
  { max: 10, label: "Last 10 minutes" },
  { max: 60, label: "Earlier this visit" },
  { max: Infinity, label: "Start of the visit" },
];

function groupLabel(ms) {
  const minutes = (Date.now() - ms) / 60000;
  return TIME_GROUPS.find((group) => minutes < group.max).label;
}

function eventRow(event, index) {
  const identity = identityOf(event);
  const at = eventTime(event);
  const { text, aside } = describeEvent(event);
  const family = familyOf(event.event_type);
  const hasData = Boolean(event.event_data) && Object.keys(event.event_data || {}).length > 0;
  const panelId = `act-json-${index}`;
  const open = expandedRows.has(identity);

  const arriving = identity === arrivingIdentity && !prefersReducedMotion;

  return `
    <li class="act-ev${arriving ? " act-ev-arriving" : ""}" data-fam="${family}" data-identity="${escapeHTML(identity)}">
      <span class="act-ev-time"><time datetime="${escapeHTML(event.created_at)}">${clockLabel(at)}</time></span>
      <span class="act-ev-rail" aria-hidden="true"><span class="act-ev-dot"></span></span>
      <span class="act-ev-say">
        <span class="act-ev-text">${text}</span>
        <span class="act-ev-side">
          ${aside ? `<span class="act-ev-aside">${escapeHTML(aside)}</span>` : ""}
          <span class="act-ev-ago" data-at="${at}">${formatRelativeTime(at)}</span>
          ${
            hasData
              ? `<button type="button" class="act-ev-json" aria-expanded="${open}" aria-controls="${panelId}"
                   aria-label="Show the raw data for this event">{&nbsp;}</button>`
              : ""
          }
        </span>
      </span>
      ${
        hasData
          ? `<div class="act-ev-panel" id="${panelId}" ${open ? "" : "hidden"}>
               <div class="act-ev-panel-head">
                 <span class="act-ev-panel-label">${escapeHTML(event.event_type)}</span>
                 <button type="button" class="act-copy-json" aria-label="Copy this event as JSON">
                   <i class="fas fa-copy" aria-hidden="true"></i><span class="act-copy-label">Copy</span>
                 </button>
               </div>
               <pre class="act-ev-pre">${escapeHTML(JSON.stringify(event.event_data, null, 2))}</pre>
             </div>`
          : ""
      }
    </li>
  `;
}

function skeletonRows() {
  return Array.from({ length: 6 })
    .map(
      () => `
      <li class="act-ev act-ev-skeleton" aria-hidden="true">
        <span class="act-ev-time"><span class="skeleton skeleton-text"></span></span>
        <span class="act-ev-rail"><span class="act-ev-dot"></span></span>
        <span class="act-ev-say"><span class="skeleton skeleton-text"></span></span>
      </li>`,
    )
    .join("");
}

function paintStream() {
  const list = document.getElementById("act-stream");
  const status = document.getElementById("act-stream-status");
  const moreBtn = document.getElementById("act-show-more");
  if (!list) return;

  if (loadState === "loading") {
    list.innerHTML = skeletonRows();
    list.dataset.state = "loading";
    if (status) status.textContent = "Loading your events…";
    if (moreBtn) moreBtn.hidden = true;
    return;
  }

  if (loadState === "error") {
    list.dataset.state = "error";
    list.innerHTML = `
      <li class="act-empty">
        <b>${escapeHTML(loadMessage)}</b>
        <span>${escapeHTML(loadDetail)}</span>
      </li>`;
    if (status) status.textContent = "";
    if (moreBtn) moreBtn.hidden = true;
    return;
  }

  const matching = filteredEvents();
  const shown = matching.slice(0, visibleCount);
  list.dataset.state = "ready";

  if (!shown.length) {
    list.innerHTML = hasActiveFilter()
      ? `<li class="act-empty"><b>No events match those filters</b>
           <span>Try clearing the search, or picking a different family.</span></li>`
      : `<li class="act-empty"><b>Nothing recorded yet</b>
           <span>Move around the site and your events will appear here within a few seconds.</span></li>`;
  } else {
    let lastGroup = null;
    list.innerHTML = shown
      .map((event, index) => {
        const group = groupLabel(eventTime(event));
        const header =
          group === lastGroup
            ? ""
            : `<li class="act-group" role="presentation">${group}</li>`;
        lastGroup = group;
        return header + eventRow(event, index);
      })
      .join("");
  }

  if (status) {
    const scope = hasActiveFilter() ? "matching" : "recorded";
    status.textContent = matching.length
      ? `Showing ${shown.length} of ${matching.length} ${scope} event${matching.length === 1 ? "" : "s"}` +
        (truncated && !hasActiveFilter() ? ` (most recent ${SESSION_FETCH_LIMIT})` : "")
      : "";
  }
  if (moreBtn) {
    moreBtn.hidden = shown.length >= matching.length;
    moreBtn.textContent = `Show ${Math.min(PAGE_SIZE, matching.length - shown.length)} more`;
  }

  // One paint per arrival: without this every later repaint - a filter change,
  // a clock tick - would replay the entrance on the same row.
  arrivingIdentity = null;
}

/**
 * Identifies the focused control by its data, not by node reference.
 *
 * Every paint replaces innerHTML, so a live event arriving mid-interaction
 * would otherwise destroy the focused element and drop the reader back to the
 * top of the document - which is exactly when a keyboard user is least able to
 * recover their place.
 */
const FOCUS_SCOPES = [
  ["#act-timeline", "bucket"],
  ["#act-families", "family"],
  ["#activity-funnel", "path"],
];

function focusKey(element) {
  if (!element || typeof element.closest !== "function") return null;
  for (const [scope, key] of FOCUS_SCOPES) {
    const owner = element.closest(`${scope} [data-${key}]`);
    if (owner) return { scope, key, value: owner.dataset[key] };
  }
  return null;
}

function restoreFocus(mark) {
  if (!mark) return;
  const candidates = [...document.querySelectorAll(`${mark.scope} [data-${mark.key}]`)];
  const match = candidates.find((node) => node.dataset[mark.key] === mark.value && !node.disabled);
  // A bucket can empty out between paints; fall back to whatever now holds the
  // strip's tab stop rather than dropping focus to the body.
  const target = match || candidates.find((node) => node.tabIndex === 0);
  if (!target || target === document.activeElement) return;
  // preventScroll matters: a live event repaints roughly every few seconds, and
  // a scrolling focus call would yank the viewport back to the strip each time
  // the reader had scrolled down into the log.
  target.focus({ preventScroll: true });
}

function render() {
  const mark = focusKey(document.activeElement);
  paintHeadline();
  paintTimeline();
  paintFamilies();
  paintActiveFilters();
  paintStream();
  paintChain();
  restoreFocus(mark);
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

// ── Pipeline chain ──

function recordApiLatency(ms, serverMs = null) {
  lastApiLatencyMs = ms;
  if (serverMs !== null) lastServerMs = serverMs;
  latencySamples.push(ms);
  if (latencySamples.length > LATENCY_SAMPLE_LIMIT) {
    latencySamples = latencySamples.slice(-LATENCY_SAMPLE_LIMIT);
  }
}

function setStage(id, health, detail) {
  const node = document.getElementById(id);
  if (!node) return;
  node.dataset.health = health;
  if (detail) node.title = detail;
}

/**
 * Repaints the four-stage chain from measured values only.
 *
 * Every figure is a real client observation, a server pipeline snapshot, or a
 * summary aggregate - nothing is synthesised. A stage the server has not
 * reported on reads "no data", which is a state; the previous bare dash read
 * as a broken pipeline.
 */
function paintChain() {
  const sinceLast = lastEventAt === null ? Infinity : Date.now() - lastEventAt;
  const ingress = lastEventAt === null ? "idle" : sinceLast < 120000 ? "ok" : "warn";
  setStage("act-stage-browser", ingress, `${sessionEvents.length} events captured in this browser`);

  const kafka = pipelineHealth?.stages?.kafka;
  if (!kafka) {
    setStage("act-stage-kafka", "idle", "Queue depth not reported by the API yet");
  } else if ((kafka.mode || "bypass") === "bypass") {
    setStage("act-stage-kafka", "bypass", "Broker bypassed - events go straight to the API");
  } else {
    const lag = Number.isFinite(kafka.lag) ? `, lag ${kafka.lag}` : "";
    setStage("act-stage-kafka", kafka.health || "ok", `${formatCount(kafka.messages ?? 0)} messages${lag}`);
  }

  const p95 = percentile(latencySamples, 0.95);
  setStage(
    "act-stage-api",
    latencyBand(p95),
    lastServerMs === null
      ? "FastAPI worker"
      : `FastAPI worker - ${Math.round(lastServerMs)}ms server time`,
  );

  const rows = summaryState?.total_events;
  const postgres = pipelineHealth?.stages?.postgres;
  setStage(
    "act-stage-postgres",
    postgres?.health || (Number.isFinite(rows) ? "ok" : "idle"),
    Number.isFinite(rows) ? `${formatCount(rows)} rows written for this session` : "No rows written yet",
  );

  setText("act-latency", lastApiLatencyMs === null ? "-" : String(Math.round(lastApiLatencyMs)));
}

// ── Live status ──

function setLiveStatus(status) {
  const node = document.getElementById("act-live");
  const label = document.getElementById("act-live-label");
  if (!node || !label) return;

  node.dataset.status = status;
  if (status === "connected") {
    const newest = sessionEvents.length ? eventTime(sessionEvents[0]) : null;
    label.textContent = newest ? `Live · ${formatRelativeTime(newest)}` : "Live";
  } else if (status === "connecting") {
    label.textContent = "Connecting…";
  } else {
    label.textContent = "Not streaming";
  }
}

function tickClocks() {
  document.querySelectorAll(".act-ev-ago[data-at]").forEach((node) => {
    node.textContent = formatRelativeTime(Number(node.dataset.at));
  });
  paintHeadline();
  paintTimeline();
  setLiveStatus(document.getElementById("act-live")?.dataset.status || "disconnected");
}

// ── Streaming ──

function startActivityStream() {
  if (activityStreamSource) return;

  const sessionId = currentSessionId();
  if (!sessionId || !isApiConfigured()) {
    setLiveStatus("disconnected");
    return;
  }

  setLiveStatus("connecting");
  activityStreamSource = new EventSource(`${API_BASE}/sessions/${sessionId}/stream`);
  activityStreamSource.onopen = () => setLiveStatus("connected");

  const parse = (event, handler) => {
    try {
      handler(JSON.parse(event.data));
    } catch (error) {
      console.error("Error parsing activity stream data:", error);
    }
  };

  // Named channels. The API also emits an unnamed frame per activity event so
  // a client still on `onmessage` keeps working across the deploy; both are
  // normalised to the same shape and deduplicated by event_id below.
  activityStreamSource.addEventListener("activity", (event) =>
    parse(event, (data) => handleIncomingStreamEvent(normalizeStreamEvent(data))),
  );
  activityStreamSource.addEventListener("pipeline", (event) =>
    parse(event, (snapshot) => {
      pipelineHealth = snapshot;
      paintChain();
    }),
  );
  activityStreamSource.addEventListener("hello", (event) =>
    parse(event, (data) => {
      if (data.pipeline) pipelineHealth = data.pipeline;
      paintChain();
    }),
  );
  activityStreamSource.onmessage = (event) =>
    parse(event, (data) => handleIncomingStreamEvent(normalizeStreamEvent(data)));
  activityStreamSource.onerror = () => setLiveStatus("connecting");
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
    session_id: currentSessionId(),
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
  setLiveStatus("disconnected");
}

function handleIncomingStreamEvent(event) {
  const sessionId = currentSessionId();
  if (!sessionId || event.session_id !== sessionId) return;

  const incoming = identityOf(event);
  if (sessionEvents.some((existing) => identityOf(existing) === incoming)) return;

  lastEventAt = Date.now();
  sessionEvents.unshift(event);
  liveArrivals += 1;
  arrivingIdentity = incoming;

  // Local counts stay honest between refetches; distinct_paths and the funnel
  // are server-side aggregates a client cannot derive from one event.
  if (summaryState) {
    summaryState.total_events = (summaryState.total_events || 0) + 1;
    summaryState.last_event_at = event.created_at;
    if (!summaryState.first_event_at) summaryState.first_event_at = event.created_at;
  }

  render();
  setLiveStatus("connected");

  // A live arrival invalidates the server aggregates. Refetch on the clock tick
  // rather than per event, so a burst costs one round trip.
}

// ── Lifecycle ──

async function enterActivitySection() {
  clearFilters();
  visibleCount = PAGE_SIZE;
  expandedRows.clear();

  // Landing straight on #activity (a shared link, a reload on the hash) races
  // session creation: without this the page renders "no session" and never
  // retries, because nothing re-runs when the id finally lands.
  if (isApiConfigured() && !currentSessionId()) {
    await ensureSession();
  }

  await loadActivity();
  loadActivitySummary();
  loadActivityFunnel();
  startActivityStream();

  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    tickClocks();
    if (liveArrivals > 0) {
      liveArrivals = 0;
      loadActivitySummary();
      loadActivityFunnel();
    }
  }, CLOCK_TICK_MS);
}

function leaveActivitySection() {
  stopActivityStream();
  pipelineHealth = null;
  lastEventAt = null;
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

// ── Init ──

const copyResetTimers = new WeakMap();

function setCopyButtonState(button, state) {
  const label = button.querySelector(".act-copy-label");
  const defaultLabel = button.dataset.defaultLabel || label?.textContent || "Copy";
  button.dataset.defaultLabel = defaultLabel;
  button.dataset.copyState = state;
  if (label) label.textContent = state === "copied" ? "Copied" : "Failed";

  const existing = copyResetTimers.get(button);
  if (existing) clearTimeout(existing);
  copyResetTimers.set(
    button,
    setTimeout(() => {
      delete button.dataset.copyState;
      if (label) label.textContent = defaultLabel;
      copyResetTimers.delete(button);
    }, COPY_RESET_DELAY_MS),
  );
}

export function initActivity() {
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  prefersReducedMotion = motionQuery.matches;
  motionQuery.addEventListener("change", (event) => {
    prefersReducedMotion = event.matches;
  });

  // Every analytics flush is also a latency sample, which is what lets the
  // chain reflect real traffic rather than only the dashboard's own fetches.
  onTelemetry((sample) => {
    if (!sample.ok) return;
    recordApiLatency(sample.roundTripMs, sample.serverMs);
    if (document.getElementById("activity")?.classList.contains("active")) paintChain();
  });

  const search = document.getElementById("act-search-input");
  if (search) {
    search.addEventListener("input", (event) => {
      const value = event.target.value;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        filters.query = value.trim();
        visibleCount = PAGE_SIZE;
        paintActiveFilters();
        paintStream();
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  document.getElementById("act-families")?.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-family]");
    if (!chip || chip.disabled) return;
    const family = chip.dataset.family;
    if (!family) filters.families.clear();
    else if (filters.families.has(family)) filters.families.delete(family);
    else filters.families.add(family);
    visibleCount = PAGE_SIZE;
    render();
  });

  document.getElementById("act-timeline")?.addEventListener("keydown", (event) => {
    if (moveTimelineFocus(event.currentTarget, event.key)) event.preventDefault();
  });

  document.getElementById("act-timeline")?.addEventListener("click", (event) => {
    const bar = event.target.closest("[data-bucket]");
    if (!bar) return;
    const index = Number(bar.dataset.bucket);
    filters.bucket = filters.bucket === index ? null : index;
    visibleCount = PAGE_SIZE;
    render();
  });

  document.getElementById("activity-funnel")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-path]");
    if (!row) return;
    filters.path = filters.path === row.dataset.path ? null : row.dataset.path;
    visibleCount = PAGE_SIZE;
    render();
    paintPaths();
  });

  document.getElementById("act-active-filters")?.addEventListener("click", (event) => {
    if (!event.target.closest("#act-clear-filters")) return;
    clearFilters();
    render();
    paintPaths();
  });

  document.getElementById("act-show-more")?.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    paintStream();
  });

  document.getElementById("act-stream")?.addEventListener("click", async (event) => {
    const copyBtn = event.target.closest(".act-copy-json");
    if (copyBtn) {
      const json = copyBtn.closest(".act-ev-panel")?.querySelector(".act-ev-pre");
      if (!json) return;
      try {
        await copyText(json.textContent || "");
        setCopyButtonState(copyBtn, "copied");
      } catch (error) {
        console.error("Activity JSON copy failed", error);
        setCopyButtonState(copyBtn, "failed");
      }
      return;
    }

    const toggle = event.target.closest(".act-ev-json");
    if (!toggle) return;
    const panel = document.getElementById(toggle.getAttribute("aria-controls"));
    if (!panel) return;

    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    panel.hidden = open;

    // Keyed by identity, not row index, so the panel survives a live arrival
    // shifting every row down by one.
    const identity = toggle.closest(".act-ev")?.dataset.identity;
    if (!identity) return;
    if (open) expandedRows.delete(identity);
    else expandedRows.add(identity);
  });

  const sessionPill = document.getElementById("activity-session-pill");
  sessionPill?.addEventListener("click", async () => {
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

  document.getElementById("activity-refresh-btn")?.addEventListener("click", () => {
    visibleCount = PAGE_SIZE;
    loadActivity();
    loadActivitySummary();
    loadActivityFunnel();
  });

  const section = document.getElementById("activity");
  if (!section) return;

  let wasActive = section.classList.contains("active");
  new MutationObserver(() => {
    const isActive = section.classList.contains("active");
    if (isActive && !wasActive) enterActivitySection();
    else if (!isActive && wasActive) leaveActivitySection();
    wasActive = isActive;
  }).observe(section, { attributes: true, attributeFilter: ["class"] });

  if (wasActive) enterActivitySection();
}
