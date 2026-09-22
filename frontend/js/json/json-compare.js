/**
 * Structural JSON comparison for the Workbench.
 *
 * `/diff`'s About tab states the limitation this closes, about itself: "two
 * JSON documents that differ just in key order are reported as different."
 * That is correct for a text diff and wrong for JSON, where `{"a":1,"b":2}`
 * and `{"b":2,"a":1}` are the same document. The pieces to fix it were already
 * in the repo on either side of the gap - this page can already sort keys and
 * print deterministically, and `/diff` has a Myers implementation - so the
 * only real decision here is the import below.
 *
 * That import is deliberate and worth naming: `diff-engine.js` is a pure
 * function over two strings with no DOM and no page state, which is what makes
 * it reusable rather than entangling. The alternative was a second copy of
 * Myers in this folder.
 */

import { diffLines } from "../diff/diff-engine.js";
import { parseJson } from "./json-parser.js";

/**
 * Canonical text for a parsed value: keys sorted at every depth, one fixed
 * indent, so two documents that mean the same thing print the same way.
 *
 * Array order is preserved - it is meaningful in JSON, and sorting it would
 * make the comparison lie about a real difference.
 */
export function canonicalise(value, indent = 2) {
  return JSON.stringify(sortDeep(value), null, indent);
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
  return out;
}

/**
 * Compare two JSON documents.
 *
 * With `ignoreKeyOrder` on (the default) both sides are canonicalised first,
 * so key order stops being a difference. With it off the two sides are still
 * pretty-printed to the same indent - comparing raw text would report every
 * whitespace choice as a change and drown the real ones.
 *
 * A document that does not parse is reported, not thrown: pasting something
 * half-copied is the normal way to arrive here.
 *
 * @param {string} leftText
 * @param {string} rightText
 * @param {{indent?: number, ignoreKeyOrder?: boolean, context?: number}} [options]
 */
export function compareDocuments(leftText, rightText, options = {}) {
  const indent = options.indent ?? 2;
  const ignoreKeyOrder = options.ignoreKeyOrder !== false;

  const left = parseJson(leftText ?? "");
  const right = parseJson(rightText ?? "");

  if (!left.ok || !right.ok) {
    return {
      ok: false,
      leftError: left.ok ? null : left.error,
      rightError: right.ok ? null : right.error,
    };
  }

  const render = (value) =>
    ignoreKeyOrder ? canonicalise(value, indent) : JSON.stringify(value, null, indent);

  const leftCanonical = render(left.value);
  const rightCanonical = render(right.value);
  const result = diffLines(leftCanonical, rightCanonical, { context: options.context ?? 3 });

  return {
    ok: true,
    leftError: null,
    rightError: null,
    identical: result.identical,
    leftCanonical,
    rightCanonical,
    result,
    stats: result.stats,
  };
}

/**
 * The comparison as flat rows, ready to paint.
 *
 * Only the hunks are walked, so an unchanged run between two differences costs
 * its context lines and nothing more - the same reason `/diff` builds hunks
 * rather than rendering every line of both documents.
 */
export function compareRows(result, { maxRows = 4000 } = {}) {
  const rows = [];
  if (!result || !result.hunks) return rows;

  // The cap is checked per LINE, not per change: a single `replace` can carry
  // hundreds of lines, so a check that only ran between changes would let one
  // of them blow straight through the limit it exists to enforce.
  for (const hunk of result.hunks) {
    if (rows.length >= maxRows) return rows;
    rows.push({ type: "hunk", text: hunkHeader(hunk) });

    for (const change of hunk.changes) {
      const equal = change.type === "equal";

      for (const [i, line] of (change.leftLines ?? []).entries()) {
        if (rows.length >= maxRows) return rows;
        rows.push({
          type: equal ? "equal" : "delete",
          left: change.leftStart + i + 1,
          right: equal ? change.rightStart + i + 1 : null,
          text: line,
        });
      }

      // An `equal` run is one row per line, already emitted above - its right
      // side is the same text at a different number.
      if (equal) continue;

      for (const [i, line] of (change.rightLines ?? []).entries()) {
        if (rows.length >= maxRows) return rows;
        rows.push({ type: "insert", left: null, right: change.rightStart + i + 1, text: line });
      }
    }
  }

  return rows;
}

function hunkHeader(hunk) {
  return `@@ -${hunk.leftStart + 1},${hunk.leftCount} +${hunk.rightStart + 1},${hunk.rightCount} @@`;
}
