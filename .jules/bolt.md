## 2024-06-05 - Replace DOM-based HTML escaping with fast regex
**Learning:** Synchronous DOM operations (like `document.createElement` and `innerHTML` assignments) block the main thread and are significantly slower than native string manipulation for simple tasks like HTML escaping. This codebase previously relied on DOM manipulation for escaping, leading to a performance bottleneck.
**Action:** Use fast, regex-based string replacement for HTML escaping instead of relying on the DOM.
