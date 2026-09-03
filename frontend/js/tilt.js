import { prefersReducedMotion, supportsHover } from "./config.js";

/**
 * A card taller than this many viewports cannot read as one tilting plane -
 * only a slice of it is ever on screen, so the rotation stops looking like a
 * card leaning and starts looking like the text warping under the pointer.
 * Measured at hover time, so a card that shrinks gets its tilt back.
 */
const MAX_VIEWPORT_RATIO = 1.5;

const clampRatio = (value) => Math.min(0.5, Math.max(-0.5, value));

export function initTilt() {
  if (prefersReducedMotion.matches || !supportsHover.matches) return;

  const cards = document.querySelectorAll(".tilt-card");

  cards.forEach(card => {
    let rect = null;
    let hovering = false;
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;

    const applyTilt = () => {
      frame = 0;
      if (!hovering) return;
      // BUG FIX ROOT CAUSE: the rect was measured once on mouseenter and never
      // again, so every scroll left it stale - `rect.top` is viewport-relative
      // and the card had moved. On a short card that self-corrected, because
      // the pointer leaves and re-enters constantly. On a card several
      // viewports tall the pointer never leaves while you read it, so the
      // tilt froze at whatever angle it caught and stayed wrong for the whole
      // scroll. Re-measure whenever something invalidated it.
      if (!rect) rect = card.getBoundingClientRect();

      const multiplier = 8; // degrees max rotation
      // Clamped: a rect that goes stale between one frame and the next - a
      // scroll, a lazily-loaded image reflowing the page - must not be able to
      // drive the rotation past that cap.
      const xCalc = clampRatio((pointerX - rect.left) / rect.width - 0.5) * multiplier;
      const yCalc = clampRatio((pointerY - rect.top) / rect.height - 0.5) * -multiplier;

      card.style.transform = `perspective(1000px) rotateX(${yCalc}deg) rotateY(${xCalc}deg) translateY(-8px) scale3d(1.02, 1.02, 1.02)`;
      card.style.transition = "none";
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(applyTilt);
    };

    card.addEventListener("mouseenter", () => {
      const bounds = card.getBoundingClientRect();
      if (bounds.height > window.innerHeight * MAX_VIEWPORT_RATIO) return;
      hovering = true;
      rect = bounds;
    });

    card.addEventListener("mousemove", (e) => {
      if (!hovering) return;
      pointerX = e.clientX;
      pointerY = e.clientY;
      schedule();
    });

    // Scrolling moves the card under a stationary pointer, which changes the
    // tilt as surely as moving the pointer does. Passive, and only measuring
    // again on the next animation frame, so this stays off the scroll path.
    const invalidate = () => {
      if (!hovering) return;
      rect = null;
      schedule();
    };
    window.addEventListener("scroll", invalidate, { passive: true });
    window.addEventListener("resize", invalidate, { passive: true });

    card.addEventListener("mouseleave", () => {
      if (!hovering) return;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      hovering = false;
      rect = null;
      card.style.transition = "transform var(--motion-medium) var(--ease-enter)";
      card.style.transform = "";
      card.addEventListener("transitionend", () => {
        // BUG FIX ROOT CAUSE: If the user hovers back onto the card before the
        // transition to empty finishes, the transitionend listener clears the
        // active card transition, resulting in visual glitches. We guard the
        // style reset on the hover state - not on `rect`, which is now also
        // nulled by a scroll while the pointer is still inside.
        if (!hovering) {
          card.style.transition = "";
        }
      }, { once: true });
    });
  });
}
