## 2025-06-01 - Fix escapeHTML DOM-based XSS Vulnerability
**Vulnerability:** The `escapeHTML` function in `js/utils.js` used a DOM-based approach (`textContent` to `innerHTML`) to escape HTML entities, which failed to escape quotes (`"` and `'`), making the application vulnerable to attribute injection XSS.
**Learning:** Using `textContent` followed by `innerHTML` read does not escape quotes, which is a significant issue if the escaped text is placed inside an HTML attribute. It is also slower as synchronous DOM operations block the main thread.
**Prevention:** Always use regex-based string manipulation to reliably escape all dangerous HTML characters (`&`, `<`, `>`, `"`, `'`) instead of relying on implicit DOM behavior.
