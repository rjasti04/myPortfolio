// Recursive-descent arithmetic evaluator. Deliberately not `eval`: the grammar
// below is the entire language, so no identifier can ever be resolved.
export function evaluateMathExpression(expr) {
  let index = 0;

  function skipSpaces() {
    while (/\s/.test(expr[index] || "")) index++;
  }

  function parseNumber() {
    skipSpaces();
    const start = index;
    while (/[\d.]/.test(expr[index] || "")) index++;
    const raw = expr.slice(start, index);
    if (!raw || raw.split(".").length > 2) {
      throw new Error("invalid number");
    }
    return Number(raw);
  }

  function parseFactor() {
    skipSpaces();
    if (expr[index] === "+") {
      index++;
      return parseFactor();
    }
    if (expr[index] === "-") {
      index++;
      return -parseFactor();
    }
    if (expr[index] === "(") {
      index++;
      const value = parseExpression();
      skipSpaces();
      if (expr[index] !== ")") throw new Error("missing closing paren");
      index++;
      return value;
    }
    return parseNumber();
  }

  function parseTerm() {
    let value = parseFactor();
    for (;;) {
      skipSpaces();
      const op = expr[index];
      if (op !== "*" && op !== "/") break;
      index++;
      const right = parseFactor();
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    for (;;) {
      skipSpaces();
      const op = expr[index];
      if (op !== "+" && op !== "-") break;
      index++;
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  skipSpaces();
  if (index !== expr.length || !Number.isFinite(result)) {
    throw new Error("invalid expression");
  }
  return result;
}
