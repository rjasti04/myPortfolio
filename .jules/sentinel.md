## 2024-05-19 - [DOM-based HTML Escaping Causes Attribute Injection XSS]
**Vulnerability:** The `escapeHTML` function in `js/utils.js` relied on DOM manipulation (`div.textContent` to `div.innerHTML`), which correctly escaped `<`, `>`, and `&`, but failed to escape single (`'`) and double (`"`) quotes.
**Learning:** Using DOM properties for escaping is dangerous in contexts where the sanitized output is placed inside HTML attributes, leading to XSS vulnerabilities. Additionally, synchronous DOM operations block the main thread and perform worse than string manipulation.
**Prevention:** Always use regex-based string replacements to escape all dangerous characters (`&`, `<`, `>`, `"`, `'`) when creating an HTML escaping utility, rather than relying on browser DOM behavior.
