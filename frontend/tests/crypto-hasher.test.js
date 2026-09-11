import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

// Ensure Web Crypto API is available in Node test environments (e.g. Node 18)
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

import { computeHash, computeAllHashes } from "../js/crypto/hasher.js";

test("computeHash: calculates accurate SHA-256, SHA-512, and SHA-1 vectors", async () => {
  const text = "hello world";

  const sha256 = await computeHash(text, "SHA-256");
  assert.equal(
    sha256.hex,
    "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
  );
  assert.equal(
    sha256.uppercaseHex,
    "B94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9"
  );
  assert.equal(sha256.charCount, 11);
  assert.equal(sha256.byteLength, 11);

  const sha1 = await computeHash(text, "SHA-1");
  assert.equal(sha1.hex, "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed");

  const sha512 = await computeHash(text, "SHA-512");
  assert.equal(
    sha512.hex,
    "309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f"
  );
});

test("computeHash: correctly hashes empty string", async () => {
  const empty256 = await computeHash("", "SHA-256");
  assert.equal(
    empty256.hex,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(empty256.byteLength, 0);

  const empty1 = await computeHash("", "SHA-1");
  assert.equal(empty1.hex, "da39a3ee5e6b4b0d3255bfef95601890afd80709");
});

test("computeHash: rejects unsupported algorithm", async () => {
  await assert.rejects(
    async () => computeHash("test", "MD5"),
    /Unsupported hash algorithm/
  );
});

test("computeAllHashes: concurrent execution produces all outputs", async () => {
  const res = await computeAllHashes("antigravity");
  assert.ok(res["SHA-256"].hex.length === 64);
  assert.ok(res["SHA-512"].hex.length === 128);
  assert.ok(res["SHA-1"].hex.length === 40);
  assert.equal(res.metrics.charCount, 11);
  assert.equal(res.metrics.byteLength, 11);
});
