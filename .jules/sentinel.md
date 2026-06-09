## 2024-05-18 - Fix Cross-Site Scripting (XSS) due to insecure innerHTML

**Vulnerability:** The `escapeHTML` function in `js/utils.js` converts strings using `document.createElement("div").textContent = value` and returns `innerHTML`. This does not escape double quotes or single quotes. If the escaped output is used within an HTML attribute (e.g. `title="${escapeHTML(city)}"`), an attacker can inject malicious code by breaking out of the attribute using quotes (e.g., `"`), leading to attribute injection XSS.
**Learning:** Using synchronous DOM operations (`textContent` to `innerHTML`) blocks the main thread and fails to escape quotes. This is a common anti-pattern that leads to attribute injection XSS vulnerabilities.
**Prevention:** Always use regex-based string replacement mapping special characters (`&`, `<`, `>`, `"`, `'`) to their corresponding HTML entities for robust and performant escaping.
