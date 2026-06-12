## 2024-06-12 - Fix XSS Vulnerability in escapeHTML
**Vulnerability:** The `escapeHTML` utility function used a DOM trick (`div.textContent = value; return div.innerHTML;`) to escape HTML. This failed to escape single and double quotes, allowing for Attribute Injection XSS anywhere `escapeHTML` output was placed in an HTML attribute (e.g. data attributes, title attributes).
**Learning:** Using synchronous DOM operations for escaping is not only a performance bottleneck but critically fails to sanitize quotes when converting `textContent` to `innerHTML`. This gap leads to XSS vulnerabilities.
**Prevention:** Always use regex-based string replacement (`&`, `<`, `>`, `"`, `'`) for HTML escaping rather than relying on DOM tricks.
