import test from "node:test";
import assert from "node:assert/strict";
import { tokenizeRegex, evaluateRegex, normalizeFlags } from "../js/cron/regex-parser.js";

test("tokenizeRegex: identifies literals, character sets, and quantifiers", () => {
  const tokens = tokenizeRegex("[a-z0-9_]+@\\w+\\.\\w{2,4}");
  assert.ok(tokens.length > 0);

  const classTokens = tokens.filter((t) => t.type === "tok-class");
  assert.ok(classTokens.length >= 3); // [a-z0-9_], \w, \w

  const quantTokens = tokens.filter((t) => t.type === "tok-quant");
  assert.ok(quantTokens.length >= 2); // +, {2,4}
});

test("tokenizeRegex: recognizes capturing, non-capturing, and named groups", () => {
  const tokens = tokenizeRegex("(?<year>\\d{4})-(?:\\d{2})-(\\d{2})");
  const groups = tokens.filter((t) => t.type === "tok-group");
  assert.ok(groups.some((g) => g.text.includes("year")));
  assert.ok(groups.some((g) => g.text === "(?:"));
  assert.ok(groups.some((g) => g.text === "("));
});

test("normalizeFlags: filters and deduplicates valid flags", () => {
  assert.equal(normalizeFlags("gimgi"), "gim");
  assert.equal(normalizeFlags("xzg"), "g");
  assert.equal(normalizeFlags("xyzg"), "yg");
  assert.equal(normalizeFlags(""), "");
});

test("evaluateRegex: extracts global matches with correct indices", () => {
  const text = "Hello world! Contact test@example.com or admin@domain.org.";
  const res = evaluateRegex("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", "g", text);

  assert.equal(res.valid, true);
  assert.equal(res.matchCount, 2);
  assert.equal(res.matches[0].match, "test@example.com");
  assert.equal(res.matches[1].match, "admin@domain.org");
  assert.equal(text.slice(res.matches[0].index, res.matches[0].endIndex), "test@example.com");
});

test("evaluateRegex: extracts numbered and named capture groups", () => {
  const pattern = "(?<area>\\d{3})-(?<prefix>\\d{3})-(?<line>\\d{4})";
  const text = "Call 800-555-0199 today.";
  const res = evaluateRegex(pattern, "g", text);

  assert.equal(res.valid, true);
  assert.equal(res.matchCount, 1);
  const m = res.matches[0];
  assert.equal(m.groups.length, 3);
  assert.equal(m.groups[0].name, "area");
  assert.equal(m.groups[0].value, "800");
  assert.equal(m.groups[1].name, "prefix");
  assert.equal(m.groups[1].value, "555");
  assert.equal(m.groups[2].name, "line");
  assert.equal(m.groups[2].value, "0199");
});

test("evaluateRegex: handles zero-length matches without hanging", () => {
  const res = evaluateRegex("^|\\b", "g", "a b c");
  assert.equal(res.valid, true);
  assert.ok(res.matchCount > 0);
});

test("evaluateRegex: reports syntax error on invalid regex", () => {
  const res = evaluateRegex("[a-z", "g", "test");
  assert.equal(res.valid, false);
  assert.ok(res.error.length > 0);
});
