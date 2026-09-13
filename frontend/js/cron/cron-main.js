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

  function scrollToActivePanel(panel) {
    if (!panel) return;
    const header = document.querySelector(".app-header");
    const headerOffset = header ? header.offsetHeight + 16 : 80;
    const panelTop = panel.getBoundingClientRect().top + window.pageYOffset;
    const targetY = Math.max(0, panelTop - headerOffset);
    window.scrollTo({
      top: targetY,
      behavior: "smooth",
    });
  }

  function switchTab(tabName, shouldScroll = false) {
    activeTab = tabName;

    tabButtons.forEach((btn) => {
      const isTarget = btn.getAttribute("data-tab") === tabName;
      btn.classList.toggle("active", isTarget);
      btn.setAttribute("aria-selected", String(isTarget));
      if (isTarget && typeof btn.scrollIntoView === "function") {
        btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    });

    const activePanel = tabName === "cron" ? panelCron : panelRegex;
    if (tabName === "cron") {
      panelCron.hidden = false;
      panelRegex.hidden = true;
      history.replaceState(null, "", `#cron${window.location.search}`);
    } else {
      panelCron.hidden = true;
      panelRegex.hidden = false;
      history.replaceState(null, "", `#regex${window.location.search}`);
    }

    if (shouldScroll) {
      scrollToActivePanel(activePanel);
    }

    persistCurrentState();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      switchTab(targetTab, true);
    });
  });

  /**
   * Arrow-key navigation across the tablist. The markup already declares
   * role="tablist"/role="tab", which promises this behaviour to assistive
   * tech; without it the widget announced itself as a tablist and then only
   * responded to Tab and clicks.
   */
  function bindTabKeyNav(buttons, activate) {
    const list = Array.from(buttons);
    if (list.length === 0) return;

    list.forEach((btn, idx) => {
      btn.addEventListener("keydown", (e) => {
        let nextIdx = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = (idx + 1) % list.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
          nextIdx = (idx - 1 + list.length) % list.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = list.length - 1;
        if (nextIdx === null) return;

        e.preventDefault();
        const target = list[nextIdx];
        target.focus();
        activate(target.getAttribute("data-tab"), false);
      });
    });
  }

  bindTabKeyNav(tabButtons, switchTab);

  // Handle hashchange
  window.addEventListener("hashchange", () => {
    const newHash = window.location.hash;
    const nextTab = newHash.startsWith("#regex") ? "regex" : "cron";
    if (nextTab !== activeTab) {
      switchTab(nextTab, true);
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

  function syncThemeColorMeta(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#090d16" : "#f8fafc");
    }
  }

  function updateThemeIcon(theme) {
    if (!themeToggleBtn) return;
    const icon = themeToggleBtn.querySelector("i");
    if (icon) {
      icon.className = theme === "dark" ? "fas fa-sun" : "fas fa-moon";
    }
    themeToggleBtn.setAttribute(
      "aria-label",
      `Switch to ${theme === "dark" ? "light" : "dark"} theme`
    );
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    updateThemeIcon(theme);
    syncThemeColorMeta(theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // ignore
    }
  }

  const storedTheme = localStorage.getItem("theme") || getSystemTheme();
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
