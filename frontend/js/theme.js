import { prefersDarkScheme } from "./config.js";
import { trackEvent } from "./analytics.js";
import { reapplyCustomTheme, syncThemeColorMeta } from "./theme-customizer.js";

let themeBtn, themeIcon;

export function applyTheme(isDark) {
  document.body.classList.toggle("dark-theme", isDark);
  // The class lives on <body>, but the browser resolves the palette for the
  // viewport scrollbars and the canvas from the ROOT element, so body alone
  // leaves a white scrollbar on a dark page. Mirrors the inline bootstrap in
  // index.html, which sets the same property before first paint.
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  if (themeIcon) {
    themeIcon.className = isDark ? "fas fa-sun" : "fas fa-moon";
  }
  if (themeBtn) {
    themeBtn.setAttribute("aria-pressed", String(isDark));
  }
  
  if (typeof reapplyCustomTheme === "function") {
    reapplyCustomTheme(isDark);
  }

  // Still needed after `reapplyCustomTheme`, which syncs the meta tag itself
  // but returns early when there is no custom palette at all - the plain
  // light/dark flip on the shipped colours has to move the browser bar too.
  syncThemeColorMeta(isDark);
}

/**
 * Flip the theme, persisting and tracking it exactly as the header button
 * does. Exported so callers (the command prompt) don't have to synthesise a
 * click on `#theme-toggle` to change the theme.
 *
 * @returns {boolean} true when the resulting theme is dark.
 */
export function toggleTheme() {
  const nextValue = !document.body.classList.contains("dark-theme");
  trackEvent("theme_change", { theme: nextValue ? "dark" : "light" });
  applyTheme(nextValue);
  try {
    localStorage.setItem("theme", nextValue ? "dark" : "light");
  } catch {
    // Storage unavailable — the theme still applies for this view.
  }
  return nextValue;
}

export function initTheme() {
  themeBtn = document.getElementById("theme-toggle");
  themeIcon = document.getElementById("theme-icon");

  // Must match the inline bootstrap in index.html exactly: a saved choice wins,
  // otherwise follow the OS. If these two disagree the theme visibly changes at
  // DOMContentLoaded, which is the flash the bootstrap exists to prevent.
  const savedTheme = localStorage.getItem("theme");
  applyTheme(savedTheme ? savedTheme === "dark" : prefersDarkScheme.matches);

  themeBtn?.addEventListener("click", () => {
    toggleTheme();
  });

  prefersDarkScheme.addEventListener("change", (event) => {
    if (!localStorage.getItem("theme")) {
      applyTheme(event.matches);
    }
  });
}
