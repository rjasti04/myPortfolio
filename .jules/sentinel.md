## 2024-05-24 - DOM-based HTML Escaping Fails on Quotes
**Vulnerability:** XSS vulnerability in `escapeHTML` function.
**Learning:** The `escapeHTML` function in `js/utils.js` used a DOM-based approach (`div.textContent = value; return div.innerHTML;`) which fails to escape single and double quotes correctly. This leads to attribute injection XSS vulnerabilities if the escaped output is used within HTML attributes.
**Prevention:** Always use regex-based string manipulation (`.replace()`) to escape special characters (`&`, `<`, `>`, `"`, `'`) instead of DOM-based trickery. Synchronous DOM operations are also bad for performance as they block the main thread.
