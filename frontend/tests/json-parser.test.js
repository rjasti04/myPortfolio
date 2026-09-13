import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJson,
  repairJson,
  formatJson,
  minifyJson,
  describeValue,
  positionAt,
  excerptAt,
} from "../js/json/json-parser.js";

test("parseJson: accepts every JSON shape", () => {
  const cases = [
    ['{"a":1}', { a: 1 }],
    ["[1,2,3]", [1, 2, 3]],
    ['"bare string"', "bare string"],
    ["42", 42],
    ["-1.5e3", -1500],
    ["true", true],
    ["null", null],
    ["{}", {}],
    ["[]", []],
    ['{"nested":{"deep":[{"x":null}]}}', { nested: { deep: [{ x: null }] } }],
    ['{"unicode":"\\u00e9\\ud83d\\ude80"}', { unicode: "é🚀" }],
    ['{"escapes":"a\\"b\\\\c\\nd\\te"}', { escapes: 'a"b\\c\nd\te' }],
  ];
  for (const [text, expected] of cases) {
    const result = parseJson(text);
    assert.equal(result.ok, true, `should have parsed: ${text}`);
    assert.deepEqual(result.value, expected);
  }
});

test("parseJson: agrees with JSON.parse on what is invalid", () => {
  const invalid = [
    '{"a":1,}',
    "{a:1}",
    "{'a':1}",
    '{"a":}',
    '{"a" 1}',
    "[1,2",
    '{"a":1}extra',
    "NaN",
    "undefined",
    "",
    "   ",
    "//comment",
    "[1,]",
    '{"a":01}',
    '{"a":.5}',
  ];
  for (const text of invalid) {
    let nativeThrew = false;
    try {
      JSON.parse(text);
    } catch {
      nativeThrew = true;
    }
    assert.equal(nativeThrew, true, `precondition: JSON.parse should reject ${JSON.stringify(text)}`);
    assert.equal(parseJson(text).ok, false, `parseJson should reject ${JSON.stringify(text)}`);
  }
});

test("parseJson: reports a real line and column, not an engine message", () => {
  const text = '{\n  "a": 1,\n  "b": ,\n  "c": 3\n}';
  const result = parseJson(text);
  assert.equal(result.ok, false);
  assert.equal(result.error.line, 3);
  assert.equal(result.error.column, 8);
  assert.ok(result.error.excerpt.caret.endsWith("^"));
  assert.equal(result.error.excerpt.caret.length, result.error.column);
});

test("positionAt & excerptAt: offsets resolve to 1-based line and column", () => {
  const text = "one\ntwo\nthree";
  assert.deepEqual(positionAt(text, 0), { line: 1, column: 1, offset: 0 });
  assert.deepEqual(positionAt(text, 4), { line: 2, column: 1, offset: 4 });
  assert.deepEqual(positionAt(text, 9), { line: 3, column: 2, offset: 9 });
  // Past the end clamps rather than running off the string.
  assert.equal(positionAt(text, 9999).line, 3);
  assert.equal(excerptAt(text, 4).text, "two");
});

test("repairJson: one test per repair rule", () => {
  const cases = [
    ["trailing-comma", '{"a":1,}', { a: 1 }],
    ["trailing-comma", "[1,2,]", [1, 2]],
    ["unquoted-key", "{a:1}", { a: 1 }],
    ["single-quoted", "{'a':'b'}", { a: "b" }],
    ["comment", '{"a":1} // trailing note', { a: 1 }],
    ["comment", '{/* lead */"a":1}', { a: 1 }],
    ["non-finite", '{"a":NaN}', { a: null }],
    ["non-finite", '{"a":Infinity}', { a: null }],
    ["non-finite", '{"a":undefined}', { a: null }],
    ["python-literal", "{a:True,b:False,c:None}", { a: true, b: false, c: null }],
    ["smart-quote", "{\u201ca\u201d:\u201cb\u201d}", { a: "b" }],
    ["missing-comma", '{"a":1 "b":2}', { a: 1, b: 2 }],
    ["missing-comma", "[1 2]", [1, 2]],
    ["number-format", '{"a":0x10}', { a: 16 }],
    ["number-format", '{"a":+5}', { a: 5 }],
    ["number-format", '{"a":007}', { a: 7 }],
    ["trailing-garbage", '{"a":1} oops', { a: 1 }],
    ["unescaped-newline", '{"a":"x\ny"}', { a: "x\ny" }],
  ];
  for (const [rule, input, expected] of cases) {
    const result = repairJson(input);
    assert.equal(result.ok, true, `should have repaired ${JSON.stringify(input)}`);
    assert.deepEqual(result.value, expected, `wrong value for ${JSON.stringify(input)}`);
    assert.ok(
      result.repairs.some((entry) => entry.rule === rule),
      `expected rule "${rule}" in [${result.repairs.map((r) => r.rule).join(", ")}] for ${JSON.stringify(input)}`
    );
  }
});

test("repairJson: repaired output always re-parses as strict JSON", () => {
  const messy = `{
    // a config someone actually pasted
    name: 'widget',
    'count': 007,
    tags: ['a', 'b',],
    ratio: NaN,
    enabled: True,
    nested: { x: 1 "y": 2 },
  }`;
  const result = repairJson(messy);
  assert.equal(result.ok, true);
  assert.equal(parseJson(result.text).ok, true, "repaired text must be strictly valid");
  assert.deepEqual(result.value, {
    name: "widget",
    count: 7,
    tags: ["a", "b"],
    ratio: null,
    enabled: true,
    nested: { x: 1, y: 2 },
  });
});

test("repairJson: valid input is a no-op with an empty log", () => {
  const result = repairJson('{"a": [1, 2], "b": "x"}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.repairs, []);
  assert.deepEqual(result.value, { a: [1, 2], b: "x" });
});

test("repairJson: value-changing repairs are flagged lossy, syntax ones are not", () => {
  const lossy = repairJson('{"a":NaN}');
  assert.equal(lossy.repairs.find((r) => r.rule === "non-finite").lossy, true);

  const syntax = repairJson('{"a":1,}');
  assert.equal(syntax.repairs.find((r) => r.rule === "trailing-comma").lossy, false);
});

test("repairJson: every repair carries a line and column", () => {
  const result = repairJson("{\n  a: 1,\n  b: 'two',\n}");
  assert.ok(result.repairs.length >= 3);
  for (const entry of result.repairs) {
    assert.equal(typeof entry.line, "number");
    assert.equal(typeof entry.column, "number");
    assert.ok(entry.line >= 1 && entry.column >= 1);
    assert.equal(typeof entry.detail, "string");
    assert.ok(entry.detail.length > 0);
  }
});

test("repairJson: an unrepairable document returns the original text, not a mangled one", () => {
  const broken = '{"a": [1, 2';
  const result = repairJson(broken);
  assert.equal(result.ok, false);
  assert.equal(result.text, broken, "must not hand back a half-repaired document");
  assert.equal(result.value, null);
  assert.ok(result.error.message.length > 0);
  assert.equal(typeof result.error.line, "number");
});

test("repairJson: never reorders or drops members", () => {
  const result = repairJson("{z:1, a:2, m:3,}");
  assert.deepEqual(Object.keys(result.value), ["z", "a", "m"]);
});

test("parser: deep nesting is refused rather than overflowing the stack", () => {
  const deep = `${"[".repeat(5000)}1${"]".repeat(5000)}`;
  const result = repairJson(deep);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /Nesting deeper/);
});

test("formatJson & minifyJson: indent, tabs and sorted keys", () => {
  const value = { b: 1, a: { d: 2, c: 3 } };
  assert.equal(minifyJson(value), '{"b":1,"a":{"d":2,"c":3}}');
  assert.ok(formatJson(value, { indent: 2 }).includes('\n  "b": 1'));
  assert.ok(formatJson(value, { indent: 4 }).includes('\n    "b": 1'));
  assert.ok(formatJson(value, { indent: "tab" }).includes('\n\t"b": 1'));

  const sorted = JSON.parse(formatJson(value, { sortKeys: true }));
  assert.deepEqual(Object.keys(sorted), ["a", "b"]);
  assert.deepEqual(Object.keys(sorted.a), ["c", "d"], "sorting is recursive");
});

test("describeValue: counts containers, scalars and depth", () => {
  const stats = describeValue({ a: [1, 2, { b: "x" }], c: null });
  assert.equal(stats.objects, 2);
  assert.equal(stats.arrays, 1);
  assert.equal(stats.scalars, 4);
  assert.equal(stats.depth, 4);
});
