## 2026-05-30 - XSS Vulnerability in DOM-based HTML Escaping
**Vulnerability:** The `escapeHTML` function in `js/utils.js` uses `document.createElement` and reads `innerHTML` to escape HTML. This does not escape quotes (`"` or `'`), which can lead to Cross-Site Scripting (XSS) via attribute injection.
**Learning:** Browser native DOM element text-to-HTML conversion only escapes `<`, `>`, and `&`. It does not safely escape attributes when rendering HTML.
**Prevention:** Use a regex-based replacement function instead of DOM manipulation for HTML escaping, specifically ensuring `"` and `'` are safely encoded to `&quot;` and `&#39;`.
