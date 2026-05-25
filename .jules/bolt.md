## 2025-02-23 - DOM-based HTML Escaping Anti-Pattern

**Learning:** Using `document.createElement("div")` to convert `textContent` to `innerHTML` for escaping is extremely slow compared to simple string regex replacement because it blocks the main thread with synchronous DOM operations, has higher memory allocation overhead, and critically, fails to escape quotes correctly (causing attribute injection vulnerabilities).
**Action:** Always prefer regex-based string manipulation over DOM-based trickery for HTML escaping, specifically using map-based regex replace functions which are magnitudes faster for Node and browser runtime engines.
