// Cover for /json's Compare tab.
//
// The point of it is the one thing /diff documents as its own limitation:
// "two JSON documents that differ just in key order are reported as
// different." That is correct for a text diff and wrong for JSON, so the
// first test here is the whole reason the tab exists.
import test from "node:test";
import assert from "node:assert/strict";

import { canonicalise, compareDocuments, compareRows } from "../js/json/json-compare.js";

test("key order is not a difference", () => {
  const left = '{"b":2,"a":1,"nested":{"z":1,"y":2}}';
  const right = '{"a":1,"nested":{"y":2,"z":1},"b":2}';
  const result = compareDocuments(left, right);
  assert.equal(result.ok, true);
  assert.equal(result.identical, true, "the whole reason this tab exists");
});

test("with the switch off, key order is reported", () => {
  const result = compareDocuments('{"b":2,"a":1}', '{"a":1,"b":2}', { ignoreKeyOrder: false });
  assert.equal(result.identical, false);
});

test("array order IS a difference - it means something in JSON", () => {
  const result = compareDocuments('{"xs":[1,2,3]}', '{"xs":[3,2,1]}');
  assert.equal(result.identical, false);
});

test("a real difference is still reported, with counts", () => {
  const result = compareDocuments('{"a":1,"b":2}', '{"a":1,"b":3}');
  assert.equal(result.identical, false);
  assert.equal(result.stats.modifications, 1);
});

test("an added key counts as an addition, not a modification", () => {
  const result = compareDocuments('{"a":1}', '{"a":1,"b":2}');
  assert.equal(result.stats.additions >= 1, true);
});

test("whitespace and indentation are never a difference", () => {
  const left = '{"a":1,"b":[1,2]}';
  const right = '{\n  "a" : 1,\n\n  "b" : [ 1,\n 2 ]\n}';
  assert.equal(compareDocuments(left, right).identical, true);
  // And with key order honoured, formatting alone still is not a difference.
  assert.equal(compareDocuments(left, right, { ignoreKeyOrder: false }).identical, true);
});

test("a document that does not parse is reported, not thrown", () => {
  const badLeft = compareDocuments("{not json", "{}");
  assert.equal(badLeft.ok, false);
  assert.ok(badLeft.leftError);
  assert.equal(badLeft.rightError, null);

  const badRight = compareDocuments("{}", "[1,2,");
  assert.equal(badRight.ok, false);
  assert.ok(badRight.rightError);
});

test("canonical text sorts keys at every depth and leaves arrays alone", () => {
  const text = canonicalise({ b: 1, a: { d: 4, c: [{ f: 6, e: 5 }] } });
  assert.equal(text.indexOf('"a"') < text.indexOf('"b"'), true);
  assert.equal(text.indexOf('"c"') < text.indexOf('"d"'), true);
  assert.equal(text.indexOf('"e"') < text.indexOf('"f"'), true);
  assert.deepEqual(JSON.parse(canonicalise([3, 1, 2])), [3, 1, 2]);
});

test("null survives canonicalisation as null, not as an empty object", () => {
  assert.equal(canonicalise({ a: null }), '{\n  "a": null\n}');
});

test("rows carry a hunk header, both line numbers, and the line text", () => {
  const result = compareDocuments('{"a":1,"b":2}', '{"a":9,"b":2}');
  const rows = compareRows(result.result);

  assert.equal(rows[0].type, "hunk");
  assert.match(rows[0].text, /^@@ -\d+,\d+ \+\d+,\d+ @@$/);

  const removed = rows.find((r) => r.type === "delete");
  const added = rows.find((r) => r.type === "insert");
  assert.match(removed.text, /"a": 1/);
  assert.match(added.text, /"a": 9/);
  assert.equal(removed.right, null, "a removed line has no right-hand number");
  assert.equal(added.left, null);
});

test("identical documents produce no rows at all", () => {
  const result = compareDocuments('{"a":1}', '{"a":1}');
  assert.deepEqual(compareRows(result.result), []);
});

test("the row cap is honoured, so a huge pair cannot freeze the tab", () => {
  const left = JSON.stringify(Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i])));
  const right = JSON.stringify(Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i + 1])));
  const result = compareDocuments(left, right);
  assert.equal(compareRows(result.result, { maxRows: 25 }).length <= 25, true);
});
