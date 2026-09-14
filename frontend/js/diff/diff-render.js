/**
 * Diff Renderer (`diff-render.js`)
 *
 * Turns the hunk structure into DOM, in split or unified layout.
 *
 * **Nothing here builds an HTML string.** Every line of both panes is
 * attacker-controlled text that the visitor has explicitly asked to see
 * rendered, which is the exact shape of a stored-XSS bug: one `innerHTML +=`
 * and a pasted `<img onerror>` executes in the page's origin. So each segment
 * is a `createElement` plus a `textContent` assignment, DOMPurify is neither
 * loaded nor needed — there is no HTML to purify — and a test feeds a payload
 * through and asserts it renders as visible text.
 *
 * Syntax colour and intra-line refinement both want to wrap parts of the same
 * line. Rather than nesting one inside the other, the two span lists are merged
 * into a single set of boundaries and each resulting segment carries whichever
 * classes apply to it. That keeps the DOM flat and makes "diff colour wins over
 * token colour" a question of CSS rather than of nesting order.
 *
 * Only hunks are drawn. The unchanged stretches between them collapse to an
 * expander that renders its lines on demand, so a one-line change in a
 * ten-thousand-line file costs a handful of rows rather than ten thousand.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

import { tokenizeDocument } from "./diff-tokenize.js";
import { refineLinePair } from "./diff-refine.js";

/**
 * Hard ceiling on rows drawn in one pass. Collapsed regions already keep a
 * normal diff small; this is for the pathological case of two large files that
 * share nothing, where every line is a change and the honest answer is to draw
 * a lot and say what was left out.
 */
export const MAX_RENDER_ROWS = 5000;

/** Lines past this length are not syntax-tinted; the pass stops paying off. */
const MAX_TOKENIZE_LENGTH = 4000;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Write one line into a `<code>` cell, merging syntax spans and refinement
 * spans into a single flat run of segments.
 *
 * Both lists arrive sorted and non-overlapping, so the boundaries are merged
 * with a linear sweep rather than a lookup per character.
 */
function paintCode(target, line, tokenSpans, refineSpans, refineClass) {
  if (line === "") return;

  const boundaries = new Set([0, line.length]);
  for (const span of tokenSpans) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  for (const span of refineSpans ?? []) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }

  const points = [...boundaries]
    .filter((point) => point >= 0 && point <= line.length)
    .sort((a, b) => a - b);

  let tokenIndex = 0;
  let refineIndex = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;

    while (tokenIndex < tokenSpans.length && tokenSpans[tokenIndex].end <= start) tokenIndex++;
    const token =
      tokenIndex < tokenSpans.length &&
      tokenSpans[tokenIndex].start <= start &&
      tokenSpans[tokenIndex].end >= end
        ? tokenSpans[tokenIndex]
        : null;

    const refine = refineSpans ?? [];
    while (refineIndex < refine.length && refine[refineIndex].end <= start) refineIndex++;
    const changed =
      refineIndex < refine.length &&
      refine[refineIndex].start <= start &&
      refine[refineIndex].end >= end &&
      refine[refineIndex].changed;

    const text = line.slice(start, end);
    if (!token && !changed) {
      target.appendChild(document.createTextNode(text));
      continue;
    }

    const span = element("span");
    if (token) span.classList.add(`tok-${token.type}`);
    if (changed) span.classList.add(refineClass);
    span.textContent = text;
    target.appendChild(span);
  }
}

/**
 * Build a per-line token index for one side.
 *
 * A computed diff carries both documents whole, so the lexer sees them in order
 * and block comments span lines correctly. A pasted patch carries only its
 * hunks, so the gaps are filled with blanks — the comment state resets across a
 * gap, which is the most that can be known from a patch.
 */
function buildTokenIndex(lines) {
  if (lines.length === 0) return [];
  return tokenizeDocument(lines.map((line) => (line.length > MAX_TOKENIZE_LENGTH ? "" : line)));
}

function sideLines(result, side) {
  const whole = result[side].lines;
  if (whole.length > 0) return whole;

  // Patch mode: reconstruct a sparse document from the hunks alone.
  const key = side === "left" ? "leftLines" : "rightLines";
  const startKey = side === "left" ? "leftStart" : "rightStart";
  const lines = [];
  for (const hunk of result.hunks) {
    for (const change of hunk.changes) {
      change[key].forEach((line, index) => {
        lines[change[startKey] + index] = line;
      });
    }
  }
  for (let i = 0; i < lines.length; i++) if (lines[i] === undefined) lines[i] = "";
  return lines;
}

/** One half of a split row, or the single half of a unified row. */
function half(kind, options) {
  const node = element("div", options.unified ? "diff-half diff-half--unified" : "diff-half");
  node.dataset.kind = kind;

  if (options.unified) {
    node.appendChild(element("span", "diff-gutter", options.leftNumber ?? ""));
    node.appendChild(element("span", "diff-gutter", options.rightNumber ?? ""));
  } else {
    node.appendChild(element("span", "diff-gutter", options.number ?? ""));
  }
  node.appendChild(element("span", "diff-marker", options.marker ?? ""));

  const code = element("code", "diff-code");
  if (kind !== "void") {
    paintCode(code, options.line ?? "", options.tokens ?? [], options.refine, options.refineClass);
  }
  node.appendChild(code);
  return node;
}

function markerFor(kind) {
  if (kind === "insert") return "+";
  if (kind === "delete") return "−";
  return " ";
}

/**
 * Draw a diff or a parsed patch into a container.
 *
 * @param {HTMLElement} container emptied before drawing
 * @param {object} result output of `diffLines` or `patchToView`
 * @param {{ view?: "split"|"unified", expanded?: Set<number>,
 *           onExpand?: (index: number) => void, emptyMessage?: string }} [options]
 * @returns {{ rows: HTMLElement[], truncated: boolean }} the change rows, in
 *   order, for the prev/next navigation to step through
 */
export function renderDiff(container, result, options = {}) {
  const unified = options.view === "unified";
  const expanded = options.expanded ?? new Set();

  container.textContent = "";

  if (!result || result.hunks.length === 0) {
    container.appendChild(
      element("div", "diff-empty", options.emptyMessage ?? "No differences.")
    );
    return { rows: [], truncated: false };
  }

  const leftLines = sideLines(result, "left");
  const rightLines = sideLines(result, "right");
  const leftTokens = buildTokenIndex(leftLines);
  const rightTokens = buildTokenIndex(rightLines);
  const hasWholeDocument = result.left.lines.length > 0 || result.right.lines.length > 0;

  const changeRows = [];
  let rowCount = 0;
  let truncated = false;

  const addRow = (kind, halves) => {
    if (rowCount >= MAX_RENDER_ROWS) {
      truncated = true;
      return null;
    }
    rowCount++;
    const row = element("div", "diff-row");
    row.dataset.kind = kind;
    for (const node of halves) row.appendChild(node);
    container.appendChild(row);
    if (kind !== "equal") changeRows.push(row);
    return row;
  };

  const equalRow = (leftIndex, rightIndex) => {
    const line = leftLines[leftIndex] ?? rightLines[rightIndex] ?? "";
    if (unified) {
      return addRow("equal", [
        half("equal", {
          unified: true,
          leftNumber: String(leftIndex + 1),
          rightNumber: String(rightIndex + 1),
          marker: markerFor("equal"),
          line,
          tokens: leftTokens[leftIndex] ?? [],
        }),
      ]);
    }
    return addRow("equal", [
      half("equal", {
        number: String(leftIndex + 1),
        marker: markerFor("equal"),
        line,
        tokens: leftTokens[leftIndex] ?? [],
      }),
      half("equal", {
        number: String(rightIndex + 1),
        marker: markerFor("equal"),
        line: rightLines[rightIndex] ?? line,
        tokens: rightTokens[rightIndex] ?? [],
      }),
    ]);
  };

  /** Render the unchanged stretch between two hunks, or the expander for it. */
  const gap = (index, leftFrom, leftTo, rightFrom) => {
    const count = leftTo - leftFrom;
    if (count <= 0) return;
    if (!hasWholeDocument) return;

    if (expanded.has(index)) {
      for (let i = 0; i < count; i++) equalRow(leftFrom + i, rightFrom + i);
      return;
    }
    const button = element(
      "button",
      "diff-expander",
      `Show ${count} unchanged line${count === 1 ? "" : "s"}`
    );
    button.type = "button";
    button.dataset.gap = String(index);
    if (options.onExpand) {
      button.addEventListener("click", () => options.onExpand(index));
    }
    container.appendChild(button);
  };

  let previousLeftEnd = 0;
  let previousRightEnd = 0;

  result.hunks.forEach((hunk, hunkIndex) => {
    gap(hunkIndex, previousLeftEnd, hunk.leftStart, previousRightEnd);

    const head = element(
      "div",
      "diff-hunk-head",
      `@@ -${hunk.leftStart + 1},${hunk.leftCount} +${hunk.rightStart + 1},${hunk.rightCount} @@${
        hunk.header ? ` ${hunk.header}` : ""
      }`
    );
    container.appendChild(head);

    for (const change of hunk.changes) {
      if (change.type === "equal") {
        change.leftLines.forEach((_line, index) => {
          equalRow(change.leftStart + index, change.rightStart + index);
        });
        continue;
      }

      const pairs =
        change.type === "replace"
          ? Math.min(change.leftLines.length, change.rightLines.length)
          : 0;

      if (unified) {
        change.leftLines.forEach((line, index) => {
          const refine =
            index < pairs ? (change.refine?.[index] ?? refineLinePair(line, change.rightLines[index])) : null;
          addRow("delete", [
            half("delete", {
              unified: true,
              leftNumber: String(change.leftStart + index + 1),
              rightNumber: "",
              marker: markerFor("delete"),
              line,
              tokens: leftTokens[change.leftStart + index] ?? [],
              refine: refine?.left,
              refineClass: "rf-del",
            }),
          ]);
        });
        change.rightLines.forEach((line, index) => {
          const refine =
            index < pairs ? (change.refine?.[index] ?? refineLinePair(change.leftLines[index], line)) : null;
          addRow("insert", [
            half("insert", {
              unified: true,
              leftNumber: "",
              rightNumber: String(change.rightStart + index + 1),
              marker: markerFor("insert"),
              line,
              tokens: rightTokens[change.rightStart + index] ?? [],
              refine: refine?.right,
              refineClass: "rf-ins",
            }),
          ]);
        });
        continue;
      }

      const rows = Math.max(change.leftLines.length, change.rightLines.length);
      for (let index = 0; index < rows; index++) {
        const leftLine = change.leftLines[index];
        const rightLine = change.rightLines[index];
        const refine =
          index < pairs ? (change.refine?.[index] ?? refineLinePair(leftLine, rightLine)) : null;

        const leftHalf =
          leftLine === undefined
            ? half("void", {})
            : half("delete", {
                number: String(change.leftStart + index + 1),
                marker: markerFor("delete"),
                line: leftLine,
                tokens: leftTokens[change.leftStart + index] ?? [],
                refine: refine?.left,
                refineClass: "rf-del",
              });
        const rightHalf =
          rightLine === undefined
            ? half("void", {})
            : half("insert", {
                number: String(change.rightStart + index + 1),
                marker: markerFor("insert"),
                line: rightLine,
                tokens: rightTokens[change.rightStart + index] ?? [],
                refine: refine?.right,
                refineClass: "rf-ins",
              });
        addRow(change.type, [leftHalf, rightHalf]);
      }
    }

    previousLeftEnd = hunk.leftStart + hunk.leftCount;
    previousRightEnd = hunk.rightStart + hunk.rightCount;
  });

  gap(result.hunks.length, previousLeftEnd, leftLines.length, previousRightEnd);

  if (truncated) {
    container.appendChild(
      element(
        "div",
        "diff-empty",
        `Stopped after ${MAX_RENDER_ROWS.toLocaleString()} rows. The two documents differ too widely to draw in full — narrow them down, or download the patch instead.`
      )
    );
  }

  return { rows: changeRows, truncated };
}
