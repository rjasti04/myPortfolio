# Architecture Decision Records (ADRs)

## ADR-001: Vanilla JavaScript Over Framework

**Date**: 2024-01-15  
**Status**: Accepted

### Context

Need to choose between vanilla JavaScript or a framework (React, Vue, etc.) for the frontend.

### Decision

Use vanilla JavaScript with ES modules.

### Rationale

- **Performance**: No framework overhead, faster initial load
- **Simplicity**: Straightforward for a single-page portfolio
- **Learning**: Demonstrates core JavaScript skills
- **Bundle Size**: Minimal dependencies (only DOMPurify and Marked for chat)
- **Control**: Full control over DOM manipulation and optimization

### Consequences

- More manual DOM manipulation code
- Need to implement own state management
- Easier to optimize for specific use cases
- Better understanding of browser APIs

---

## ADR-002: Service Worker for PWA

**Date**: 2024-01-15  
**Status**: Accepted

### Context

Need offline support and improved performance for returning visitors.

### Decision

Implement service worker with cache-first strategy for CDN resources and stale-while-revalidate for app shell.

### Rationale

- **Offline Support**: Core functionality works offline
- **Performance**: Instant load from cache
- **PWA**: Enables progressive web app features
- **User Experience**: Faster perceived performance

### Consequences

- Added complexity in cache management
- Need to handle cache invalidation
- Requires HTTPS in production
- Cache versioning strategy needed

---

## ADR-003: FastAPI for Backend

**Date**: 2024-01-15  
**Status**: Accepted

### Context

Need a backend for activity tracking and AI chat integration.

### Decision

Use FastAPI with asyncpg for PostgreSQL and boto3 for Amazon Bedrock.

### Rationale

- **Performance**: Async/await support for high concurrency
- **Type Safety**: Pydantic models for validation
- **Documentation**: Auto-generated OpenAPI docs
- **Modern**: Python 3.10+ with type hints
- **Ecosystem**: Rich ecosystem for AWS integration

### Consequences

- Requires Python 3.10+
- Need to manage async context properly
- Database migrations not included (external tool needed)
- No built-in authentication (intentional for demo)

---

## ADR-004: No ORM, Raw SQL

**Date**: 2024-01-15  
**Status**: Accepted

### Context

Need to interact with PostgreSQL database for activity tracking.

### Decision

Use raw SQL with asyncpg instead of an ORM like SQLAlchemy.

### Rationale

- **Performance**: Direct SQL is faster
- **Simplicity**: Fewer abstractions for simple queries
- **Control**: Full control over query optimization
- **Transparency**: SQL is explicit and visible

### Consequences

- More verbose query code
- Manual parameter binding
- No automatic migrations
- Need to handle SQL injection manually (use parameterized queries)

---

## ADR-005: Incremental DOM Updates

**Date**: 2024-01-20  
**Status**: Accepted

### Context

Activity table refresh causes flicker and loses expanded row state.

### Decision

Implement incremental DOM updates that only add new rows instead of rebuilding entire table.

### Rationale

- **UX**: Prevents flicker and maintains state
- **Performance**: Faster updates for small changes
- **Accessibility**: Screen readers handle better

### Consequences

- More complex rendering logic
- Need to track existing rows
- Fallback to full render when needed

---

## ADR-006: SRI Verification in Service Worker

**Date**: 2024-01-20  
**Status**: Accepted

### Context

CDN resources could be compromised, leading to security vulnerabilities.

### Decision

Implement Subresource Integrity (SRI) verification in service worker before caching CDN resources.

### Rationale

- **Security**: Prevents cache poisoning attacks
- **Trust**: Verify CDN resources haven't been tampered with
- **Defense in Depth**: Additional security layer beyond CSP

### Consequences

- Requires maintaining SRI hashes
- Slight performance overhead for verification
- Need to update hashes when CDN resources change
- Graceful fallback if verification fails

---

## ADR-007: URL-Based Pagination State

**Date**: 2024-01-20  
**Status**: Accepted

### Context

Activity table pagination state is lost on page refresh.

### Decision

Store pagination state in URL query parameters.

### Rationale

- **Persistence**: State survives page refresh
- **Shareability**: Users can share specific pages
- **Browser History**: Back/forward buttons work correctly
- **Standard Practice**: Common pattern for pagination

### Consequences

- Need to parse URL on init
- Update URL on pagination changes
- Handle invalid page numbers gracefully

---

## ADR-008: Environment-Aware API Configuration

**Date**: 2024-01-20  
**Status**: Accepted

### Context

Need different API endpoints for localhost, staging, and production.

### Decision

Auto-detect environment based on hostname with override support via window.APP_CONFIG.

### Rationale

- **Developer Experience**: Works out of the box locally
- **Flexibility**: Can override for testing
- **Security**: No hardcoded credentials
- **Simplicity**: No build-time configuration needed

### Consequences

- Need to ensure correct hostname detection
- Staging environment needs specific subdomain
- Override mechanism must be documented

---

## ADR-009: Toast Notifications for Async Operations

**Date**: 2024-01-20  
**Status**: Accepted

### Context

Users need feedback for async operations (copy, save, API calls).

### Decision

Implement toast notification system with dismiss button and auto-hide.

### Rationale

- **UX**: Non-blocking feedback
- **Accessibility**: ARIA live regions for screen readers
- **Consistency**: Unified notification pattern
- **Flexibility**: Support success, error, warning, info types

### Consequences

- Need toast container in HTML
- Manage toast queue for multiple notifications
- Ensure proper z-index stacking

---

## ADR-010: Lazy Loading with IntersectionObserver

**Date**: 2024-01-20  
**Status**: Accepted

### Context

Large images slow down initial page load.

### Decision

Implement lazy loading using IntersectionObserver API with fallback.

### Rationale

- **Performance**: Faster initial load
- **Bandwidth**: Only load visible images
- **Native API**: Browser-native solution
- **Progressive Enhancement**: Fallback for older browsers

### Consequences

- Need data-src attribute on images
- Slight delay before images load
- Requires JavaScript (fallback loads all)
- Need to handle loading states

---

## Future Considerations

### ADR-011: Virtual Scrolling (Proposed)

For activity table with thousands of rows, implement virtual scrolling to render only visible rows.

### ADR-012: Redis Caching (Proposed)

For multi-instance API deployments, replace in-memory rate limiting with Redis.

### ADR-013: WebSocket for Real-Time Updates (Proposed)

For live activity updates without polling, implement WebSocket connection.
