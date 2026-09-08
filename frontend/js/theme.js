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

/**
 * The saved theme, or null when there is no choice to honour.
 *
 * Returns null both when nothing is stored and when storage is unreachable,
 * because the caller does the same thing in either case: fall back to the OS.
 */
function readStoredTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem("theme");
  } catch {
    // Storage blocked - follow the OS for this view.
    return null;
  }
  return stored === null ? null : stored === "dark";
}

export function initTheme() {
  themeBtn = document.getElementById("theme-toggle");
  themeIcon = document.getElementById("theme-icon");

  // Must match the inline bootstrap in index.html exactly: a saved choice wins,
  // otherwise follow the OS. If these two disagree the theme visibly changes at
  // DOMContentLoaded, which is the flash the bootstrap exists to prevent.
  //
  // Reading storage throws outright where it is blocked - Safari with "Block
  // All Cookies", strict privacy extensions - and this is the FIRST init
  // main.js runs. An uncaught throw here used to unwind the whole
  // DOMContentLoaded handler, so `initAnimations` never ran and every
  // `.reveal` element stayed at opacity 0: the contact form, both Apps tiles
  // and the About cards rendered as blank space. Same guard as the write in
  // toggleTheme above.
  applyTheme(readStoredTheme() ?? prefersDarkScheme.matches);

  themeBtn?.addEventListener("click", () => {
    toggleTheme();
  });

  prefersDarkScheme.addEventListener("change", (event) => {
    // No stored choice - which is also what a blocked store reports - means
    // the OS is the authority.
    if (readStoredTheme() === null) {
      applyTheme(event.matches);
    }
  });
}
