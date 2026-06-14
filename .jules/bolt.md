## 2024-05-20 - [Performance] Regex over DOM for String Manipulation
**Learning:** Using `document.createElement` and assigning to `textContent` and reading `innerHTML` for HTML escaping is synchronous, blocks the main thread, fails to escape quotes (leading to attribute injection XSS vulnerabilities), and is over 50x slower than a regex-based replacement.
**Action:** Always prefer regex-based string manipulation over DOM-based trickery for HTML escaping for both performance and security.
