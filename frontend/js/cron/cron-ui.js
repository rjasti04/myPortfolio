/**
 * cron-ui.js
 *
 * DOM controller for the Cron Visualizer view.
 * Handles input synchronization, presets, interactive 5-part picker,
 * translation card, and next-run timeline.
 *
 * Zero external dependencies.
 */

import { parseCron, translateCron, getNextRuns } from "./cron-parser.js";

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

  // Part selector inputs
  const partMin = container.querySelector("#part-minute");
  const partHour = container.querySelector("#part-hour");
  const partDom = container.querySelector("#part-dom");
  const partMon = container.querySelector("#part-month");
  const partDow = container.querySelector("#part-dow");

  // Render presets
  renderPresets();

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

  function syncPartPickers(parts) {
    if (!parts) return;
    if (partMin) partMin.value = parts.minute || "*";
    if (partHour) partHour.value = parts.hour || "*";
    if (partDom) partDom.value = parts.dayOfMonth || "*";
    if (partMon) partMon.value = parts.month || "*";
    if (partDow) partDow.value = parts.dayOfWeek || "*";
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
      if (timelineEl) {
        timelineEl.textContent = "";
      }
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

    // Sync 5-part picker dropdowns
    syncPartPickers(parsed.rawParts);

    // Calculate next 10 triggers
    const nextRuns = getNextRuns(expr, 10);
    renderTimeline(nextRuns);

    if (typeof onExpressionChange === "function") {
      onExpressionChange(expr);
    }
  }

  function renderTimeline(runs) {
    if (!timelineEl) return;
    timelineEl.textContent = "";

    if (!runs || runs.length === 0) {
      const emptyMsg = document.createElement("p");
      emptyMsg.className = "timeline-empty";
      emptyMsg.textContent = "No future triggers found in the next 5 years.";
      timelineEl.appendChild(emptyMsg);
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
      try {
        await navigator.clipboard.writeText(inputEl.value.trim());
        const originalText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = originalText;
        }, 1500);
      } catch {
        // Fallback or ignore
      }
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
