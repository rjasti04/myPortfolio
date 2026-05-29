## 2026-05-29 - XSS Vulnerability in HTML Escaping
**Vulnerability:** `escapeHTML` in `js/utils.js` fails to escape single and double quotes due to using `div.innerHTML`. This leads to attribute injection XSS vulnerabilities when used in attribute contexts.
**Learning:** `textContent` to `innerHTML` conversion does not escape quotes. DOM-based trickery should be avoided for HTML escaping. Synchronous DOM operations block the main thread.
**Prevention:** Use regex-based string manipulation over DOM-based trickery for HTML escaping.
