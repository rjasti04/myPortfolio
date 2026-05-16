# Project Architecture Map

This document outlines the high-level architecture and component structure of the `rjWebApp` portfolio application. Refer to this map to understand how components interact before proposing systemic changes.

## System Overview

The application is a Progressive Web App (PWA) static frontend with an optional FastAPI backend for advanced features (chat, analytics).

- **Frontend Environment:** Static hosting capable, Service Worker caching, `localStorage`/`sessionStorage` state management.
- **Backend Environment:** ASGI server running Python `FastAPI` (expected production target: `https://rjasti.com/api`).
- **Database:** PostgreSQL (Schema manages `user_sessions` and `user_activity_events`).

## Directory Structure

### 1. Frontend Core

- **`index.html`**: The single-page application entry point. Contains the DOM structure for all sections (Hero, About, Projects, Contact, Chat).
- **`styles.css`**: Global Vanilla CSS file. No Tailwind or preprocessors are used. Handles all responsive layouts, CSS variables, and core animations.
- **`sw.js`** & **`manifest.json`**: Progressive Web App (PWA) service worker and configuration for offline caching and installability.

### 2. Frontend JavaScript (`/js`)

The application relies on Vanilla ES modules. State is generally local to the modules or managed via the DOM and `localStorage`.

**Key Modules:**

- **`main.js`**: Core entry point that initializes the app and coordinates other modules.
- **UI & Interactions:**
  - `navigation.js`: Scroll handling, header state, and mobile menu.
  - `animations.js` / `confetti.js` / `particles-config.js` / `tilt.js`: Micro-interactions and visual effects.
  - `theme.js` / `theme-customizer.js`: Light/Dark mode and dynamic color palette management.
  - `modal.js` / `skills-carousel.js` / `terminal.js`: Specific UI component logic.
- **Features & Integrations:**
  - `chat.js`: Handles the AI chatbot interface, streaming responses, and communicating with the backend API.
  - `analytics.js` / `activity.js`: Manages session tracking and activity logging.
  - `form.js`: Logic for the FormSubmit contact form.
- **`three-bg.js`** (Root): Handles the WebGL Three.js background canvas.

### 3. Backend API (`/server`)

A lightweight, asynchronous Python API.

- **`server/main.py`**: The FastAPI application.
  - **Endpoints:** Expected to handle AI chat generation (via Amazon Bedrock) and analytics tracking.
  - **Stack:** `asyncpg` for raw SQL interactions (No ORM), `Pydantic v2` for data validation, `boto3` for AWS services.
- **`server/requirements.txt`**: Backend dependencies.

## Key Data Flows

1.  **AI Chat (Frontend -> Backend -> Bedrock):**
    - User types in `chat.js` UI.
    - `chat.js` sends an HTTP request to the FastAPI backend (`server/main.py`).
    - FastAPI calls Amazon Bedrock via `boto3`.
    - Response streams back to the frontend to update the DOM.

2.  **Analytics Tracking (Frontend -> Backend -> PostgreSQL):**
    - `analytics.js` / `activity.js` monitor user interactions (clicks, scrolls, time on page).
    - Data is periodically flushed to the FastAPI backend.
    - FastAPI inserts records into `user_sessions` and `user_activity_events` using raw SQL (`asyncpg`).

## Conventions & Constraints

- **Vanilla First:** Avoid introducing heavy frontend frameworks (React, Vue) or CSS frameworks unless explicitly required.
- **Performant Animations:** Rely on CSS transitions and `requestAnimationFrame` for JS animations (Three.js).
- **No Backend ORM:** Database queries are written in raw SQL using `asyncpg`.
