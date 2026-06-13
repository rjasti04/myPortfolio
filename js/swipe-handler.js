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

  handleTouchStart(e) {
    // Ignore if touching interactive elements
    const target = e.target;
    if (target.closest('input, textarea, select, button, a, .no-swipe')) {
      return;
    }

    const touch = e.touches[0];
    this.startX = touch.pageX;
    this.startY = touch.pageY;
    this.startTime = Date.now();
  }

  handleTouchMove(e) {
    // Prevent default only if it's a horizontal swipe
    if (Math.abs(this.distX) > Math.abs(this.distY)) {
      // e.preventDefault(); // Commented to avoid blocking scroll
    }
  }

  handleTouchEnd(e) {
    const target = e.target;
    if (target.closest('input, textarea, select, button, a, .no-swipe')) {
      return;
    }

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

// Pull-to-refresh functionality
export class PullToRefresh {
  constructor(element, onRefresh) {
    this.element = element;
    this.onRefresh = onRefresh;
    this.startY = 0;
    this.currentY = 0;
    this.pulling = false;
    this.threshold = 80;
    
    // Cache bound handlers to prevent listener leaks
    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);
    
    this.init();
  }

  init() {
    this.element.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    this.element.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    this.element.addEventListener('touchend', this.boundTouchEnd, { passive: true });
  }

  handleTouchStart(e) {
    if (this.element.scrollTop === 0) {
      this.startY = e.touches[0].pageY;
      this.pulling = true;
    }
  }

  handleTouchMove(e) {
    if (!this.pulling) return;

    this.currentY = e.touches[0].pageY;
    const distance = this.currentY - this.startY;

    if (distance > 0 && this.element.scrollTop === 0) {
      e.preventDefault();
      
      // Visual feedback
      const pullDistance = Math.min(distance, this.threshold * 1.5);
      this.element.style.transform = `translateY(${pullDistance * 0.5}px)`;
      this.element.style.transition = 'none';
    }
  }

  handleTouchEnd() {
    if (!this.pulling) return;

    const distance = this.currentY - this.startY;
    
    this.element.style.transition = 'transform var(--motion-medium) var(--ease-standard)';
    this.element.style.transform = '';

    if (distance > this.threshold) {
      this.onRefresh();
    }

    this.pulling = false;
    this.startY = 0;
    this.currentY = 0;
  }

  destroy() {
    this.element.removeEventListener('touchstart', this.boundTouchStart);
    this.element.removeEventListener('touchmove', this.boundTouchMove);
    this.element.removeEventListener('touchend', this.boundTouchEnd);
  }
}
