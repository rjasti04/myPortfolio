## 2024-05-18 - Refactor HTML escaping to use regex
**Learning:** In this codebase, DOM-based string manipulations (like using `document.createElement` for escaping HTML) are a performance anti-pattern. They block the main thread and can degrade performance when called frequently (e.g., rendering chat messages or activity logs).
**Action:** Use regex-based string replacement for simple HTML escaping to avoid expensive synchronous DOM operations and ensure smooth UI rendering.
