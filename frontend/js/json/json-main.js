/**
 * JSON Workbench Entry Point (`json-main.js`)
 *
 * Standalone controller for `/json`. Owns the theme, the four deep-linkable
 * tabs, preference persistence and an error boundary; the workbench itself
 * lives in `json-ui.js`.
 *
 * **Document text is not persisted by default.** People paste bearer tokens,
 * customer records and internal schemas into JSON tools, and a workbench that
 * quietly kept the last one in `localStorage` would be a liability on a shared
 * machine. `rj-json:preferences` holds the tab and the formatting options; the
 * document joins it only while "Remember my document" is on, and that switch
 * defaults to off.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

import { initWorkbench } from "./json-ui.js";

const VALID_TABS = ["format", "query", "tree", "convert"];
const STORAGE_KEY = "rj-json:preferences";

/** Shared with the SPA, so a visitor who picked light on the portfolio keeps it. */
const THEME_KEY = "theme";

function readPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePreferences(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPreferences(), ...patch }));
  } catch {
    // Quota, private mode or storage disabled — preferences are a convenience.
  }
}

function tabFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  return VALID_TABS.includes(hash) ? hash : null;
}

document.addEventListener("DOMContentLoaded", () => {
  const preferences = readPreferences();
  const root = document.documentElement;

  /* --- theme ----------------------------------------------------------- */

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function syncThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#090d16" : "#f8fafc");
  }

  const themeToggle = document.getElementById("theme-toggle-btn");

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    syncThemeColor(theme);
    if (themeToggle) {
      const icon = themeToggle.querySelector("i");
      if (icon) icon.className = theme === "dark" ? "fas fa-sun" : "fas fa-moon";
      themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
    }
  }

  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem(THEME_KEY);
  } catch {
    storedTheme = null;
  }
  applyTheme(storedTheme === "light" || storedTheme === "dark" ? storedTheme : systemTheme());

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Not fatal — the choice just will not survive a reload.
      }
    });
  }

  /* --- workbench ------------------------------------------------------- */

  const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
  const panels = new Map(VALID_TABS.map((tab) => [tab, document.getElementById(`panel-${tab}`)]));

  let workbench;
  try {
    workbench = initWorkbench({
      preferences,
      onPreferenceChange: writePreferences,
      onTabChange: (tab) => {
        for (const button of tabButtons) {
          const active = button.dataset.tab === tab;
          button.classList.toggle("active", active);
          button.setAttribute("aria-selected", String(active));
          button.tabIndex = active ? 0 : -1;
        }
        for (const [name, panel] of panels) {
          if (panel) panel.hidden = name !== tab;
        }
      },
    });
  } catch (error) {
    // An error boundary: a thrown module error should leave a message on the
    // page rather than a blank one with a console nobody opens.
    const status = document.getElementById("source-status");
    if (status) {
      status.className = "status-strip is-error";
      status.textContent = `The workbench failed to start: ${error.message}`;
    }
    return;
  }

  function activate(tab, { updateHash = true } = {}) {
    if (!VALID_TABS.includes(tab)) return;
    workbench.setActiveTab(tab);
    writePreferences({ tab });
    if (updateHash && window.location.hash.replace(/^#/, "") !== tab) {
      window.history.replaceState(null, "", `#${tab}`);
    }
  }

  for (const [index, button] of tabButtons.entries()) {
    button.addEventListener("click", () => activate(button.dataset.tab));
    button.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = tabButtons[(index + step + tabButtons.length) % tabButtons.length];
      next.focus();
      activate(next.dataset.tab);
    });
  }

  window.addEventListener("hashchange", () => {
    const tab = tabFromHash();
    if (tab) activate(tab, { updateHash: false });
  });

  /* --- privacy --------------------------------------------------------- */

  const rememberToggle = document.getElementById("remember-document");
  if (rememberToggle) {
    rememberToggle.checked = Boolean(preferences.remember);
    rememberToggle.addEventListener("change", () => {
      writePreferences({
        remember: rememberToggle.checked,
        document: rememberToggle.checked ? workbench.getDocument() : "",
      });
    });
  }

  const clearButton = document.getElementById("btn-clear-all");
  if (clearButton) {
    let confirmTimer = null;
    clearButton.addEventListener("click", () => {
      if (!clearButton.classList.contains("is-confirming")) {
        clearButton.classList.add("is-confirming");
        const originalText = clearButton.innerHTML;
        clearButton.dataset.originalText = originalText;
        clearButton.innerHTML = '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i> Confirm Clear?';
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          clearButton.classList.remove("is-confirming");
          clearButton.innerHTML = originalText;
        }, 3000);
        return;
      }
      clearTimeout(confirmTimer);
      clearButton.classList.remove("is-confirming");
      if (clearButton.dataset.originalText) {
        clearButton.innerHTML = clearButton.dataset.originalText;
      }
      workbench.clearAll();
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing to undo if storage was unavailable in the first place.
      }
      if (rememberToggle) rememberToggle.checked = false;
      clearButton.classList.add("cleared");
      window.setTimeout(() => clearButton.classList.remove("cleared"), 1200);
    });
  }

  activate(tabFromHash() ?? (VALID_TABS.includes(preferences.tab) ? preferences.tab : "format"), {
    updateHash: Boolean(tabFromHash()),
  });
});
