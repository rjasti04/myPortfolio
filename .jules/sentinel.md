## 2024-05-18 - Fix XSS Vulnerability in escapeHTML
**Vulnerability:** The `escapeHTML` function in `js/utils.js` used DOM manipulation (`textContent` to `innerHTML`) which fails to escape quotes (`"` and `'`), leading to attribute injection XSS vulnerabilities.
**Learning:** DOM-based text escaping is incomplete and unsafe for attribute contexts. It also relies on the `document` object, making it incompatible with server-side environments.
**Prevention:** Always use regex-based string replacement for HTML escaping to cover all necessary characters (`&`, `<`, `>`, `"`, `'`) and ensure compatibility across environments.
