import test from "node:test";
import assert from "node:assert/strict";
import { toYaml, fromYaml } from "../js/json/json-yaml.js";
import { toCsv, fromCsv } from "../js/json/json-csv.js";
import { toTypeScript } from "../js/json/json-typescript.js";

/* ---------------------------------------------------------------------------
   YAML
   ------------------------------------------------------------------------- */

test("YAML: round-trips every JSON shape", () => {
  const documents = [
    { a: 1, b: "two", c: true, d: null },
    { nested: { deep: { deeper: [1, 2, 3] } } },
    { list: [{ x: 1 }, { x: 2 }] },
    { empty_object: {}, empty_array: [] },
    { "key with spaces": 1, "key:with:colons": 2 },
    [1, "two", null, true],
    { mixed: [1, "a", null, { b: [2] }] },
    { unicode: "héllo 🚀", escaped: 'quote " backslash \\' },
  ];
  for (const doc of documents) {
    const yaml = toYaml(doc);
    const back = fromYaml(yaml);
    assert.equal(back.ok, true, `parse failed for ${JSON.stringify(doc)}: ${back.error && back.error.message}`);
    assert.deepEqual(back.value, doc, `round-trip changed ${JSON.stringify(doc)}\n--- yaml ---\n${yaml}`);
  }
});

test("YAML: the 1.1 ambiguity vectors survive as strings — the Norway problem", () => {
  // Each of these, written bare, is re-read by YAML as a boolean, null or number.
  const vectors = [
    "no", "NO", "No", "yes", "y", "n", "on", "off", "true", "false",
    "null", "~", "0755", "1:30", "1.0", "0x1A", "0o17", "1e5", "", " padded ",
    "-", "- dash", "#hash", "@at", "*star", "&amp", "!bang", "|pipe", ">gt", "%pct",
  ];
  for (const vector of vectors) {
    const yaml = toYaml({ k: vector });
    const back = fromYaml(yaml);
    assert.equal(back.ok, true, `failed to parse ${JSON.stringify(vector)}: ${back.error && back.error.message}`);
    assert.equal(typeof back.value.k, "string", `${JSON.stringify(vector)} came back as ${typeof back.value.k}`);
    assert.equal(back.value.k, vector, `${JSON.stringify(vector)} changed value`);
  }
});

test("YAML: keys that would resolve to another type are quoted too", () => {
  const yaml = toYaml({ no: 1, yes: 2, "0755": 3 });
  assert.ok(yaml.includes('"no":'), yaml);
  assert.ok(yaml.includes('"yes":'), yaml);
  const back = fromYaml(yaml);
  assert.deepEqual(Object.keys(back.value).sort(), ["0755", "no", "yes"]);
});

test("YAML: block scalars preserve newlines, and fold as documented", () => {
  const doc = { note: "line one\nline two\nline three" };
  const yaml = toYaml(doc);
  assert.ok(yaml.includes("|-"), `expected a literal block scalar:\n${yaml}`);
  assert.deepEqual(fromYaml(yaml).value, doc);

  const literal = fromYaml("text: |\n  one\n  two\n");
  assert.equal(literal.value.text, "one\ntwo\n");
  const stripped = fromYaml("text: |-\n  one\n  two\n");
  assert.equal(stripped.value.text, "one\ntwo");
  const kept = fromYaml("text: |+\n  one\n");
  assert.equal(kept.value.text, "one\n");
  const folded = fromYaml("text: >\n  one\n  two\n\n  three\n");
  assert.equal(folded.value.text, "one two\nthree\n");
});

test("YAML: sequences of mappings emit the idiomatic inline dash", () => {
  const yaml = toYaml({ people: [{ name: "Ada", age: 36 }] });
  assert.ok(yaml.includes("- name: Ada"), yaml);
  assert.ok(!/-\s*\n\s+name/.test(yaml), `dash should not be stranded on its own line:\n${yaml}`);
});

test("YAML: flow collections, comments and a leading document marker parse", () => {
  const result = fromYaml("---\n# a comment\na: [1, 2, {b: 'c'}]  # trailing\nd: {e: 1}\n");
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.deepEqual(result.value, { a: [1, 2, { b: "c" }], d: { e: 1 } });
});

test("YAML: unsupported constructs are refused by name, never guessed at", () => {
  const cases = [
    ["anchors", "base: &anchor\n  a: 1\nuse: *anchor\n", /anchor|alias/i],
    ["merge keys", "a: 1\n<<: *base\n", /merge/i],
    ["tags", "a: !!binary QQ==\n", /tag/i],
    ["multi-document", "a: 1\n---\nb: 2\n", /multi-document/i],
  ];
  for (const [label, source, pattern] of cases) {
    const result = fromYaml(source);
    assert.equal(result.ok, false, `${label} should be refused`);
    assert.match(result.error.message, pattern, `${label} should say what it found`);
  }
});

test("YAML: .inf and .nan are refused because JSON cannot hold them", () => {
  assert.equal(fromYaml("a: .inf\n").ok, false);
  assert.equal(fromYaml("a: .nan\n").ok, false);
});

test("YAML: empty input is an error, not an empty document", () => {
  assert.equal(fromYaml("").ok, false);
  assert.equal(fromYaml("   ").ok, false);
});

/* ---------------------------------------------------------------------------
   CSV
   ------------------------------------------------------------------------- */

test("CSV: the header is the union of every row's keys, in first-seen order", () => {
  const result = toCsv([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.columns, ["a", "b", "c"]);
  const [header, ...rows] = result.text.trim().split("\n");
  assert.equal(header, "a,b,c");
  assert.equal(rows[1], ",2,", "a row missing the first column must not shift left");
});

test("CSV: RFC 4180 quoting round-trips commas, quotes and newlines", () => {
  const rows = [
    { plain: "simple", comma: "a,b", quote: 'he said "hi"', newline: "one\ntwo", crlf: "x\r\ny" },
  ];
  const csv = toCsv(rows);
  assert.equal(csv.ok, true);
  const back = fromCsv(csv.text);
  assert.equal(back.ok, true);
  assert.equal(back.value[0].comma, "a,b");
  assert.equal(back.value[0].quote, 'he said "hi"');
  assert.equal(back.value[0].newline, "one\ntwo");
});

test("CSV: inference refuses to guess — zip codes and phone numbers stay strings", () => {
  const csv = "zip,phone,big,count,ratio,flag,blank\n00123,+15551234567,1e999,42,3.5,true,\n";
  const { value } = fromCsv(csv);
  assert.equal(value[0].zip, "00123", "a leading zero means it was never a number");
  assert.equal(value[0].phone, "+15551234567");
  assert.equal(value[0].big, "1e999", "a value that does not round-trip stays a string");
  assert.equal(value[0].count, 42);
  assert.equal(value[0].ratio, 3.5);
  assert.equal(value[0].flag, true);
  assert.equal(value[0].blank, null);
});

test("CSV: a quoted cell is always a string, and inference can be turned off", () => {
  const { value } = fromCsv('n,m\n"42",42\n');
  assert.equal(value[0].n, "42", "the author quoted it on purpose");
  assert.equal(value[0].m, 42);

  const raw = fromCsv("n\n42\n", { inferTypes: false });
  assert.equal(raw.value[0].n, "42");
});

test("CSV: nested objects flatten to dotted columns and come back nested", () => {
  const rows = [{ id: 1, address: { city: "London", geo: { lat: 51.5 } } }];
  const csv = toCsv(rows);
  assert.deepEqual(csv.columns, ["id", "address.city", "address.geo.lat"]);
  const back = fromCsv(csv.text);
  assert.deepEqual(back.value[0], { id: 1, address: { city: "London", geo: { lat: 51.5 } } });
});

test("CSV: alternative delimiters", () => {
  for (const delimiter of [";", "\t", "|"]) {
    const csv = toCsv([{ a: 1, b: "x,y" }], { delimiter });
    const back = fromCsv(csv.text, { delimiter });
    assert.deepEqual(back.value[0], { a: 1, b: "x,y" });
  }
});

test("CSV: arrays of scalars join; arrays of objects are refused by name", () => {
  const joined = toCsv([{ tags: ["a", "b"] }]);
  assert.equal(joined.ok, true);
  assert.ok(joined.text.includes("a; b"));

  const refused = toCsv([{ items: [{ id: 1 }] }]);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /array of objects/i);
  assert.match(refused.error, /items/, "the message should name the column");
});

test("CSV: an API envelope is tabulated from its one array, and says which", () => {
  const result = toCsv({ page: 1, members: [{ id: 1, name: "Ada" }, { id: 2, name: "Alan" }] });
  assert.equal(result.ok, true);
  assert.equal(result.sourceKey, "members", "the caller must be told the envelope was unwrapped");
  assert.equal(result.rows, 2);
  assert.deepEqual(result.columns, ["id", "name"]);

  // Two candidate arrays is ambiguous, so it falls back to the one-row path
  // (which then refuses, naming the column).
  const ambiguous = toCsv({ a: [{ x: 1 }], b: [{ y: 2 }] });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.sourceKey, null);

  // A plain object with no array of objects is still a one-row table.
  const single = toCsv({ id: 1, name: "Ada" });
  assert.equal(single.ok, true);
  assert.equal(single.sourceKey, null);
  assert.equal(single.rows, 1);
});

test("CSV: a bare array of scalars becomes a one-column table", () => {
  const result = toCsv([1, 2, 3]);
  assert.equal(result.ok, true);
  assert.equal(result.text.trim().split("\n")[0], "value");
  assert.equal(result.rows, 3);
});

test("CSV: an unterminated quoted field is an error, not a truncated row", () => {
  const result = fromCsv('a\n"never closed\n');
  assert.equal(result.ok, false);
  assert.match(result.error, /Unterminated/i);
});

/* ---------------------------------------------------------------------------
   TypeScript
   ------------------------------------------------------------------------- */

test("TypeScript: nested objects become their own named interfaces", () => {
  const out = toTypeScript({ user: { name: "Ada", address: { city: "London" } } }, "Root");
  assert.match(out, /export interface Root \{/);
  assert.match(out, /export interface User \{/);
  assert.match(out, /export interface Address \{/);
  assert.match(out, /user: User;/);
  assert.match(out, /city: string;/);
});

test("TypeScript: keys missing from some array elements become optional", () => {
  const out = toTypeScript({ users: [{ id: 1, nickname: "A" }, { id: 2 }] }, "Root");
  assert.match(out, /id: number;/);
  assert.match(out, /nickname\?: string;/);
  assert.ok(!/id\?:/.test(out), "a key present in every element is not optional");
});

test("TypeScript: heterogeneous arrays become a parenthesised union", () => {
  const out = toTypeScript({ mixed: [1, "two", null] }, "Root");
  assert.match(out, /mixed: \(string \| number \| null\)\[\];/);
});

test("TypeScript: empty arrays and objects degrade honestly", () => {
  const out = toTypeScript({ nothing: [], blank: {}, nil: null }, "Root");
  assert.match(out, /nothing: unknown\[\];/);
  assert.match(out, /blank: Record<string, unknown>;/);
  assert.match(out, /nil: null;/);
});

test("TypeScript: identical shapes share one interface", () => {
  const out = toTypeScript({ a: { x: 1 }, b: { x: 2 }, c: { x: 3 } }, "Root");
  const declarations = out.match(/export interface /g) ?? [];
  assert.equal(declarations.length, 2, `expected Root plus one shared shape, got:\n${out}`);
});

test("TypeScript: keys that are not valid identifiers are quoted", () => {
  const out = toTypeScript({ "not-an-ident": 1, "with space": 2, "3leading": 4, ok_key: 5 }, "Root");
  assert.match(out, /"not-an-ident": number;/);
  assert.match(out, /"with space": number;/);
  assert.match(out, /"3leading": number;/);
  assert.match(out, /\n {2}ok_key: number;/);
});

test("TypeScript: a non-object root becomes a type alias", () => {
  assert.match(toTypeScript([1, 2, 3], "Numbers"), /export type Numbers = number\[\];/);
  assert.match(toTypeScript("hello", "Greeting"), /export type Greeting = string;/);
});

test("TypeScript: array element names are singularised", () => {
  // Distinct shapes, or the structural cache would (correctly) merge them.
  const out = toTypeScript({ categories: [{ id: 1 }], boxes: [{ label: "x" }] }, "Root");
  assert.match(out, /export interface Category \{/);
  assert.match(out, /export interface Box/);
});

test("TypeScript: deep recursion terminates", () => {
  let deep = { leaf: 1 };
  for (let i = 0; i < 200; i += 1) deep = { child: deep };
  const out = toTypeScript(deep, "Deep");
  assert.ok(out.length > 0);
  assert.match(out, /unknown/, "past the depth guard the type degrades to unknown");
});
