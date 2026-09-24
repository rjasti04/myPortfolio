/**
 * Crypto Main Controller (`crypto-main.js`)
 *
 * Standalone application entry point for the Crypto & Encoders Toolbox (/crypto).
 * Manages tab switching, URL hash synchronization (#encoders, #hasher, #generators, #time),
 * light/dark theme toggles, shareable links, and error boundaries.
 *
 * Pure vanilla ES modules. Zero dependencies.
 */

import { initCryptoUI, copyWithFeedback } from "./crypto-ui.js";
import { buildShareUrl, applyShareState } from "./share-state.js";
import { initAppSwitcher } from "../app-shared/app-switcher.js";
import { initAppShortcuts } from "../app-shared/app-shortcuts.js";

const VALID_TABS = ["encoders", "hasher", "generators", "jwt", "time", "about"];
const STORAGE_KEY = "rj-crypto:preferences";

/* A reduced-motion preference is read when the scroll happens, because
   JS-initiated smooth scrolling ignores the stylesheet's
   `scroll-behavior: auto` and would animate regardless. */
function scrollBehavior() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function getStoredPreferences() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

function savePreferences(prefs) {
  try {
    const existing = getStoredPreferences();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, ...prefs }));
  } catch {
    // Ignore storage quota or disabled issues
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initAppSwitcher({ current: "crypto" });
  initAppShortcuts({ focusPrimary: "#encoder-input", tabs: ".mode-tabs .tab-btn" });

  // 1. Theme Management
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  const htmlEl = document.documentElement;

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

  // Guarded: with storage blocked this read threw before the tabs were
  // wired, and the whole page was dead. Same guard as json-main.js.
  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem("theme");
  } catch {
    storedTheme = null;
  }
  const savedTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : getSystemTheme();
  htmlEl.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);
  syncThemeColorMeta(savedTheme);

  themeToggleBtn?.addEventListener("click", () => {
    const currentTheme = htmlEl.getAttribute("data-theme") || "dark";
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    htmlEl.setAttribute("data-theme", nextTheme);
    try {
      localStorage.setItem("theme", nextTheme);
    } catch {
      // Ignore storage errors
    }
    updateThemeIcon(nextTheme);
    syncThemeColorMeta(nextTheme);
  });

  // 2. Tab Navigation
  const tabButtons = document.querySelectorAll(".tab-btn");
  const panels = {
    encoders: document.getElementById("panel-encoders"),
    hasher: document.getElementById("panel-hasher"),
    generators: document.getElementById("panel-generators"),
    jwt: document.getElementById("panel-jwt"),
    time: document.getElementById("panel-time"),
    about: document.getElementById("panel-about"),
  };

  function getActiveTabFromHash() {
    const hash = (window.location.hash || "").replace("#", "").toLowerCase();
    return VALID_TABS.includes(hash) ? hash : "encoders";
  }

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

  function switchTab(tabId, shouldScroll = false) {
    if (!VALID_TABS.includes(tabId)) tabId = "encoders";

    tabButtons.forEach((btn) => {
      const isTarget = btn.getAttribute("data-tab") === tabId;
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
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) {
        const isCurrent = key === tabId;
        panel.hidden = !isCurrent;
        if (isCurrent) activePanel = panel;
      }
    });

    if (window.location.hash !== `#${tabId}`) {
      history.replaceState(null, "", `#${tabId}`);
    }

    if (shouldScroll) {
      scrollToActivePanel(activePanel);
    }

    savePreferences({ lastTab: tabId });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      switchTab(tabId, true);
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

  window.addEventListener("hashchange", () => {
    switchTab(getActiveTabFromHash(), true);
  });

  // Initial tab load
  const initialTab = getActiveTabFromHash();
  switchTab(initialTab);

  // 3. Share Link Button
  //
  // The settings a link carries are restored before initCryptoUI() runs, so
  // the workbench renders once, already in the shared shape, rather than
  // rendering defaults and then visibly correcting itself.
  applyShareState(document, window.location.href);

  const shareBtn = document.getElementById("share-link-btn");
  shareBtn?.addEventListener("click", () => {
    copyWithFeedback(buildShareUrl(document, window.location.href), shareBtn);
  });

  // 4. Initialize UI Logic
  initCryptoUI();
});
