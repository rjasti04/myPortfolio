## 2024-05-24 - escapeHTML Performance Bottleneck
**Learning:** Using `document.createElement("div")` and `textContent` -> `innerHTML` is an anti-pattern for HTML escaping as synchronous DOM operations block the main thread and can be remarkably slow, especially for long strings. It's also less secure as `textContent` to `innerHTML` conversion fails to escape quotes, leading to attribute injection XSS vulnerabilities.
**Action:** Always prefer regex-based string manipulation (`replace()`) over DOM-based trickery for HTML escaping.
