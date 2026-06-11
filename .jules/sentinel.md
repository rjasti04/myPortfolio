## 2024-06-11 - XSS Vulnerability in DOM-based HTML Escaping

**Vulnerability:** The `escapeHTML` function in `js/utils.js` used DOM `textContent` assignment and read `.innerHTML` to escape strings. This method failed to escape single quotes (`'`) and double quotes (`"`), leaving the application vulnerable to attribute injection XSS.
**Learning:** For both performance and security, always prefer regex-based string manipulation over DOM-based trickery for HTML escaping. Synchronous DOM operations block the main thread, and `textContent` to `innerHTML` conversion fails to escape quotes.
**Prevention:** Implement a standard regex replace chain mapping `&`, `<`, `>`, `"`, and `'` to their respective HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`) for escaping operations.
