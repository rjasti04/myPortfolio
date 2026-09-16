import { prefersDarkScheme } from "./config.js";
import { trackEvent } from "./analytics.js";
import { reapplyCustomTheme, syncThemeColorMeta } from "./theme-customizer.js";

let themeBtn, themeIcon;

/**
 * The three states the header control cycles through.
 *
 * "system" is the one that did not exist. Storage held only "dark" or "light",
 * and initTheme follows the OS only while NOTHING is stored - so the first
 * press of the toggle was a one-way door: it wrote a preference that nothing
 * could ever remove, and a visitor who wanted to go back to following their
 * OS had to clear site data for the origin.
 */
const THEME_MODES = ["light", "dark", "system"];

/** The stored mode, defaulting to "system" when nothing is stored. */
export function readThemeMode() {
  try {
    const stored = localStorage.getItem("theme");
    return THEME_MODES.includes(stored) ? stored : "system";
  } catch {
    // Storage blocked - follow the OS for this view.
    return "system";
  }
}

function writeThemeMode(mode) {
  try {
    // "system" is the ABSENCE of a preference, not a third stored value:
    // readStoredTheme below and the inline bootstrap in index.html both treat
    // a missing key as "ask the OS", and storing the word would make them
    // fall through to light instead.
    if (mode === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", mode);
  } catch {
    // Storage unavailable - the theme still applies for this view.
  }
}

/** Does `mode` resolve to a dark page right now? */
function modeIsDark(mode) {
  return mode === "system" ? prefersDarkScheme.matches : mode === "dark";
}

/* Every glyph here must exist in the vendored Font Awesome subset.
   `scripts/vendor_fonts.py` subsets to the icons the source actually uses and
   the fonts are committed rather than rebuilt by `npm run build`, so an icon
   from outside it renders as a blank box in production. These three are in it;
   fa-circle-half-stroke, the obvious pick for "system", is not. */
const MODE_ICON = {
  light: "fas fa-moon",
  dark: "fas fa-sun",
  system: "fas fa-display",
};

const MODE_LABEL = {
  light: "Theme: light. Switch to dark.",
  dark: "Theme: dark. Follow system.",
  system: "Theme: following system. Switch to light.",
};

/** Point the button's icon and accessible name at the mode now in effect. */
function syncThemeButton(mode) {
  if (themeIcon) themeIcon.className = MODE_ICON[mode];
  if (themeBtn) {
    themeBtn.setAttribute("aria-label", MODE_LABEL[mode]);
    themeBtn.setAttribute("title", MODE_LABEL[mode]);
  }
}

/**
 * Advance light -> dark -> system -> light and apply the result.
 *
 * Separate from `toggleTheme` on purpose: that one is a straight binary flip
 * and the command prompt's `theme` command returns its boolean, so widening
 * it would change a published contract for the sake of the header button.
 *
 * @returns {string} the mode now in effect.
 */
export function cycleTheme() {
  const next = THEME_MODES[(THEME_MODES.indexOf(readThemeMode()) + 1) % THEME_MODES.length];
  trackEvent("theme_change", { theme: next });
  writeThemeMode(next);
  applyTheme(modeIsDark(next));
  syncThemeButton(next);
  return next;
}

export function applyTheme(isDark) {
  document.body.classList.toggle("dark-theme", isDark);
  // The class lives on <body>, but the browser resolves the palette for the
  // viewport scrollbars and the canvas from the ROOT element, so body alone
  // leaves a white scrollbar on a dark page. Mirrors the inline bootstrap in
  // index.html, which sets the same property before first paint.
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  // The button's icon and name are NOT set here. They describe the MODE
  // (light / dark / system), and this function only knows the resolved
  // colour - dark-because-chosen and dark-because-the-OS-says-so look
  // identical from in here. syncThemeButton owns the control; aria-pressed is
  // gone with it, because a three-state control is not a pressed/unpressed
  // one and announcing it as such was worse than not announcing it.


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
  // The icon and the accessible name have to state which of the THREE modes
  // is in effect, and a stored preference is indistinguishable from following
  // the OS by looking at the page alone.
  syncThemeButton(readThemeMode());

  themeBtn?.addEventListener("click", () => {
    cycleTheme();
  });

  prefersDarkScheme.addEventListener("change", (event) => {
    // No stored choice - which is also what a blocked store reports - means
    // the OS is the authority.
    if (readStoredTheme() === null) {
      applyTheme(event.matches);
    }
  });
}
