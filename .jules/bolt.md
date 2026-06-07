## 2024-05-24 - Replace slow DOM-based HTML escaping with regex
**Learning:** Synchronous DOM-based escaping (`document.createElement`) is significantly slower than regex replacement, and `textContent` to `innerHTML` conversion fails to escape quotes (`"` and `'`), potentially leading to attribute injection XSS vulnerabilities.
**Action:** Always prefer regex-based string manipulation over DOM-based trickery for HTML escaping to improve both performance and security.
