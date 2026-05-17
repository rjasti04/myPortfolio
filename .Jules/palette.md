## 2024-05-24 - Interactive Component Accessibility
**Learning:** Found that several interactive icon-only buttons in `js/chat.js` (e.g. voice input, message copy, delete session) and main `index.html` (e.g. theme customizer options) lack `aria-label`s. This is a recurring pattern for elements generated dynamically in JS or nested deeply within customizer panels.
**Action:** Ensure dynamic elements in `js/chat.js` and customizer tools explicitly receive `.setAttribute('aria-label', '...')` when created, especially when they rely solely on FontAwesome icons for meaning.
