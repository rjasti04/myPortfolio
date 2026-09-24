/**
 * Theme resolution for the Dev Tools apps, before first paint.
 *
 * A classic script, not a module: it is loaded blocking in <head>, ahead of
 * the stylesheets, which is the only point early enough. The four pages hard
 * code data-theme="dark" (the no-JS default), and their modules used to apply
 * a saved light theme at DOMContentLoaded - a visible dark flash on every load
 * for anyone who picked light. The SPA and the predictors resolve it early
 * already; these pages carry a CSP with `script-src 'self'`, so this is a
 * file rather than an inline script needing four more pinned hashes. The same
 * choice as js/theme-bootstrap.js, and built the same way (an IIFE entry in
 * scripts/build.mjs).
 *
 * Only data-theme is set here. The modules still run their own theme code,
 * which syncs the icon, the label and <meta name="theme-color">.
 */
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("theme");
  } catch (e) {
    /* Storage is blocked; fall through to the system preference. */
  }
  if (theme !== "light" && theme !== "dark") {
    theme =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
