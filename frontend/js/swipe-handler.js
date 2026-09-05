/**
 * Swipe gesture handler for mobile navigation
 * Enables swipe left/right to navigate between sections
 */

export class SwipeHandler {
  constructor(options = {}) {
    this.threshold = options.threshold || 50; // Minimum swipe distance
    this.restraint = options.restraint || 100; // Maximum vertical movement
    this.allowedTime = options.allowedTime || 500; // Maximum swipe duration
    this.onSwipeLeft = options.onSwipeLeft || (() => {});
    this.onSwipeRight = options.onSwipeRight || (() => {});
    
    this.startX = 0;
    this.startY = 0;
    this.startTime = 0;
    this.distX = 0;
    this.distY = 0;
    // Whether touchstart accepted this gesture. Without it, touchstart and
    // touchend filtered independently on their own targets - which differ
    // whenever a drag begins on a button and ends on the page - so a gesture
    // rejected at the start could still be measured at the end, against
    // startX/startY left over from a previous one.
    this.armed = false;
    
    // Cache bound handlers to prevent listener leaks
    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);
    
    this.init();
  }

  init() {
    document.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    document.addEventListener('touchmove', this.boundTouchMove, { passive: true });
    document.addEventListener('touchend', this.boundTouchEnd, { passive: true });
  }

  static IGNORE_SELECTOR =
    'input, textarea, select, button, a, .no-swipe, [data-scroll-x], pre, table, .act-table';

  handleTouchStart(e) {
    // Interactive and horizontally scrollable regions are not swipe surfaces:
    // dragging sideways inside a code block or a wide table is a scroll, and
    // treating it as navigation jumps the visitor to another section.
    this.armed = !e.target.closest(SwipeHandler.IGNORE_SELECTOR);
    if (!this.armed) return;

    const touch = e.touches[0];
    this.startX = touch.pageX;
    this.startY = touch.pageY;
    this.startTime = Date.now();
  }

  handleTouchMove(_e) {
    // Prevent default only if it's a horizontal swipe
    if (Math.abs(this.distX) > Math.abs(this.distY)) {
      // e.preventDefault(); // Commented to avoid blocking scroll
    }
  }

  handleTouchEnd(e) {
    // One gesture, one decision: whatever touchstart concluded stands, so the
    // release target cannot revive a rejected gesture or measure it from a
    // stale origin.
    if (!this.armed) return;
    this.armed = false;

    const touch = e.changedTouches[0];
    this.distX = touch.pageX - this.startX;
    this.distY = touch.pageY - this.startY;
    const elapsedTime = Date.now() - this.startTime;

    // Check if swipe meets criteria
    if (elapsedTime <= this.allowedTime) {
      if (Math.abs(this.distX) >= this.threshold && Math.abs(this.distY) <= this.restraint) {
        if (this.distX < 0) {
          // Swipe left
          this.onSwipeLeft();
        } else {
          // Swipe right
          this.onSwipeRight();
        }
      }
    }
  }

  destroy() {
    document.removeEventListener('touchstart', this.boundTouchStart);
    document.removeEventListener('touchmove', this.boundTouchMove);
    document.removeEventListener('touchend', this.boundTouchEnd);
  }
}

/**
 * Pull-to-refresh for a scroller the browser's own gesture cannot reach.
 *
 * The AI page does not scroll as a document: `.layout` is `height: 100dvh`,
 * `body` is `overflow: hidden` - which propagates to the viewport, since no
 * rule sets overflow on `html` - and the one scrolling surface,
 * `.ai-content-area`, sets `overscroll-behavior: contain`. A downward drag
 * therefore never chains out to the viewport, and the viewport overscroll is
 * exactly what Chrome's native pull-to-refresh is built on. This puts the
 * gesture back on the element that does scroll, and it is the only version
 * that works at all once the site is installed to a home screen, where the
 * browser offers no gesture of its own.
 *
 * `touchmove` is the one non-passive listener: cancelling it is what stops the
 * scroller rubber-banding out from under the indicator. It bails on its first
 * comparison unless a pull is genuinely in progress, and only ever cancels
 * while one is.
 */
export class PullToRefresh {
  constructor(element, onRefresh, options = {}) {
    this.element = element || null;
    this.onRefresh = typeof onRefresh === 'function' ? onRefresh : null;

    // Past the threshold, releasing refreshes. maxTravel is where the
    // indicator stops following the finger, so a long drag cannot fling it
    // down the panel.
    this.threshold = options.threshold ?? 70;
    this.maxTravel = options.maxTravel ?? 96;
    // The finger moves twice as far as the indicator. The pull has to feel
    // like it is working against something, or an ordinary flick at the top of
    // the transcript reads as a refresh.
    this.resistance = options.resistance ?? 0.5;

    // A gesture is followed only while it began at the top of the scroller and
    // has been heading down ever since. touchId pins it to one finger, so a
    // second one landing mid-pull cannot retarget the measurement.
    this.touchId = null;
    this.startY = 0;
    this.distance = 0;
    this.refreshing = false;

    if (!this.element || !this.onRefresh) return;

    this.indicator = document.createElement('div');
    this.indicator.className = 'ptr-indicator js-only';
    this.indicator.innerHTML =
      '<span class="ptr-spinner" aria-hidden="true"></span>' +
      '<span class="ptr-label sr-only" role="status" aria-live="polite"></span>';
    this.label = this.indicator.querySelector('.ptr-label');
    // The scroller cannot host it: an absolutely positioned child of a scroll
    // box scrolls away with the content. Its parent is the positioned one.
    (this.element.parentElement || this.element).appendChild(this.indicator);

    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);

    this.init();
  }

  init() {
    this.element.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    this.element.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    this.element.addEventListener('touchend', this.boundTouchEnd, { passive: true });
    this.element.addEventListener('touchcancel', this.boundTouchEnd, { passive: true });
  }

  /** The finger this pull is following, or null once it is gone. */
  trackedTouch(list) {
    if (this.touchId === null || !list) return null;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].identifier === this.touchId) return list[i];
    }
    return null;
  }

  handleTouchStart(e) {
    if (this.refreshing || e.touches.length !== 1) return;
    // The gesture has to START at the top. Arming it on any touch and testing
    // scrollTop later would turn a fast flick back to the top into a refresh.
    if (this.element.scrollTop > 0) return;

    this.touchId = e.touches[0].identifier;
    this.startY = e.touches[0].clientY;
    this.distance = 0;
    this.indicator.classList.remove('is-settling');
  }

  handleTouchMove(e) {
    if (!this.trackedTouch(e.touches)) return;

    // A second finger is a pinch or a two-finger scroll, not a pull.
    if (e.touches.length !== 1) {
      this.cancel();
      return;
    }

    const distance = e.touches[0].clientY - this.startY;

    // Upward, or the scroller has left the top: hand the gesture back whole
    // rather than half-holding it, so the transcript scrolls normally.
    if (distance <= 0 || this.element.scrollTop > 0) {
      this.cancel();
      return;
    }

    // Non-cancelable once the browser has committed the gesture to its own
    // scrolling; preventDefault would do nothing but log a warning.
    if (e.cancelable) e.preventDefault();

    this.distance = distance;
    this.setPull(
      Math.min(distance * this.resistance, this.maxTravel),
      Math.min(distance / this.threshold, 1)
    );
  }

  handleTouchEnd(e) {
    if (this.touchId === null) return;
    // Only the finger that was steering ends the pull.
    if (!this.trackedTouch(e.changedTouches)) return;

    const passed = this.distance >= this.threshold;
    this.touchId = null;
    this.distance = 0;
    this.indicator.classList.add('is-settling');

    if (passed) this.refresh();
    else this.setPull(0, 0);
  }

  cancel() {
    this.touchId = null;
    this.distance = 0;
    this.indicator.classList.add('is-settling');
    this.setPull(0, 0);
  }

  /** travel in px, progress 0-1. The CSS reads both off the indicator. */
  setPull(travel, progress) {
    this.indicator.style.setProperty('--ptr-travel', `${travel}px`);
    this.indicator.style.setProperty('--ptr-progress', String(progress));
  }

  refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.indicator.classList.add('is-refreshing');
    this.setPull(this.threshold, 1);
    if (this.label) this.label.textContent = 'Refreshing';

    // Two frames, not none: the first commits the class and the parked
    // position, the second paints them. Calling straight into a reload
    // navigates before the spinner has ever been on screen.
    const run = () => this.onRefresh();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(run));
    } else {
      run();
    }
  }

  destroy() {
    if (!this.element) return;
    this.element.removeEventListener('touchstart', this.boundTouchStart);
    this.element.removeEventListener('touchmove', this.boundTouchMove);
    this.element.removeEventListener('touchend', this.boundTouchEnd);
    this.element.removeEventListener('touchcancel', this.boundTouchEnd);
    this.indicator?.remove();
  }
}

/**
 * Swipe-down gesture handler to dismiss modals on touch devices
 */
export class ModalSwipeDismiss {
  constructor(modalSelector, closeCallback) {
    this.modal = typeof modalSelector === 'string' ? document.querySelector(modalSelector) : modalSelector;
    this.closeCallback = closeCallback;
    this.startY = 0;
    this.currentY = 0;
    this.isDragging = false;
    this.threshold = 70; // Swipe down threshold in px

    if (!this.modal) return;

    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);

    this.init();
  }

  init() {
    this.modal.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    this.modal.addEventListener('touchmove', this.boundTouchMove, { passive: true });
    this.modal.addEventListener('touchend', this.boundTouchEnd, { passive: true });
  }

  handleTouchStart(e) {
    const content = this.modal.querySelector('.modal-inner, .auth-modal-content, .modal-content') || this.modal;
    if (content.scrollTop && content.scrollTop > 0) return;

    const touch = e.touches[0];
    this.startY = touch.pageY;
    this.isDragging = true;
  }

  handleTouchMove(e) {
    if (!this.isDragging) return;
    const touch = e.touches[0];
    this.currentY = touch.pageY;
    const distY = this.currentY - this.startY;

    if (distY > 0) {
      const content = this.modal.querySelector('.modal-inner, .auth-modal-content, .modal-content') || this.modal;
      content.style.transform = `translateY(${Math.min(distY, 200)}px)`;
      content.style.transition = 'none';
    }
  }

  handleTouchEnd() {
    if (!this.isDragging) return;
    this.isDragging = false;
    const distY = this.currentY - this.startY;
    const content = this.modal.querySelector('.modal-inner, .auth-modal-content, .modal-content') || this.modal;

    content.style.transition = 'transform var(--motion-medium) var(--ease-standard)';

    if (distY > this.threshold) {
      content.style.transform = 'translateY(100%)';
      setTimeout(() => {
        content.style.transform = '';
        if (typeof this.closeCallback === 'function') {
          this.closeCallback();
        } else {
          this.modal.classList.add('hidden');
          this.modal.setAttribute('aria-hidden', 'true');
        }
      }, 200);
    } else {
      content.style.transform = '';
    }

    this.startY = 0;
    this.currentY = 0;
  }

  destroy() {
    if (!this.modal) return;
    this.modal.removeEventListener('touchstart', this.boundTouchStart);
    this.modal.removeEventListener('touchmove', this.boundTouchMove);
    this.modal.removeEventListener('touchend', this.boundTouchEnd);
  }
}
