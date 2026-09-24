/* Aggregate analytics, owner only.
 *
 * Everything else in the Activity section is the visitor's own session, which
 * is what its intro promises. This panel reads across every session, so it is
 * built only after the API confirms the signed-in caller is the owner - a 403
 * leaves the section exactly as a visitor sees it, with no empty shell shipped
 * to the page.
 *
 * The renderers come from activity-charts.js unchanged. They were written as
 * pure paints over data ("activity.js owns all state; every export here is a
 * pure paint"), which is what lets a date range re-use them as readily as a
 * session window.
 */

import { API_BASE } from "./analytics.js";
import { authenticatedFetch, getAuthToken } from "./auth.js";
import { renderPaths } from "./activity-charts.js";
import { escapeHTML } from "./utils.js";

const WINDOWS = [7, 30, 90, 365];
const DEFAULT_WINDOW = 30;

/* Each URL is written out in full rather than built from a variable segment.
   tests/backend/integration/test_frontend_api_contract.py scans this file for
   API_BASE template literals and asserts the backend serves every path it
   finds. An interpolated path segment normalises to /admin/analytics/{}, which
   matches no route, so the guard would fail rather than check. (This comment
   avoids writing such a literal for the same reason - the scanner reads
   comments too.) */
const PANELS = [
  { key: "overview", url: (days) => `${API_BASE}/admin/analytics/overview?days=${days}` },
  { key: "funnel", url: (days) => `${API_BASE}/admin/analytics/funnel?days=${days}` },
  { key: "commands", url: (days) => `${API_BASE}/admin/analytics/commands?days=${days}` },
  { key: "llm", url: (days) => `${API_BASE}/admin/analytics/llm?days=${days}` },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

/** A labelled figure. Absent measurements read as an em dash, never as zero. */
function stat(label, value, hint) {
  const wrap = el("div", "act-owner-stat");
  wrap.appendChild(el("span", "act-owner-stat-value", value ?? "—"));
  wrap.appendChild(el("span", "act-owner-stat-label", label));
  if (hint) {
    const note = el("span", "act-owner-stat-hint", hint);
    wrap.appendChild(note);
  }
  return wrap;
}

/** A horizontal bar list, used for event types, devices and commands alike. */
function barList(rows, { labelKey, valueKey, emptyText }) {
  if (!rows || !rows.length) return el("p", "act-owner-empty", emptyText);

  const peak = Math.max(...rows.map((row) => Number(row[valueKey]) || 0), 1);
  const list = el("ul", "act-owner-bars");
  rows.forEach((row) => {
    const item = el("li", "act-owner-bar");
    const fill = el("span", "act-owner-bar-fill");
    fill.style.width = `${Math.round(((Number(row[valueKey]) || 0) / peak) * 100)}%`;
    item.appendChild(fill);
    item.appendChild(el("span", "act-owner-bar-label", String(row[labelKey] ?? "unknown")));
    item.appendChild(el("span", "act-owner-bar-value", formatNumber(row[valueKey])));
    list.appendChild(item);
  });
  return list;
}

export async function initOwnerAnalytics() {
  const root = document.getElementById("act-owner");
  if (!root) return;

  // Signing out has to take the panel with it. Returning early while leaving
  // it on screen would show the previous owner's aggregate figures to whoever
  // is at the browser next.
  function hide() {
    root.hidden = true;
    root.replaceChildren();
    delete root.dataset.busy;
  }

  if (!getAuthToken()) {
    hide();
    return;
  }

  let days = DEFAULT_WINDOW;
  // Bumped by every window change; see the picker's click handler.
  let loadSeq = 0;

  async function load() {
    const results = await Promise.all(
      PANELS.map(async ({ key, url }) => {
        try {
          const res = await authenticatedFetch(url(days));
          if (!res.ok) return { key, error: res.status };
          return { key, data: await res.json() };
        } catch {
          return { key, error: "network" };
        }
      })
    );
    return Object.fromEntries(results.map((result) => [result.key, result]));
  }

  const first = await load();

  // 401 or 403 anywhere means this caller is not the owner. Leave the section
  // exactly as a visitor sees it rather than showing a panel that cannot fill.
  const denied = Object.values(first).some(
    (result) => result.error === 401 || result.error === 403
  );
  if (denied) {
    hide();
    return;
  }

  root.hidden = false;
  build();
  paint(first);

  function build() {
    root.replaceChildren();

    const header = el("div", "act-owner-head");
    const heading = el("h2", "act-owner-title", "Across every session");
    heading.id = "act-owner-title";
    header.appendChild(heading);

    const note = el(
      "p",
      "act-owner-note",
      "Owner view. Everything above is your own visit; this is every visitor's."
    );
    header.appendChild(note);

    const picker = el("div", "act-owner-window");
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "Reporting window");
    WINDOWS.forEach((option) => {
      const button = el("button", "act-owner-window-btn", `${option}d`);
      button.type = "button";
      button.dataset.days = String(option);
      button.setAttribute("aria-pressed", String(option === days));
      button.addEventListener("click", async () => {
        if (option === days) return;
        days = option;
        picker.querySelectorAll("button").forEach((other) => {
          other.setAttribute("aria-pressed", String(Number(other.dataset.days) === days));
        });
        // Only the latest click may paint. A 90-day query is slower than a
        // 7-day one, so pressing 90d then 7d let the 90-day figures land last
        // and sit under a pressed 7d button - and cleared the busy state while
        // the answer that mattered was still loading.
        const seq = ++loadSeq;
        setBusy(true);
        const results = await load();
        if (seq !== loadSeq) return;
        paint(results);
        setBusy(false);
      });
      picker.appendChild(button);
    });
    header.appendChild(picker);
    root.appendChild(header);

    const body = el("div", "act-owner-body");
    body.id = "act-owner-body";
    // Announced, because changing the window replaces every figure below it.
    body.setAttribute("aria-live", "polite");
    root.appendChild(body);

    root.setAttribute("aria-labelledby", "act-owner-title");
  }

  function setBusy(busy) {
    root.dataset.busy = busy ? "true" : "false";
  }

  /** A failed panel says so. Rendering it as zeroes would report a measurement
   *  nobody took - the defect uiux.md finding 19 was written against. */
  function failure(title) {
    const card = el("section", "act-owner-card act-owner-card--error");
    card.appendChild(el("h3", "act-owner-card-title", title));
    const message = el("p", "act-owner-empty", "Could not load this panel.");
    message.setAttribute("role", "alert");
    card.appendChild(message);
    return card;
  }

  function card(title, ...children) {
    const node = el("section", "act-owner-card");
    node.appendChild(el("h3", "act-owner-card-title", title));
    children.forEach((child) => child && node.appendChild(child));
    return node;
  }

  function paint(results) {
    const body = document.getElementById("act-owner-body");
    if (!body) return;
    body.replaceChildren();

    // --- Reach -------------------------------------------------------------
    const overview = results.overview;
    if (overview?.data) {
      const { data } = overview;
      const stats = el("div", "act-owner-stats");
      stats.appendChild(stat("Sessions", formatNumber(data.sessions)));
      stats.appendChild(
        stat("Distinct IPs", formatNumber(data.distinct_ips), "a floor on people, not a count")
      );
      stats.appendChild(stat("Live now", formatNumber(data.active_sessions)));
      stats.appendChild(
        stat(
          "Events",
          formatNumber((data.event_types || []).reduce((sum, row) => sum + row.count, 0))
        )
      );
      body.appendChild(card("Reach", stats));
      body.appendChild(
        card(
          "Event mix",
          barList(data.event_types, {
            labelKey: "type",
            valueKey: "count",
            emptyText: "No events in this window.",
          })
        )
      );
      body.appendChild(
        card(
          "Devices",
          barList(data.devices, {
            labelKey: "device",
            valueKey: "count",
            emptyText: "No sessions in this window.",
          })
        )
      );
    } else {
      body.appendChild(failure("Reach"));
    }

    // --- Where people go ---------------------------------------------------
    const funnel = results.funnel;
    if (funnel?.data) {
      const paths = el("div", "act-paths");
      // The per-session renderer, unchanged: it takes {steps, transitions},
      // which is the shape this endpoint returns.
      renderPaths(paths, funnel.data, {
        escapeHTML,
        emptyText: "No navigation recorded in this window.",
      });
      body.appendChild(card("Where visitors go", paths));
    } else {
      body.appendChild(failure("Where visitors go"));
    }

    // --- Terminal ----------------------------------------------------------
    const commands = results.commands;
    if (commands?.data) {
      const rows = commands.data.commands || [];
      const unrecognised = rows.filter((row) => row.recognised < row.runs);
      const children = [
        barList(rows, {
          labelKey: "command",
          valueKey: "runs",
          emptyText: "Nobody has run a command in this window.",
        }),
      ];
      if (unrecognised.length) {
        // A command typed but not recognised is a feature request in disguise.
        children.push(
          el(
            "p",
            "act-owner-hint",
            `${unrecognised.length} command${unrecognised.length === 1 ? " was" : "s were"} typed but not recognised.`
          )
        );
      }
      body.appendChild(card("Terminal commands", ...children));
    } else {
      body.appendChild(failure("Terminal commands"));
    }

    // --- Bedrock -----------------------------------------------------------
    const llm = results.llm;
    if (llm?.data) {
      const { data } = llm;
      const stats = el("div", "act-owner-stats");
      stats.appendChild(stat("Turns", formatNumber(data.turns)));
      stats.appendChild(stat("Input tokens", formatNumber(data.input_tokens)));
      stats.appendChild(stat("Output tokens", formatNumber(data.output_tokens)));
      stats.appendChild(
        stat("Cache hit rate", data.turns ? `${Math.round(data.cache_hit_rate * 100)}%` : "—")
      );
      stats.appendChild(
        stat(
          "Mean latency",
          // An em dash until a turn has been measured: 0 ms is a measurement,
          // and this is the absence of one. Same rule as the chat top bar.
          data.mean_latency_ms == null ? "—" : `${Math.round(data.mean_latency_ms)} ms`
        )
      );
      body.appendChild(card("Bedrock usage", stats));
    } else {
      body.appendChild(failure("Bedrock usage"));
    }
  }
}
