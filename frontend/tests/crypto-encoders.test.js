import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeBase64,
  decodeBase64,
  encodeUrl,
  decodeUrl,
  textToHex,
  hexToText,
  encodeHtmlEntities,
  decodeHtmlEntities,
  textToBinary,
  binaryToText,
} from "../js/crypto/encoders.js";

test("encodeBase64 & decodeBase64: handles standard ASCII and Unicode characters", () => {
  const cases = [
    "Hello World!",
    "Rajeev Jasti's Portfolio",
    "🚀 Modern Web Cryptography & Encoders 🔐",
    "Special characters: !@#$%^&*()_+-=[]{}|;':\",./<>?",
    "Multiline\nText\r\nWith\tTabs",
    "",
  ];

  for (const text of cases) {
    const encoded = encodeBase64(text);
    const decoded = decodeBase64(encoded);
    assert.equal(decoded, text, `Failed on: "${text}"`);
  }
});

test("encodeUrl & decodeUrl: handles components and query parameters", () => {
  const url = "https://rjasti.com/crypto?query=test value&symbols=100%&safe=true";
  const encoded = encodeUrl(url);
  assert.ok(!encoded.includes(" "));
  assert.ok(encoded.includes("%20"));

  const decoded = decodeUrl(encoded);
  assert.equal(decoded, url);

  // Test + as space
  assert.equal(decodeUrl("hello+world"), "hello world");
});

test("textToHex & hexToText: handles byte conversions and formatting", () => {
  const text = "Crypto 2026";
  const hex = textToHex(text);
  assert.equal(hex, "43727970746f2032303236");
  assert.equal(hexToText(hex), text);

  // With space delimiter
  const spacedHex = textToHex(text, " ");
  assert.equal(spacedHex, "43 72 79 70 74 6f 20 32 30 32 36");
  assert.equal(hexToText(spacedHex), text);

  // Odd length validation
  assert.throws(() => hexToText("abc"), /Invalid hex string/);
});

test("encodeHtmlEntities & decodeHtmlEntities: escapes and restores safely", () => {
  const raw = '<script>alert("XSS & \'security\'");</script>';
  const encoded = encodeHtmlEntities(raw);
  assert.ok(!encoded.includes("<script>"));
  assert.ok(encoded.includes("&lt;script&gt;"));
  assert.ok(encoded.includes("&amp;"));
  assert.ok(encoded.includes("&quot;"));
  assert.ok(encoded.includes("&#39;"));

  const decoded = decodeHtmlEntities(encoded);
  assert.equal(decoded, raw);

  // Test numeric entities
  assert.equal(decodeHtmlEntities("&#65;&#66;&#67;"), "ABC");
  assert.equal(decodeHtmlEntities("&#x41;&#x42;&#x43;"), "ABC");
});

test("textToBinary & binaryToText: converts 8-bit binary representations", () => {
  const text = "Web";
  const binary = textToBinary(text);
  assert.equal(binary, "01010111 01100101 01100010");
  assert.equal(binaryToText(binary), text);

  // Invalid binary length
  assert.throws(() => binaryToText("0101"), /Invalid binary representation/);
});
