/**
 * cron-ui.js
 *
 * DOM controller for the Cron Visualizer view.
 * Handles input synchronization, presets, interactive 5-part picker,
 * translation card, and next-run timeline.
 *
 * Zero external dependencies.
 */

import {
  parseCron,
  translateCron,
  getNextRuns,
  resolveLocalTimeZone,
} from "./cron-parser.js";

/**
 * The five cron fields, in expression order. Drives the field map strip and
 * the click-through from a token to the builder select that owns it, which is
 * what makes the mapping between a raw expression and the dropdowns legible
 * instead of something the visitor has to already know.
 */
const SEGMENTS = [
  { key: "minute", label: "Minute", selectId: "part-minute", fieldKey: "minutes", unit: "minute" },
  { key: "hour", label: "Hour", selectId: "part-hour", fieldKey: "hours", unit: "hour" },
  {
    key: "dayOfMonth",
    label: "Day of Month",
    selectId: "part-dom",
    fieldKey: "daysOfMonth",
    unit: "day of the month",
  },
  { key: "month", label: "Month", selectId: "part-month", fieldKey: "months", unit: "month" },
  {
    key: "dayOfWeek",
    label: "Day of Week",
    selectId: "part-dow",
    fieldKey: "daysOfWeek",
    unit: "day of the week",
  },
];

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * One short sentence describing what a single cron field resolves to.
 * Deliberately narrower than translateCron(): that reads the whole schedule,
 * this annotates one token so the strip can stand on its own.
 */
function describeSegment(segment, raw, matched) {
  if (raw === "*") return `Every ${segment.unit}`;

  const stepMatch = /^\*\/(\d+)$/.exec(raw);
  if (stepMatch) return `Every ${stepMatch[1]} ${segment.unit}s`;

  if (!Array.isArray(matched) || matched.length === 0) return "\u2014";

  if (segment.key === "dayOfWeek") {
    return matched.map((d) => DOW_LABELS[d] ?? d).join(", ");
  }
  if (segment.key === "month") {
    return matched.map((m) => MONTH_LABELS[m - 1] ?? m).join(", ");
  }
  if (matched.length === 1) {
    return `${segment.unit === "hour" ? "At hour" : "At"} ${matched[0]}`;
  }
  return `${matched.length} ${segment.unit}s`;
}

const PRESETS = [
  { label: "Every minute", expr: "* * * * *" },
  { label: "Every 15 min", expr: "*/15 * * * *" },
  { label: "Hourly", expr: "0 * * * *" },
  { label: "Daily at 00:00", expr: "0 0 * * *" },
  { label: "Weekdays at 9 AM", expr: "0 9 * * 1-5" },
  { label: "Sunday midnight", expr: "0 0 * * 0" },
  { label: "1st of month", expr: "0 0 1 * *" },
];

export function initCronUI({ container, onExpressionChange, initialExpr = "*/15 9-17 * * 1-5" }) {
  let currentExpr = initialExpr;

  // DOM Elements inside container
  const inputEl = container.querySelector("#cron-input");
  const errorEl = container.querySelector("#cron-error");
  const translationEl = container.querySelector("#cron-translation");
  const presetsContainer = container.querySelector("#cron-presets");
  const timelineEl = container.querySelector("#cron-timeline");
  const copyBtn = container.querySelector("#cron-copy-btn");
  const segmentsEl = container.querySelector("#cron-segments");
  const tzEl = container.querySelector("#cron-tz");

  // Part selector inputs
  const partMin = container.querySelector("#part-minute");
  const partHour = container.querySelector("#part-hour");
  const partDom = container.querySelector("#part-dom");
  const partMon = container.querySelector("#part-month");
  const partDow = container.querySelector("#part-dow");

  // Render presets
  renderPresets();
  renderTimezone();

  /**
   * Fill the timezone picker.
   *
   * A cron expression is wall-clock, so the only question the rail is ever
   * really asked is "when does this fire on the box that runs it" - which is
   * unanswerable while the schedule is pinned to the visitor's own zone. The
   * list comes from Intl.supportedValuesOf, so it is the runtime's own zone
   * database rather than a table that will be wrong the next time a country
   * changes its rules.
   *
   * Two shortcuts sit above the full list: the local zone (the default, and
   * still the right answer when you run cron on your laptop) and UTC (what
   * most servers and every CI runner are set to).
   */
  function renderTimezone() {
    if (!tzEl) return;

    const localZone = resolveLocalTimeZone();
    let zones = [];
    try {
      zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    } catch {
      zones = [];
    }

    tzEl.textContent = "";

    const shortcuts = document.createElement("optgroup");
    shortcuts.label = "Common";
    for (const [value, label] of [["", `Your timezone (${localZone})`], ["UTC", "UTC"]]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      shortcuts.appendChild(opt);
    }
    tzEl.appendChild(shortcuts);

    if (zones.length > 0) {
      const all = document.createElement("optgroup");
      all.label = "All timezones";
      for (const zone of zones) {
        const opt = document.createElement("option");
        opt.value = zone;
        opt.textContent = zone;
        all.appendChild(opt);
      }
      tzEl.appendChild(all);
    }

    tzEl.value = "";
  }

  /** The zone the timeline computes in: the picker's choice, or the local one. */
  function activeTimeZone() {
    return tzEl?.value || resolveLocalTimeZone();
  }

  /**
   * Paints the five-field map. Each token is a button that focuses the builder
   * select for the same field, so the expression string is a navigation
   * surface rather than an opaque blob.
   */
  function renderSegments(rawParts, fields) {
    if (!segmentsEl) return;
    segmentsEl.textContent = "";

    SEGMENTS.forEach((segment) => {
      const raw = rawParts ? rawParts[segment.key] : null;

      const item = document.createElement("li");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "segment";
      btn.dataset.part = segment.key;

      const label = document.createElement("span");
      label.className = "segment-label";
      label.textContent = segment.label;

      const value = document.createElement("span");
      value.className = "segment-value";
      value.textContent = raw ?? "?";

      const meaning = document.createElement("span");
      meaning.className = "segment-meaning";

      if (raw == null) {
        btn.classList.add("is-invalid");
        meaning.textContent = "Missing field";
      } else {
        meaning.textContent = describeSegment(
          segment,
          raw,
          fields ? fields[segment.fieldKey] : null
        );
      }

      btn.title = `Jump to the ${segment.label} field`;
      btn.setAttribute("aria-label", `${segment.label}: ${raw ?? "missing"}. Edit this field.`);
      btn.append(label, value, meaning);
      btn.addEventListener("click", () => focusPart(segment.selectId));

      item.appendChild(btn);
      segmentsEl.appendChild(item);
    });
  }

  function focusPart(selectId) {
    const selectEl = container.querySelector(`#${selectId}`);
    if (!selectEl) return;
    const field = selectEl.closest(".builder-field");
    selectEl.scrollIntoView({ behavior: "smooth", block: "center" });
    selectEl.focus({ preventScroll: true });
    if (field) {
      field.classList.add("is-flashing");
      setTimeout(() => field.classList.remove("is-flashing"), 900);
    }
  }

  function renderPresets() {
    if (!presetsContainer) return;
    presetsContainer.textContent = "";
    for (const p of PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip-btn";
      btn.textContent = p.label;
      btn.title = `Load: ${p.expr}`;
      btn.addEventListener("click", () => {
        setExpression(p.expr);
      });
      presetsContainer.appendChild(btn);
    }
  }

  function setSelectValueWithCustom(selectEl, value) {
    if (!selectEl) return;
    const val = value || "*";
    let found = false;
    for (const opt of selectEl.options) {
      if (opt.value === val) {
        found = true;
        break;
      }
    }
    const existingCustom = selectEl.querySelector('option[data-custom="true"]');
    if (existingCustom && existingCustom.value !== val) {
      existingCustom.remove();
    }
    if (!found) {
      const customOpt = document.createElement("option");
      customOpt.value = val;
      customOpt.textContent = `${val} (Custom)`;
      customOpt.setAttribute("data-custom", "true");
      selectEl.appendChild(customOpt);
    }
    selectEl.value = val;
  }

  function syncPartPickers(parts) {
    if (!parts) return;
    setSelectValueWithCustom(partMin, parts.minute);
    setSelectValueWithCustom(partHour, parts.hour);
    setSelectValueWithCustom(partDom, parts.dayOfMonth);
    setSelectValueWithCustom(partMon, parts.month);
    setSelectValueWithCustom(partDow, parts.dayOfWeek);
  }

  function update() {
    const expr = inputEl.value.trim();
    currentExpr = expr;

    const parsed = parseCron(expr);
    if (!parsed.valid) {
      if (errorEl) {
        errorEl.textContent = parsed.error;
        errorEl.hidden = false;
      }
      if (translationEl) {
        translationEl.textContent = "Invalid cron expression syntax.";
        translationEl.classList.add("text-error");
      }
      const typed = expr.split(/\s+/).filter(Boolean);
      renderSegments(
        {
          minute: typed[0] ?? null,
          hour: typed[1] ?? null,
          dayOfMonth: typed[2] ?? null,
          month: typed[3] ?? null,
          dayOfWeek: typed[4] ?? null,
        },
        null
      );
      renderEmptyTimeline("Fix the expression above to see when it fires.");
      return;
    }

    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }

    // Translation
    const trans = translateCron(expr);
    if (translationEl) {
      translationEl.textContent = trans.translation || "Valid schedule.";
      translationEl.classList.remove("text-error");
    }

    // Sync the field map and the 5-part picker dropdowns
    renderSegments(parsed.rawParts, parsed.fields);
    syncPartPickers(parsed.rawParts);

    // Calculate next 10 triggers, in whichever zone the rail is set to.
    const nextRuns = getNextRuns(expr, 10, new Date(), activeTimeZone());
    renderTimeline(nextRuns);

    if (typeof onExpressionChange === "function") {
      onExpressionChange(expr);
    }
  }

  function renderEmptyTimeline(message) {
    if (!timelineEl) return;
    timelineEl.textContent = "";

    const wrap = document.createElement("div");
    wrap.className = "empty-state";

    const icon = document.createElement("i");
    icon.className = "fas fa-circle-exclamation";
    icon.setAttribute("aria-hidden", "true");

    const text = document.createElement("p");
    text.className = "empty-state-text";
    text.textContent = message;

    wrap.append(icon, text);
    timelineEl.appendChild(wrap);
  }

  function renderTimeline(runs) {
    if (!timelineEl) return;
    timelineEl.textContent = "";

    if (!runs || runs.length === 0) {
      renderEmptyTimeline("No future triggers found in the next 5 years.");
      return;
    }

    const list = document.createElement("ol");
    list.className = "timeline-list";

    runs.forEach((run, idx) => {
      const item = document.createElement("li");
      item.className = "timeline-item";

      const nodeIndex = document.createElement("span");
      nodeIndex.className = "timeline-node-index";
      nodeIndex.textContent = `#${idx + 1}`;

      const content = document.createElement("div");
      content.className = "timeline-content";

      const topRow = document.createElement("div");
      topRow.className = "timeline-top-row";

      const dateSpan = document.createElement("span");
      dateSpan.className = "timeline-date";
      dateSpan.textContent = run.localDate;

      const timeSpan = document.createElement("span");
      timeSpan.className = "timeline-time";
      timeSpan.textContent = run.localTime;

      const relativeBadge = document.createElement("span");
      relativeBadge.className = "timeline-relative badge";
      relativeBadge.textContent = run.relative;

      topRow.appendChild(dateSpan);
      topRow.appendChild(timeSpan);
      topRow.appendChild(relativeBadge);

      const isoSpan = document.createElement("span");
      isoSpan.className = "timeline-iso font-mono";
      isoSpan.textContent = run.iso;

      content.appendChild(topRow);
      content.appendChild(isoSpan);

      item.appendChild(nodeIndex);
      item.appendChild(content);
      list.appendChild(item);
    });

    timelineEl.appendChild(list);
  }

  function setExpression(newExpr) {
    if (inputEl) {
      inputEl.value = newExpr;
      update();
    }
  }

  // Changing the zone re-reads the same expression against a different clock.
  tzEl?.addEventListener("change", update);

  // Bind input typing
  if (inputEl) {
    inputEl.value = currentExpr;
    inputEl.addEventListener("input", () => {
      update();
    });
  }

  // Bind copy button
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = inputEl ? inputEl.value.trim() : "";
      // execCommand reports failure by returning false rather than throwing,
      // and "Copied!" used to show whichever it did. /json already said
      // "Copy failed"; now these do too.
      let copied = true;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          copied = document.execCommand("copy");
        } catch {
          copied = false;
        } finally {
          document.body.removeChild(ta);
        }
      }
      const originalHtml = copyBtn.innerHTML;
      copyBtn.classList.toggle("copied", copied);
      copyBtn.innerHTML = copied
        ? '<i class="fas fa-check" aria-hidden="true"></i> <span>Copied!</span>'
        : '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i> <span>Copy failed</span>';
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.innerHTML = originalHtml;
      }, 1500);
    });
  }

  // Bind 5-part picker change events
  function handlePickerChange() {
    const minVal = partMin ? partMin.value : "*";
    const hourVal = partHour ? partHour.value : "*";
    const domVal = partDom ? partDom.value : "*";
    const monVal = partMon ? partMon.value : "*";
    const dowVal = partDow ? partDow.value : "*";
    const expr = `${minVal} ${hourVal} ${domVal} ${monVal} ${dowVal}`;
    setExpression(expr);
  }

  [partMin, partHour, partDom, partMon, partDow].forEach((el) => {
    if (el) {
      el.addEventListener("change", handlePickerChange);
    }
  });

  // Initial render
  update();

  return {
    setExpression,
    getExpression: () => currentExpr,
  };
}
