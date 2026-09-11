/**
 * cron-main.js
 *
 * App controller for the Cron & Regex Visualizer standalone page.
 * Manages tab switching, URL hash/query permalink synchronization,
 * localStorage persistence, theme toggling, and copy link toasts.
 *
 * Zero external dependencies.
 */

import { initCronUI } from "./cron-ui.js";
import { initRegexUI } from "./regex-ui.js";

const STORAGE_KEY = "rj-inspector:state";

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be disabled or quota full
  }
}

function showToast(message) {
  let toast = document.getElementById("toast-notification");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast-notification";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

document.addEventListener("DOMContentLoaded", () => {
  const savedState = loadSavedState() || {};

  // Parse URL hash & search params
  const hash = window.location.hash || "#cron";
  let activeTab = hash.startsWith("#regex") ? "regex" : "cron";

  const params = new URLSearchParams(window.location.search);
  const initialCronExpr = params.get("expr") || savedState.cronExpr || "*/15 9-17 * * 1-5";
  const initialRegexPattern = params.get("pattern") || savedState.regexPattern || "";
  const initialRegexFlags = params.get("flags") || savedState.regexFlags || "g";
  const initialRegexText = params.get("text") || savedState.regexText || "";

  // Tab DOM elements
  const tabButtons = document.querySelectorAll(".tab-btn");
  const panelCron = document.getElementById("panel-cron");
  const panelRegex = document.getElementById("panel-regex");
  const shareBtn = document.getElementById("share-link-btn");
  const themeToggleBtn = document.getElementById("theme-toggle-btn");

  let cronController;
  let regexController;

  function switchTab(tabName) {
    activeTab = tabName;

    tabButtons.forEach((btn) => {
      const isTarget = btn.getAttribute("data-tab") === tabName;
      btn.classList.toggle("active", isTarget);
      btn.setAttribute("aria-selected", String(isTarget));
    });

    if (tabName === "cron") {
      panelCron.hidden = false;
      panelRegex.hidden = true;
      history.replaceState(null, "", `#cron${window.location.search}`);
    } else {
      panelCron.hidden = true;
      panelRegex.hidden = false;
      history.replaceState(null, "", `#regex${window.location.search}`);
    }

    persistCurrentState();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });

  // Handle hashchange
  window.addEventListener("hashchange", () => {
    const newHash = window.location.hash;
    const nextTab = newHash.startsWith("#regex") ? "regex" : "cron";
    if (nextTab !== activeTab) {
      switchTab(nextTab);
    }
  });

  function persistCurrentState() {
    const cronExpr = cronController ? cronController.getExpression() : initialCronExpr;
    const regexState = regexController ? regexController.getState() : {
      pattern: initialRegexPattern,
      flags: initialRegexFlags,
      text: initialRegexText,
    };

    saveState({
      activeTab,
      cronExpr,
      regexPattern: regexState.pattern,
      regexFlags: regexState.flags,
      regexText: regexState.text,
    });
  }

  // Initialize UI controllers
  cronController = initCronUI({
    container: panelCron,
    initialExpr: initialCronExpr,
    onExpressionChange: () => {
      persistCurrentState();
    },
  });

  regexController = initRegexUI({
    container: panelRegex,
    initialPattern: initialRegexPattern,
    initialFlags: initialRegexFlags,
    initialText: initialRegexText,
    onStateChange: () => {
      persistCurrentState();
    },
  });

  // Set initial active tab
  switchTab(activeTab);

  // Share Permalink button
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const url = new URL(window.location.href);
      url.search = ""; // clear old params

      if (activeTab === "cron") {
        url.hash = "#cron";
        url.searchParams.set("expr", cronController.getExpression());
      } else {
        url.hash = "#regex";
        const rState = regexController.getState();
        url.searchParams.set("pattern", rState.pattern);
        url.searchParams.set("flags", rState.flags);
        if (rState.text && rState.text.length < 2000) {
          url.searchParams.set("text", rState.text);
        }
      }

      try {
        await navigator.clipboard.writeText(url.toString());
        showToast("Shareable link copied to clipboard!");
      } catch {
        showToast("Could not copy link to clipboard.");
      }
    });
  }

  // Theme management
  function getSystemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("rj-theme", theme);
    } catch {
      // ignore
    }
  }

  const storedTheme = localStorage.getItem("rj-theme") || getSystemTheme();
  applyTheme(storedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "light" ? "dark" : "light";
      applyTheme(next);
      showToast(`Switched to ${next} theme`);
    });
  }
});
