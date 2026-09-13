import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseQuery, evaluate, runQuery, formatPath } from "../js/json/json-query.js";

const DOC = {
  store: {
    name: "Corner shop",
    items: [
      { id: 1, name: "apple", price: 30, tags: ["fruit", "red"] },
      { id: 2, name: "bread", price: 80, tags: ["bakery"] },
      { id: 3, name: "cheese", price: 120, tags: ["dairy"], organic: true },
      { id: 4, name: "date", price: 50, tags: ["fruit", "dried"] },
    ],
    open: true,
  },
  "odd key": { "with space": 7 },
};

const values = (expression, root = DOC) => {
  const result = runQuery(expression, root);
  assert.equal(result.ok, true, result.error ? result.error.message : "query should parse");
  return result.matches.map((match) => match.value);
};

test("segments: child, bracket, index and negative index", () => {
  assert.deepEqual(values("$.store.name"), ["Corner shop"]);
  assert.deepEqual(values("store.name"), ["Corner shop"], "bare dot-notation equals the $-rooted form");
  assert.deepEqual(values("$['store']['name']"), ["Corner shop"]);
  assert.deepEqual(values("$.store.items[0].name"), ["apple"]);
  assert.deepEqual(values("$.store.items[-1].name"), ["date"]);
  assert.deepEqual(values("$.store.items[-2].name"), ["cheese"]);
  assert.deepEqual(values("$['odd key']['with space']"), [7]);
});

test("segments: out-of-range and missing keys yield no match rather than an error", () => {
  assert.deepEqual(values("$.store.items[99]"), []);
  assert.deepEqual(values("$.store.items[-99]"), []);
  assert.deepEqual(values("$.nope.deeper"), []);
});

test("segments: wildcard over arrays and objects", () => {
  assert.deepEqual(values("$.store.items[*].id"), [1, 2, 3, 4]);
  assert.deepEqual(values("$.store.items[0].tags[*]"), ["fruit", "red"]);
  assert.deepEqual(values("$.odd key".replace("odd key", "store")).length, 1);
  assert.deepEqual(values("$['odd key'].*"), [7]);
});

test("segments: slices, including step and negative bounds", () => {
  assert.deepEqual(values("$.store.items[0:2].id"), [1, 2]);
  assert.deepEqual(values("$.store.items[1:].id"), [2, 3, 4]);
  assert.deepEqual(values("$.store.items[:2].id"), [1, 2]);
  assert.deepEqual(values("$.store.items[::2].id"), [1, 3]);
  assert.deepEqual(values("$.store.items[-2:].id"), [3, 4]);
  assert.deepEqual(values("$.store.items[::-1].id"), [4, 3, 2, 1]);
  assert.deepEqual(values("$.store.items[0:0].id"), []);
});

test("segments: recursive descent", () => {
  assert.deepEqual(values("$..price"), [30, 80, 120, 50]);
  assert.deepEqual(values("$..id"), [1, 2, 3, 4]);
  assert.deepEqual(values("$..organic"), [true]);
  assert.ok(values("$..*").length > 10);
});

test("filters: comparison operators", () => {
  assert.deepEqual(values("$.store.items[?(@.price > 50)].name"), ["bread", "cheese"]);
  assert.deepEqual(values("$.store.items[?(@.price >= 50)].name"), ["bread", "cheese", "date"]);
  assert.deepEqual(values("$.store.items[?(@.price < 50)].name"), ["apple"]);
  assert.deepEqual(values("$.store.items[?(@.id == 2)].name"), ["bread"]);
  assert.deepEqual(values("$.store.items[?(@.id != 2)].id"), [1, 3, 4]);
  assert.deepEqual(values("$.store.items[?(@.name == 'apple')].id"), [1]);
});

test("filters: boolean composition and precedence", () => {
  // && binds tighter than ||, so this is (price>100) || (price<40 && id==1).
  assert.deepEqual(values("$.store.items[?(@.price > 100 || @.price < 40 && @.id == 1)].id"), [1, 3]);
  assert.deepEqual(values("$.store.items[?(@.price > 40 && @.price < 100)].id"), [2, 4]);
  assert.deepEqual(values("$.store.items[?(!(@.price > 40))].id"), [1]);
  assert.deepEqual(values("$.store.items[?((@.id == 1 || @.id == 2) && @.price > 50)].id"), [2]);
});

test("filters: word operators over strings and arrays", () => {
  assert.deepEqual(values("$.store.items[?(@.name contains 'ea')].name"), ["bread"]);
  assert.deepEqual(values("$.store.items[?(@.name startsWith 'a')].name"), ["apple"]);
  assert.deepEqual(values("$.store.items[?(@.name endsWith 'e')].name"), ["apple", "cheese", "date"]);
  assert.deepEqual(values("$.store.items[?(@.tags contains 'fruit')].id"), [1, 4]);
});

test("filters: a missing operand is never ordered and never equal", () => {
  assert.deepEqual(values("$.store.items[?(@.organic == true)].id"), [3]);
  assert.deepEqual(values("$.store.items[?(@.organic > 0)].id"), []);
  assert.deepEqual(values("$.store.items[?(@.missing)].id"), []);
});

test("filter(...) sugar equals its JSONPath form, and chains", () => {
  const sugar = values("store.items.filter(price > 50)").map((v) => v.id);
  const explicit = values("$.store.items[?(@.price > 50)]").map((v) => v.id);
  assert.deepEqual(sugar, explicit);
  assert.deepEqual(sugar, [2, 3]);

  // Bare `filter(...)` applies to the root.
  assert.deepEqual(runQuery("filter(price > 100)", DOC.store.items).matches.map((m) => m.value.id), [3]);
  // And it composes with further segments.
  assert.deepEqual(values("store.items.filter(price > 50).name"), ["bread", "cheese"]);
});

test("a property genuinely called `filter` is still reachable", () => {
  const doc = { filter: { kind: "hepa" } };
  assert.deepEqual(runQuery("$['filter'].kind", doc).matches.map((m) => m.value), ["hepa"]);
});

test("returned paths round-trip back to the same node", () => {
  const result = runQuery("$..price", DOC);
  for (const match of result.matches) {
    for (const dialect of ["jsonpath", "dot", "bracket"]) {
      const rendered = formatPath(match.path, dialect);
      if (dialect === "bracket") continue; // bracket form is for copying, not re-querying
      const again = runQuery(rendered, DOC);
      assert.equal(again.ok, true, `re-parsing ${rendered} should succeed`);
      assert.deepEqual(again.matches.map((m) => m.value), [match.value], `round-trip failed for ${rendered}`);
    }
  }
});

test("formatPath: three dialects, including keys needing escapes", () => {
  assert.equal(formatPath(["items", 0, "id"], "jsonpath"), "$.items[0].id");
  assert.equal(formatPath(["items", 0, "id"], "dot"), "items[0].id");
  assert.equal(formatPath(["items", 0, "id"], "bracket"), '["items"][0]["id"]');
  assert.equal(formatPath(["odd key", 2], "jsonpath"), '$["odd key"][2]');
  assert.equal(formatPath(["odd key"], "dot"), '["odd key"]');
  assert.equal(formatPath([], "jsonpath"), "$");
});

test("syntax errors return a column rather than throwing", () => {
  const bad = [
    "$.items[",
    "$.items[?(@.price >)]",
    "$.items[?(@.price > 5",
    "$..",
    "$.items[?()]",
    "items.filter(price >",
    "$.a..[",
    "$['unterminated",
  ];
  for (const expression of bad) {
    const result = parseQuery(expression);
    assert.equal(result.ok, false, `should have rejected: ${expression}`);
    assert.equal(typeof result.error.column, "number");
    assert.ok(result.error.message.length > 0);
  }
});

test("an empty query selects the root", () => {
  const parsed = parseQuery("");
  assert.equal(parsed.ok, true);
  assert.deepEqual(evaluate(parsed.ast, DOC), [{ path: [], value: DOC }]);
  assert.deepEqual(evaluate(parseQuery("$").ast, DOC), [{ path: [], value: DOC }]);
});

/* ---------------------------------------------------------------------------
   Security. The conventional JSONPath filter implementation is eval(); these
   assert refusal, not sanitisation, and that the module has no evaluator to
   reach for in the first place.
   ------------------------------------------------------------------------- */

test("SECURITY: expression injection is refused, not executed", () => {
  globalThis.__jsonQueryPwned = false;
  const payloads = [
    "$.store.items[?(@.x == 1); globalThis.__jsonQueryPwned = true)]",
    "$.store.items[?(constructor.constructor('globalThis.__jsonQueryPwned = true')())]",
    "$.store.items[?(@.constructor.constructor('return 1')())]",
    "$.store.items[?(1); alert(1)]",
    "$.store.items[?(globalThis.__jsonQueryPwned = true)]",
    "$.store.items[?(process.exit(1))]",
    "$.store.items[?(@.price.toString.constructor('x')())]",
    "$.store.items[?(this)]",
  ];
  for (const payload of payloads) {
    const result = runQuery(payload, DOC);
    const harmless = !result.ok || result.matches.length === 0;
    assert.ok(harmless, `payload should not have selected anything: ${payload}`);
  }
  assert.equal(globalThis.__jsonQueryPwned, false, "no payload may run script");
  delete globalThis.__jsonQueryPwned;
});

test("SECURITY: member access never reaches the prototype chain", () => {
  const doc = { items: [{ own: 1 }] };
  for (const expression of [
    "$.items[0].constructor",
    "$.items[0].__proto__",
    "$.items[0].toString",
    "$.items[0].hasOwnProperty",
    "$.constructor",
    "$.__proto__.polluted",
  ]) {
    assert.deepEqual(values(expression, doc), [], `${expression} must not resolve`);
  }
  // A filter testing an inherited member finds nothing, because the member is
  // Nothing rather than a function. (`!=` against it would be *true* — RFC 9535
  // makes a missing member unequal to every value — so truthiness is the
  // assertion that actually distinguishes "absent" from "leaked".)
  assert.deepEqual(values("$.items[?(@.constructor)]", doc), []);
  assert.deepEqual(values("$.items[?(@.__proto__)]", doc), []);
});

test("SECURITY: the module source contains no evaluator", () => {
  const source = readFileSync(fileURLToPath(new URL("../js/json/json-query.js", import.meta.url)), "utf8");
  // Strip the block comments, which discuss eval by name on purpose.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["eval(", "new Function", "Function(", "setTimeout(", "setInterval(", "innerHTML"]) {
    assert.ok(!code.includes(forbidden), `json-query.js must not contain ${forbidden}`);
  }
});
