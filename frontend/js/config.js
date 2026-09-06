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
