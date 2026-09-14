/**
 * Intra-line Refinement (`diff-refine.js`)
 *
 * "This line changed" is rarely the answer anyone wants. `const timeout = 30;`
 * against `const timeout = 300;` is one character of news wrapped in forty
 * characters of noise, and a viewer that paints the whole pair red and green
 * makes the reader do the comparison a second time by eye.
 *
 * So each paired line runs through the very same algorithm as the file, one
 * scale down: tokenise both sides, diff the token sequences with
 * `diffSequences`, and project the result back onto character ranges the
 * renderer can wrap. One engine, two granularities — the alternative is a
 * second, subtly different differ to keep correct.
 *
 * Two guards stop refinement from making things worse:
 *
 * - **Length.** Refining two 40 KB lines costs more than the result is worth,
 *   so past `MAX_REFINE_LENGTH` the pair stays a whole-line change.
 * - **Similarity.** Two lines with almost nothing in common produce a
 *   confetti of alternating spans that reads worse than a clean
 *   red-line/green-line pair. Below `MIN_SIMILARITY` the pair is left alone.
 *
 * Pure vanilla ES module. Zero dependencies, no DOM.
 */

import { diffSequences, MAX_REFINE_LENGTH } from "./diff-engine.js";

/**
 * Fraction of tokens the two lines must share before a character-level
 * highlight is an improvement rather than noise.
 */
export const MIN_SIMILARITY = 0.25;

/**
 * Split a line into the units a reader thinks in: identifiers and numbers as
 * whole words, runs of whitespace as one token, and every other character on
 * its own so a changed bracket or comma is pinpointed rather than swallowed
 * into the word beside it.
 *
 * @param {string} line
 * @returns {Array<{ text: string, start: number, end: number }>}
 */
export function tokenizeForRefine(line) {
  const tokens = [];
  let index = 0;
  while (index < line.length) {
    const start = index;
    const character = line[index];

    if (/\s/.test(character)) {
      while (index < line.length && /\s/.test(line[index])) index++;
    } else if (/[A-Za-z0-9_$]/.test(character)) {
      while (index < line.length && /[A-Za-z0-9_$]/.test(line[index])) index++;
    } else {
      index++;
    }

    tokens.push({ text: line.slice(start, index), start, end: index });
  }
  return tokens;
}

/** Collapse neighbouring ranges of the same kind so the DOM gets fewer spans. */
function mergeSpans(spans) {
  const merged = [];
  for (const span of spans) {
    if (span.end <= span.start) continue;
    const last = merged[merged.length - 1];
    if (last && last.changed === span.changed && last.end === span.start) {
      last.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Character ranges to highlight within one changed line pair.
 *
 * @param {string} leftLine
 * @param {string} rightLine
 * @returns {{ left: Array, right: Array }|null} `null` when the pair should be
 *   shown as a plain whole-line change.
 */
export function refineLinePair(leftLine, rightLine) {
  if (leftLine === rightLine) return null;
  if (leftLine.length > MAX_REFINE_LENGTH || rightLine.length > MAX_REFINE_LENGTH) return null;
  if (leftLine.length === 0 || rightLine.length === 0) return null;

  const leftTokens = tokenizeForRefine(leftLine);
  const rightTokens = tokenizeForRefine(rightLine);

  const { ops } = diffSequences(
    leftTokens.map((token) => token.text),
    rightTokens.map((token) => token.text)
  );

  // Similarity counts only tokens with substance. Two lines that share nothing
  // but the spaces between their words are not similar, and letting whitespace
  // vote was enough on its own to push unrelated lines over the threshold.
  const substantial = (text) => text.trim() !== "";
  let shared = 0;
  for (const op of ops) {
    if (op.type !== "equal") continue;
    for (let i = op.aStart; i < op.aEnd; i++) {
      if (substantial(leftTokens[i].text)) shared++;
    }
  }
  const total =
    leftTokens.filter((token) => substantial(token.text)).length +
    rightTokens.filter((token) => substantial(token.text)).length;
  const similarity = total === 0 ? 0 : (2 * shared) / total;
  if (similarity < MIN_SIMILARITY) return null;

  const left = [];
  const right = [];
  for (const op of ops) {
    const changed = op.type !== "equal";
    if (op.aEnd > op.aStart) {
      left.push({
        start: leftTokens[op.aStart].start,
        end: leftTokens[op.aEnd - 1].end,
        changed,
      });
    }
    if (op.bEnd > op.bStart) {
      right.push({
        start: rightTokens[op.bStart].start,
        end: rightTokens[op.bEnd - 1].end,
        changed,
      });
    }
  }

  return { left: mergeSpans(left), right: mergeSpans(right) };
}

/**
 * Attach refinement to every `replace` change in place.
 *
 * Lines are paired by position within the change. A replace of three lines by
 * five refines the first three pairs and leaves the remaining two as plain
 * insertions, which is what the renderer draws them as anyway.
 *
 * @param {Array} changes
 * @returns {Array} the same array, for chaining
 */
export function refineChanges(changes) {
  for (const change of changes) {
    if (change.type !== "replace") continue;
    const pairs = Math.min(change.leftLines.length, change.rightLines.length);
    const refine = [];
    for (let i = 0; i < pairs; i++) {
      refine.push(refineLinePair(change.leftLines[i], change.rightLines[i]));
    }
    change.refine = refine;
  }
  return changes;
}
