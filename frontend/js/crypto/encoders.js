/**
 * Encoders & Decoders Module
 *
 * Provides bidirectional transformations between text and various encoding formats:
 * - Base64 (UTF-8 safe text & file Data URI with strict 5 MB cap)
 * - URL encoding / decoding
 * - Hexadecimal (byte-level UTF-8)
 * - HTML Entities (named and numeric character references)
 * - Binary (8-bit byte representations)
 *
 * Uses native browser TextEncoder, TextDecoder, and FileReader. Zero dependencies.
 */

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Encodes a string to UTF-8 Base64.
 * Handles multibyte Unicode characters (emojis, accented characters, CJK).
 * @param {string} str
 * @returns {string} Base64 encoded string
 */
export function encodeBase64(str) {
  if (!str) return "";
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const len = bytes.byteLength;
  const chunk = 8192;
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, len)));
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string to a UTF-8 string.
 * @param {string} b64
 * @returns {string} Decoded UTF-8 string
 */
export function decodeBase64(b64) {
  if (!b64) return "";
  const clean = b64.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Reads a File or Blob object into a Base64 Data URI string.
 * Rejects files larger than 5 MB to prevent browser memory exhaustion.
 * @param {File|Blob} file
 * @returns {Promise<string>} Resolves with the Data URI string
 */
export function fileToBase64DataUri(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file provided."));
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      reject(new Error(`File size (${sizeMb} MB) exceeds the strict 5 MB limit.`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

/**
 * URL encodes a string.
 * @param {string} str
 * @param {boolean} componentMode - true uses encodeURIComponent, false uses encodeURI
 * @returns {string}
 */
export function encodeUrl(str, componentMode = true) {
  if (!str) return "";
  return componentMode ? encodeURIComponent(str) : encodeURI(str);
}

/**
 * Decodes a URL-encoded string.
 * @param {string} str
 * @param {boolean} plusAsSpace - Whether '+' should be converted to space before decode
 * @returns {string}
 */
export function decodeUrl(str, plusAsSpace = true) {
  if (!str) return "";
  const prepared = plusAsSpace ? str.replace(/\+/g, " ") : str;
  return decodeURIComponent(prepared);
}

/**
 * Encodes text into hexadecimal byte values.
 * @param {string} str
 * @param {string} delimiter - optional delimiter between bytes (e.g. " " or "")
 * @returns {string}
 */
export function textToHex(str, delimiter = "") {
  if (!str) return "";
  const bytes = new TextEncoder().encode(str);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(delimiter);
}

/**
 * Decodes a hexadecimal string back to text.
 * @param {string} hex
 * @returns {string}
 */
export function hexToText(hex) {
  if (!hex) return "";
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex string (length must be even).");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Escapes HTML characters to named entities.
 * @param {string} str
 * @returns {string}
 */
export function encodeHtmlEntities(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

/**
 * Decodes HTML entities (both named and numeric) to normal text.
 * @param {string} str
 * @returns {string}
 */
export function decodeHtmlEntities(str) {
  if (!str) return "";
  const entityMap = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };

  return str.replace(/&(?:[a-zA-Z]+|#\d+|#x[a-fA-F0-9]+);/g, (entity) => {
    if (entityMap[entity]) return entityMap[entity];
    if (entity.startsWith("&#x") || entity.startsWith("&#X")) {
      const code = parseInt(entity.slice(3, -1), 16);
      return !isNaN(code) ? String.fromCodePoint(code) : entity;
    }
    if (entity.startsWith("&#")) {
      const code = parseInt(entity.slice(2, -1), 10);
      return !isNaN(code) ? String.fromCodePoint(code) : entity;
    }
    return entity;
  });
}

/**
 * Encodes text into 8-bit binary byte strings.
 * @param {string} str
 * @param {string} delimiter - delimiter between byte chunks (default: " ")
 * @returns {string}
 */
export function textToBinary(str, delimiter = " ") {
  if (!str) return "";
  const bytes = new TextEncoder().encode(str);
  return Array.from(bytes)
    .map((b) => b.toString(2).padStart(8, "0"))
    .join(delimiter);
}

/**
 * Decodes 8-bit binary byte representations back to text.
 * @param {string} bin
 * @returns {string}
 */
export function binaryToText(bin) {
  if (!bin) return "";
  const clean = bin.trim().replace(/[^01]/g, "");
  if (clean.length % 8 !== 0) {
    throw new Error("Invalid binary representation (total bits must be a multiple of 8).");
  }
  const bytes = new Uint8Array(clean.length / 8);
  for (let i = 0; i < clean.length; i += 8) {
    bytes[i / 8] = parseInt(clean.slice(i, i + 8), 2);
  }
  return new TextDecoder().decode(bytes);
}
