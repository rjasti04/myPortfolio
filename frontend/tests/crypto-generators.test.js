import test from "node:test";
import assert from "node:assert/strict";
import {
  generateUuidV4,
  generateUuidV7,
  extractTimestampFromUuidV7,
  generateSecureToken,
  generateBatch,
} from "../js/crypto/generators.js";

test("generateUuidV4: adheres to RFC 4122 canonical layout", () => {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (let i = 0; i < 20; i++) {
    const id = generateUuidV4();
    assert.equal(id.length, 36);
    assert.ok(uuidRegex.test(id), `Invalid v4 UUID: ${id}`);
  }
});

test("generateUuidV7: adheres to RFC 9562 time-ordered specification", () => {
  const uuidV7Regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const now = Date.now();
  const id = generateUuidV7(now);

  assert.equal(id.length, 36);
  assert.ok(uuidV7Regex.test(id), `Invalid v7 UUID: ${id}`);

  // Test timestamp extraction
  const extracted = extractTimestampFromUuidV7(id);
  assert.equal(extracted, now);
});

test("generateUuidV7: sequential generation exhibits chronological sort order", async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) {
    ids.push(generateUuidV7(1700000000000 + i * 100));
  }

  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, "UUID v7s were not chronologically ordered");
});

test("generateSecureToken: generates hex, base64url, and strong passwords", () => {
  const hexToken = generateSecureToken(32, "hex");
  assert.equal(hexToken.length, 32);
  assert.ok(/^[0-9a-f]+$/i.test(hexToken));

  const b64Token = generateSecureToken(24, "base64url");
  assert.equal(b64Token.length, 24);
  assert.ok(/^[a-zA-Z0-9_-]+$/.test(b64Token));

  const pwd = generateSecureToken(16, "password", {
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
  });
  assert.equal(pwd.length, 16);
  assert.ok(/[A-Z]/.test(pwd), "Missing uppercase");
  assert.ok(/[a-z]/.test(pwd), "Missing lowercase");
  assert.ok(/[0-9]/.test(pwd), "Missing numbers");
  assert.ok(/[!@#$%^&*()_\-=[\]{}|;:,.<>?]/.test(pwd), "Missing symbols");
});

test("generateBatch: creates requested count of unique items", () => {
  const batch = generateBatch(() => generateUuidV4(), 10);
  assert.equal(batch.length, 10);
  const unique = new Set(batch);
  assert.equal(unique.size, 10);
});
