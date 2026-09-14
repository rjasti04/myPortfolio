import test from "node:test";
import assert from "node:assert/strict";
import { diffLines } from "../js/diff/diff-engine.js";
import { writePatch, parsePatch, applyPatch, patchToView } from "../js/diff/diff-patch.js";

/**
 * Reference output captured from real `git diff --no-index --no-color`. The
 * writer is not "close enough to" the unified format — it matches git byte for
 * byte on these, and this suite is what keeps it that way.
 */
const GIT_BASIC = `--- a/a.txt
+++ b/b.txt
@@ -1,8 +1,9 @@
 alpha
 beta
-gamma
+GAMMA
 delta
 epsilon
 zeta
+inserted
 eta
 theta
`;

const GIT_NO_EOL = `--- a/c.txt
+++ b/d.txt
@@ -1,3 +1,3 @@
 one
-two
+twoX
 three
\\ No newline at end of file
`;

const GIT_FROM_EMPTY = `--- a/e.txt
+++ b/f.txt
@@ -0,0 +1,2 @@
+x
+y
`;

test("writePatch: matches git byte for byte on a merged hunk", () => {
  const a = "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\n";
  const b = "alpha\nbeta\nGAMMA\ndelta\nepsilon\nzeta\ninserted\neta\ntheta\n";
  const patch = writePatch(diffLines(a, b), { leftLabel: "a/a.txt", rightLabel: "b/b.txt" });
  assert.equal(patch, GIT_BASIC);
});

test("writePatch: emits the no-newline marker exactly where git does", () => {
  const patch = writePatch(diffLines("one\ntwo\nthree", "one\ntwoX\nthree", { context: 1 }), {
    leftLabel: "a/c.txt",
    rightLabel: "b/d.txt",
  });
  assert.equal(patch, GIT_NO_EOL);
});

test("writePatch: a count of zero anchors on the preceding line", () => {
  const patch = writePatch(diffLines("", "x\ny\n"), {
    leftLabel: "a/e.txt",
    rightLabel: "b/f.txt",
  });
  assert.equal(patch, GIT_FROM_EMPTY);
  assert.match(patch, /^@@ -0,0 \+1,2 @@$/m);
});

test("writePatch: a single-line range is written bare, without ',1'", () => {
  const patch = writePatch(diffLines("a\nb\nc\n", "a\nX\nc\n", { context: 0 }));
  assert.match(patch, /^@@ -2 \+2 @@$/m);
});

test("writePatch: an unchanged pair produces no patch at all", () => {
  assert.equal(writePatch(diffLines("same\n", "same\n")), "");
});

test("parsePatch: reads git output back into the engine's hunk structure", () => {
  const parsed = parsePatch(GIT_BASIC);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.files.length, 1);

  const [file] = parsed.files;
  assert.equal(file.oldPath, "a/a.txt");
  assert.equal(file.newPath, "b/b.txt");
  assert.equal(file.hunks.length, 1);

  const [hunk] = file.hunks;
  assert.equal(hunk.leftStart, 0);
  assert.equal(hunk.leftCount, 8);
  assert.equal(hunk.rightStart, 0);
  assert.equal(hunk.rightCount, 9);

  // Adjacent delete/insert runs are paired into `replace`, exactly as the
  // engine pairs them, so the renderer cannot tell the two sources apart.
  const replaced = hunk.changes.find((change) => change.type === "replace");
  assert.deepEqual(replaced.leftLines, ["gamma"]);
  assert.deepEqual(replaced.rightLines, ["GAMMA"]);
  const inserted = hunk.changes.find((change) => change.type === "insert");
  assert.deepEqual(inserted.rightLines, ["inserted"]);
});

test("parsePatch: no-newline markers attach to the right side", () => {
  const parsed = parsePatch(GIT_NO_EOL);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.files[0].oldNoEol, true);
  assert.equal(parsed.files[0].newNoEol, true);
});

test("parsePatch: multi-file git diff with preambles and index lines", () => {
  const multi = `diff --git a/one.js b/one.js
index 1111111..2222222 100644
--- a/one.js
+++ b/one.js
@@ -1,2 +1,2 @@
 keep
-old
+new
diff --git a/two.js b/two.js
index 3333333..4444444 100644
--- a/two.js
+++ b/two.js
@@ -5,1 +5,2 @@
 context
+added
`;
  const parsed = parsePatch(multi);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0].newPath, "b/one.js");
  assert.equal(parsed.files[1].hunks[0].leftStart, 4);
});

test("parsePatch: a bare paste of hunks, with no file headers, still works", () => {
  const parsed = parsePatch("@@ -1,2 +1,2 @@\n keep\n-old\n+new\n");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.files[0].hunks.length, 1);
});

test("parsePatch: a context line stripped of its leading space is tolerated", () => {
  // Mail clients do this routinely to blank context lines.
  const parsed = parsePatch("@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n");
  assert.equal(parsed.ok, true);
  const kinds = parsed.files[0].hunks[0].changes.map((change) => change.type);
  assert.deepEqual(kinds, ["equal", "replace"]);
});

test("parsePatch: malformed hunk header reports line, column and an excerpt", () => {
  const parsed = parsePatch("--- a\n+++ b\n@@ nonsense @@\n context\n");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.line, 3);
  assert.equal(parsed.error.column, 1);
  assert.match(parsed.error.message, /Malformed hunk header/);
  assert.match(parsed.error.excerpt, /\^/);
});

test("parsePatch: a hunk whose declared counts do not match its body is rejected", () => {
  const parsed = parsePatch("@@ -1,5 +1,5 @@\n a\n-b\n+B\n");
  assert.equal(parsed.ok, false);
  assert.match(parsed.error.message, /carries 2 and 2/);
});

test("parsePatch: an unexpected marker in the hunk body is rejected", () => {
  const parsed = parsePatch("@@ -1,2 +1,2 @@\n a\n?b\n");
  assert.equal(parsed.ok, false);
  assert.match(parsed.error.message, /Unexpected "\?"/);
});

test("parsePatch: empty input and hunk-free input are both refused", () => {
  assert.equal(parsePatch("").ok, false);
  const noHunks = parsePatch("--- a\n+++ b\n");
  assert.equal(noHunks.ok, false);
  assert.match(noHunks.error.message, /No hunks found/);
});

test("applyPatch: rejects a patch whose context does not match the source", () => {
  const result = applyPatch("completely\ndifferent\n", GIT_BASIC);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /Context does not match/);
});

test("patchToView: counts additions, deletions and modifications from a patch", () => {
  const view = patchToView(parsePatch(GIT_BASIC));
  assert.deepEqual(view.stats, { additions: 1, deletions: 0, modifications: 1 });
  assert.equal(view.algorithm, "patch");
  assert.equal(view.hunks.length, 1);
});

test("ROUND TRIP: applyPatch(a, writePatch(diff(a, b))) === b, over generated pairs", () => {
  // The single most valuable assertion in this suite. It holds the engine, the
  // writer and the parser against each other: an off-by-one in a hunk header
  // is invisible to inspection and silently corrupts a file in use.
  let seed = 913;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const alphabet = ["alpha", "beta", "gamma", "delta", "epsilon", "", "  indented", "}"];
  const makeDoc = (count, trailingNewline) => {
    const lines = Array.from(
      { length: count },
      () => alphabet[Math.floor(random() * alphabet.length)]
    );
    return lines.join("\n") + (trailingNewline ? "\n" : "");
  };

  for (let round = 0; round < 200; round++) {
    const a = makeDoc(1 + Math.floor(random() * 18), random() > 0.25);
    const b = makeDoc(1 + Math.floor(random() * 18), random() > 0.25);
    const context = Math.floor(random() * 4);

    const result = diffLines(a, b, { context });
    const patch = writePatch(result);

    if (patch === "") {
      assert.equal(a, b, "an empty patch must mean the documents are identical");
      continue;
    }

    const parsed = parsePatch(patch);
    assert.equal(parsed.ok, true, `patch must re-parse:\n${patch}`);

    const applied = applyPatch(a, parsed);
    assert.equal(applied.ok, true, `patch must apply:\n${patch}`);
    assert.equal(applied.text, b, `round trip must reproduce b:\n${patch}`);
  }
});

test("ROUND TRIP: holds for the degenerate documents too", () => {
  const cases = [
    ["", "a\n"],
    ["a\n", ""],
    ["a", "b"],
    ["a\nb\nc", "a\nb\nc\n"],
    ["one\n", "one\ntwo\nthree\n"],
    ["one\ntwo\nthree\n", "one\n"],
    ["\n\n\n", "\n"],
  ];
  for (const [a, b] of cases) {
    const patch = writePatch(diffLines(a, b));
    if (patch === "") {
      assert.equal(a, b);
      continue;
    }
    const applied = applyPatch(a, patch);
    assert.equal(applied.ok, true, `must apply for ${JSON.stringify([a, b])}:\n${patch}`);
    assert.equal(applied.text, b, `must reproduce b for ${JSON.stringify([a, b])}:\n${patch}`);
  }
});
