## 2025-02-14 - Fix DOM-based escapeHTML vulnerability

**Vulnerability:** The custom `escapeHTML` implementation was using DOM innerHTML encoding, which failed to escape single and double quotes, creating an Attribute Injection XSS risk.
**Learning:** `div.textContent` to `div.innerHTML` conversion does not escape quotes, making it unsafe for sanitizing input that might be placed inside HTML attributes. Relying on synchronous DOM methods for utility functions also blocks the main thread unnecessarily.
**Prevention:** Always use regex-based character replacement for standard HTML escaping to ensure `<, >, &, ", '` are properly sanitized and avoid heavy synchronous DOM operations.
