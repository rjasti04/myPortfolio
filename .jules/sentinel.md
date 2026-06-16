## 2025-02-24 - Fix Attribute Injection XSS in escapeHTML

**Vulnerability:** The `escapeHTML` function in `js/utils.js` was using DOM manipulation (`div.textContent` then `div.innerHTML`) which failed to escape quotes, allowing attribute injection XSS vulnerabilities.
**Learning:** Synchronous DOM operations for HTML escaping are not only bad for performance by blocking the main thread, but `textContent` to `innerHTML` conversion fails to escape single and double quotes properly.
**Prevention:** Always use regex-based string replacement for basic HTML escaping (e.g., `&`, `<`, `>`, `"`, `'`) rather than relying on DOM element trickery.
