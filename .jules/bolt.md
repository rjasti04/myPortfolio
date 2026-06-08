## 2026-06-08 - DOM-based vs Regex-based HTML Escaping
**Learning:** Found that `escapeHTML` was using a hidden div (`document.createElement('div')`, `textContent`, `innerHTML`) for escaping. While simple, synchronous DOM operations block the main thread and can be up to 10x slower than simple Regex string replacement. Furthermore, `innerHTML` conversion does not escape double quotes, which can cause attribute injection vulnerabilities.
**Action:** Replace DOM-based string manipulation with regex replacement functions across the codebase.
