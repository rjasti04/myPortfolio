/**
 * JWT decoder for /crypto.
 *
 * Decode only. This page will never offer to verify a signature, and the panel
 * says so: verification needs the signing key, and a tool that appears to
 * verify - but is really checking a key the visitor pasted in next to the
 * token - is worse than one that plainly does not. What it does instead is the
 * part that is genuinely useful without a key: show what the token claims
 * about itself, and whether it has expired.
 *
 * Almost all of this is wiring two modules that already exist: Base64URL
 * decoding is the same transform as `encoders.js`, and the `exp`/`iat`/`nbf`
 * rendering is `time-workbench.js`'s relative formatter.
 */

import { formatRelativeTime } from "./time-workbench.js";

/** Claims with a registered meaning, so the panel can annotate them. */
const REGISTERED_CLAIMS = {
  iss: "Issuer",
  sub: "Subject",
  aud: "Audience",
  exp: "Expires at",
  nbf: "Not valid before",
  iat: "Issued at",
  jti: "JWT ID",
};

/** The three claims carrying NumericDate values, which render as a time. */
const TIME_CLAIMS = ["exp", "nbf", "iat"];

/**
 * Base64URL -> string.
 *
 * Base64URL swaps `+/` for `-_` and drops the padding, so both have to be put
 * back before atob() will look at it. The result is decoded as UTF-8, since a
 * `name` claim holding a non-ASCII character is ordinary.
 */
function decodeBase64Url(segment) {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Decode a JWT into its header and payload.
 *
 * Never throws: a malformed token is a thing people paste constantly, usually
 * because it was truncated on the way, and an exception at that point tells
 * them less than a sentence does. Returns `{ valid: false, error }` instead.
 *
 * @param {string} token
 * @param {number} nowMs - injectable so the expiry wording is testable
 * @returns {{valid: boolean, error?: string, header?: object, payload?: object,
 *            signature?: string, claims?: Array, expired?: boolean|null}}
 */
export function decodeJwt(token, nowMs = Date.now()) {
  const raw = (token || "").trim();
  if (!raw) return { valid: false, error: "Paste a token to decode it." };

  const parts = raw.split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      error: `A JWT has three dot-separated parts; this has ${parts.length}.`,
    };
  }

  let header;
  let payload;
  try {
    header = JSON.parse(decodeBase64Url(parts[0]));
  } catch {
    return { valid: false, error: "The header is not valid Base64URL-encoded JSON." };
  }
  try {
    payload = JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return { valid: false, error: "The payload is not valid Base64URL-encoded JSON." };
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, error: "The payload decoded, but it is not a JSON object." };
  }

  return {
    valid: true,
    header,
    payload,
    signature: parts[2],
    claims: describeClaims(payload, nowMs),
    expired: typeof payload.exp === "number" ? payload.exp * 1000 <= nowMs : null,
  };
}

/**
 * Flatten the payload into rows the panel renders, annotating the registered
 * claims and turning the three NumericDate ones into readable times.
 *
 * A NumericDate is seconds, not milliseconds - a distinction worth getting
 * right here, because a token read as 1970 is the classic symptom of missing
 * it.
 */
export function describeClaims(payload, nowMs = Date.now()) {
  return Object.entries(payload).map(([key, value]) => {
    const row = {
      key,
      label: REGISTERED_CLAIMS[key] ?? null,
      value: typeof value === "object" && value !== null ? JSON.stringify(value) : String(value),
      relative: null,
    };

    if (TIME_CLAIMS.includes(key) && typeof value === "number" && Number.isFinite(value)) {
      const ms = value * 1000;
      row.value = new Date(ms).toISOString();
      row.relative = formatRelativeTime(ms, nowMs);
    }

    return row;
  });
}
