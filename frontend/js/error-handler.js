// Client-side error reporting.
//
// This module used to also carry a speculative error-handling layer -
// AppError/NetworkError/APIError/ValidationError plus handleError,
// withErrorHandling and retryWithBackoff. Nothing ever imported any of it: the
// call sites that do exist throw plain Errors and surface them with
// `showToast` from utils.js, and the subclasses were never constructed. It was
// removed rather than left as a second, unused way to do what the code already
// does.

// --- Reporting -------------------------------------------------------------
// Production JS failures previously reached nobody: they went to console.error
// and nothing forwarded them, so the only way to learn the site was broken was
// for someone to say so. These ride the analytics pipeline that already exists
// rather than a dedicated endpoint - DATA-01 is parked, and a `client_error`
// event needs no new surface, no new auth and no new table.

// Per page load. An error inside a render loop or an interval can fire
// thousands of times a second; without a cap the reporter becomes the outage.
const MAX_REPORTS_PER_PAGE = 10;
let reportsSent = 0;
const seenSignatures = new Set();

/** Trims a stack to something useful but bounded. */
function stackHead(error) {
  const stack = typeof error?.stack === "string" ? error.stack : "";
  return stack.split("\n").slice(0, 4).join(" | ").slice(0, 500);
}

/**
 * Forwards one client-side error to the analytics pipeline.
 *
 * Deliberately best-effort and silent: a failure to report must never surface
 * to the visitor or trigger another report.
 *
 * @param {unknown} error   the thrown value, which need not be an Error
 * @param {object} context  where it came from, e.g. { source: "onerror" }
 */
export function reportClientError(error, context = {}) {
  try {
    if (reportsSent >= MAX_REPORTS_PER_PAGE) return;

    const name = error?.name || typeof error;
    const message = String(error?.message ?? error ?? "").slice(0, 300);

    // The same error repeating is one fact, not a hundred.
    const signature = `${name}:${message}`;
    if (seenSignatures.has(signature)) return;
    seenSignatures.add(signature);
    reportsSent += 1;

    import("./analytics.js")
      .then(({ trackEvent }) => {
        trackEvent("client_error", {
          name: String(name).slice(0, 100),
          message,
          stack_head: stackHead(error),
          // Hash, not href: the query string can carry a reset or magic-link
          // token, and this payload is persisted.
          path: `${window.location.pathname}${window.location.hash}`,
          ...context,
        });
      })
      .catch(() => {});
  } catch {
    // Reporting must never be the thing that breaks the page.
  }
}
