/**
 * Query Engine (`json-query.js`)
 *
 * JSONPath, dot-notation and `filter(...)` sugar over a parsed document.
 *
 * **This module contains no `eval` and no `new Function`, and it never will.**
 * That is not a stylistic preference. The conventional way to implement a
 * JSONPath filter — `[?(@.price > 50)]` — is to hand the expression to `eval`,
 * which is why almost no JSONPath library on npm could ship on a page with a
 * strict CSP. Here the expression is tokenised, parsed into an AST by precedence
 * climbing, and walked by a `switch` over known node types. `/json` ships
 * `script-src 'self'` with no `'unsafe-eval'`, so a regression that reached for
 * `Function` would fault in the browser rather than quietly becoming a script
 * injection sink.
 *
 * The second half of that guarantee is property lookup. `@.constructor`,
 * `@.__proto__` and `@.toString` must resolve to *missing*, not to JavaScript
 * internals, so every member access goes through `getMember()` below, which
 * reads own enumerable properties only.
 *
 * Supported: `$`, `.name`, `['name']`, `[n]`, `[-n]`, `[start:end:step]`, `[*]`,
 * `..name`, `..*`, `[?(expr)]`. Filter operators: `||`, `&&`, `!`, `==`, `!=`,
 * `<`, `<=`, `>`, `>=`, `contains`, `startsWith`, `endsWith`.
 *
 * Deliberately absent: script expressions `[(...)]` and the RFC 9535 function
 * extensions (`length()`, `match()`, `search()`). The first cannot be done
 * without an evaluator; the rest are surface without a user.
 *
 * Pure vanilla ES module. Zero dependencies.
 */

const MISSING = Symbol("missing");

/** Own enumerable properties only — never the prototype chain. */
function getMember(node, key) {
  if (node === null || typeof node !== "object") return MISSING;
  if (!Object.prototype.hasOwnProperty.call(node, key)) return MISSING;
  return node[key];
}

/** Normalise a possibly-negative array index; returns -1 when out of range. */
function resolveIndex(length, raw) {
  const index = raw < 0 ? length + raw : raw;
  return index >= 0 && index < length ? index : -1;
}

class QuerySyntaxError extends Error {
  constructor(message, column) {
    super(message);
    this.name = "QuerySyntaxError";
    this.column = column;
  }
}

/* -------------------------------------------------------------------------
   Expression parser (filters)
   ------------------------------------------------------------------------- */

const WORD_OPERATORS = ["contains", "startsWith", "endsWith"];

/**
 * @param {string} src        expression source, without the surrounding `?()`
 * @param {number} base       column offset of `src` within the whole query
 * @param {boolean} bareNames when true a bare `price` means `@.price`
 */
function parseExpression(src, base, bareNames) {
  let i = 0;

  const fail = (message) => {
    throw new QuerySyntaxError(message, base + i + 1);
  };
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i += 1;
  };
  const eat = (token) => {
    ws();
    if (src.startsWith(token, i)) {
      i += token.length;
      return true;
    }
    return false;
  };

  function readQuoted() {
    const quote = src[i];
    i += 1;
    let out = "";
    while (i < src.length && src[i] !== quote) {
      if (src[i] === "\\" && i + 1 < src.length) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      out += src[i];
      i += 1;
    }
    if (src[i] !== quote) fail("Unterminated string in filter expression");
    i += 1;
    return out;
  }

  /** A path operand: `@`, `$`, or (in sugar mode) a bare name. */
  function readPathOperand() {
    ws();
    let root;
    if (src[i] === "@") {
      root = "current";
      i += 1;
    } else if (src[i] === "$") {
      root = "root";
      i += 1;
    } else if (bareNames && /[A-Za-z_]/.test(src[i] ?? "")) {
      root = "current";
    } else {
      return null;
    }
    const steps = [];
    for (;;) {
      if (src[i] === ".") {
        i += 1;
        const start = i;
        while (i < src.length && /[A-Za-z0-9_$-]/.test(src[i])) i += 1;
        if (i === start) fail("Expected a property name after '.'");
        steps.push(src.slice(start, i));
        continue;
      }
      if (src[i] === "[") {
        i += 1;
        ws();
        if (src[i] === '"' || src[i] === "'") {
          steps.push(readQuoted());
        } else {
          const start = i;
          if (src[i] === "-") i += 1;
          while (i < src.length && /[0-9]/.test(src[i])) i += 1;
          if (i === start) fail("Expected an index or quoted key inside '[' ']'");
          steps.push(Number(src.slice(start, i)));
        }
        ws();
        if (src[i] !== "]") fail("Expected ']'");
        i += 1;
        continue;
      }
      // Bare-name sugar consumes its first identifier here.
      if (steps.length === 0 && bareNames && root === "current" && /[A-Za-z_]/.test(src[i] ?? "")) {
        const start = i;
        while (i < src.length && /[A-Za-z0-9_$-]/.test(src[i])) i += 1;
        steps.push(src.slice(start, i));
        continue;
      }
      break;
    }
    return { type: "path", root, steps };
  }

  function primary() {
    ws();
    if (eat("(")) {
      const inner = orExpr();
      if (!eat(")")) fail("Expected ')'");
      return inner;
    }
    if (src[i] === '"' || src[i] === "'") return { type: "literal", value: readQuoted() };

    // Keywords before paths, so `true` is not read as a bare name.
    for (const [word, value] of [["true", true], ["false", false], ["null", null]]) {
      if (src.startsWith(word, i) && !/[A-Za-z0-9_$]/.test(src[i + word.length] ?? "")) {
        i += word.length;
        return { type: "literal", value };
      }
    }
    if (/[-0-9]/.test(src[i] ?? "") && !(src[i] === "-" && !/[0-9.]/.test(src[i + 1] ?? ""))) {
      const start = i;
      if (src[i] === "-") i += 1;
      while (i < src.length && /[0-9.eE+-]/.test(src[i])) i += 1;
      const value = Number(src.slice(start, i));
      if (Number.isNaN(value)) fail(`Invalid number ${src.slice(start, i)}`);
      return { type: "literal", value };
    }
    const path = readPathOperand();
    if (path) return path;
    fail(
      src[i] === undefined
        ? "Unexpected end of filter expression"
        : `Unexpected ${JSON.stringify(src[i])} in filter expression`
    );
    return null;
  }

  function unary() {
    ws();
    if (src[i] === "!" && src[i + 1] !== "=") {
      i += 1;
      return { type: "not", operand: unary() };
    }
    return primary();
  }

  function comparison() {
    const left = unary();
    ws();
    for (const op of ["==", "!=", "<=", ">=", "<", ">"]) {
      if (src.startsWith(op, i)) {
        i += op.length;
        return { type: "compare", op, left, right: unary() };
      }
    }
    for (const op of WORD_OPERATORS) {
      if (src.startsWith(op, i) && !/[A-Za-z0-9_$]/.test(src[i + op.length] ?? "")) {
        i += op.length;
        return { type: "compare", op, left, right: unary() };
      }
    }
    return left;
  }

  function andExpr() {
    let node = comparison();
    for (;;) {
      ws();
      if (src.startsWith("&&", i)) {
        i += 2;
        node = { type: "and", left: node, right: comparison() };
        continue;
      }
      return node;
    }
  }

  function orExpr() {
    let node = andExpr();
    for (;;) {
      ws();
      if (src.startsWith("||", i)) {
        i += 2;
        node = { type: "or", left: node, right: andExpr() };
        continue;
      }
      return node;
    }
  }

  const ast = orExpr();
  ws();
  if (i < src.length) fail(`Unexpected ${JSON.stringify(src[i])} after the filter expression`);
  return ast;
}

/* -------------------------------------------------------------------------
   Expression evaluation
   ------------------------------------------------------------------------- */

function resolvePath(node, root, current) {
  let value = node.root === "root" ? root : current;
  for (const step of node.steps) {
    if (value === MISSING) return MISSING;
    if (typeof step === "number") {
      if (!Array.isArray(value)) return MISSING;
      const index = resolveIndex(value.length, step);
      if (index === -1) return MISSING;
      value = value[index];
      continue;
    }
    value = getMember(value, step);
  }
  return value;
}

function looseEquals(a, b) {
  if (a === MISSING || b === MISSING) return a === b;
  if (a === null || b === null) return a === b;
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return a === b;
}

function evaluateExpression(node, root, current) {
  switch (node.type) {
    case "literal":
      return node.value;
    case "path":
      return resolvePath(node, root, current);
    case "not":
      return !truthy(evaluateExpression(node.operand, root, current));
    case "and":
      return truthy(evaluateExpression(node.left, root, current)) && truthy(evaluateExpression(node.right, root, current));
    case "or":
      return truthy(evaluateExpression(node.left, root, current)) || truthy(evaluateExpression(node.right, root, current));
    case "compare": {
      const left = evaluateExpression(node.left, root, current);
      const right = evaluateExpression(node.right, root, current);
      switch (node.op) {
        case "==":
          return looseEquals(left, right);
        case "!=":
          return !looseEquals(left, right);
        case "contains":
          if (typeof left === "string") return typeof right === "string" && left.includes(right);
          if (Array.isArray(left)) return left.some((item) => looseEquals(item, right));
          return false;
        case "startsWith":
          return typeof left === "string" && typeof right === "string" && left.startsWith(right);
        case "endsWith":
          return typeof left === "string" && typeof right === "string" && left.endsWith(right);
        default: {
          // Ordering comparisons are only meaningful between two numbers or
          // two strings; a missing operand is never ordered.
          if (left === MISSING || right === MISSING) return false;
          const comparable =
            (typeof left === "number" && typeof right === "number") ||
            (typeof left === "string" && typeof right === "string");
          if (!comparable) return false;
          if (node.op === "<") return left < right;
          if (node.op === "<=") return left <= right;
          if (node.op === ">") return left > right;
          return left >= right;
        }
      }
    }
    default:
      // Unreachable: every node this module builds is handled above.
      return false;
  }
}

function truthy(value) {
  if (value === MISSING || value === null || value === false || value === undefined) return false;
  if (value === "") return false;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  return true;
}

/* -------------------------------------------------------------------------
   Path parser
   ------------------------------------------------------------------------- */

/**
 * Parse a query into a segment list.
 *
 * Accepts `$`-rooted JSONPath, bare dot-notation (`items[0].id`), and
 * `filter(expr)` sugar, which is exactly `$[?(expr)]` with bare names allowed.
 *
 * @returns {{ ok: boolean, ast: Array|null, error: {message: string, column: number}|null }}
 */
export function parseQuery(expression) {
  const src = String(expression ?? "").trim();
  if (src === "" || src === "$") return { ok: true, ast: [], error: null };

  try {
    const sugar = /^filter\s*\(/i.exec(src);
    if (sugar) {
      if (!src.endsWith(")")) throw new QuerySyntaxError("Expected ')' to close filter(...)", src.length);
      const inner = src.slice(sugar[0].length, -1);
      const expr = parseExpression(inner, sugar[0].length, true);
      return { ok: true, ast: [{ type: "filter", expr }], error: null };
    }
    return { ok: true, ast: parseSegments(src), error: null };
  } catch (error) {
    if (!(error instanceof QuerySyntaxError)) throw error;
    return { ok: false, ast: null, error: { message: error.message, column: error.column } };
  }
}

function parseSegments(src) {
  let i = 0;
  const segments = [];
  const fail = (message) => {
    throw new QuerySyntaxError(message, i + 1);
  };

  if (src[i] === "$") i += 1;

  const readName = () => {
    const start = i;
    while (i < src.length && /[A-Za-z0-9_$-]/.test(src[i])) i += 1;
    if (i === start) fail("Expected a property name");
    return src.slice(start, i);
  };

  /**
   * `filter(...)` as a chained segment, so `items.filter(price > 50)` reads the
   * way people expect rather than forcing `$.items[?(@.price > 50)]`. A document
   * with a property genuinely named `filter` reaches it as `['filter']`.
   */
  const readFilterCall = () => {
    const start = i + 1;
    let depth = 1;
    let quote = null;
    i += 1;
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i += 1;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "(") {
        depth += 1;
      } else if (c === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
    }
    if (src[i] !== ")") fail("Expected ')' to close filter(...)");
    const inner = src.slice(start, i);
    i += 1;
    return { type: "filter", expr: parseExpression(inner, start, true) };
  };

  // A leading bare name: `items[0].id` means `$.items[0].id`.
  if (/[A-Za-z_$]/.test(src[i] ?? "")) {
    const name = readName();
    segments.push(name === "filter" && src[i] === "(" ? readFilterCall() : { type: "child", name });
  }

  while (i < src.length) {
    if (src.startsWith("..", i)) {
      i += 2;
      if (src[i] === "*") {
        i += 1;
        segments.push({ type: "descendant", name: null });
        continue;
      }
      if (src[i] === "[") continue; // `..[0]` — the bracket handler picks it up
      segments.push({ type: "descendant", name: readName() });
      continue;
    }
    if (src[i] === ".") {
      i += 1;
      if (src[i] === "*") {
        i += 1;
        segments.push({ type: "wildcard" });
        continue;
      }
      const name = readName();
      segments.push(name === "filter" && src[i] === "(" ? readFilterCall() : { type: "child", name });
      continue;
    }
    if (src[i] === "[") {
      i += 1;
      while (i < src.length && /\s/.test(src[i])) i += 1;

      if (src[i] === "*") {
        i += 1;
        if (src[i] !== "]") fail("Expected ']' after '*'");
        i += 1;
        segments.push({ type: "wildcard" });
        continue;
      }
      if (src[i] === "?") {
        i += 1;
        const wrapped = src[i] === "(";
        if (wrapped) i += 1;
        const depth0 = i;
        let depth = wrapped ? 1 : 0;
        // Find the matching close, ignoring brackets inside quotes.
        let quote = null;
        while (i < src.length) {
          const c = src[i];
          if (quote) {
            if (c === "\\") i += 1;
            else if (c === quote) quote = null;
          } else if (c === '"' || c === "'") {
            quote = c;
          } else if (c === "(") {
            depth += 1;
          } else if (c === ")") {
            depth -= 1;
            if (wrapped && depth === 0) break;
          } else if (c === "]" && depth === 0) {
            break;
          }
          i += 1;
        }
        const inner = src.slice(depth0, i);
        if (wrapped) {
          if (src[i] !== ")") fail("Expected ')' to close the filter");
          i += 1;
        }
        if (src[i] !== "]") fail("Expected ']' to close the filter");
        i += 1;
        segments.push({ type: "filter", expr: parseExpression(inner, depth0, false) });
        continue;
      }
      if (src[i] === '"' || src[i] === "'") {
        const quote = src[i];
        i += 1;
        let name = "";
        while (i < src.length && src[i] !== quote) {
          if (src[i] === "\\" && i + 1 < src.length) {
            name += src[i + 1];
            i += 2;
            continue;
          }
          name += src[i];
          i += 1;
        }
        if (src[i] !== quote) fail("Unterminated quoted key");
        i += 1;
        while (i < src.length && /\s/.test(src[i])) i += 1;
        if (src[i] !== "]") fail("Expected ']'");
        i += 1;
        segments.push({ type: "child", name });
        continue;
      }

      // Index or slice.
      const readInt = () => {
        const start = i;
        if (src[i] === "-") i += 1;
        while (i < src.length && /[0-9]/.test(src[i])) i += 1;
        return i === start ? null : Number(src.slice(start, i));
      };
      const first = readInt();
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (src[i] === ":") {
        i += 1;
        while (i < src.length && /\s/.test(src[i])) i += 1;
        const end = readInt();
        let step = null;
        while (i < src.length && /\s/.test(src[i])) i += 1;
        if (src[i] === ":") {
          i += 1;
          while (i < src.length && /\s/.test(src[i])) i += 1;
          step = readInt();
        }
        while (i < src.length && /\s/.test(src[i])) i += 1;
        if (src[i] !== "]") fail("Expected ']' to close the slice");
        i += 1;
        segments.push({ type: "slice", start: first, end, step });
        continue;
      }
      if (first === null) fail("Expected an index, slice, '*', quoted key or filter inside '[' ']'");
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (src[i] !== "]") fail("Expected ']'");
      i += 1;
      segments.push({ type: "index", index: first });
      continue;
    }
    fail(`Unexpected ${JSON.stringify(src[i])} in the query`);
  }
  return segments;
}

/* -------------------------------------------------------------------------
   Evaluation
   ------------------------------------------------------------------------- */

function childrenOf(node) {
  if (Array.isArray(node)) return node.map((value, index) => [index, value]);
  if (node && typeof node === "object") return Object.keys(node).map((key) => [key, node[key]]);
  return [];
}

function collectDescendants(node, path, out) {
  for (const [key, value] of childrenOf(node)) {
    out.push({ path: [...path, key], value });
    collectDescendants(value, [...path, key], out);
  }
}

/**
 * Run a parsed query against a document.
 *
 * @returns {Array<{ path: Array<string|number>, value: unknown }>}
 */
export function evaluate(ast, root) {
  let matches = [{ path: [], value: root }];

  for (const segment of ast) {
    const next = [];
    for (const { path, value } of matches) {
      switch (segment.type) {
        case "child": {
          const child = getMember(value, segment.name);
          if (child !== MISSING) next.push({ path: [...path, segment.name], value: child });
          break;
        }
        case "index": {
          if (!Array.isArray(value)) break;
          const index = resolveIndex(value.length, segment.index);
          if (index !== -1) next.push({ path: [...path, index], value: value[index] });
          break;
        }
        case "slice": {
          if (!Array.isArray(value)) break;
          const length = value.length;
          const step = segment.step ?? 1;
          if (step === 0) break;
          if (step > 0) {
            const from = segment.start === null ? 0 : Math.max(0, segment.start < 0 ? length + segment.start : segment.start);
            const to = segment.end === null ? length : Math.min(length, segment.end < 0 ? length + segment.end : segment.end);
            for (let k = from; k < to; k += step) next.push({ path: [...path, k], value: value[k] });
          } else {
            const from = segment.start === null ? length - 1 : Math.min(length - 1, segment.start < 0 ? length + segment.start : segment.start);
            const to = segment.end === null ? -1 : Math.max(-1, segment.end < 0 ? length + segment.end : segment.end);
            for (let k = from; k > to; k += step) next.push({ path: [...path, k], value: value[k] });
          }
          break;
        }
        case "wildcard": {
          for (const [key, child] of childrenOf(value)) next.push({ path: [...path, key], value: child });
          break;
        }
        case "descendant": {
          const found = [];
          collectDescendants(value, path, found);
          for (const entry of found) {
            if (segment.name === null || entry.path[entry.path.length - 1] === segment.name) next.push(entry);
          }
          break;
        }
        case "filter": {
          for (const [key, child] of childrenOf(value)) {
            if (truthy(evaluateExpression(segment.expr, root, child))) next.push({ path: [...path, key], value: child });
          }
          break;
        }
        default:
          break;
      }
    }
    matches = next;
  }
  return matches;
}

/** Parse and evaluate in one step. */
export function runQuery(expression, root) {
  const parsed = parseQuery(expression);
  if (!parsed.ok) return { ok: false, matches: [], error: parsed.error };
  return { ok: true, matches: evaluate(parsed.ast, root), error: null };
}

/** JavaScript identifiers can use dot notation; everything else needs brackets. */
const SAFE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Render a path in one of three dialects.
 *
 * `jsonpath` -> `$.items[0].id`  ·  `dot` -> `items[0].id`  ·  `bracket` -> `["items"][0]["id"]`
 */
export function formatPath(segments, dialect = "jsonpath") {
  if (dialect === "bracket") {
    return segments.map((s) => (typeof s === "number" ? `[${s}]` : `[${JSON.stringify(s)}]`)).join("");
  }
  let out = "";
  for (const segment of segments) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else if (SAFE_IDENTIFIER.test(segment)) {
      out += out === "" && dialect === "dot" ? segment : `.${segment}`;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  if (dialect === "dot") return out.replace(/^\./, "");
  return `$${out}`;
}
