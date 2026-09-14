/**
 * Unified Patch Writer & Parser (`diff-patch.js`)
 *
 * The `#patch` tab is the reason this module exists, and the reason it is
 * shaped the way it is.
 *
 * `parsePatch` produces **the same hunk structure `diff-engine.js` produces**.
 * That is the one design decision here worth defending: a patch pasted into the
 * page and a diff computed in the page converge on one intermediate
 * representation, so `diff-render.js` draws both without knowing which it has.
 * Reading a patch costs a parser and no view code at all. Had the patch tab
 * owned its own rendering, this app would be half as large again and the two
 * views would drift apart on every change.
 *
 * It also buys the strongest test in the suite for free: because the writer and
 * the parser speak the same structure, `applyPatch(a, writePatch(diff(a, b)))`
 * must equal `b`, and a property test over generated pairs holds all three
 * honest. An off-by-one in a hunk header is invisible to inspection and fatal
 * in use — a patch that applies cleanly to the wrong place corrupts a file
 * silently, which is worse than emitting nothing.
 *
 * Parse failures are reported the way `json-parser.js` reports them: a result
 * object carrying a 1-based `line`, `column` and an excerpt, never an exception
 * and never a half-rendered patch.
 *
 * Pure vanilla ES module. Zero dependencies, no DOM.
 */

import { splitLines } from "./diff-engine.js";

/** Git's marker for a final line with no terminating newline. */
const NO_EOL = "\\ No newline at end of file";

const HUNK_HEADER = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@+(.*)$/;

function fail(line, column, message, source) {
  return {
    ok: false,
    error: { line, column, message, excerpt: excerptAt(source, line, column) },
  };
}

/**
 * One line of context with a caret under the offending column, for the UI to
 * show verbatim.
 */
export function excerptAt(lines, line, column) {
  const text = lines[line - 1] ?? "";
  return `${text}\n${" ".repeat(Math.max(0, column - 1))}^`;
}

/**
 * Render a hunk header the way git does: a count of exactly 1 is written bare,
 * and a count of 0 anchors on the line *before* the change rather than on a
 * line that does not exist.
 */
function formatRange(start, count) {
  if (count === 0) return `${start},0`;
  if (count === 1) return `${start + 1}`;
  return `${start + 1},${count}`;
}

/**
 * Serialise a diff result as a standard unified patch.
 *
 * @param {object} result the value returned by `diffLines`
 * @param {{ leftLabel?: string, rightLabel?: string }} [options]
 * @returns {string}
 */
export function writePatch(result, options = {}) {
  const leftLabel = options.leftLabel ?? "a/original";
  const rightLabel = options.rightLabel ?? "b/changed";

  if (result.hunks.length === 0) return "";

  const out = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
  const lastLeft = result.left.lines.length - 1;
  const lastRight = result.right.lines.length - 1;

  for (const hunk of result.hunks) {
    out.push(`@@ -${formatRange(hunk.leftStart, hunk.leftCount)} +${formatRange(hunk.rightStart, hunk.rightCount)} @@`);

    for (const change of hunk.changes) {
      if (change.type === "equal") {
        change.leftLines.forEach((line, index) => {
          out.push(` ${line}`);
          const isLast =
            change.leftStart + index === lastLeft && change.rightStart + index === lastRight;
          if (isLast && (result.left.noEol || result.right.noEol)) out.push(NO_EOL);
        });
        continue;
      }
      change.leftLines.forEach((line, index) => {
        out.push(`-${line}`);
        if (change.leftStart + index === lastLeft && result.left.noEol) out.push(NO_EOL);
      });
      change.rightLines.forEach((line, index) => {
        out.push(`+${line}`);
        if (change.rightStart + index === lastRight && result.right.noEol) out.push(NO_EOL);
      });
    }
  }

  return `${out.join("\n")}\n`;
}

/** Fold delete/insert neighbours into `replace`, matching the engine's output. */
function pairRuns(raw) {
  const changes = [];
  for (let i = 0; i < raw.length; i++) {
    const current = raw[i];
    const next = raw[i + 1];
    if (current.type === "delete" && next && next.type === "insert") {
      changes.push({
        type: "replace",
        leftStart: current.leftStart,
        leftLines: current.leftLines,
        rightStart: next.rightStart,
        rightLines: next.rightLines,
      });
      i++;
      continue;
    }
    changes.push(current);
  }
  return changes;
}

/**
 * Parse unified patch text.
 *
 * Accepts a full `git diff` (several files, `diff --git` preambles and index
 * lines included) and a bare paste of hunks with no file headers at all, which
 * is what people actually copy out of a code review.
 *
 * @param {string} text
 * @returns {{ ok: true, files: Array }|{ ok: false, error: object }}
 */
export function parsePatch(text) {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) {
    return { ok: false, error: { line: 1, column: 1, message: "Patch is empty", excerpt: "" } };
  }

  const files = [];
  let file = null;
  let hunk = null;
  let raw = null;
  let leftCursor = 0;
  let rightCursor = 0;

  const startFile = (oldPath, newPath) => {
    file = { oldPath, newPath, hunks: [], oldNoEol: false, newNoEol: false };
    files.push(file);
  };

  const closeHunk = (index) => {
    if (!hunk) return null;
    if (raw.length > 0 && raw[raw.length - 1].leftLines.length + raw[raw.length - 1].rightLines.length === 0) {
      raw.pop();
    }
    const seenLeft = leftCursor - hunk.leftStart;
    const seenRight = rightCursor - hunk.rightStart;
    if (seenLeft !== hunk.leftCount || seenRight !== hunk.rightCount) {
      return fail(
        index,
        1,
        `Hunk claims ${hunk.leftCount} line(s) before and ${hunk.rightCount} after, but carries ${seenLeft} and ${seenRight}`,
        lines
      );
    }
    hunk.changes = pairRuns(raw);
    file.hunks.push(hunk);
    hunk = null;
    raw = null;
    return null;
  };

  const push = (type, line) => {
    const last = raw[raw.length - 1];
    if (last && last.type === type) {
      if (type === "insert") last.rightLines.push(line);
      else if (type === "delete") last.leftLines.push(line);
      else {
        last.leftLines.push(line);
        last.rightLines.push(line);
      }
      return;
    }
    if (type === "insert") {
      raw.push({ type, leftStart: leftCursor, leftLines: [], rightStart: rightCursor, rightLines: [line] });
    } else if (type === "delete") {
      raw.push({ type, leftStart: leftCursor, leftLines: [line], rightStart: rightCursor, rightLines: [] });
    } else {
      raw.push({ type, leftStart: leftCursor, leftLines: [line], rightStart: rightCursor, rightLines: [line] });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (line.startsWith("diff --git ") || line.startsWith("index ")) {
      const closed = closeHunk(lineNumber);
      if (closed) return closed;
      continue;
    }

    if (line.startsWith("--- ")) {
      const closed = closeHunk(lineNumber);
      if (closed) return closed;
      startFile(line.slice(4).trim(), null);
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (!file) startFile(null, null);
      file.newPath = line.slice(4).trim();
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      const closed = closeHunk(lineNumber);
      if (closed) return closed;
      if (!file) startFile("a", "b");

      const leftCount = header[2] === undefined ? 1 : Number(header[2]);
      const rightCount = header[4] === undefined ? 1 : Number(header[4]);
      const leftDeclared = Number(header[1]);
      const rightDeclared = Number(header[3]);
      // A count of 0 anchors on the preceding line, so it is already the
      // 0-based index; anything else is 1-based and steps back by one.
      hunk = {
        leftStart: leftCount === 0 ? leftDeclared : leftDeclared - 1,
        leftCount,
        rightStart: rightCount === 0 ? rightDeclared : rightDeclared - 1,
        rightCount,
        header: header[5].trim(),
        changes: [],
      };
      if (hunk.leftStart < 0 || hunk.rightStart < 0) {
        return fail(lineNumber, 4, "Hunk header line numbers must be positive", lines);
      }
      raw = [];
      leftCursor = hunk.leftStart;
      rightCursor = hunk.rightStart;
      continue;
    }

    if (line.startsWith("@@")) {
      return fail(lineNumber, 1, "Malformed hunk header — expected @@ -old,count +new,count @@", lines);
    }

    if (!hunk) {
      // Preamble, commit message, "new file mode", trailing junk: ignored
      // outside a hunk, which is what makes an email-pasted patch work.
      continue;
    }

    if (line === NO_EOL || line.startsWith("\\ No newline")) {
      const last = raw[raw.length - 1];
      if (last?.type === "insert") file.newNoEol = true;
      else if (last?.type === "delete") file.oldNoEol = true;
      else {
        file.oldNoEol = true;
        file.newNoEol = true;
      }
      continue;
    }

    const marker = line[0];
    const content = line.slice(1);
    if (marker === "+") {
      push("insert", content);
      rightCursor++;
    } else if (marker === "-") {
      push("delete", content);
      leftCursor++;
    } else if (marker === " " || line === "") {
      // A genuinely empty line in the body is a context line whose single
      // leading space some mailers strip. Treating it as context is what most
      // patches in the wild need.
      push("equal", marker === " " ? content : "");
      leftCursor++;
      rightCursor++;
    } else {
      return fail(lineNumber, 1, `Unexpected "${marker}" in hunk body — expected " ", "+", "-" or "\\"`, lines);
    }
  }

  const closed = closeHunk(lines.length);
  if (closed) return closed;

  if (files.length === 0 || files.every((entry) => entry.hunks.length === 0)) {
    return fail(1, 1, "No hunks found — expected at least one @@ header", lines);
  }

  return { ok: true, files };
}

/**
 * Apply a parsed or textual patch to a source document.
 *
 * Used by the round-trip property test rather than by the UI — `/diff` reads
 * and renders, it does not write a third document. Keeping it here anyway is
 * what lets the writer and the parser be checked against each other; esbuild
 * drops it from the bundle because nothing in the entry graph calls it.
 *
 * @param {string} sourceText
 * @param {string|object} patch patch text, or the result of `parsePatch`
 * @returns {{ ok: true, text: string }|{ ok: false, error: object }}
 */
export function applyPatch(sourceText, patch) {
  const parsed = typeof patch === "string" ? parsePatch(patch) : patch;
  if (!parsed.ok) return parsed;

  const source = splitLines(sourceText);
  const file = parsed.files.find((entry) => entry.hunks.length > 0);
  const out = [];
  let cursor = 0;

  for (const hunk of file.hunks) {
    if (hunk.leftStart < cursor) {
      return { ok: false, error: { line: 0, column: 0, message: "Hunks are out of order" } };
    }
    out.push(...source.lines.slice(cursor, hunk.leftStart));
    cursor = hunk.leftStart;

    for (const change of hunk.changes) {
      if (change.type === "insert") {
        out.push(...change.rightLines);
        continue;
      }
      const actual = source.lines.slice(cursor, cursor + change.leftLines.length);
      if (actual.join("\n") !== change.leftLines.join("\n")) {
        return {
          ok: false,
          error: {
            line: cursor + 1,
            column: 1,
            message: `Context does not match at line ${cursor + 1}`,
          },
        };
      }
      cursor += change.leftLines.length;
      if (change.type === "equal") out.push(...change.leftLines);
      else if (change.type === "replace") out.push(...change.rightLines);
    }
  }

  // When the patch never reaches the final line, the tail is copied verbatim
  // and the result's terminator is the *source's*, not the patch's — a unified
  // diff has nowhere to record a no-newline marker for a line it does not
  // include. That is safe here because a pair whose terminators disagree always
  // makes the final line unequal, so the patch is guaranteed to cover it.
  const tailCopied = cursor < source.lines.length;
  out.push(...source.lines.slice(cursor));
  if (out.length === 0) return { ok: true, text: "" };
  const noEol = tailCopied ? source.noEol : file.newNoEol;
  return { ok: true, text: out.join("\n") + (noEol ? "" : "\n") };
}

/**
 * Flatten a parsed patch into the shape `diff-render.js` draws, synthesising
 * the two sides from the hunks themselves. Only the hunks are known — a patch
 * carries no unchanged remainder — so the rendered view is the patch, not the
 * whole file.
 */
export function patchToView(parsed) {
  const empty = {
    hunks: [],
    changes: [],
    algorithm: "patch",
    identical: true,
    stats: { additions: 0, deletions: 0, modifications: 0 },
    left: { lines: [], noEol: false },
    right: { lines: [], noEol: false },
    files: [],
  };
  // A caller that skipped the `ok` check gets an empty view rather than a
  // crash — this is reached from a paste handler on every keystroke.
  if (!parsed?.ok || !parsed.files?.length) return empty;

  const file = parsed.files.find((entry) => entry.hunks.length > 0) ?? parsed.files[0];
  let additions = 0;
  let deletions = 0;
  let modifications = 0;

  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (change.type === "insert") additions += change.rightLines.length;
      else if (change.type === "delete") deletions += change.leftLines.length;
      else if (change.type === "replace") {
        modifications += Math.min(change.leftLines.length, change.rightLines.length);
        additions += Math.max(0, change.rightLines.length - change.leftLines.length);
        deletions += Math.max(0, change.leftLines.length - change.rightLines.length);
      }
    }
  }

  return {
    hunks: file.hunks,
    changes: file.hunks.flatMap((hunk) => hunk.changes),
    algorithm: "patch",
    identical: file.hunks.length === 0,
    stats: { additions, deletions, modifications },
    left: { lines: [], noEol: file.oldNoEol },
    right: { lines: [], noEol: file.newNoEol },
    files: parsed.files,
  };
}
