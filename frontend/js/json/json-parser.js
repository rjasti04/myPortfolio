/**
 * JSON Parser, Validator & Repair Engine (`json-parser.js`)
 *
 * Two jobs the platform will not do for us.
 *
 * 1. **Error positions.** `JSON.parse` throws a `SyntaxError` whose message is
 *    engine-specific — V8, SpiderMonkey and JSC word it differently and disagree
 *    about whether an offset is even included. None of it is fit to put in a UI.
 *    So the fast path is `JSON.parse`, and only when that throws does the
 *    hand-written scanner below re-read the text to produce a stable
 *    `{ line, column, offset, message, excerpt }`.
 *
 * 2. **Repair.** A tolerant mode of the same scanner accepts the things people
 *    actually paste — trailing commas, unquoted keys, comments, `NaN` — and
 *    records every accommodation it made. Repair is never silent and never
 *    automatic: the caller gets a log and decides.
 *
 * Repairs are classified. Most rewrite *syntax* and preserve the value exactly.
 * A few cannot: JSON has no representation for `NaN`, `Infinity` or `undefined`,
 * so those become `null` and are flagged `lossy: true` for the UI to surface
 * differently. Nothing else ever changes a value, and no rule reorders or drops
 * a member.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

/** Members past this depth are refused rather than risking a stack overflow. */
const MAX_DEPTH = 200;

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** Quote characters a word processor substitutes for `"` and `'`. */
const SMART_QUOTES = {
  "“": "”", // " "
  "”": "”",
  "‘": "’", // ' '
  "’": "’",
};

/**
 * Resolve a character offset to a 1-based line and column.
 * Done on demand rather than tracked during scanning — one pass over a string
 * that already failed is cheap, and it keeps the scanner free of bookkeeping
 * that is easy to get subtly wrong.
 */
export function positionAt(text, offset) {
  const safe = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < safe; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: safe - lineStart + 1, offset: safe };
}

/**
 * The source line containing `offset`, plus a caret line beneath it.
 * Long lines are windowed around the offset so the caret stays visible.
 */
export function excerptAt(text, offset) {
  const { line, column } = positionAt(text, offset);
  const lines = text.split("\n");
  const raw = lines[line - 1] ?? "";
  const WINDOW = 80;
  let start = 0;
  let body = raw;
  if (raw.length > WINDOW && column > WINDOW - 20) {
    start = Math.max(0, column - Math.floor(WINDOW / 2));
    body = raw.slice(start, start + WINDOW);
  } else if (raw.length > WINDOW) {
    body = raw.slice(0, WINDOW);
  }
  const caretCol = Math.max(0, column - 1 - start);
  return { line, column, text: body, caret: " ".repeat(caretCol) + "^" };
}

class JsonSyntaxError extends Error {
  constructor(message, offset) {
    super(message);
    this.name = "JsonSyntaxError";
    this.offset = offset;
  }
}

/* -------------------------------------------------------------------------
   Scanner
   ------------------------------------------------------------------------- */

function createScanner(src, options) {
  const tolerant = Boolean(options.tolerant);
  const repairs = options.repairs ?? [];
  let i = 0;

  function note(rule, detail, offset, lossy = false) {
    const { line, column } = positionAt(src, offset);
    repairs.push({ rule, detail, line, column, offset, lossy });
  }

  function fail(message) {
    throw new JsonSyntaxError(message, Math.min(i, src.length));
  }

  function atEnd() {
    return i >= src.length;
  }

  /** Whitespace, and in tolerant mode `//` and block comments. */
  function skipTrivia() {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (src[i] === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
        if (!tolerant) fail("Comments are not valid in JSON");
        const start = i;
        if (src[i + 1] === "/") {
          while (i < src.length && src[i] !== "\n") i += 1;
          note("comment", "Removed a // line comment", start);
        } else {
          i += 2;
          while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
          if (atEnd()) fail("Unterminated block comment");
          i += 2;
          note("comment", "Removed a /* */ block comment", start);
        }
        continue;
      }
      return;
    }
  }

  function readEscape() {
    // `i` sits on the backslash.
    const start = i;
    i += 1;
    const c = src[i];
    if (c === undefined) fail("Unterminated string escape");
    const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    if (Object.prototype.hasOwnProperty.call(simple, c)) {
      i += 1;
      return simple[c];
    }
    if (c === "u") {
      const hex = src.slice(i + 1, i + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid \\u escape — expected four hex digits");
      i += 5;
      return String.fromCharCode(parseInt(hex, 16));
    }
    if (!tolerant) fail(`Invalid escape sequence \\${c}`);
    // Tolerant: a stray backslash almost always meant a literal backslash.
    if (c === "'") {
      i += 1;
      note("escape", "Replaced \\' with '", start);
      return "'";
    }
    if (c === "x" && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 1, i + 3))) {
      const code = parseInt(src.slice(i + 1, i + 3), 16);
      i += 3;
      note("escape", "Converted \\x hex escape to \\u form", start);
      return String.fromCharCode(code);
    }
    i += 1;
    note("escape", `Kept invalid escape \\${c} as a literal backslash`, start);
    return "\\" + c;
  }

  function readString() {
    const start = i;
    const open = src[i];
    let close = '"';
    if (open === '"') {
      close = '"';
    } else if (open === "'") {
      if (!tolerant) fail("Strings must use double quotes");
      close = "'";
      note("single-quoted", "Converted a single-quoted string to double quotes", start);
    } else if (SMART_QUOTES[open]) {
      if (!tolerant) fail("Strings must use straight double quotes");
      close = SMART_QUOTES[open];
      note("smart-quote", "Replaced curly quotes with straight double quotes", start);
    } else {
      fail("Expected a string");
    }
    i += 1;
    let out = "";
    for (;;) {
      if (atEnd()) fail("Unterminated string");
      const c = src[i];
      if (c === close) {
        i += 1;
        return out;
      }
      // A smart closing quote can differ from the opener it was paired with.
      if (close !== '"' && close !== "'" && SMART_QUOTES[c]) {
        i += 1;
        return out;
      }
      if (c === "\\") {
        out += readEscape();
        continue;
      }
      if (c === "\n") {
        if (!tolerant) fail("Unescaped newline in string — use \\n");
        note("unescaped-newline", "Escaped a raw newline inside a string", i);
        out += "\n";
        i += 1;
        continue;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        if (!tolerant) fail("Unescaped control character in string");
        note("control-char", "Escaped a raw control character inside a string", i);
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
    }
  }

  function readNumber() {
    const start = i;
    let repaired = false;
    if (src[i] === "+") {
      if (!tolerant) fail("Numbers may not start with '+'");
      i += 1;
      repaired = true;
    }
    if (src[i] === "-") i += 1;

    // Hexadecimal — never valid JSON, common in hand-written config.
    if (src[i] === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
      if (!tolerant) fail("Hexadecimal numbers are not valid in JSON");
      const hexStart = i;
      i += 2;
      while (i < src.length && /[0-9a-fA-F]/.test(src[i])) i += 1;
      const value = Number(src.slice(hexStart, i));
      if (!Number.isFinite(value)) fail("Invalid hexadecimal number");
      note("number-format", "Converted a hexadecimal literal to decimal", start);
      return src[start] === "-" ? -value : value;
    }

    const intStart = i;
    while (i < src.length && /[0-9]/.test(src[i])) i += 1;
    const intDigits = i - intStart;
    if (intDigits === 0) {
      if (src[i] === "." && /[0-9]/.test(src[i + 1] ?? "")) {
        if (!tolerant) fail("Numbers must have a digit before the decimal point");
        repaired = true;
      } else {
        fail("Expected a number");
      }
    } else if (intDigits > 1 && src[intStart] === "0") {
      if (!tolerant) fail("Numbers may not have leading zeros");
      note("number-format", "Dropped leading zeros from a number", start);
      repaired = true;
    }

    if (src[i] === ".") {
      i += 1;
      const fracStart = i;
      while (i < src.length && /[0-9]/.test(src[i])) i += 1;
      if (i === fracStart) {
        if (!tolerant) fail("Numbers must have a digit after the decimal point");
        repaired = true;
      }
    }
    if (src[i] === "e" || src[i] === "E") {
      i += 1;
      if (src[i] === "+" || src[i] === "-") i += 1;
      const expStart = i;
      while (i < src.length && /[0-9]/.test(src[i])) i += 1;
      if (i === expStart) fail("Missing digits in the exponent");
    }
    const text = src.slice(start, i);
    const value = Number(text);
    if (Number.isNaN(value)) fail(`Invalid number ${text}`);
    if (repaired) note("number-format", `Normalised the number ${text}`, start);
    return value;
  }

  /** Bare words: JSON's three literals, plus the ones tolerant mode accepts. */
  function readWord() {
    const start = i;
    while (i < src.length && IDENT_PART.test(src[i])) i += 1;
    const word = src.slice(start, i);
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    if (!tolerant) fail(`Unexpected token ${word || src[start]}`);

    if (word === "True" || word === "False") {
      note("python-literal", `Converted Python ${word} to ${word.toLowerCase()}`, start);
      return word === "True";
    }
    if (word === "None") {
      note("python-literal", "Converted Python None to null", start);
      return null;
    }
    if (word === "NaN" || word === "Infinity" || word === "undefined") {
      note("non-finite", `JSON cannot represent ${word} — replaced with null`, start, true);
      return null;
    }
    fail(`Unexpected token ${word || src[start]}`);
    return null;
  }

  /** In tolerant mode an unquoted identifier is accepted as an object key. */
  function readKey() {
    skipTrivia();
    const c = src[i];
    if (c === '"' || c === "'" || SMART_QUOTES[c]) return readString();
    if (!tolerant) fail("Object keys must be double-quoted strings");
    if (!IDENT_START.test(c ?? "")) fail("Expected an object key");
    const start = i;
    while (i < src.length && IDENT_PART.test(src[i])) i += 1;
    const key = src.slice(start, i);
    note("unquoted-key", `Quoted the bare key ${key}`, start);
    return key;
  }

  /** True when the next token could begin a value — drives missing-comma recovery. */
  function startsValue() {
    const c = src[i];
    if (c === undefined) return false;
    return (
      c === "{" ||
      c === "[" ||
      c === '"' ||
      c === "'" ||
      Boolean(SMART_QUOTES[c]) ||
      c === "-" ||
      c === "+" ||
      c === "." ||
      /[0-9]/.test(c) ||
      IDENT_START.test(c)
    );
  }

  function parseObject(depth) {
    const start = i;
    i += 1; // consume '{'
    const out = {};
    skipTrivia();
    if (src[i] === "}") {
      i += 1;
      return out;
    }
    for (;;) {
      skipTrivia();
      if (src[i] === "}") {
        // We only get here after a comma.
        if (!tolerant) fail("Trailing comma before '}'");
        note("trailing-comma", "Removed a trailing comma before '}'", i);
        i += 1;
        return out;
      }
      const key = readKey();
      skipTrivia();
      if (src[i] !== ":") fail(`Expected ':' after the key "${key}"`);
      i += 1;
      const value = parseValue(depth + 1);
      out[key] = value;
      skipTrivia();
      if (src[i] === ",") {
        i += 1;
        continue;
      }
      if (src[i] === "}") {
        i += 1;
        return out;
      }
      if (atEnd()) {
        i = start;
        fail("Unterminated object — no closing '}'");
      }
      // Neither a comma nor a close, but something that could be another key.
      if (tolerant && (src[i] === '"' || src[i] === "'" || IDENT_START.test(src[i] ?? ""))) {
        note("missing-comma", "Inserted a missing comma between object members", i);
        continue;
      }
      fail("Expected ',' or '}' after an object member");
    }
  }

  function parseArray(depth) {
    const start = i;
    i += 1; // consume '['
    const out = [];
    skipTrivia();
    if (src[i] === "]") {
      i += 1;
      return out;
    }
    for (;;) {
      skipTrivia();
      if (src[i] === "]") {
        if (!tolerant) fail("Trailing comma before ']'");
        note("trailing-comma", "Removed a trailing comma before ']'", i);
        i += 1;
        return out;
      }
      out.push(parseValue(depth + 1));
      skipTrivia();
      if (src[i] === ",") {
        i += 1;
        continue;
      }
      if (src[i] === "]") {
        i += 1;
        return out;
      }
      if (atEnd()) {
        i = start;
        fail("Unterminated array — no closing ']'");
      }
      if (tolerant && startsValue()) {
        note("missing-comma", "Inserted a missing comma between array elements", i);
        continue;
      }
      fail("Expected ',' or ']' after an array element");
    }
  }

  function parseValue(depth) {
    if (depth > MAX_DEPTH) fail(`Nesting deeper than ${MAX_DEPTH} levels is not supported`);
    skipTrivia();
    if (atEnd()) fail("Unexpected end of input");
    const c = src[i];
    if (c === "{") return parseObject(depth);
    if (c === "[") return parseArray(depth);
    if (c === '"' || c === "'" || SMART_QUOTES[c]) return readString();
    if (c === "-" || c === "+" || c === "." || /[0-9]/.test(c)) return readNumber();
    if (IDENT_START.test(c)) return readWord();
    fail(`Unexpected character ${JSON.stringify(c)}`);
    return null;
  }

  function parseDocument() {
    skipTrivia();
    if (atEnd()) fail("Input is empty");
    const value = parseValue(0);
    skipTrivia();
    if (!atEnd()) {
      if (!tolerant) fail("Unexpected content after the end of the document");
      note("trailing-garbage", "Discarded content after the end of the document", i, true);
    }
    return value;
  }

  return { parseDocument, get offset() { return i; } };
}

/* -------------------------------------------------------------------------
   Public API
   ------------------------------------------------------------------------- */

/**
 * Strict parse. `JSON.parse` decides validity; the scanner only locates the
 * error when it fails, so we never disagree with the platform about what JSON is.
 *
 * @returns {{ ok: boolean, value: unknown, error: object|null }}
 */
export function parseJson(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, value: null, error: { message: "Input is empty", line: 1, column: 1, offset: 0, excerpt: null } };
  }
  try {
    return { ok: true, value: JSON.parse(text), error: null };
  } catch (nativeError) {
    try {
      createScanner(text, { tolerant: false }).parseDocument();
      // The scanner accepted what JSON.parse rejected. Trust the platform and
      // report its message rather than claiming the document is fine.
      return {
        ok: false,
        value: null,
        error: { message: String(nativeError.message), line: 1, column: 1, offset: 0, excerpt: null },
      };
    } catch (scanError) {
      if (!(scanError instanceof JsonSyntaxError)) throw scanError;
      const excerpt = excerptAt(text, scanError.offset);
      return {
        ok: false,
        value: null,
        error: {
          message: scanError.message,
          line: excerpt.line,
          column: excerpt.column,
          offset: scanError.offset,
          excerpt,
        },
      };
    }
  }
}

/**
 * Tolerant parse with a repair log.
 *
 * Returns the repaired document as canonical JSON — repair re-emits rather than
 * patching in place, so the output is guaranteed to parse. On a document it
 * cannot rescue it returns the original text untouched plus the error, never a
 * half-mangled result.
 *
 * @returns {{ ok: boolean, text: string, value: unknown, repairs: Array, error: object|null }}
 */
export function repairJson(text, options = {}) {
  const indent = options.indent ?? 2;
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, text: text ?? "", value: null, repairs: [], error: { message: "Input is empty", line: 1, column: 1 } };
  }
  const repairs = [];
  try {
    const value = createScanner(text, { tolerant: true, repairs }).parseDocument();
    return { ok: true, text: formatJson(value, { indent }), value, repairs, error: null };
  } catch (scanError) {
    if (!(scanError instanceof JsonSyntaxError)) throw scanError;
    const excerpt = excerptAt(text, scanError.offset);
    return {
      ok: false,
      text,
      value: null,
      repairs,
      error: { message: scanError.message, line: excerpt.line, column: excerpt.column, offset: scanError.offset, excerpt },
    };
  }
}

/** Recursively rebuild an object with its keys in sorted order. */
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

/**
 * Pretty-print. `indent` accepts a number of spaces or the string "tab".
 */
export function formatJson(value, options = {}) {
  const { indent = 2, sortKeys = false } = options;
  const gap = indent === "tab" ? "\t" : Number(indent) || 0;
  return JSON.stringify(sortKeys ? sortValue(value) : value, null, gap);
}

/** Single-line output with no insignificant whitespace. */
export function minifyJson(value) {
  return JSON.stringify(value);
}

/** Rough structural summary for the status strip. */
export function describeValue(value) {
  let objects = 0;
  let arrays = 0;
  let scalars = 0;
  let maxDepth = 0;
  const walk = (node, depth) => {
    if (depth > maxDepth) maxDepth = depth;
    if (Array.isArray(node)) {
      arrays += 1;
      for (const child of node) walk(child, depth + 1);
    } else if (node && typeof node === "object") {
      objects += 1;
      for (const key of Object.keys(node)) walk(node[key], depth + 1);
    } else {
      scalars += 1;
    }
  };
  walk(value, 1);
  return { objects, arrays, scalars, depth: maxDepth };
}
