# Vendored third-party scripts

`purify.min.js` (DOMPurify 3.4.14) and `marked.min.js` (marked 15.0.12), copied
verbatim from the npm packages of the same versions pinned in `package.json`.

They are vendored rather than loaded from a CDN because they were the last
third-party origin in the page. Every external origin in the critical path is an
independent point of failure — a corporate proxy, an ad blocker or a regional
block is enough — and with them gone the CSP's `script-src` is `'self'` alone.

To update: bump the version in `package.json`, `npm install`, then re-copy:

    cp node_modules/dompurify/dist/purify.min.js frontend/vendor/purify.min.js
    cp node_modules/marked/marked.min.js        frontend/vendor/marked.min.js

`renderBotHTML()` in `js/chat.js` degrades to escaped plain text if either is
missing, so a failed update is visible but not dangerous.
