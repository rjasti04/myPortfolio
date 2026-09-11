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

const VALID_TABS = ["encoders", "hasher", "generators", "time"];
const STORAGE_KEY = "rj-crypto:preferences";

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

  const savedTheme = localStorage.getItem("theme") || getSystemTheme();
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
    time: document.getElementById("panel-time"),
  };

  function getActiveTabFromHash() {
    const hash = (window.location.hash || "").replace("#", "").toLowerCase();
    return VALID_TABS.includes(hash) ? hash : "encoders";
  }

  function switchTab(tabId) {
    if (!VALID_TABS.includes(tabId)) tabId = "encoders";

    tabButtons.forEach((btn) => {
      const isTarget = btn.getAttribute("data-tab") === tabId;
      btn.classList.toggle("active", isTarget);
      btn.setAttribute("aria-selected", String(isTarget));
    });

    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) {
        panel.hidden = key !== tabId;
      }
    });

    if (window.location.hash !== `#${tabId}`) {
      history.replaceState(null, "", `#${tabId}`);
    }

    savePreferences({ lastTab: tabId });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      switchTab(tabId);
    });
  });

  window.addEventListener("hashchange", () => {
    switchTab(getActiveTabFromHash());
  });

  // Initial tab load
  const initialTab = getActiveTabFromHash();
  switchTab(initialTab);

  // 3. Share Link Button
  const shareBtn = document.getElementById("share-link-btn");
  shareBtn?.addEventListener("click", () => {
    copyWithFeedback(window.location.href, shareBtn);
  });

  // 4. Initialize UI Logic
  initCryptoUI();
});
