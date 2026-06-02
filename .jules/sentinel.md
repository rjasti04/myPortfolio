## 2025-06-02 - DOM-based escapeHTML leads to quote injection vulnerability
**Vulnerability:** The `escapeHTML` implementation used `document.createElement("div")` and `.textContent` -> `.innerHTML` conversion which correctly escapes `<` and `>` but leaves single and double quotes unescaped, allowing for attribute injection XSS.
**Learning:** Browser native DOM manipulations for text-to-HTML conversion prioritize rendering safety but do not guarantee complete attribute safety, making it unsuitable for a generic `escapeHTML` function.
**Prevention:** Always use regex-based string manipulation (`/[&<>"']/g`) with explicit character mappings for generic HTML escaping to ensure all critical characters are caught, regardless of the output context.
