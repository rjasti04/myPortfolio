## 2024-06-14 - Fix Attribute Injection XSS in HTML Escaping
**Vulnerability:** The `escapeHTML` utility function used a DOM-based approach (`textContent` to `innerHTML`) which successfully escapes `<`, `>`, and `&`, but fails to escape single and double quotes (`'` and `"`). This exposed the application to attribute injection XSS vulnerabilities if user input was placed within HTML attributes.
**Learning:** Browser DOM manipulation utilities for text escaping do not consistently escape quotes since they assume element content context, not attribute context.
**Prevention:** Always prefer regex-based string manipulation (`.replace(/&/g, "&amp;").replace(/</g, "&lt;")...`) over DOM-based trickery for HTML escaping to ensure all sensitive characters, including quotes, are safely encoded.
