import test from "node:test";
import assert from "node:assert/strict";
import { diffLines } from "../js/diff/diff-engine.js";
import {
  refineLinePair,
  refineChanges,
  tokenizeForRefine,
  MIN_SIMILARITY,
} from "../js/diff/diff-refine.js";
import {
  tokenizeLine,
  tokenizeDocument,
  createState,
} from "../js/diff/diff-tokenize.js";

/** Read a span list back as the substrings it points at. */
const slice = (line, spans, predicate = () => true) =>
  spans.filter(predicate).map((span) => line.slice(span.start, span.end));

test("tokenizeForRefine: words, whitespace runs, and punctuation one at a time", () => {
  const tokens = tokenizeForRefine("const a = fn(x, 1);").map((token) => token.text);
  assert.deepEqual(tokens, [
    "const", " ", "a", " ", "=", " ", "fn", "(", "x", ",", " ", "1", ")", ";",
  ]);
});

test("tokenizeForRefine: spans cover the line exactly, with no gaps", () => {
  const line = "  let x_1 = 'a b';";
  const tokens = tokenizeForRefine(line);
  assert.equal(tokens[0].start, 0);
  assert.equal(tokens[tokens.length - 1].end, line.length);
  for (let i = 1; i < tokens.length; i++) {
    assert.equal(tokens[i].start, tokens[i - 1].end, "tokens must be contiguous");
  }
});

test("refineLinePair: pinpoints the one token that changed", () => {
  const left = "const timeout = 30;";
  const right = "const timeout = 300;";
  const result = refineLinePair(left, right);

  assert.notEqual(result, null);
  assert.deepEqual(slice(left, result.left, (span) => span.changed), ["30"]);
  assert.deepEqual(slice(right, result.right, (span) => span.changed), ["300"]);

  // The unchanged prefix is one span, not a scatter of them.
  const unchangedLeft = slice(left, result.left, (span) => !span.changed);
  assert.deepEqual(unchangedLeft, ["const timeout = ", ";"]);
});

test("refineLinePair: spans tile the line in order with no gaps or overlaps", () => {
  const left = "foo(alpha, beta);";
  const right = "foo(alpha, gamma, beta);";
  const result = refineLinePair(left, right);

  for (const [line, spans] of [
    [left, result.left],
    [right, result.right],
  ]) {
    assert.equal(spans[0].start, 0);
    assert.equal(spans[spans.length - 1].end, line.length);
    for (let i = 1; i < spans.length; i++) {
      assert.equal(spans[i].start, spans[i - 1].end);
      assert.notEqual(spans[i].changed, spans[i - 1].changed, "runs must alternate");
    }
  }
});

test("refineLinePair: declines when the two lines share almost nothing", () => {
  // Highlighting every other token here reads worse than a plain red/green
  // pair, so the refiner stands down.
  assert.equal(refineLinePair("alpha beta gamma", "zulu yankee xray"), null);
});

test("refineLinePair: declines on identical, empty or oversized lines", () => {
  assert.equal(refineLinePair("same", "same"), null);
  assert.equal(refineLinePair("", "something"), null);
  assert.equal(refineLinePair("something", ""), null);
  assert.equal(refineLinePair("x".repeat(5000), "y".repeat(5000)), null);
});

test("refineLinePair: similarity threshold is the documented one", () => {
  // Eight tokens, six shared: comfortably above the floor.
  const result = refineLinePair("a b c d e f g h", "a b c d e f g X");
  assert.notEqual(result, null);
  assert.ok(MIN_SIMILARITY > 0 && MIN_SIMILARITY < 1);
});

test("refineChanges: attaches refinement to replace changes only", () => {
  const result = diffLines("const x = 1;\nkeep\n", "const x = 2;\nkeep\nadded\n");
  refineChanges(result.changes);

  const replaced = result.changes.find((change) => change.type === "replace");
  assert.equal(Array.isArray(replaced.refine), true);
  assert.equal(replaced.refine.length, 1);
  assert.deepEqual(
    slice("const x = 1;", replaced.refine[0].left, (span) => span.changed),
    ["1"]
  );

  for (const change of result.changes) {
    if (change.type !== "replace") {
      assert.equal(change.refine, undefined, "only replaces carry refinement");
    }
  }
});

test("refineChanges: an uneven replace refines the paired lines and no more", () => {
  const result = diffLines("a1\na2\na3\n", "b1\nb2\n");
  refineChanges(result.changes);
  const replaced = result.changes.find((change) => change.type === "replace");
  assert.equal(replaced.refine.length, Math.min(replaced.leftLines.length, replaced.rightLines.length));
});

test("tokenizeLine: strings, in all three quote styles", () => {
  const line = `a "double" b 'single' c \`template\``;
  const spans = tokenizeLine(line);
  assert.deepEqual(slice(line, spans, (span) => span.type === "string"), [
    '"double"',
    "'single'",
    "`template`",
  ]);
});

test("tokenizeLine: escaped quotes do not end a string early", () => {
  const line = `x = "a \\" still string"`;
  const spans = tokenizeLine(line);
  assert.deepEqual(slice(line, spans, (span) => span.type === "string"), [
    '"a \\" still string"',
  ]);
});

test("tokenizeLine: an unterminated string stops at the end of its own line", () => {
  const line = "it's a comment-ish apostrophe";
  const spans = tokenizeLine(line);
  const strings = spans.filter((span) => span.type === "string");
  assert.equal(strings.length, 1);
  assert.equal(strings[0].end, line.length, "must not run past the line");
});

test("tokenizeLine: every comment dialect runs to end of line", () => {
  for (const line of ["code // trailing", "code # trailing", "code -- trailing"]) {
    const spans = tokenizeLine(line);
    const comment = spans.find((span) => span.type === "comment");
    assert.notEqual(comment, undefined, line);
    assert.equal(comment.end, line.length, line);
  }
});

test("tokenizeLine: numbers, including hex and exponents", () => {
  const line = "a = 42 + 0xFF + 1e-9 + 3.14";
  const spans = tokenizeLine(line);
  assert.deepEqual(slice(line, spans, (span) => span.type === "number"), [
    "42",
    "0xFF",
    "1e-9",
    "3.14",
  ]);
});

test("tokenizeLine: keywords, case-insensitively, and not inside identifiers", () => {
  const line = "const iffy = if SELECT";
  const spans = tokenizeLine(line);
  assert.deepEqual(slice(line, spans, (span) => span.type === "keyword"), [
    "const",
    "if",
    "SELECT",
  ]);
});

test("tokenizeLine: spans never overlap and stay within the line", () => {
  const line = `const x = fn("a", 0x1F); // note`;
  const spans = tokenizeLine(line);
  for (let i = 0; i < spans.length; i++) {
    assert.ok(spans[i].start >= 0 && spans[i].end <= line.length);
    assert.ok(spans[i].end > spans[i].start);
    if (i > 0) assert.ok(spans[i].start >= spans[i - 1].end, "spans must not overlap");
  }
});

test("tokenizeDocument: a block comment carries across lines and then stops", () => {
  const lines = ["before /* open", "still comment", "close */ after", "code = 1"];
  const perLine = tokenizeDocument(lines);

  assert.equal(perLine[0].some((span) => span.type === "comment"), true);
  assert.deepEqual(slice(lines[1], perLine[1]), ["still comment"]);
  assert.equal(perLine[1][0].type, "comment");
  assert.deepEqual(slice(lines[2], perLine[2], (span) => span.type === "comment"), ["close */"]);
  // Back to normal code on the line after the comment closes.
  assert.equal(perLine[3].some((span) => span.type === "comment"), false);
  assert.equal(perLine[3].some((span) => span.type === "keyword" || span.type === "number"), true);
});

test("tokenizeLine: a single-line block comment does not open a run", () => {
  const state = createState();
  const line = "a /* inline */ b";
  const spans = tokenizeLine(line, state);
  assert.deepEqual(slice(line, spans, (span) => span.type === "comment"), ["/* inline */"]);
  assert.equal(state.inBlockComment, false);
});

test("tokenizeLine: an empty line yields nothing and throws nothing", () => {
  assert.deepEqual(tokenizeLine(""), []);
});
