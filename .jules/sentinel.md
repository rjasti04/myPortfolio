## 2025-05-26 - [HIGH] Fix XSS vulnerability in escapeHTML
**Vulnerability:** XSS vulnerability in `escapeHTML` and `escapeInfoHTML` where single and double quotes were not escaped because the function used `document.createElement("div")` and `div.textContent` + `div.innerHTML`.
**Learning:** Browsers do not escape single and double quotes when reading `.innerHTML` after setting `.textContent`. As a result, strings with quotes could break out of HTML attributes and allow XSS. DOM-based trickery also blocks the main thread.
**Prevention:** Use standard regex-based string replacements (e.g. `replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")`) rather than DOM elements to perform HTML escaping.
