// Regression cover for the chat's syntax highlighter (codebase review C16).
//
// Each masked token was restored with `escaped.replace(key, html)`. A string
// replacement is scanned for `$` patterns, so source containing `$&`, `` $` ``,
// `$'` or `$$` was rewritten on the way back: JS `'$&'` rendered as the
// placeholder key it was replacing. Only the display was wrong - Copy reads
// the raw source - which is exactly why it went unnoticed.
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { highlightCode } from "../js/syntax-highlighter.js";

const { document } = new JSDOM("<!doctype html><body></body>").window;

/** What a reader actually sees: the rendered text of the highlighted HTML. */
function rendered(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.textContent;
}

for (const source of [
  "const whole = '$&';",
  "const before = '$`';",
  "const after = \"$'\";",
  "const dollar = '$$';",
  "str.replace(/x/g, '$&$&') // doubles every x",
  "const price = `$${amount}`;",
]) {
  test(`renders ${JSON.stringify(source)} exactly as written`, () => {
    assert.equal(rendered(highlightCode(source, "javascript")), source);
  });
}

test("still highlights the tokens around a $ pattern", () => {
  const html = highlightCode("const whole = '$&';", "javascript");
  assert.match(html, /<span class="token-keyword">const<\/span>/);
  assert.match(html, /<span class="token-string">'\$&amp;'<\/span>/);
});
