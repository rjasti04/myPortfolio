## 2026-05-23 - XSS Vulnerability in escapeHTML
**Vulnerability:** XSS via `escapeHTML` attribute injection.
**Learning:** `escapeHTML` uses `.innerHTML` to encode characters, but it does NOT encode single or double quotes, meaning it fails to prevent attribute injection when used inside HTML attributes.
**Prevention:** Prefer regex-based replacement over DOM trickery for `escapeHTML` to ensure all necessary characters are escaped, preventing XSS.
