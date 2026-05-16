## 2026-05-15 - Fixed escapeHTML Attribute Injection XSS
**Vulnerability:** The `escapeHTML` (and `escapeInfoHTML`) functions in `js/utils.js` and `js/archived/info-bar.js` used a DOM-based sanitization approach (`div.textContent = str; return div.innerHTML`). While this escapes `<` and `>`, it does not escape single or double quotes, leaving the application vulnerable to attribute-based XSS when escaping strings passed directly into HTML tag attributes.
**Learning:** Never rely solely on setting `textContent` and reading `innerHTML` for full sanitization when placing values into HTML attributes.
**Prevention:** Always use regex-based escaping to comprehensively encode `&`, `<`, `>`, `"`, and `'`.
