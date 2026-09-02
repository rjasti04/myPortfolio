import { prefersDarkScheme } from "./config.js";
import { trackEvent } from "./analytics.js";
import { reapplyCustomTheme } from "./theme-customizer.js";

let themeBtn, themeIcon, themeColorMeta;

export function applyTheme(isDark) {
  document.body.classList.toggle("dark-theme", isDark);
  if (themeIcon) {
    themeIcon.className = isDark ? "fas fa-sun" : "fas fa-moon";
  }
  if (themeBtn) {
    themeBtn.setAttribute("aria-pressed", String(isDark));
  }
  
  if (typeof reapplyCustomTheme === "function") {
    reapplyCustomTheme(isDark);
  }

  if (themeColorMeta) {
    // Use computed CSS variable instead of hardcoded color
    // Read from body because customizer applies properties on body
    const accentColor = getComputedStyle(document.body)
      .getPropertyValue('--accent-fill').trim();
    themeColorMeta.setAttribute("content", accentColor || (isDark ? "#0a0a0b" : "#F59E0B"));
  }
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
  themeColorMeta = document.querySelector('meta[name="theme-color"]');

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
