## 2026-05-16 - Replace DOM-based HTML escaping with regex
**Learning:** DOM manipulation operations (`document.createElement` + `innerHTML`) for string escaping can be ~10x slower than regex string replacement and cause main-thread blocking when executed frequently. Also, `textContent` to `innerHTML` conversion is flawed for escaping attribute quotes (`"` and `'`), creating subtle XSS vectors.
**Action:** Default to chained regex replacements or dictionary-based regex replacements (`.replace(/[...]/g, map)`) for string operations instead of abusing the DOM APIs.
