// Keydown -> intent. Kept separate from the DOM so the binding table is
// testable and so the Ctrl+K palette can reuse the same vocabulary.

export const Intent = {
  SUBMIT: "submit",
  HIST_PREV: "histPrev",
  HIST_NEXT: "histNext",
  COMPLETE: "complete",
  CLEAR: "clear",
  ABORT: "abort",
  BLUR: "blur",
  NONE: "none",
};

/**
 * @param {KeyboardEvent} event
 * @returns {string} one of Intent.*
 */
export function intentFor(event) {
  const mod = event.ctrlKey || event.metaKey;

  if (mod) {
    switch (event.key.toLowerCase()) {
      case "l":
        return Intent.CLEAR;
      case "c":
        // Only claim Ctrl+C when there is nothing selected to copy.
        return Intent.ABORT;
      default:
        return Intent.NONE;
    }
  }

  switch (event.key) {
    case "Enter":
      return Intent.SUBMIT;
    case "ArrowUp":
      return Intent.HIST_PREV;
    case "ArrowDown":
      return Intent.HIST_NEXT;
    case "Tab":
      // Shift+Tab is never completion - it is how a keyboard user leaves.
      // Claiming Tab in BOTH directions made this input a keyboard trap
      // (WCAG 2.1.2): focus could enter the prompt and never get out, on the
      // default tab path through the About section. Forward Tab still
      // completes; index.js additionally declines an empty prompt, where
      // there is nothing to complete anyway.
      return event.shiftKey ? Intent.NONE : Intent.COMPLETE;
    case "Escape":
      // The second way out, and the one the key hints name.
      return Intent.BLUR;
    default:
      return Intent.NONE;
  }
}

/**
 * Longest common prefix of a candidate list — what a real shell inserts when
 * Tab is ambiguous. Returns "" when the candidates share nothing.
 */
export function commonPrefix(candidates) {
  if (candidates.length === 0) return "";
  let prefix = candidates[0];
  for (const candidate of candidates.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < candidate.length && prefix[i] === candidate[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

/**
 * Resolve a Tab press against the registry.
 *
 * Completes the command word when the cursor is still on it, and delegates to
 * the command's own `complete()` for later words — so `cd po<Tab>` finishes
 * the section name, which the previous command-name-only completion could not.
 *
 * @returns {{ value: string, matches: string[] }} `value` is the replacement
 *   input value (unchanged when there is nothing unambiguous to insert).
 */
export function completeInput(raw, registry, ctx) {
  const trailingSpace = /\s$/.test(raw);
  const parts = raw.trimStart().split(/\s+/).filter(Boolean);

  // Completing the command word itself.
  if (parts.length === 0 || (parts.length === 1 && !trailingSpace)) {
    const partial = (parts[0] ?? "").toLowerCase();
    const matches = registry.names().filter((name) => name.startsWith(partial));
    if (matches.length === 1) return { value: `${matches[0]} `, matches };
    const prefix = commonPrefix(matches);
    return { value: prefix.length > partial.length ? prefix : raw, matches };
  }

  // Completing an argument.
  const command = registry.get(parts[0]);
  if (!command || typeof command.complete !== "function") return { value: raw, matches: [] };

  const partial = trailingSpace ? "" : parts[parts.length - 1];
  const argIndex = trailingSpace ? parts.length - 1 : parts.length - 2;
  let matches = [];
  try {
    matches = command.complete(ctx, partial, argIndex) ?? [];
  } catch {
    matches = [];
  }
  if (matches.length === 0) return { value: raw, matches };

  const head = trailingSpace ? parts : parts.slice(0, -1);
  const insert = matches.length === 1 ? `${matches[0]} ` : commonPrefix(matches);
  if (!insert || (matches.length > 1 && insert.length <= partial.length)) {
    return { value: raw, matches };
  }
  return { value: `${head.join(" ")} ${insert}`, matches };
}
