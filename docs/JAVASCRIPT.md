# JavaScript Module Documentation

## Core Modules

### analytics.js
**Purpose**: Session tracking and event analytics

**Key Functions**:
- `initAnalytics()` - Initialize analytics tracking with session management
- `trackEvent(eventType, eventData)` - Track custom events
- `ensureSession()` - Ensure valid session exists
- `apiFetch(url, options)` - Wrapper for fetch with analytics context

**Usage**:
```javascript
import { initAnalytics, trackEvent } from './analytics.js';

// Initialize on page load
initAnalytics();

// Track custom events
trackEvent('button_click', { button_id: 'cta-main' });
```

---

### activity.js
**Purpose**: The Session Activity dashboard - what the site has recorded about
the current visit

**Key Functions**:
- `initActivity()` - Wire up controls and bind to the section's active state
- `loadActivity()` - Fetch the whole session in one request (the API caps a page
  at 500 events) and hold it in memory
- `loadActivitySummary()` / `loadActivityFunnel()` - Server-side aggregates for
  the headline figures and the path list
- `describeEvent(event)` - Turn a stored event into one plain sentence

**Features**:
- All filtering is local: search, event family, time slice and path
- Four event families (Navigation / Interaction / Preference / Contact) carry
  the colour encoding across the strip, chips, dots and bars
- One list renderer for every viewport - no separate table, card or drawer path
- SSE stream appends live events without a refetch

### activity-charts.js
**Purpose**: Pure paint helpers for the dashboard; `activity.js` owns all state

**Key Functions**:
- `bucketSession(samples, from, to)` - Per-family counts across the session span
- `renderTimeline(root, buckets, options)` - The brushable session strip
- `renderPaths(root, funnel, options)` - Ranked path rows
- `percentile(values, fraction)` / `latencyBand(ms)` - Pipeline chain health

---

### chat.js
**Purpose**: AI chat interface with Amazon Bedrock integration

**Key Functions**:
- `initChat()` - Initialize chat widget and AI page
- Session management with localStorage persistence
- Streaming response handling
- Token counting and limits

**Features**:
- Multi-session support (up to 50 sessions)
- Markdown rendering with syntax highlighting
- Voice input on mobile devices
- Automatic context summarization
- Connection status indicator

---

### utils.js
**Purpose**: Shared utility functions

**Key Functions**:
- `escapeHTML(value)` - Escape HTML special characters
- `copyText(text)` - Copy text to clipboard
- `showToast(message, type, duration)` - Display toast notifications
- `estimateTokens(text)` - Estimate token count for text
- `lazyLoadImages(selector)` - Lazy load images with IntersectionObserver
- `debounce(func, wait)` - Debounce function calls
- `throttle(func, limit)` - Throttle function calls

---

### modal-utils.js
**Purpose**: Reusable modal dialog utilities

**Key Functions**:
- `openModal(modal, options)` - Open modal with focus trap
- `closeModal(modal)` - Close modal and restore focus
- `closeAllModals()` - Close all open modals
- `isModalOpen()` - Check if any modal is open

**Options**:
```javascript
{
  initialFocus: HTMLElement,  // Element to focus on open
  onClose: Function,          // Callback when closed
  closeOnEscape: boolean,     // Allow ESC to close (default: true)
  closeOnBackdrop: boolean    // Allow backdrop click (default: true)
}
```

---

### animation-utils.js
**Purpose**: Shared animation utilities

**Key Functions**:
- `animateCounter(element, target, duration, suffix)` - Animate number counter
- `fadeIn(element, duration)` - Fade in element
- `fadeOut(element, duration)` - Fade out element
- `slideDown(element, duration)` - Slide down element
- `slideUp(element, duration)` - Slide up element
- `staggerAnimation(elements, animationFn, delay)` - Stagger animations
- `parallaxScroll(element, speed)` - Apply parallax effect
- `smoothScrollTo(target, offset)` - Smooth scroll to element
- `revealOnScroll(selector, options)` - Reveal elements on scroll

---


## Configuration

### config.js
**Purpose**: Application configuration and constants

**Exports**:
- `CONTACT_EMAIL` - Contact email address
- `API_BASE` - API base URL (environment-aware)
- `isApiConfigured()` - Check if API is configured
- `prefersReducedMotion` - Media query for reduced motion
- `prefersDarkScheme` - Media query for dark color scheme
- `compactViewport` - Media query for compact viewport
- `supportsHover` - Media query for hover support
- `mobileDevice` - Media query for mobile devices

**Environment Detection**:
- Localhost: `http://localhost:8000`
- Staging: `https://staging-api.rjasti.com/api`
- Production: `https://rjasti.com/api`

---

## Service Worker

### sw.js
**Purpose**: PWA service worker with caching strategies

**Features**:
- App shell caching (stale-while-revalidate)
- CDN resource caching (cache-first)
- SRI (Subresource Integrity) verification
- Cache expiration (7 days)
- Offline fallback

**Cache Strategy**:
1. External CDN resources: Cache-first with SRI verification
2. Local app assets: Stale-while-revalidate
3. API responses: Never cached

---

## Testing

### Running Tests
```bash
npm test
```

**Test Files**:
- `tests/app-logic.test.js` - Core application logic tests
- `tests/utils.test.js` - Utility function tests

**Coverage**:
- Unit tests for utility functions
- Integration tests for modal utilities
- Animation utility tests

---

## Best Practices

### Performance
1. Use `debounce` for input handlers
2. Use `throttle` for scroll handlers
3. Lazy load images with `lazyLoadImages()`
4. Use incremental DOM updates where possible

### Accessibility
1. All modals use proper ARIA attributes
2. Focus management with focus traps
3. Keyboard navigation support
4. Screen reader announcements for dynamic content

### Security
1. All user input is escaped with `escapeHTML()`
2. CSP headers prevent XSS attacks
3. SRI verification for CDN resources
4. No inline scripts (except bootstrap)

### Code Organization
1. Separate concerns into modules
2. Export reusable utilities
3. Use JSDoc comments for documentation
4. Follow consistent naming conventions
