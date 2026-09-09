// NOTE: These values are also hardcoded in index.html (mailto links,
// structured data, connect menu). Keep them in sync when changing.
export const CONTACT_EMAIL = "inboxtorj@gmail.com";

export const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
export const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
export const compactViewport = window.matchMedia("(max-width: 1150px)");
export const supportsHover = window.matchMedia("(hover: hover) and (pointer: fine)");
// Phones only: coarse pointer (touch) AND narrow screen (≤768px).
// iPads are typically 768px+ in portrait; laptops always have a fine pointer.
export const mobileDevice = window.matchMedia("(pointer: coarse) and (max-width: 768px)");
// Animated background gate: desktops and wider screens only. A coarse pointer
// means a phone or tablet, and a sub-1024px window is not a desktop layout
// either. Both animated layers - the full-viewport plexus in `three-bg.js` and
// the hero particle fallback in `particles-config.js` - are gated on this, and
// the `(width < 1024px), (pointer: coarse)` block in `styles.css` mirrors it so
// the fixed canvas cannot paint before the scripts have run.
export const desktopBackground = window.matchMedia("(min-width: 1024px) and (pointer: fine)");

/* The motion scale lives in `styles.css`'s token region, and JS that animates
   alongside CSS has to read it rather than restate it: `animations.js` carried
   its own 180ms twice, which is `--motion-base` written a second time in a
   second language, free to drift the moment the token moves.

   Cached because the scale is static - the theme customiser rewrites colour
   tokens on `body`, never these - so this is one getComputedStyle per token
   for the life of the page rather than one per animation frame.

   The fallback matters: under jsdom, and before the stylesheet has applied,
   the property resolves empty. Callers get a sane number instead of NaN. */
const motionCache = new Map();

/**
 * A `--motion-*` token as a number of milliseconds.
 *
 * @param {string} name Token name without the leading dashes, e.g. "base".
 * @param {number} fallbackMs Used when the token is absent or unparseable.
 * @returns {number} Duration in milliseconds.
 */
export function motionMs(name, fallbackMs) {
  if (motionCache.has(name)) return motionCache.get(name);
  let resolved = fallbackMs;
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(`--motion-${name}`)
      .trim();
    const match = /^([\d.]+)(ms|s)$/.exec(raw);
    if (match) {
      const value = parseFloat(match[1]);
      if (Number.isFinite(value)) {
        resolved = match[2] === "s" ? value * 1000 : value;
      }
    }
  } catch {
    // No computed style available - keep the fallback.
  }
  motionCache.set(name, resolved);
  return resolved;
}
