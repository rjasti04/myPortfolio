## 2026-05-20 - Fix DOM-based XSS in HTML escaping
**Vulnerability:** DOM-based HTML escaping in utils.js does not escape quotes, enabling attribute injection XSS.
**Learning:** Using `textContent` to `innerHTML` conversion is insufficient for escaping user input intended for HTML attributes.
**Prevention:** Always use regex-based string replacement for HTML escaping, specifically ensuring `&`, `<`, `>`, `"`, and `'` are handled.
