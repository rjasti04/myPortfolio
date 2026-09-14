/**
 * Generic Syntax Lexer (`diff-tokenize.js`)
 *
 * One lexer, not a grammar per language.
 *
 * The alternative — real grammars for JavaScript, Python, Go, SQL and the rest
 * — is N parsers to write, N to test and N to keep correct, and every one of
 * them is a new way for the page to colour something wrongly. What actually
 * makes a diff readable is far cruder than a parse tree: strings look like
 * strings, comments recede, numbers and keywords stand out. That is four
 * categories, and the same four in almost every language anyone will paste.
 *
 * So this handles the shapes rather than the languages: four comment dialects
 * (double-slash, slash-star blocks, hash and double-dash), three quote styles
 * plus template literals, numeric
 * literals, and a keyword set pooled across the C family, JavaScript, Python,
 * Go, Java, SQL and the config formats. It is wrong about `#` in a language
 * where that is not a comment, and it does not know that `match` is a keyword
 * only sometimes. Both are cheap to live with; a wrong parse tree is not.
 *
 * Diff colour always wins over token colour in the stylesheet — the diff is the
 * signal, syntax is the context.
 *
 * Block comments span lines, so callers thread a small state object through the
 * document, line by line.
 *
 * Pure vanilla ES module. Zero dependencies, no DOM.
 */

/**
 * Pooled keyword set. Deliberately a union across languages: a false positive
 * tints a word that happens to be a keyword elsewhere, which costs nothing,
 * while a missing entry leaves real code flat.
 */
const KEYWORDS = new Set([
  "abstract", "and", "as", "async", "await", "base", "bool", "boolean", "break",
  "by", "byte", "case", "catch", "char", "class", "const", "constructor",
  "continue", "def", "default", "defer", "del", "delete", "do", "double",
  "elif", "else", "elseif", "end", "enum", "except", "export", "extends",
  "extern", "false", "final", "finally", "float", "fn", "for", "foreach",
  "from", "func", "function", "global", "go", "goto", "if", "impl", "implements",
  "import", "in", "instanceof", "int", "interface", "is", "lambda", "let",
  "long", "match", "mod", "module", "mut", "namespace", "new", "nil", "none",
  "not", "null", "nullptr", "or", "package", "pass", "private", "protected",
  "public", "pub", "raise", "range", "readonly", "record", "ref", "return",
  "select", "self", "short", "sizeof", "static", "struct", "super", "switch",
  "this", "throw", "throws", "trait", "true", "try", "type", "typedef",
  "typeof", "union", "unsafe", "use", "using", "var", "virtual", "void",
  "when", "where", "while", "with", "yield",
  // SQL, upper-cased by convention but matched case-insensitively below.
  "alter", "create", "delete", "drop", "from", "group", "having", "insert",
  "into", "join", "limit", "order", "select", "set", "table", "update",
  "values", "where",
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/** A fresh lexer state for the top of a document. */
export function createState() {
  return { inBlockComment: false };
}

/**
 * Tokenise one line.
 *
 * @param {string} line
 * @param {{ inBlockComment: boolean }} [state] threaded between lines; mutated.
 * @returns {Array<{ start: number, end: number, type: string }>} spans in
 *   order, covering only the parts worth colouring — plain text is left out
 *   and the renderer fills the gaps.
 */
export function tokenizeLine(line, state = createState()) {
  const spans = [];
  let index = 0;

  const push = (start, end, type) => {
    if (end > start) spans.push({ start, end, type });
  };

  while (index < line.length) {
    if (state.inBlockComment) {
      const close = line.indexOf("*/", index);
      if (close === -1) {
        push(index, line.length, "comment");
        return spans;
      }
      push(index, close + 2, "comment");
      state.inBlockComment = false;
      index = close + 2;
      continue;
    }

    const character = line[index];
    const next = line[index + 1];

    if (character === "/" && next === "*") {
      const close = line.indexOf("*/", index + 2);
      if (close === -1) {
        push(index, line.length, "comment");
        state.inBlockComment = true;
        return spans;
      }
      push(index, close + 2, "comment");
      index = close + 2;
      continue;
    }

    // Line comments run to the end, so there is nothing after them to scan.
    if ((character === "/" && next === "/") || character === "#") {
      push(index, line.length, "comment");
      return spans;
    }
    if (character === "-" && next === "-") {
      push(index, line.length, "comment");
      return spans;
    }

    if (character === '"' || character === "'" || character === "`") {
      let cursor = index + 1;
      let closed = false;
      while (cursor < line.length) {
        if (line[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (line[cursor] === character) {
          closed = true;
          cursor++;
          break;
        }
        cursor++;
      }
      // An unterminated string stops at the end of its own line rather than
      // swallowing the rest of the document — a stray apostrophe in a comment
      // should not repaint everything after it.
      push(index, closed ? cursor : line.length, "string");
      index = closed ? cursor : line.length;
      continue;
    }

    if (DIGIT.test(character) || (character === "." && DIGIT.test(next ?? ""))) {
      let cursor = index;
      while (cursor < line.length && /[0-9a-fA-FxXoObB._]/.test(line[cursor])) cursor++;
      // Exponent, as in 1e-9.
      if (/[eE]/.test(line[cursor - 1] ?? "") && /[+-]/.test(line[cursor] ?? "")) {
        cursor++;
        while (cursor < line.length && DIGIT.test(line[cursor])) cursor++;
      }
      push(index, cursor, "number");
      index = cursor;
      continue;
    }

    if (IDENT_START.test(character)) {
      let cursor = index;
      while (cursor < line.length && IDENT_PART.test(line[cursor])) cursor++;
      const word = line.slice(index, cursor);
      if (KEYWORDS.has(word.toLowerCase())) push(index, cursor, "keyword");
      index = cursor;
      continue;
    }

    if (/[{}[\]()<>=+\-*/%!&|^~?:;,.]/.test(character)) {
      push(index, index + 1, "punct");
      index++;
      continue;
    }

    index++;
  }

  return spans;
}

/**
 * Tokenise a whole document, threading block-comment state through it.
 *
 * @param {string[]} lines
 * @returns {Array<Array>} one span list per line, index-aligned with `lines`
 */
export function tokenizeDocument(lines) {
  const state = createState();
  return lines.map((line) => tokenizeLine(line, state));
}
