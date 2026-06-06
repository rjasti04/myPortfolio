## 2024-06-06 - XSS vulnerability in escapeHTML

**Vulnerability:** The `escapeHTML` function in `js/utils.js` used a DOM-based approach (`document.createElement('div').textContent = value; return div.innerHTML;`) which fails to escape single and double quotes. If the output of this function was used in an HTML attribute context, it could lead to an Attribute Injection XSS vulnerability.
**Learning:** DOM-based HTML escaping using `textContent` and `innerHTML` is insecure for attribute contexts because browsers do not automatically escape quotes when reading `innerHTML` of text content. It is also slower than regex replacement due to synchronous DOM operations blocking the main thread.
**Prevention:** Always use regex-based string manipulation (`replace(/&/g, "&amp;").replace(/</g, "&lt;")...`) for HTML escaping in JavaScript instead of DOM-based "tricks". Ensure test suites explicitly check for quote escaping.
