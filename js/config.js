// NOTE: These values are also hardcoded in index.html (mailto links, footer,
// structured data, connect menu). Keep them in sync when changing.
export const CONTACT_EMAIL = "inboxtorj@gmail.com";
export const LINKEDIN_URL = "https://www.linkedin.com/in/rajeev-jasti-326080169";
export const GITHUB_URL = "https://github.com/rjasti04";
export const RESUME_URL = "rajeev_jasti.pdf";

export const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
export const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
export const compactViewport = window.matchMedia("(max-width: 900px)");
export const supportsHover = window.matchMedia("(hover: hover) and (pointer: fine)");
// Phones only: coarse pointer (touch) AND narrow screen (≤768px).
// iPads are typically 768px+ in portrait; laptops always have a fine pointer.
export const mobileDevice = window.matchMedia("(pointer: coarse) and (max-width: 768px)");
