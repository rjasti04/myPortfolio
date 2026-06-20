// Centralized error handling utilities

export class AppError extends Error {
  constructor(message, code = "UNKNOWN_ERROR", details = null) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export class NetworkError extends AppError {
  constructor(message = "Network request failed", details = null) {
    super(message, "NETWORK_ERROR", details);
    this.name = "NetworkError";
  }
}

export class APIError extends AppError {
  constructor(
    message = "API request failed",
    statusCode = 500,
    details = null,
  ) {
    super(message, "API_ERROR", details);
    this.name = "APIError";
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", fields = {}) {
    super(message, "VALIDATION_ERROR", fields);
    this.name = "ValidationError";
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
    fallbackMessage = "An unexpected error occurred",
  } = options;

  let userMessage = fallbackMessage;
  let logMessage = error.message || fallbackMessage;

  if (error instanceof NetworkError) {
    userMessage = "Unable to connect. Please check your internet connection.";
  } else if (error instanceof APIError) {
    if (error.statusCode === 429) {
      userMessage = "Too many requests. Please wait a moment and try again.";
    } else if (error.statusCode === 404) {
      userMessage = "The requested resource was not found.";
    } else if (error.statusCode >= 500) {
      userMessage = "Server error. Please try again later.";
    } else {
      userMessage = error.message || "Request failed. Please try again.";
    }
  } else if (error instanceof ValidationError) {
    userMessage = error.message;
  } else if (error instanceof AppError) {
    userMessage = error.message;
  }

  if (logToConsole) {
    console.error(`[${error.name || "Error"}]`, logMessage, error);
  }

  if (showToast && typeof window !== "undefined") {
    // Dynamically import showToast to avoid circular dependencies
    import("./utils.js")
      .then(({ showToast }) => {
        showToast(userMessage, "error");
      })
      .catch(() => {
        // Fallback if toast fails
        console.warn("Toast notification failed:", userMessage);
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
  return async function (...args) {
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
    shouldRetry = (error) => error instanceof NetworkError,
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
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError;
}
