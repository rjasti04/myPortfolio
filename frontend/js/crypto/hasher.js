/**
 * Cryptographic Hasher Module
 *
 * Provides real-time calculation of SHA-256, SHA-512, and SHA-1 cryptographic hashes
 * using browser-native Web Cryptography API (`crypto.subtle`).
 * Zero external libraries.
 */

export const SUPPORTED_ALGORITHMS = ["SHA-256", "SHA-512", "SHA-1"];

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
 * Calculates cryptographic hash of a text string using native crypto.subtle.digest.
 * @param {string} text - Plaintext string to hash
 * @param {string} algorithm - "SHA-256" | "SHA-512" | "SHA-1"
 * @returns {Promise<{
 *   algorithm: string,
 *   hex: string,
 *   uppercaseHex: string,
 *   charCount: number,
 *   byteLength: number,
 *   durationMs: number
 * }>}
 */
export async function computeHash(text, algorithm = "SHA-256") {
  if (!SUPPORTED_ALGORITHMS.includes(algorithm)) {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }

  const c = getCrypto();
  if (!c || !c.subtle) {
    throw new Error("Web Cryptography API (crypto.subtle) is not available");
  }

  const start = performance.now();
  const encoded = new TextEncoder().encode(text || "");
  const hashBuffer = await c.subtle.digest(algorithm, encoded);
  const durationMs = performance.now() - start;

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return {
    algorithm,
    hex,
    uppercaseHex: hex.toUpperCase(),
    charCount: (text || "").length,
    byteLength: encoded.byteLength,
    durationMs: Math.round(durationMs * 100) / 100,
  };
}

/**
 * Concurrently calculates all supported cryptographic hashes for a text.
 * @param {string} text
 * @returns {Promise<Record<string, { hex: string, uppercaseHex: string, durationMs: number }>>}
 */
export async function computeAllHashes(text) {
  const [sha256, sha512, sha1] = await Promise.all([
    computeHash(text, "SHA-256"),
    computeHash(text, "SHA-512"),
    computeHash(text, "SHA-1"),
  ]);

  return {
    "SHA-256": sha256,
    "SHA-512": sha512,
    "SHA-1": sha1,
    metrics: {
      charCount: sha256.charCount,
      byteLength: sha256.byteLength,
    },
  };
}
