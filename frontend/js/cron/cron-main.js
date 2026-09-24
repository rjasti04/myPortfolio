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
import { initAppSwitcher } from "../app-shared/app-switcher.js";
import { initAppShortcuts } from "../app-shared/app-shortcuts.js";

const STORAGE_KEY = "rj-inspector:state";

/* A reduced-motion preference is read when the scroll happens, because
   JS-initiated smooth scrolling ignores the stylesheet's
   `scroll-behavior: auto` and would animate regardless. */
function scrollBehavior() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

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

/* 3.2s, held while the toast has the pointer or focus, with a close button -
   the SPA's toast (js/utils.js). This one vanished after 2.2s with no way to
   keep it or dismiss it, and ignored the pointer entirely. */
const TOAST_MS = 3200;

function showToast(message) {
  let toast = document.getElementById("toast-notification");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast-notification";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML =
      '<span class="toast-text"></span>' +
      '<button type="button" class="toast-close" aria-label="Dismiss notification">' +
      '<i class="fas fa-times" aria-hidden="true"></i></button>';
    const hide = () => toast.classList.remove("show");
    const hold = () => clearTimeout(toast._timer);
    const arm = () => {
      clearTimeout(toast._timer);
      toast._timer = setTimeout(hide, TOAST_MS);
    };
    toast.querySelector(".toast-close").addEventListener("click", () => {
      hold();
      hide();
    });
    toast.addEventListener("mouseenter", hold);
    toast.addEventListener("mouseleave", arm);
    toast.addEventListener("focusin", hold);
    toast.addEventListener("focusout", arm);
    toast._arm = arm;
    document.body.appendChild(toast);
  }
  toast.querySelector(".toast-text").textContent = message;
  toast.classList.add("show");
  toast._arm();
}

const VALID_TABS = ["cron", "regex", "about"];

/** Hash -> tab name, defaulting to the cron inspector for anything unknown. */
function tabFromHash(hash) {
  const name = (hash || "").replace(/^#/, "").toLowerCase();
  return VALID_TABS.includes(name) ? name : "cron";
}

document.addEventListener("DOMContentLoaded", () => {
  // Shared chrome: the shelf reachable from the header, and a `?` sheet
  // generated from what is actually bound.
  initAppSwitcher({ current: "cron" });
  initAppShortcuts({ focusPrimary: "#cron-input", tabs: ".mode-tabs .tab-btn" });

  const savedState = loadSavedState() || {};

  // Parse URL hash & search params
  const hash = window.location.hash || "#cron";
  let activeTab = tabFromHash(hash);

  const params = new URLSearchParams(window.location.search);
  const initialCronExpr = params.get("expr") || savedState.cronExpr || "*/15 9-17 * * 1-5";
  const initialRegexPattern = params.get("pattern") || savedState.regexPattern || "";
  const initialRegexFlags = params.get("flags") || savedState.regexFlags || "g";
  const initialRegexText = params.get("text") || savedState.regexText || "";

  // Tab DOM elements
  const tabButtons = document.querySelectorAll(".tab-btn");
  const panelCron = document.getElementById("panel-cron");
  const panelRegex = document.getElementById("panel-regex");
  const panels = {
    cron: panelCron,
    regex: panelRegex,
    about: document.getElementById("panel-about"),
  };
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
      behavior: scrollBehavior(),
    });
  }

  function switchTab(tabName, shouldScroll = false) {
    activeTab = tabName;

    tabButtons.forEach((btn) => {
      const isTarget = btn.getAttribute("data-tab") === tabName;
      btn.classList.toggle("active", isTarget);
      btn.setAttribute("aria-selected", String(isTarget));
      // Roving tabindex: role="tablist" promises one Tab stop for the whole
      // set, with the arrow keys moving between tabs. Without this every tab
      // stayed individually Tab-reachable. Same line as json-main.js.
      btn.tabIndex = isTarget ? 0 : -1;
      if (isTarget && typeof btn.scrollIntoView === "function") {
        btn.scrollIntoView({ behavior: scrollBehavior(), inline: "center", block: "nearest" });
      }
    });

    let activePanel = null;
    for (const [name, panel] of Object.entries(panels)) {
      if (!panel) continue;
      const isTarget = name === tabName;
      panel.hidden = !isTarget;
      if (isTarget) activePanel = panel;
    }
    history.replaceState(null, "", `#${tabName}${window.location.search}`);

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
    const nextTab = tabFromHash(window.location.hash);
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

      if (activeTab !== "regex") {
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

  // Guarded: with storage blocked this read threw, and the theme toggle was
  // never wired. Same guard as json-main.js.
  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem("theme");
  } catch {
    storedTheme = null;
  }
  applyTheme(storedTheme === "light" || storedTheme === "dark" ? storedTheme : getSystemTheme());

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "light" ? "dark" : "light";
      applyTheme(next);
      showToast(`Switched to ${next} theme`);
    });
  }
});
