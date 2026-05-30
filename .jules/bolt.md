## 2024-05-20 - Regex vs DOM Escaping

**Learning:** For both performance and security, always prefer regex-based string manipulation over DOM-based trickery (e.g., `document.createElement`) for HTML escaping in Vanilla JS. Synchronous DOM operations block the main thread and perform extremely poorly in loops. Additionally, `textContent` to `innerHTML` conversion fails to escape quotes, leading to attribute injection XSS vulnerabilities.
**Action:** Use regex replacements mapping `&`, `<`, `>`, `"`, and `'` to their respective HTML entities for fast and secure HTML escaping.
