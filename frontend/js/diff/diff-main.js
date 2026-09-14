/**
 * Code Difference Checker Entry Point (`diff-main.js`)
 *
 * Standalone controller for `/diff`. Owns the theme and the three deep-linkable
 * tabs; the workbench itself lives in `diff-ui.js`.
 *
 * The theme key is shared with the SPA, so a visitor who chose light on the
 * portfolio arrives here in light.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

import { initWorkbench, readPreferences } from "./diff-ui.js";

const VALID_TABS = ["compare", "patch", "about"];
const STORAGE_KEY = "rj-diff:preferences";

/** Shared with the SPA, so a visitor who picked light on the portfolio keeps it. */
const THEME_KEY = "theme";

function tabFromHash() {
  const hash = window.location.hash.replace(/^#/, "");
  return VALID_TABS.includes(hash) ? hash : null;
}

function writeTab(tab) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const preferences = raw ? JSON.parse(raw) : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...preferences, tab }));
  } catch {
    // Quota, private mode or storage disabled — the tab choice is a convenience.
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  const shell = document.querySelector(".diff-shell");

  /* --- theme ----------------------------------------------------------- */

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function syncThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0f1a" : "#f8fafc");
  }

  const themeToggle = document.getElementById("theme-toggle-btn");

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    syncThemeColor(theme);
    if (themeToggle) {
      const icon = themeToggle.querySelector("i");
      if (icon) icon.className = theme === "dark" ? "fas fa-sun" : "fas fa-moon";
      themeToggle.setAttribute(
        "aria-label",
        `Switch to ${theme === "dark" ? "light" : "dark"} theme`
      );
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

  try {
    initWorkbench();
  } catch (error) {
    // An error boundary: a thrown module error should leave a message on the
    // page rather than a blank one with a console nobody opens.
    const stats = document.getElementById("diff-stats");
    if (stats) {
      stats.textContent = `The checker failed to start: ${error.message}`;
    }
    return;
  }

  /* --- tabs ------------------------------------------------------------ */

  const tabButtons = Array.from(document.querySelectorAll(".tab-btn[data-tab]"));
  const panels = new Map(
    VALID_TABS.map((tab) => [tab, document.getElementById(`panel-${tab}`)])
  );

  function activate(tab, { updateHash = true } = {}) {
    if (!VALID_TABS.includes(tab)) return;
    for (const button of tabButtons) {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const [name, panel] of panels) {
      if (panel) panel.hidden = name !== tab;
    }
    if (shell) shell.dataset.tab = tab;
    writeTab(tab);
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

  activate(tabFromHash() ?? readPreferences().tab ?? "compare", { updateHash: false });
});
