/**
 * Secure Generators Module
 *
 * Implements cryptographically secure generators:
 * - RFC 4122 UUID v4 (random UUID)
 * - RFC 9562 UUID v7 (time-ordered UUID with millisecond precision)
 * - Secure random tokens (Hex, Base64URL)
 * - Strong passwords with customizable character set guarantees
 * - Batch generation (1 to 50 count)
 *
 * Strictly uses native window.crypto.getRandomValues() and crypto.randomUUID(). Zero Math.random().
 */

const CHARSET_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHARSET_LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const CHARSET_NUMBERS = "0123456789";
const CHARSET_SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?";

/**
 * Safely resolves the Web Cryptography API instance across environments
 * (browser window, web workers, and Node.js test runtimes).
 * @returns {Crypto|null}
 */
function getCrypto() {
  if (typeof crypto !== "undefined") {
    return crypto;
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto) {
    return globalThis.crypto;
  }
  if (typeof window !== "undefined" && window.crypto) {
    return window.crypto;
  }
  if (typeof self !== "undefined" && self.crypto) {
    return self.crypto;
  }
  return null;
}

/**
 * Safely fills a typed array with cryptographically secure random values.
 * Throws if Web Cryptography API is unavailable.
 * @param {Uint8Array|Uint32Array} array
 * @returns {Uint8Array|Uint32Array}
 */
function getRandomValues(array) {
  const c = getCrypto();
  if (c && typeof c.getRandomValues === "function") {
    return c.getRandomValues(array);
  }
  throw new Error("crypto.getRandomValues() is not available in this environment");
}

/**
 * Converts a 16-byte Uint8Array into a canonical UUID string (8-4-4-4-12).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToUuid(bytes) {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Generates an RFC 4122 UUID v4.
 * Uses native crypto.randomUUID() when supported, with native getRandomValues fallback.
 * @returns {string}
 */
export function generateUuidV4() {
  const c = getCrypto();
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  const bytes = new Uint8Array(16);
  getRandomValues(bytes);
  // Set version 4: bits 12-15 of time_hi_and_version to 0100
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Set variant 1: bits 6-7 of clock_seq_hi_and_reserved to 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

/**
 * Generates an RFC 9562 UUID v7.
 * Encodes a 48-bit big-endian millisecond timestamp followed by version 7 and random entropy.
 * @param {number} [timestampMs=Date.now()]
 * @returns {string}
 */
export function generateUuidV7(timestampMs = Date.now()) {
  const bytes = new Uint8Array(16);
  getRandomValues(bytes);

  // 48-bit millisecond timestamp
  const ts = Math.floor(timestampMs);
  bytes[0] = Math.floor(ts / 0x10000000000) & 0xff;
  bytes[1] = Math.floor(ts / 0x100000000) & 0xff;
  bytes[2] = Math.floor(ts / 0x1000000) & 0xff;
  bytes[3] = Math.floor(ts / 0x10000) & 0xff;
  bytes[4] = Math.floor(ts / 0x100) & 0xff;
  bytes[5] = ts & 0xff;

  // Version 7: 0111
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variant 1: 10xx
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

/**
 * Extracts the 48-bit millisecond timestamp from an RFC 9562 UUID v7.
 * @param {string} uuid
 * @returns {number|null} Timestamp in milliseconds, or null if invalid format
 */
export function extractTimestampFromUuidV7(uuid) {
  if (!uuid || typeof uuid !== "string") return null;
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) return null;
  const tsHex = hex.slice(0, 12);
  const ts = parseInt(tsHex, 16);
  return isNaN(ts) ? null : ts;
}

/**
 * Generates a cryptographically secure random token.
 * @param {number} [length=32] - Token length
 * @param {"hex"|"base64url"|"password"} [type="hex"]
 * @param {object} [passwordOptions]
 * @param {boolean} [passwordOptions.uppercase=true]
 * @param {boolean} [passwordOptions.lowercase=true]
 * @param {boolean} [passwordOptions.numbers=true]
 * @param {boolean} [passwordOptions.symbols=true]
 * @returns {string}
 */
export function generateSecureToken(length = 32, type = "hex", passwordOptions = {}) {
  const safeLength = Math.max(4, Math.min(256, Math.floor(length) || 32));

  if (type === "hex") {
    const byteCount = Math.ceil(safeLength / 2);
    const bytes = new Uint8Array(byteCount);
    getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, safeLength);
  }

  if (type === "base64url") {
    const byteCount = Math.ceil((safeLength * 3) / 4);
    const bytes = new Uint8Array(byteCount);
    getRandomValues(bytes);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    return b64.slice(0, safeLength);
  }

  // Password generator
  const opts = {
    uppercase: passwordOptions.uppercase !== false,
    lowercase: passwordOptions.lowercase !== false,
    numbers: passwordOptions.numbers !== false,
    symbols: passwordOptions.symbols !== false,
  };

  let pool = "";
  const guaranteed = [];

  if (opts.uppercase) {
    pool += CHARSET_UPPERCASE;
    guaranteed.push(getRandomChar(CHARSET_UPPERCASE));
  }
  if (opts.lowercase) {
    pool += CHARSET_LOWERCASE;
    guaranteed.push(getRandomChar(CHARSET_LOWERCASE));
  }
  if (opts.numbers) {
    pool += CHARSET_NUMBERS;
    guaranteed.push(getRandomChar(CHARSET_NUMBERS));
  }
  if (opts.symbols) {
    pool += CHARSET_SYMBOLS;
    guaranteed.push(getRandomChar(CHARSET_SYMBOLS));
  }

  if (pool.length === 0) {
    pool = CHARSET_LOWERCASE + CHARSET_NUMBERS;
    guaranteed.push(getRandomChar(pool));
  }

  const result = [...guaranteed];
  const remainingCount = safeLength - result.length;

  if (remainingCount > 0) {
    const randomBytes = new Uint32Array(remainingCount);
    getRandomValues(randomBytes);
    for (let i = 0; i < remainingCount; i++) {
      result.push(pool[randomBytes[i] % pool.length]);
    }
  }

  // Fisher-Yates cryptographically sound shuffle
  shuffleArray(result);

  return result.slice(0, safeLength).join("");
}

/**
 * Returns a random character from a string using crypto.getRandomValues().
 * @param {string} chars
 * @returns {string}
 */
function getRandomChar(chars) {
  const buf = new Uint32Array(1);
  getRandomValues(buf);
  return chars[buf[0] % chars.length];
}

/**
 * Shuffles an array in place using Fisher-Yates with crypto.getRandomValues().
 * @param {Array} arr
 */
function shuffleArray(arr) {
  const randomBuf = new Uint32Array(arr.length);
  getRandomValues(randomBuf);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomBuf[i] % (i + 1);
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
}

/**
 * Generates a batch of items using a generator function.
 * @param {() => string} generatorFn
 * @param {number} [count=1] - Clamped between 1 and 50
 * @returns {string[]}
 */
export function generateBatch(generatorFn, count = 1) {
  const safeCount = Math.max(1, Math.min(50, Math.floor(count) || 1));
  const results = [];
  for (let i = 0; i < safeCount; i++) {
    results.push(generatorFn());
  }
  return results;
}
