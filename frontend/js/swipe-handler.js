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
 * Pull-to-refresh. The site's only one, on every page.
 *
 * It started as a stand-in for the AI page alone. That page does not scroll as
 * a document: `.layout` is `height: 100dvh`, `body` is `overflow: hidden` -
 * which propagates to the viewport, since no rule sets overflow on `html` -
 * and the one scrolling surface, `.ai-content-area`, sets
 * `overscroll-behavior: contain`. A downward drag therefore never chains out
 * to the viewport, and the viewport overscroll is exactly what Chrome's native
 * pull-to-refresh is built on.
 *
 * Which left the gesture behaving one way on the AI page and another
 * everywhere else - a different spinner, a different threshold, a different
 * release. So the browser's own version is now off site-wide (see the
 * `overscroll-behavior-y` rule in styles.css, scoped to `.js-enabled` so the
 * no-JS page keeps it) and this drives all of them. It is also the only
 * version that works once the site is installed to a home screen, where the
 * browser offers no gesture of its own.
 *
 * Two modes, and the constructor picks between them by looking at what it was
 * handed. A NESTED scroller - the AI transcript - listens on itself and hangs
 * its indicator on its positioned parent. The DOCUMENT scroller listens on
 * `document`, because a page pull can start on anything, and fixes its
 * indicator to the viewport, because <html> has no parent to hang it on. The
 * document instance yields wherever the page is not the thing that scrolls -
 * inside a nested scroller, or on a page whose document scroll is locked -
 * so that exactly one indicator can answer any given pull.
 *
 * `touchmove` is the one non-passive listener, and it is bound only for the
 * length of a live pull. Left bound, it would make every touch scroll on the
 * page wait for JS - the exact cost the passive flag exists to avoid, and one
 * that only mattered once this moved onto `document`.
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
    this.moveBound = false;

    if (!this.element || !this.onRefresh) return;

    // Document mode. `document.scrollingElement` is <html> in standards mode,
    // but a caller reaching for the page scroller could reasonably hand over
    // any of these three.
    this.isDocument =
      this.element === document.scrollingElement ||
      this.element === document.documentElement ||
      this.element === document.body;

    // A page pull can begin on any element, so document mode listens on
    // `document` rather than on the scroller, which only covers where its own
    // box paints.
    this.eventTarget = this.isDocument ? document : this.element;

    // What the document instance looks for to know a pull is not its own. Set
    // on the element rather than kept in a module-level registry so it is
    // visible in devtools next to the scroller it describes.
    if (!this.isDocument) this.element.dataset.ptrScroller = '';

    this.indicator = document.createElement('div');
    this.indicator.className = this.isDocument
      ? 'ptr-indicator ptr-indicator--viewport js-only'
      : 'ptr-indicator js-only';
    this.indicator.innerHTML =
      '<span class="ptr-spinner" aria-hidden="true"></span>' +
      '<span class="ptr-label sr-only" role="status" aria-live="polite"></span>';
    this.label = this.indicator.querySelector('.ptr-label');
    // The scroller cannot host it: an absolutely positioned child of a scroll
    // box scrolls away with the content, so it goes on the positioned parent.
    // In document mode there is no parent to use and nothing to scroll away
    // from - the indicator is fixed to the viewport - so body takes it.
    const host = this.isDocument
      ? document.body
      : (this.element.parentElement || this.element);
    host.appendChild(this.indicator);

    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);

    this.init();
  }

  init() {
    this.eventTarget.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    this.eventTarget.addEventListener('touchend', this.boundTouchEnd, { passive: true });
    this.eventTarget.addEventListener('touchcancel', this.boundTouchEnd, { passive: true });
  }

  /**
   * The non-passive listener, bound only while a pull is live. touchstart
   * always precedes the first touchmove of a gesture, so arming it there
   * misses nothing, and every path that clears touchId unbinds it again.
   */
  bindMove() {
    if (this.moveBound) return;
    this.moveBound = true;
    this.eventTarget.addEventListener('touchmove', this.boundTouchMove, { passive: false });
  }

  unbindMove() {
    if (!this.moveBound) return;
    this.moveBound = false;
    this.eventTarget.removeEventListener('touchmove', this.boundTouchMove);
  }

  /**
   * True when a document-mode pull has to stand down. Two cases, and both say
   * the same thing: the page is not what is scrolling here.
   *
   * 1. The touch began inside a scroller running its own instance.
   * 2. The document scroll is locked - `body { overflow: hidden }`, which is
   *    the AI shell while #ai is active, and also an open nav or dropdown.
   *
   * The second is not covered by the first. The AI panel's transcript is
   * marked, but the strip above it, the composer and the gutter around the
   * panel are not, and a pull starting on any of those would otherwise raise
   * the page indicator on a page that already has one of its own - in a
   * different place, on the same gesture. Which is the inconsistency this
   * whole thing exists to remove.
   *
   * `instanceof Element` is deliberately not the target test: it has to hold
   * in jsdom, where the global binding is not the document's.
   */
  documentPullBlocked(e) {
    if (!this.isDocument) return false;

    const target = e.target;
    if (target && typeof target.closest === 'function' && target.closest('[data-ptr-scroller]')) {
      return true;
    }

    const styles =
      typeof window !== 'undefined' && typeof window.getComputedStyle === 'function' && document.body
        ? window.getComputedStyle(document.body)
        : null;
    return styles ? styles.overflowY === 'hidden' : false;
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
    // The AI page runs its own, and a locked page is not pulling anywhere.
    if (this.documentPullBlocked(e)) return;
    // The gesture has to START at the top. Arming it on any touch and testing
    // scrollTop later would turn a fast flick back to the top into a refresh.
    if (this.element.scrollTop > 0) return;

    this.touchId = e.touches[0].identifier;
    this.startY = e.touches[0].clientY;
    this.distance = 0;
    this.indicator.classList.remove('is-settling');
    this.bindMove();
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
    this.unbindMove();
    this.indicator.classList.add('is-settling');

    if (passed) this.refresh();
    else this.setPull(0, 0);
  }

  cancel() {
    this.touchId = null;
    this.distance = 0;
    this.unbindMove();
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
    // eventTarget too: the constructor bails before setting it when it was
    // handed an element but no callback, and destroy() is still fair game.
    if (!this.element || !this.eventTarget) return;
    this.unbindMove();
    this.eventTarget.removeEventListener('touchstart', this.boundTouchStart);
    this.eventTarget.removeEventListener('touchend', this.boundTouchEnd);
    this.eventTarget.removeEventListener('touchcancel', this.boundTouchEnd);
    if (!this.isDocument) delete this.element.dataset.ptrScroller;
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
