import test from "node:test";
import assert from "node:assert/strict";
import {
  diffLines,
  diffSequences,
  buildHunks,
  splitLines,
  lineKey,
} from "../js/diff/diff-engine.js";

/** Flatten a diff back into the two documents it claims to describe. */
function reconstruct(result) {
  const left = [];
  const right = [];
  for (const change of result.changes) {
    left.push(...change.leftLines);
    right.push(...change.rightLines);
  }
  return { left, right };
}

/**
 * The invariant every diff must satisfy: walking the changes in order and
 * concatenating each side reproduces the inputs exactly. A diff that loses,
 * duplicates or reorders a line fails here regardless of how it renders.
 */
function assertLossless(a, b, options) {
  const result = diffLines(a, b, options);
  const { left, right } = reconstruct(result);
  assert.deepEqual(left, splitLines(a).lines, "left side must reconstruct");
  assert.deepEqual(right, splitLines(b).lines, "right side must reconstruct");
  return result;
}

test("splitLines: terminators, emptiness and the missing final newline", () => {
  assert.deepEqual(splitLines(""), { lines: [], noEol: false });
  assert.deepEqual(splitLines("a\n"), { lines: ["a"], noEol: false });
  assert.deepEqual(splitLines("a"), { lines: ["a"], noEol: true });
  assert.deepEqual(splitLines("a\nb"), { lines: ["a", "b"], noEol: true });
  assert.deepEqual(splitLines("a\nb\n"), { lines: ["a", "b"], noEol: false });
  assert.deepEqual(splitLines("\n"), { lines: [""], noEol: false });
  // CRLF keeps its carriage return, so the lines genuinely differ from LF.
  assert.deepEqual(splitLines("a\r\nb\r\n"), { lines: ["a\r", "b\r"], noEol: false });
});

test("lineKey: each normalisation option, and only that option", () => {
  assert.equal(lineKey("  a  b  ", {}), "  a  b  ");
  assert.equal(lineKey("  a  b  ", { trimTrailing: true }), "  a  b");
  assert.equal(lineKey("  a  b  ", { ignoreWhitespace: true }), "ab");
  assert.equal(lineKey("AbC", { ignoreCase: true }), "abc");
  assert.equal(lineKey("a\r", { trimTrailing: true }), "a");
});

test("diffLines: identical documents produce no changes", () => {
  const text = "one\ntwo\nthree\n";
  const result = diffLines(text, text);
  assert.equal(result.identical, true);
  assert.equal(result.hunks.length, 0);
  assert.deepEqual(result.stats, { additions: 0, deletions: 0, modifications: 0 });
});

test("diffLines: degenerate inputs", () => {
  assert.equal(diffLines("", "").identical, true);
  assert.equal(diffLines("", "").hunks.length, 0);

  const added = assertLossless("", "a\nb\n");
  assert.equal(added.stats.additions, 2);
  assert.equal(added.stats.deletions, 0);

  const removed = assertLossless("a\nb\n", "");
  assert.equal(removed.stats.deletions, 2);
  assert.equal(removed.stats.additions, 0);

  const single = assertLossless("only", "only changed");
  assert.equal(single.stats.modifications, 1);
});

test("diffLines: a one-line change in the middle of a file", () => {
  const a = "a\nb\nc\nd\ne\n";
  const b = "a\nb\nX\nd\ne\n";
  const result = assertLossless(a, b);

  assert.equal(result.identical, false);
  assert.equal(result.algorithm, "myers");
  assert.deepEqual(result.stats, { additions: 0, deletions: 0, modifications: 1 });

  const replaced = result.changes.filter((change) => change.type === "replace");
  assert.equal(replaced.length, 1);
  assert.deepEqual(replaced[0].leftLines, ["c"]);
  assert.deepEqual(replaced[0].rightLines, ["X"]);
  assert.equal(replaced[0].leftStart, 2);
  assert.equal(replaced[0].rightStart, 2);
});

test("diffLines: pure insertion and pure deletion keep their line numbers", () => {
  const inserted = assertLossless("a\nb\n", "a\nnew\nb\n");
  const insert = inserted.changes.find((change) => change.type === "insert");
  assert.deepEqual(insert.rightLines, ["new"]);
  assert.equal(insert.rightStart, 1);
  assert.equal(inserted.stats.additions, 1);

  const deleted = assertLossless("a\ngone\nb\n", "a\nb\n");
  const remove = deleted.changes.find((change) => change.type === "delete");
  assert.deepEqual(remove.leftLines, ["gone"]);
  assert.equal(remove.leftStart, 1);
  assert.equal(deleted.stats.deletions, 1);
});

test("diffLines: known Myers vector ABCABBA -> CBABAC", () => {
  // Myers (1986) worked example. Edit distance is 5; whatever script we emit
  // must cost exactly that, or the algorithm is not finding an optimal path.
  // Both documents are newline-terminated, so every line is an ordinary line
  // and the edit-distance oracle below is exact. The unterminated case is a
  // different question, pinned in its own test.
  const a = "A\nB\nC\nA\nB\nB\nA\n";
  const b = "C\nB\nA\nB\nA\nC\n";
  const result = assertLossless(a, b);

  let edits = 0;
  for (const change of result.changes) {
    if (change.type === "equal") continue;
    edits += change.leftLines.length + change.rightLines.length;
  }
  assert.equal(edits, 5, "edit script must be minimal");
});

test("diffLines: minimality holds across randomised pairs", () => {
  // A cheap oracle: the LCS length from a straightforward O(NM) table. The
  // engine's edit count must equal N + M - 2 * LCS for every pair.
  const lcs = (a, b) => {
    const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        table[i][j] =
          a[i - 1] === b[j - 1]
            ? table[i - 1][j - 1] + 1
            : Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
    return table[a.length][b.length];
  };

  let seed = 20260914;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const alphabet = "abcde";
  const makeLines = (count) =>
    Array.from({ length: count }, () => alphabet[Math.floor(random() * alphabet.length)]);

  for (let round = 0; round < 60; round++) {
    const a = makeLines(1 + Math.floor(random() * 12));
    const b = makeLines(1 + Math.floor(random() * 12));
    // Terminated on both sides, so no final line carries the no-newline
    // marker and the LCS oracle measures the algorithm alone.
    const result = diffLines(`${a.join("\n")}\n`, `${b.join("\n")}\n`);

    const { left, right } = reconstruct(result);
    assert.deepEqual(left, a, `lossless left: ${a} / ${b}`);
    assert.deepEqual(right, b, `lossless right: ${a} / ${b}`);

    let edits = 0;
    for (const change of result.changes) {
      if (change.type === "equal") continue;
      edits += change.leftLines.length + change.rightLines.length;
    }
    assert.equal(edits, a.length + b.length - 2 * lcs(a, b), `minimal: ${a} / ${b}`);
  }
});

test("diffLines: CRLF against LF differs by default and matches under trimTrailing", () => {
  const crlf = "a\r\nb\r\n";
  const lf = "a\nb\n";
  assert.equal(diffLines(crlf, lf).identical, false);
  assert.equal(diffLines(crlf, lf, { trimTrailing: true }).identical, true);
});

test("diffLines: ignoreWhitespace and ignoreCase change equality, not content", () => {
  const a = "const  X = 1;\n";
  const b = "const X   = 1;\n";
  assert.equal(diffLines(a, b).identical, false);

  const relaxed = diffLines(a, b, { ignoreWhitespace: true });
  assert.equal(relaxed.identical, true);
  // The rendered text is still the original, spacing intact.
  assert.deepEqual(relaxed.changes[0].leftLines, ["const  X = 1;"]);
  assert.deepEqual(relaxed.changes[0].rightLines, ["const X   = 1;"]);

  assert.equal(diffLines("Alpha\n", "alpha\n", { ignoreCase: true }).identical, true);
  assert.equal(diffLines("Alpha\n", "alpha\n").identical, false);
});

test("diffLines: ignoreBlankLines skips blanks but keeps real line numbers", () => {
  const a = "a\n\n\nb\n";
  const b = "a\nb\n";
  assert.equal(diffLines(a, b).identical, false);

  const result = diffLines(a, b, { ignoreBlankLines: true });
  assert.equal(result.identical, true);
  const { left, right } = reconstruct(result);
  assert.deepEqual(left, ["a", "", "", "b"], "blank lines are still rendered");
  assert.deepEqual(right, ["a", "b"]);
});

test("diffSequences: the histogram fallback engages and stays lossless", () => {
  const a = Array.from({ length: 120 }, (_, i) => `left-${i % 7}`);
  const b = Array.from({ length: 120 }, (_, i) => `right-${i % 11}`);

  const myers = diffSequences(a, b);
  assert.equal(myers.algorithm, "myers");

  // A work ceiling low enough that the meter trips on this input.
  const fallback = diffSequences(a, b, { maxWork: 50 });
  assert.equal(fallback.algorithm, "histogram");

  for (const { ops } of [myers, fallback]) {
    const left = [];
    const right = [];
    for (const op of ops) {
      if (op.type !== "insert") left.push(...a.slice(op.aStart, op.aEnd));
      if (op.type !== "delete") right.push(...b.slice(op.bStart, op.bEnd));
    }
    assert.deepEqual(left, a);
    assert.deepEqual(right, b);
  }
});

test("diffLines: forceHistogram produces a good, lossless, disclosed diff", () => {
  const a = "alpha\nbeta\ngamma\ndelta\nepsilon\n";
  const b = "alpha\nbeta\nCHANGED\ndelta\nepsilon\n";
  const result = assertLossless(a, b, { forceHistogram: true });
  assert.equal(result.algorithm, "histogram");
  assert.equal(result.identical, false);
  assert.equal(result.stats.modifications, 1);
});

test("buildHunks: context, and merging hunks whose context would overlap", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const changed = [...lines];
  changed[5] = "CHANGED 5";
  changed[9] = "CHANGED 9";
  changed[30] = "CHANGED 30";

  const result = diffLines(lines.join("\n"), changed.join("\n"));
  // Lines 5 and 9 sit three apart, inside 2 * context, so they share a hunk.
  // Line 30 is far away and gets its own.
  assert.equal(result.hunks.length, 2);

  const [first, second] = result.hunks;
  assert.equal(first.leftStart, 2, "hunk opens three lines of context early");
  assert.equal(second.leftStart, 27);
  for (const hunk of result.hunks) {
    assert.equal(
      hunk.leftCount,
      hunk.changes.reduce((sum, change) => sum + change.leftLines.length, 0)
    );
    assert.equal(
      hunk.rightCount,
      hunk.changes.reduce((sum, change) => sum + change.rightLines.length, 0)
    );
  }
});

test("buildHunks: zero context emits only the changed lines", () => {
  const result = diffLines("a\nb\nc\n", "a\nX\nc\n", { context: 0 });
  assert.equal(result.hunks.length, 1);
  assert.equal(result.hunks[0].leftStart, 1);
  assert.equal(result.hunks[0].leftCount, 1);
});

test("buildHunks: an unchanged document has no hunks at any context", () => {
  assert.deepEqual(buildHunks([{ type: "equal", leftLines: ["a"], rightLines: ["a"] }], 3), []);
});

test("diffLines: one very long single line is handled as a whole-line change", () => {
  const a = `${"x".repeat(5000)}\n`;
  const b = `${"y".repeat(5000)}\n`;
  const result = assertLossless(a, b);
  assert.equal(result.stats.modifications, 1);
});

test("diffLines: a final line without a newline never matches a terminated one", () => {
  // Verified against `git diff --no-index`, which emits "-A / +A" plus the
  // marker here rather than treating the two as equal. A line's terminator is
  // part of what the line is, and a diff that hid this could not round-trip
  // through a unified patch.
  const result = diffLines("x\ny\nA\n", "x\ny\nA");
  assert.equal(result.identical, false);
  assert.equal(result.stats.modifications, 1);

  const replaced = result.changes.find((change) => change.type === "replace");
  assert.deepEqual(replaced.leftLines, ["A"]);
  assert.deepEqual(replaced.rightLines, ["A"]);
  assert.equal(result.left.noEol, false);
  assert.equal(result.right.noEol, true);
});

test("diffLines: adding a trailing newline is a real difference", () => {
  assert.equal(diffLines("a\nb\nc", "a\nb\nc\n").identical, false);
  assert.equal(diffLines("a\nb\nc", "a\nb\nc").identical, true);
  assert.equal(diffLines("a\nb\nc\n", "a\nb\nc\n").identical, true);
});

test("diffLines: two unterminated files ending on different lines compare correctly", () => {
  // Both lack a trailing newline, but on different final lines. The shared "}"
  // is last in one and not the other, so it cannot be treated as equal.
  const result = diffLines("a\n}\nindented", "a\n}");
  assert.equal(result.identical, false);
  const { left, right } = reconstruct(result);
  assert.deepEqual(left, ["a", "}", "indented"]);
  assert.deepEqual(right, ["a", "}"]);
});
