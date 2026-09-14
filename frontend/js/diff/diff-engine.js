/**
 * Diff Engine (`diff-engine.js`)
 *
 * Myers' O(ND) sequence difference algorithm, in the linear-space
 * divide-and-conquer form, plus the hunk assembly that turns its edit script
 * into something a viewer can draw.
 *
 * Three layers stand between a visitor's paste and a hung tab.
 *
 * 1. **Common prefix and suffix stripping**, before the algorithm runs at all.
 *    The overwhelmingly common case — a few changed lines in the middle of a
 *    large file — collapses here to a problem of a few lines, and Myers never
 *    sees the rest.
 * 2. **A work ceiling.** Myers is O(ND) in the *edit distance*, not the file
 *    size, so two 5 MB files that share almost nothing have an enormous D. The
 *    k-loop is metered, and when the meter trips the search is abandoned rather
 *    than finished.
 * 3. **A histogram fallback** for exactly that case: bucket the lines, anchor on
 *    the rarest line the two sides share, recurse either side of it. O(N log N)
 *    and it produces a *good* diff rather than a provably minimal one.
 *
 * The result says which algorithm produced it (`algorithm`). A fallback is
 * disclosed in the UI, never silent — a diff that quietly stopped being minimal
 * is a diff the reader cannot calibrate against.
 *
 * Comparison is done on a derived **key** per line, never on the line itself.
 * That separation is what lets a whitespace-insensitive diff still render the
 * whitespace: `ignoreWhitespace` changes what counts as equal, and changes
 * nothing about what is drawn.
 *
 * Pure vanilla ES module. Zero dependencies, and no DOM — every export here is
 * a function of its arguments, which is what makes the suite in
 * `frontend/tests/diff-engine.test.js` able to test it directly.
 */

/**
 * Inner k-loop steps allowed across all middle-snake searches for one diff
 * before the histogram fallback takes over. Tuned so the worst case costs a
 * visitor a fraction of a second rather than a frozen tab; `options.maxWork`
 * overrides it, and the tests use a deliberately tiny value to force the
 * fallback path on small inputs.
 */
export const DEFAULT_MAX_WORK = 2_000_000;

/**
 * Appended to the comparison key of a final line that has no newline after it,
 * when the other side's final line does. See `diffLines`.
 */
const NO_EOL_MARKER = "\u0000\u0000no-newline-at-eof";

/** Recursion guard for the histogram fallback on adversarial input. */
const MAX_HISTOGRAM_DEPTH = 40;

/** Lines this long stop being worth a character-level refinement pass. */
export const MAX_REFINE_LENGTH = 2000;

/** Thrown internally when the Myers meter trips. Never escapes this module. */
const WORK_EXCEEDED = Symbol("diff:work-exceeded");

/**
 * Split text into lines, dropping the terminators but remembering whether the
 * last line had one.
 *
 * Splitting on `\n` alone leaves a `\r` at the end of every line of a CRLF
 * file, which is deliberate: those files genuinely differ byte for byte from
 * their LF twins, so the default diff says so. `trimTrailing` is what makes
 * the two compare equal, because `\r` is trailing whitespace — one option,
 * not a special case.
 *
 * @param {string} text
 * @returns {{ lines: string[], noEol: boolean }}
 */
export function splitLines(text) {
  if (text.length === 0) return { lines: [], noEol: false };
  const lines = text.split("\n");
  const noEol = lines[lines.length - 1] !== "";
  if (!noEol) lines.pop();
  return { lines, noEol };
}

/**
 * Derive the comparison key for a line. The rendered text is always the
 * original; only equality testing sees this.
 *
 * @param {string} line
 * @param {object} options
 * @returns {string}
 */
export function lineKey(line, options = {}) {
  let key = line;
  if (options.trimTrailing) key = key.replace(/[ \t\r]+$/, "");
  if (options.ignoreWhitespace) key = key.replace(/\s+/g, "");
  if (options.ignoreCase) key = key.toLowerCase();
  return key;
}

/**
 * Myers' middle snake over `a[aLo..aHi)` and `b[bLo..bHi)`.
 *
 * Returns the snake bounding the middle of an optimal edit script, together
 * with the edit distance `d` that found it. `vf` and `vb` are caller-owned
 * scratch arrays so the recursion allocates once rather than per call.
 *
 * Only indices in `[-d-1, d+1]` are ever read and every index in `[-d, d]` is
 * written each round, so values left behind by a previous call at other
 * offsets can never be reached. That is why only the two seeds below need
 * clearing between calls.
 */
function middleSnake(a, b, aLo, aHi, bLo, bHi, vf, vb, offset, meter) {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const delta = n - m;
  const odd = (delta & 1) === 1;
  const max = Math.ceil((n + m) / 2) + 1;

  vf[offset + 1] = 0;
  vb[offset + 1] = 0;

  for (let d = 0; d <= max; d++) {
    meter.work += d + 1;
    if (meter.work > meter.limit) throw WORK_EXCEEDED;

    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && vf[offset + k - 1] < vf[offset + k + 1])
          ? vf[offset + k + 1]
          : vf[offset + k - 1] + 1;
      let y = x - k;
      const xStart = x;
      const yStart = y;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++;
        y++;
      }
      vf[offset + k] = x;
      if (odd && delta - k >= -(d - 1) && delta - k <= d - 1) {
        if (x + vb[offset + (delta - k)] >= n) {
          return {
            d: 2 * d - 1,
            xStart: aLo + xStart,
            yStart: bLo + yStart,
            xEnd: aLo + x,
            yEnd: bLo + y,
          };
        }
      }
    }

    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && vb[offset + k - 1] < vb[offset + k + 1])
          ? vb[offset + k + 1]
          : vb[offset + k - 1] + 1;
      let y = x - k;
      const xStart = x;
      const yStart = y;
      while (x < n && y < m && a[aHi - 1 - x] === b[bHi - 1 - y]) {
        x++;
        y++;
      }
      vb[offset + k] = x;
      if (!odd && delta - k >= -d && delta - k <= d) {
        if (x + vf[offset + (delta - k)] >= n) {
          return {
            d: 2 * d,
            xStart: aHi - x,
            yStart: bHi - y,
            xEnd: aHi - xStart,
            yEnd: bHi - yStart,
          };
        }
      }
    }
  }

  // Unreachable: `max` is chosen so a solution is always found by then.
  return null;
}

/**
 * Emit the edit script for a range known to need at most one insertion or one
 * deletion (`d <= 1`).
 *
 * Recursing on the middle snake is only safe while `d > 1` — at `d <= 1` the
 * snake can sit flush against a boundary and hand back a sub-range the same
 * size as its parent, which never terminates. Peeling the shared prefix and
 * suffix by hand settles those cases directly, and is the base case the
 * recursion below leans on.
 */
function emitTrivial(a, b, aLo, aHi, bLo, bHi, out) {
  const n = aHi - aLo;
  const m = bHi - bLo;

  let p = 0;
  while (p < n && p < m && a[aLo + p] === b[bLo + p]) p++;
  let s = 0;
  while (s < n - p && s < m - p && a[aHi - 1 - s] === b[bHi - 1 - s]) s++;

  if (p > 0) out.push({ type: "equal", aStart: aLo, aEnd: aLo + p, bStart: bLo, bEnd: bLo + p });
  if (aLo + p < aHi - s) {
    out.push({ type: "delete", aStart: aLo + p, aEnd: aHi - s, bStart: bLo + p, bEnd: bLo + p });
  }
  if (bLo + p < bHi - s) {
    out.push({ type: "insert", aStart: aHi - s, aEnd: aHi - s, bStart: bLo + p, bEnd: bHi - s });
  }
  if (s > 0) out.push({ type: "equal", aStart: aHi - s, aEnd: aHi, bStart: bHi - s, bEnd: bHi });
}

function myersRecurse(a, b, aLo, aHi, bLo, bHi, vf, vb, offset, meter, out) {
  const n = aHi - aLo;
  const m = bHi - bLo;

  if (n === 0 && m === 0) return;
  if (n === 0) {
    out.push({ type: "insert", aStart: aLo, aEnd: aLo, bStart: bLo, bEnd: bHi });
    return;
  }
  if (m === 0) {
    out.push({ type: "delete", aStart: aLo, aEnd: aHi, bStart: bLo, bEnd: bLo });
    return;
  }

  const snake = middleSnake(a, b, aLo, aHi, bLo, bHi, vf, vb, offset, meter);
  if (!snake || snake.d <= 1) {
    emitTrivial(a, b, aLo, aHi, bLo, bHi, out);
    return;
  }

  myersRecurse(a, b, aLo, snake.xStart, bLo, snake.yStart, vf, vb, offset, meter, out);
  if (snake.xEnd > snake.xStart) {
    out.push({
      type: "equal",
      aStart: snake.xStart,
      aEnd: snake.xEnd,
      bStart: snake.yStart,
      bEnd: snake.yEnd,
    });
  }
  myersRecurse(a, b, snake.xEnd, aHi, snake.yEnd, bHi, vf, vb, offset, meter, out);
}

/**
 * Histogram fallback.
 *
 * Anchor on the line the two sides share that occurs *least* often — a unique
 * function signature is a far better alignment point than the thousandth `}` —
 * extend the match as far as it runs in both directions, then recurse either
 * side of it. Not minimal, but O(N log N) and it never wanders.
 */
function histogramRecurse(a, b, aLo, aHi, bLo, bHi, depth, out) {
  const n = aHi - aLo;
  const m = bHi - bLo;

  if (n === 0 && m === 0) return;
  if (n === 0) {
    out.push({ type: "insert", aStart: aLo, aEnd: aLo, bStart: bLo, bEnd: bHi });
    return;
  }
  if (m === 0) {
    out.push({ type: "delete", aStart: aLo, aEnd: aHi, bStart: bLo, bEnd: bLo });
    return;
  }

  if (depth > MAX_HISTOGRAM_DEPTH) {
    out.push({ type: "delete", aStart: aLo, aEnd: aHi, bStart: bLo, bEnd: bLo });
    out.push({ type: "insert", aStart: aHi, aEnd: aHi, bStart: bLo, bEnd: bHi });
    return;
  }

  const countsB = new Map();
  for (let i = bLo; i < bHi; i++) {
    countsB.set(b[i], (countsB.get(b[i]) ?? 0) + 1);
  }
  const countsA = new Map();
  for (let i = aLo; i < aHi; i++) {
    countsA.set(a[i], (countsA.get(a[i]) ?? 0) + 1);
  }

  let best = null;
  let bestCount = Infinity;
  for (let i = aLo; i < aHi; i++) {
    const inB = countsB.get(a[i]);
    if (inB === undefined) continue;
    const score = countsA.get(a[i]) + inB;
    if (score < bestCount) {
      bestCount = score;
      best = i;
      if (score === 2) break; // unique on both sides — cannot be beaten
    }
  }

  if (best === null) {
    out.push({ type: "delete", aStart: aLo, aEnd: aHi, bStart: bLo, bEnd: bLo });
    out.push({ type: "insert", aStart: aHi, aEnd: aHi, bStart: bLo, bEnd: bHi });
    return;
  }

  // Pick the occurrence in b closest in relative position, so an anchor that
  // repeats does not cross-match halfway across the file.
  const targetRatio = m > 0 ? (best - aLo) / Math.max(n, 1) : 0;
  let bestB = -1;
  let bestDistance = Infinity;
  for (let j = bLo; j < bHi; j++) {
    if (b[j] !== a[best]) continue;
    const distance = Math.abs((j - bLo) / Math.max(m, 1) - targetRatio);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestB = j;
    }
  }

  let lo = best;
  let loB = bestB;
  while (lo > aLo && loB > bLo && a[lo - 1] === b[loB - 1]) {
    lo--;
    loB--;
  }
  let hi = best + 1;
  let hiB = bestB + 1;
  while (hi < aHi && hiB < bHi && a[hi] === b[hiB]) {
    hi++;
    hiB++;
  }

  histogramRecurse(a, b, aLo, lo, bLo, loB, depth + 1, out);
  out.push({ type: "equal", aStart: lo, aEnd: hi, bStart: loB, bEnd: hiB });
  histogramRecurse(a, b, hi, aHi, hiB, bHi, depth + 1, out);
}

/** Fold neighbouring segments of the same type into one. */
function coalesce(ops) {
  const merged = [];
  for (const op of ops) {
    if (op.aEnd === op.aStart && op.bEnd === op.bStart) continue;
    const last = merged[merged.length - 1];
    if (last && last.type === op.type && last.aEnd === op.aStart && last.bEnd === op.bStart) {
      last.aEnd = op.aEnd;
      last.bEnd = op.bEnd;
    } else {
      merged.push({ ...op });
    }
  }
  return merged;
}

/**
 * Diff two arrays of comparison keys.
 *
 * Exported because `diff-refine.js` runs the very same algorithm at token
 * granularity inside a changed line — one engine, two scales.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @param {{ maxWork?: number, forceHistogram?: boolean }} [options]
 * @returns {{ ops: Array, algorithm: "myers"|"histogram" }}
 */
export function diffSequences(a, b, options = {}) {
  const prefix = [];
  const suffix = [];

  let aLo = 0;
  let bLo = 0;
  let aHi = a.length;
  let bHi = b.length;

  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    aLo++;
    bLo++;
  }
  if (aLo > 0) prefix.push({ type: "equal", aStart: 0, aEnd: aLo, bStart: 0, bEnd: bLo });

  while (aHi > aLo && bHi > bLo && a[aHi - 1] === b[bHi - 1]) {
    aHi--;
    bHi--;
  }
  if (aHi < a.length) {
    suffix.push({ type: "equal", aStart: aHi, aEnd: a.length, bStart: bHi, bEnd: b.length });
  }

  const middle = [];
  let algorithm = "myers";

  if (options.forceHistogram) {
    algorithm = "histogram";
    histogramRecurse(a, b, aLo, aHi, bLo, bHi, 0, middle);
  } else {
    const size = aHi - aLo + (bHi - bLo);
    const scratch = new Int32Array(2 * (Math.ceil(size / 2) + 2) + 2);
    const offset = scratch.length >> 1;
    const meter = { work: 0, limit: options.maxWork ?? DEFAULT_MAX_WORK };
    try {
      myersRecurse(
        a,
        b,
        aLo,
        aHi,
        bLo,
        bHi,
        scratch,
        new Int32Array(scratch.length),
        offset,
        meter,
        middle
      );
    } catch (error) {
      if (error !== WORK_EXCEEDED) throw error;
      middle.length = 0;
      algorithm = "histogram";
      histogramRecurse(a, b, aLo, aHi, bLo, bHi, 0, middle);
    }
  }

  return { ops: coalesce([...prefix, ...middle, ...suffix]), algorithm };
}

/**
 * Pair each run of deletions with the run of insertions that follows it, so the
 * viewer can show them side by side and the refiner can highlight what actually
 * moved inside the line.
 */
function toChanges(ops, leftLines, rightLines) {
  const changes = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === "equal") {
      changes.push({
        type: "equal",
        leftStart: op.aStart,
        leftLines: leftLines.slice(op.aStart, op.aEnd),
        rightStart: op.bStart,
        rightLines: rightLines.slice(op.bStart, op.bEnd),
      });
      continue;
    }
    const next = ops[i + 1];
    // Myers is free to emit the insertion first, and does when the inserted run
    // is the shorter of the two. Either order is one replacement to a reader,
    // so both are paired — otherwise an identical edit renders as a replace or
    // as a separate add and remove depending on the relative run lengths.
    const pairable =
      next &&
      ((op.type === "delete" && next.type === "insert") ||
        (op.type === "insert" && next.type === "delete"));
    if (pairable) {
      const remove = op.type === "delete" ? op : next;
      const add = op.type === "insert" ? op : next;
      changes.push({
        type: "replace",
        leftStart: remove.aStart,
        leftLines: leftLines.slice(remove.aStart, remove.aEnd),
        rightStart: add.bStart,
        rightLines: rightLines.slice(add.bStart, add.bEnd),
      });
      i++;
      continue;
    }
    changes.push({
      type: op.type,
      leftStart: op.aStart,
      leftLines: leftLines.slice(op.aStart, op.aEnd),
      rightStart: op.bStart,
      rightLines: rightLines.slice(op.bStart, op.bEnd),
    });
  }
  return changes;
}

/**
 * Group changes into hunks carrying `context` unchanged lines either side,
 * merging any two whose context would otherwise overlap or abut.
 */
export function buildHunks(changes, context = 3) {
  const interesting = [];
  changes.forEach((change, index) => {
    if (change.type !== "equal") interesting.push(index);
  });
  if (interesting.length === 0) return [];

  /** @type {Array<{ from: number, to: number, headLines: number, tailLines: number }>} */
  const groups = [];
  for (const index of interesting) {
    const previous = groups[groups.length - 1];
    if (previous) {
      // Equal lines sitting between the two changes; they merge when that gap
      // is small enough that both would render its context anyway.
      let gap = 0;
      for (let i = previous.to + 1; i < index; i++) gap += changes[i].leftLines.length;
      if (gap <= context * 2) {
        previous.to = index;
        continue;
      }
    }
    groups.push({ from: index, to: index });
  }

  return groups.map((group) => {
    const parts = [];
    const before = changes[group.from - 1];
    if (before && before.type === "equal" && context > 0) {
      const take = Math.min(context, before.leftLines.length);
      parts.push({
        type: "equal",
        leftStart: before.leftStart + before.leftLines.length - take,
        leftLines: before.leftLines.slice(before.leftLines.length - take),
        rightStart: before.rightStart + before.rightLines.length - take,
        rightLines: before.rightLines.slice(before.rightLines.length - take),
      });
    }
    for (let i = group.from; i <= group.to; i++) parts.push(changes[i]);
    const after = changes[group.to + 1];
    if (after && after.type === "equal" && context > 0) {
      const take = Math.min(context, after.leftLines.length);
      parts.push({
        type: "equal",
        leftStart: after.leftStart,
        leftLines: after.leftLines.slice(0, take),
        rightStart: after.rightStart,
        rightLines: after.rightLines.slice(0, take),
      });
    }

    const first = parts[0];
    const leftCount = parts.reduce((sum, part) => sum + part.leftLines.length, 0);
    const rightCount = parts.reduce((sum, part) => sum + part.rightLines.length, 0);
    return {
      leftStart: first.leftStart,
      leftCount,
      rightStart: first.rightStart,
      rightCount,
      changes: parts,
    };
  });
}

/**
 * Diff two documents.
 *
 * @param {string} leftText
 * @param {string} rightText
 * @param {object} [options] `ignoreWhitespace`, `ignoreCase`, `ignoreBlankLines`,
 *   `trimTrailing`, `context`, `maxWork`, `forceHistogram`.
 */
export function diffLines(leftText, rightText, options = {}) {
  const context = options.context ?? 3;
  const left = splitLines(leftText);
  const right = splitLines(rightText);

  // `ignoreBlankLines` cannot be folded into the key — a blank line has to be
  // removed from the comparison entirely, not made equal to its neighbours —
  // so the sequences are filtered and the surviving indices remembered.
  const keep = (lines) => {
    const indices = [];
    lines.forEach((line, index) => {
      if (options.ignoreBlankLines && line.trim() === "") return;
      indices.push(index);
    });
    return indices;
  };
  const leftKept = keep(left.lines);
  const rightKept = keep(right.lines);

  const leftKeys = leftKept.map((index) => lineKey(left.lines[index], options));
  const rightKeys = rightKept.map((index) => lineKey(right.lines[index], options));

  // "Final line, with no newline after it" is part of what a line *is*, and a
  // pair of documents that differ only in a trailing newline are not the same
  // document — git shows that change, and so must this.
  //
  // The marker goes on each side's own final line whenever that side lacks a
  // terminator, independently of the other. Marking only when the two flags
  // disagree is not enough: two files can both end without a newline while
  // ending on *different* lines, and the shared line that is last in one but
  // not the other still has to compare unequal, or the emitted patch cannot
  // round-trip.
  if (left.noEol && leftKeys.length > 0) leftKeys[leftKeys.length - 1] += NO_EOL_MARKER;
  if (right.noEol && rightKeys.length > 0) rightKeys[rightKeys.length - 1] += NO_EOL_MARKER;

  const { ops, algorithm } = diffSequences(leftKeys, rightKeys, options);

  // Map filtered positions back onto real line numbers. With no blank-line
  // filtering this is the identity, which is the usual path.
  const remap = (op) => ({
    type: op.type,
    aStart: op.aStart < leftKept.length ? leftKept[op.aStart] : left.lines.length,
    aEnd: op.aEnd < leftKept.length ? leftKept[op.aEnd] : left.lines.length,
    bStart: op.bStart < rightKept.length ? rightKept[op.bStart] : right.lines.length,
    bEnd: op.bEnd < rightKept.length ? rightKept[op.bEnd] : right.lines.length,
  });
  const realOps = options.ignoreBlankLines ? coalesce(ops.map(remap)) : ops;

  const changes = toChanges(realOps, left.lines, right.lines);

  let additions = 0;
  let deletions = 0;
  let modifications = 0;
  for (const change of changes) {
    if (change.type === "insert") additions += change.rightLines.length;
    else if (change.type === "delete") deletions += change.leftLines.length;
    else if (change.type === "replace") {
      modifications += Math.min(change.leftLines.length, change.rightLines.length);
      additions += Math.max(0, change.rightLines.length - change.leftLines.length);
      deletions += Math.max(0, change.leftLines.length - change.rightLines.length);
    }
  }

  return {
    changes,
    hunks: buildHunks(changes, context),
    algorithm,
    identical: changes.every((change) => change.type === "equal"),
    stats: { additions, deletions, modifications },
    left: { lines: left.lines, noEol: left.noEol },
    right: { lines: right.lines, noEol: right.noEol },
  };
}
