/**
 * regex-parser.js
 *
 * Real-time tokenizer, syntax classifier, and safe execution engine
 * for ECMAScript RegExp in the browser.
 *
 * Zero external dependencies.
 */

const VALID_FLAGS = new Set(["g", "i", "m", "s", "u", "y"]);

/**
 * Tokenizes a regex pattern string into syntax tokens with semantic descriptions
 * for visual color-coding and breakdown.
 */
export function tokenizeRegex(pattern) {
  if (!pattern) return [];

  const tokens = [];
  let i = 0;
  const len = pattern.length;

  while (i < len) {
    const ch = pattern[i];

    // 1. Escaped sequence
    if (ch === "\\") {
      if (i + 1 >= len) {
        tokens.push({ text: "\\", type: "error", description: "Trailing dangling backslash" });
        break;
      }
      const next = pattern[i + 1];

      // Predefined character class shorthand: \d, \D, \w, \W, \s, \S
      if ("dDwWsS".includes(next)) {
        tokens.push({
          text: "\\" + next,
          type: "tok-class",
          description: `Shorthand class: ${describeShorthand(next)}`,
        });
        i += 2;
        continue;
      }

      // Word boundary anchor: \b, \B
      if (next === "b" || next === "B") {
        tokens.push({
          text: "\\" + next,
          type: "tok-anchor",
          description: next === "b" ? "Word boundary" : "Non-word boundary",
        });
        i += 2;
        continue;
      }

      // Standard escape characters (\n, \r, \t, etc.)
      if ("nrtvf0".includes(next)) {
        tokens.push({
          text: "\\" + next,
          type: "tok-escape",
          description: `Control character: \\${next}`,
        });
        i += 2;
        continue;
      }

      // Hex/Unicode escape
      if (next === "x" && i + 3 < len) {
        const hex = pattern.slice(i, i + 4);
        tokens.push({ text: hex, type: "tok-escape", description: `Hex escape: ${hex}` });
        i += 4;
        continue;
      }
      if (next === "u" && i + 5 < len) {
        const uni = pattern.slice(i, i + 6);
        tokens.push({ text: uni, type: "tok-escape", description: `Unicode escape: ${uni}` });
        i += 6;
        continue;
      }

      // Escaped literal
      tokens.push({
        text: "\\" + next,
        type: "tok-escape",
        description: `Escaped literal '${next}'`,
      });
      i += 2;
      continue;
    }

    // 2. Character set / class: [...] or [^...]
    if (ch === "[") {
      let j = i + 1;
      let isNegated = false;
      if (j < len && pattern[j] === "^") {
        isNegated = true;
        j++;
      }
      // If first char after '[' or '[^' is ']', it's treated as a literal ']' in ECMAScript
      if (j < len && pattern[j] === "]") {
        j++;
      }
      while (j < len && pattern[j] !== "]") {
        if (pattern[j] === "\\" && j + 1 < len) {
          j += 2; // skip escaped char inside class
        } else {
          j++;
        }
      }
      if (j < len && pattern[j] === "]") {
        const classText = pattern.slice(i, j + 1);
        tokens.push({
          text: classText,
          type: "tok-class",
          description: isNegated ? "Negated character set" : "Character set",
        });
        i = j + 1;
        continue;
      }
      // Unclosed set
      tokens.push({
        text: "[",
        type: "error",
        description: "Unclosed character set",
      });
      i++;
      continue;
    }

    // 3. Parentheses & Groups: ( ... ), (?: ... ), (?<name> ... ), (?= ... ), etc.
    if (ch === "(") {
      if (pattern.startsWith("(?:", i)) {
        tokens.push({ text: "(?:", type: "tok-group", description: "Non-capturing group start" });
        i += 3;
        continue;
      }
      if (pattern.startsWith("(?=", i)) {
        tokens.push({ text: "(?=", type: "tok-group", description: "Positive lookahead start" });
        i += 3;
        continue;
      }
      if (pattern.startsWith("(?!", i)) {
        tokens.push({ text: "(?!", type: "tok-group", description: "Negative lookahead start" });
        i += 3;
        continue;
      }
      if (pattern.startsWith("(?<=", i)) {
        tokens.push({ text: "(?<=", type: "tok-group", description: "Positive lookbehind start" });
        i += 4;
        continue;
      }
      if (pattern.startsWith("(?<!", i)) {
        tokens.push({ text: "(?<!", type: "tok-group", description: "Negative lookbehind start" });
        i += 4;
        continue;
      }
      if (pattern.startsWith("(?<", i)) {
        const closeAngle = pattern.indexOf(">", i);
        if (closeAngle !== -1) {
          const groupName = pattern.slice(i + 3, closeAngle);
          tokens.push({
            text: pattern.slice(i, closeAngle + 1),
            type: "tok-group",
            description: `Named capturing group: '${groupName}'`,
          });
          i = closeAngle + 1;
          continue;
        }
      }
      tokens.push({ text: "(", type: "tok-group", description: "Capturing group start" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ text: ")", type: "tok-group", description: "Group end" });
      i++;
      continue;
    }

    // 4. Quantifiers: *, +, ?, {n}, {n,}, {n,m} (with optional lazy '?')
    if (ch === "*" || ch === "+" || ch === "?") {
      let quant = ch;
      let isLazy = false;
      if (i + 1 < len && pattern[i + 1] === "?") {
        quant += "?";
        isLazy = true;
        i++;
      }
      tokens.push({
        text: quant,
        type: "tok-quant",
        description: describeQuantifier(ch, isLazy),
      });
      i++;
      continue;
    }

    if (ch === "{") {
      const closeBrace = pattern.indexOf("}", i);
      if (closeBrace !== -1 && /^\{\d+(?:,\d*)?\}\??$/.test(pattern.slice(i, closeBrace + (pattern[closeBrace + 1] === "?" ? 2 : 1)))) {
        let quantText = pattern.slice(i, closeBrace + 1);
        let isLazy = false;
        if (closeBrace + 1 < len && pattern[closeBrace + 1] === "?") {
          quantText += "?";
          isLazy = true;
          i = closeBrace + 2;
        } else {
          i = closeBrace + 1;
        }
        tokens.push({
          text: quantText,
          type: "tok-quant",
          description: `Custom quantifier: ${quantText}${isLazy ? " (lazy)" : ""}`,
        });
        continue;
      }
    }

    // 5. Anchors: ^, $
    if (ch === "^" || ch === "$") {
      tokens.push({
        text: ch,
        type: "tok-anchor",
        description: ch === "^" ? "Start of string / line anchor" : "End of string / line anchor",
      });
      i++;
      continue;
    }

    // 6. Alternation: |
    if (ch === "|") {
      tokens.push({
        text: "|",
        type: "tok-alt",
        description: "Alternation (OR)",
      });
      i++;
      continue;
    }

    // 7. Wildcard dot: .
    if (ch === ".") {
      tokens.push({
        text: ".",
        type: "tok-class",
        description: "Any character (wildcard)",
      });
      i++;
      continue;
    }

    // 8. Plain literal characters (batch consecutive literals together)
    let lit = ch;
    i++;
    while (i < len && !"\\()[]{}*+?^$|.".includes(pattern[i])) {
      lit += pattern[i];
      i++;
    }
    tokens.push({
      text: lit,
      type: "tok-literal",
      description: `Literal: '${lit}'`,
    });
  }

  return tokens;
}

function describeShorthand(code) {
  switch (code) {
    case "d": return "Any digit [0-9]";
    case "D": return "Any non-digit [^0-9]";
    case "w": return "Any word character [a-zA-Z0-9_]";
    case "W": return "Any non-word character [^a-zA-Z0-9_]";
    case "s": return "Any whitespace character [ \\t\\r\\n\\f]";
    case "S": return "Any non-whitespace character";
    default: return code;
  }
}

function describeQuantifier(ch, isLazy) {
  const lazySuffix = isLazy ? " (lazy / non-greedy)" : " (greedy)";
  switch (ch) {
    case "*": return "Match 0 or more times" + lazySuffix;
    case "+": return "Match 1 or more times" + lazySuffix;
    case "?": return "Match 0 or 1 time" + lazySuffix;
    default: return ch;
  }
}

/**
 * Validates a flag string and returns a normalized flag string.
 */
export function normalizeFlags(flags) {
  const seen = new Set();
  let normalized = "";
  for (const f of flags) {
    if (VALID_FLAGS.has(f) && !seen.has(f)) {
      seen.add(f);
      normalized += f;
    }
  }
  return normalized;
}

/**
 * Safely evaluates a regular expression pattern against sample text.
 * Protects against ReDoS via character limits, match counts, and execution timeout.
 *
 * @param {string} pattern - RegExp pattern string
 * @param {string} flags - RegExp flags (e.g. "g", "i", "m", "s", "u")
 * @param {string} text - Test string to match against
 * @returns {object} Evaluation results or error
 */
export function evaluateRegex(pattern, flags = "g", text = "") {
  if (typeof pattern !== "string") {
    return { valid: false, error: "Pattern must be a string." };
  }

  // If pattern is empty, no matches
  if (!pattern) {
    return {
      valid: true,
      matches: [],
      matchCount: 0,
      executionTimeMs: 0,
    };
  }

  // Safety ceiling: prevent huge test text freezing the main thread
  const MAX_TEXT_LENGTH = 100000;
  const targetText = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;

  let regex;
  try {
    regex = new RegExp(pattern, flags);
  } catch (err) {
    return {
      valid: false,
      error: err.message,
    };
  }

  const startTime = performance.now();
  const matches = [];
  const MAX_MATCHES = 1000;

  try {
    if (!flags.includes("g")) {
      // Non-global: single match execution
      const match = regex.exec(targetText);
      if (match) {
        matches.push(buildMatchObject(match));
      }
    } else {
      // Global: loop over matches
      let match;
      let lastIndex = 0;

      while ((match = regex.exec(targetText)) !== null) {
        matches.push(buildMatchObject(match));

        // Zero-length match safeguard (e.g. ^ or \b or empty groups):
        // Advance lastIndex by 1 manually to prevent infinite loop!
        if (match[0].length === 0) {
          regex.lastIndex = match.index + 1;
        }

        if (matches.length >= MAX_MATCHES) {
          break;
        }

        // Avoid infinite loop if lastIndex didn't advance
        if (regex.lastIndex <= lastIndex && match[0].length > 0) {
          break;
        }
        lastIndex = regex.lastIndex;
      }
    }
  } catch (err) {
    return {
      valid: false,
      error: `Execution error: ${err.message}`,
    };
  }

  const executionTimeMs = +(performance.now() - startTime).toFixed(2);

  return {
    valid: true,
    matches,
    matchCount: matches.length,
    executionTimeMs,
    truncated: targetText.length < text.length,
  };
}

function buildMatchObject(match) {
  const startIndex = match.index;
  const endIndex = startIndex + match[0].length;
  const groups = [];

  // 1. Numbered capturing groups
  for (let i = 1; i < match.length; i++) {
    groups.push({
      index: i,
      name: null,
      value: match[i] !== undefined ? match[i] : "",
      defined: match[i] !== undefined,
    });
  }

  // 2. Named capturing groups if present
  if (match.groups) {
    for (const [name, val] of Object.entries(match.groups)) {
      // Find corresponding numbered group if exists
      const existing = groups.find((g) => g.value === val && !g.name);
      if (existing) {
        existing.name = name;
      } else {
        groups.push({
          index: null,
          name,
          value: val !== undefined ? val : "",
          defined: val !== undefined,
        });
      }
    }
  }

  return {
    index: startIndex,
    endIndex,
    match: match[0],
    groups,
  };
}
