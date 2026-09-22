import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

// Ensure Web Crypto API is available in Node test environments (e.g. Node 18)
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

import {
  computeHash,
  computeAllHashes,
  computeHmac,
  HMAC_ALGORITHMS,
} from "../js/crypto/hasher.js";

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

/* --- HMAC ------------------------------------------------------------------
 *
 * The three digests above answer "what is the fingerprint of this"; HMAC
 * answers "was this written by someone holding the key", which is the question
 * a webhook signature actually asks. Checked against published vectors rather
 * than against itself, because a keyed digest that is self-consistently wrong
 * looks exactly like one that is right.
 */

test("computeHmac matches RFC 4231 test case 2 for SHA-256 and SHA-512", async () => {
  const key = "Jefe";
  const data = "what do ya want for nothing?";

  const sha256 = await computeHmac(data, key, "SHA-256");
  assert.equal(
    sha256.hex,
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  );

  const sha512 = await computeHmac(data, key, "SHA-512");
  assert.equal(
    sha512.hex,
    "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea250554" +
      "9758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737",
  );
});

test("computeHmac matches RFC 2202 test case 2 for SHA-1", async () => {
  const mac = await computeHmac("what do ya want for nothing?", "Jefe", "SHA-1");
  assert.equal(mac.hex, "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79");
});

test("a different key gives a different digest over the same message", async () => {
  const a = await computeHmac("payload", "key-one");
  const b = await computeHmac("payload", "key-two");
  assert.notEqual(a.hex, b.hex);
});

test("HMAC is reported in hex, uppercase hex and base64, all of one value", async () => {
  const mac = await computeHmac("what do ya want for nothing?", "Jefe", "SHA-256");
  assert.equal(mac.uppercaseHex, mac.hex.toUpperCase());
  assert.equal(Buffer.from(mac.base64, "base64").toString("hex"), mac.hex);
});

test("an unsupported HMAC algorithm is refused rather than silently downgraded", async () => {
  await assert.rejects(() => computeHmac("x", "k", "MD5"), /Unsupported HMAC algorithm/);
});

test("every offered HMAC algorithm actually works", async () => {
  for (const algorithm of HMAC_ALGORITHMS) {
    const mac = await computeHmac("message", "key", algorithm);
    assert.match(mac.hex, /^[0-9a-f]+$/);
    assert.equal(mac.algorithm, algorithm);
  }
});
