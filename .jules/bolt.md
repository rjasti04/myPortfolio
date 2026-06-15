## 2025-06-15 - Fast HTML Escaping

**Learning:** Regex-based string manipulation is substantially faster (often 2x-100x depending on string length) than DOM-based trickery (e.g., `document.createElement("div")` + `textContent` + `innerHTML`) for HTML escaping. Synchronous DOM operations block the main thread. Also, `textContent` to `innerHTML` conversion can fail to properly escape quotes, leading to attribute injection XSS vulnerabilities.

**Action:** Always prefer regex-based string manipulation over DOM-based trickery for HTML escaping.
