## 2024-06-19 - Fix XSS Vulnerability in HTML Escaping

**Vulnerability:** The custom `escapeHTML` implementation used DOM-based conversion (`textContent` to `innerHTML`), which escapes `<`, `>`, and `&`, but fails to escape quotes (`"`) and apostrophes (`'`). This left the application vulnerable to Attribute Injection XSS if user-controlled input was placed inside HTML attributes using `escapeHTML`.
**Learning:** DOM-based text escaping functions do not provide complete sanitization for all contexts, specifically HTML attributes. Synchronous DOM operations can also block the main thread.
**Prevention:** Always prefer regex-based string manipulation over DOM-based trickery (e.g., `document.createElement`) for HTML escaping to ensure all necessary characters (including quotes) are safely encoded.
