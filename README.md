# rjWebApp

A single-page portfolio web application with responsive section navigation, an accessible project detail modal, progressive enhancement for no-JS browsing, and contact-first calls to action.

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
- `npm run lint` - runs all linters.
- `npm run lint:js` - runs ESLint on `scripts.js`.
- `npm run lint:css` - runs Stylelint on all CSS files.
- `npm run format` - formats HTML/CSS/JS/JSON/Markdown/YAML files with Prettier.
- `npm run format:check` - verifies formatting without writing changes.
- `npm test` - runs unit tests.

## Features
- Section-based in-page navigation with active-link state and hash restoration.
- Light/dark theme toggle and optional UI sound persisted in `localStorage`.
- Accessible project detail modal with keyboard dismissal and focus handling.
- Progressive enhancement so core content remains available without JavaScript.
- Contact form with native form fallback plus AJAX enhancement when JavaScript is available.
