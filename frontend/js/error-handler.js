// Centralized error handling utilities

export class AppError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export class NetworkError extends AppError {
  constructor(message = 'Network request failed', details = null) {
    super(message, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
  }
}

export class APIError extends AppError {
  constructor(message = 'API request failed', statusCode = 500, details = null) {
    super(message, 'API_ERROR', details);
    this.name = 'APIError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', fields = {}) {
    super(message, 'VALIDATION_ERROR', fields);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

/**
 * Handle errors consistently across the application
 * @param {Error} error - The error to handle
 * @param {Object} options - Handling options
 * @returns {string} User-friendly error message
 */
export function handleError(error, options = {}) {
  const {
    showToast = true,
    logToConsole = true,
    fallbackMessage = 'An unexpected error occurred'
  } = options;

  let userMessage = fallbackMessage;
  let logMessage = error.message || fallbackMessage;

  if (error instanceof NetworkError) {
    userMessage = 'Unable to connect. Please check your internet connection.';
  } else if (error instanceof APIError) {
    if (error.statusCode === 429) {
      userMessage = 'Too many requests. Please wait a moment and try again.';
    } else if (error.statusCode === 404) {
      userMessage = 'The requested resource was not found.';
    } else if (error.statusCode >= 500) {
      userMessage = 'Server error. Please try again later.';
    } else {
      userMessage = error.message || 'Request failed. Please try again.';
    }
  } else if (error instanceof ValidationError) {
    userMessage = error.message;
  } else if (error instanceof AppError) {
    userMessage = error.message;
  }

  if (logToConsole) {
    console.error(`[${error.name || 'Error'}]`, logMessage, error);
  }

  if (showToast && typeof window !== 'undefined') {
    // Dynamically import showToast to avoid circular dependencies
    import('./utils.js').then(({ showToast }) => {
      showToast(userMessage, 'error');
    }).catch(() => {
      // Fallback if toast fails
      console.warn('Toast notification failed:', userMessage);
    });
  }

  return userMessage;
}

/**
 * Wrap async functions with error handling
 * @param {Function} fn - Async function to wrap
 * @param {Object} options - Error handling options
 * @returns {Function} Wrapped function
 */
export function withErrorHandling(fn, options = {}) {
  return async function(...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      handleError(error, options);
      throw error;
    }
  };
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} Result of the function
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    shouldRetry = (error) => error instanceof NetworkError
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError;
}

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
