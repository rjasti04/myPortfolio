/**
 * Unix Time Workbench Module
 *
 * Provides bidirectional transformations and live utilities for Unix timestamps:
 * - Real-time clock tick (UTC & Local seconds and milliseconds)
 * - Unix Epoch (seconds/milliseconds) <-> ISO 8601 & formatted Local dates
 * - Human-friendly relative time computation ("just now", "X minutes ago", "in Y hours")
 *
 * Zero external libraries (no moment, no date-fns).
 */

/**
 * Returns the current time metrics for the live clock.
 * @returns {{
 *   epochSeconds: number,
 *   epochMs: number,
 *   iso: string,
 *   utcString: string,
 *   localString: string
 * }}
 */
export function getLiveClock() {
  const now = new Date();
  const epochMs = now.getTime();
  const epochSeconds = Math.floor(epochMs / 1000);

  return {
    epochSeconds,
    epochMs,
    iso: now.toISOString(),
    utcString: now.toUTCString(),
    localString: now.toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "long",
    }),
  };
}

/**
 * Converts a Unix epoch timestamp (seconds or milliseconds) into structured date formats.
 * @param {number|string} epochInput
 * @returns {{
 *   valid: boolean,
 *   error?: string,
 *   epochSeconds?: number,
 *   epochMs?: number,
 *   iso?: string,
 *   utcString?: string,
 *   localString?: string,
 *   relative?: string
 * }}
 */
export function epochToDetails(epochInput) {
  if (epochInput === null || epochInput === undefined || String(epochInput).trim() === "") {
    return { valid: false, error: "Please enter a timestamp." };
  }

  const num = Number(String(epochInput).trim());
  if (isNaN(num)) {
    return { valid: false, error: "Invalid numeric timestamp." };
  }

  // Auto-detect seconds vs milliseconds:
  // Timestamps < 100,000,000,000 (year 5138 in seconds) are treated as seconds.
  const isSeconds = Math.abs(num) < 1e11;
  const epochMs = isSeconds ? Math.round(num * 1000) : Math.round(num);
  const epochSeconds = isSeconds ? Math.round(num) : Math.floor(num / 1000);

  const date = new Date(epochMs);
  if (isNaN(date.getTime())) {
    return { valid: false, error: "Out of range timestamp." };
  }

  return {
    valid: true,
    epochSeconds,
    epochMs,
    iso: date.toISOString(),
    utcString: date.toUTCString(),
    localString: date.toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "long",
    }),
    relative: formatRelativeTime(epochMs),
  };
}

/**
 * Parses a human-readable date or ISO 8601 string into Unix timestamps.
 * @param {string} dateString
 * @returns {{
 *   valid: boolean,
 *   error?: string,
 *   epochSeconds?: number,
 *   epochMs?: number,
 *   iso?: string,
 *   utcString?: string,
 *   localString?: string,
 *   relative?: string
 * }}
 */
export function parseDateInput(dateString) {
  if (!dateString || !dateString.trim()) {
    return { valid: false, error: "Please enter a date string." };
  }

  const date = new Date(dateString.trim());
  if (isNaN(date.getTime())) {
    return { valid: false, error: "Unable to parse date string." };
  }

  const epochMs = date.getTime();
  const epochSeconds = Math.floor(epochMs / 1000);

  return {
    valid: true,
    epochSeconds,
    epochMs,
    iso: date.toISOString(),
    utcString: date.toUTCString(),
    localString: date.toLocaleString(undefined, {
      dateStyle: "full",
      timeStyle: "long",
    }),
    relative: formatRelativeTime(epochMs),
  };
}

/**
 * Calculates a human-readable relative time string.
 * @param {number} targetEpochMs
 * @param {number} [nowMs=Date.now()]
 * @returns {string}
 */
export function formatRelativeTime(targetEpochMs, nowMs = Date.now()) {
  const diffSec = Math.round((targetEpochMs - nowMs) / 1000);
  const absSec = Math.abs(diffSec);

  if (absSec < 5) return "just now";

  const units = [
    { name: "year", seconds: 31536000 },
    { name: "month", seconds: 2592000 },
    { name: "day", seconds: 86400 },
    { name: "hour", seconds: 3600 },
    { name: "minute", seconds: 60 },
    { name: "second", seconds: 1 },
  ];

  for (const { name, seconds } of units) {
    const count = Math.floor(absSec / seconds);
    if (count >= 1) {
      const plural = count === 1 ? name : `${name}s`;
      return diffSec < 0 ? `${count} ${plural} ago` : `in ${count} ${plural}`;
    }
  }

  return "just now";
}
