## 2024-10-24 - DOM-based HTML Escaping leads to Attribute Injection XSS
**Vulnerability:** The custom `escapeHTML` implementation was using DOM tricks (`textContent` to `innerHTML`) which successfully escapes `<` and `>`, but crucially fails to escape quotes (`'` and `"`).
**Learning:** This failure to escape quotes leaves the application vulnerable to attribute injection XSS if the "escaped" output is ever interpolated into HTML attributes. Furthermore, synchronous DOM operations (`document.createElement`) block the main thread and degrade frontend performance.
**Prevention:** Always use regex-based string manipulation to properly escape all HTML special characters, including ampersands, angle brackets, and both types of quotes. Avoid using the DOM for sanitization.
