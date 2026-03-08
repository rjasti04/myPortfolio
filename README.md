# rjWebApp

A single-page portfolio web application with responsive section navigation, theme toggle, profile and sign-up modals, and lightweight login/sign-up demo flows.

## Getting started

### Prerequisites
- Node.js 18+
- npm

### Install dependencies
```bash
npm install
```

### Run locally
Open `index.html` directly in a browser, or serve the folder with your preferred static server.

Example using Python:
```bash
python -m http.server 8080
```
Then open `http://localhost:8080`.

## Available scripts
- `npm run lint` – runs all linters.
- `npm run lint:js` – runs ESLint on `scripts.js`.
- `npm run lint:css` – runs Stylelint on all CSS files.
- `npm run format` – formats HTML/CSS/JS/JSON/Markdown/YAML files with Prettier.
- `npm run format:check` – verifies formatting without writing changes.
- `npm test` – runs unit tests.

## Features
- Section-based in-page navigation with active-link state.
- URL hash-based section restoration and hashchange synchronization.
- Light/Dark theme toggle persisted in `localStorage`.
- Profile image modal with Escape and focus handling.
- Login and sign-up demo validation flows with status messaging.
