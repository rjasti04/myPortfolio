import { prefersReducedMotion, supportsHover } from "./config.js";

export function initTilt() {
  if (prefersReducedMotion.matches || !supportsHover.matches) return;

  const cards = document.querySelectorAll(".tilt-card");

  cards.forEach(card => {
    let rect = null;
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;

    const applyTilt = () => {
      frame = 0;
      if (!rect) return;

      const relativeX = pointerX - rect.left;
      const relativeY = pointerY - rect.top;

      const multiplier = 8; // degrees max rotation
      const xCalc = (relativeX / rect.width - 0.5) * multiplier;
      const yCalc = (relativeY / rect.height - 0.5) * -multiplier;

      card.style.transform = `perspective(1000px) rotateX(${yCalc}deg) rotateY(${xCalc}deg) translateY(-8px) scale3d(1.02, 1.02, 1.02)`;
      card.style.transition = "none";
    };

    card.addEventListener("mouseenter", () => {
      rect = card.getBoundingClientRect();
    });

    card.addEventListener("mousemove", (e) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      if (!rect) rect = card.getBoundingClientRect();
      if (!frame) frame = requestAnimationFrame(applyTilt);
    });

    card.addEventListener("mouseleave", () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      rect = null;
      card.style.transition = "transform var(--motion-medium) var(--ease-enter)";
      card.style.transform = "";
      card.addEventListener("transitionend", () => {
        // BUG FIX ROOT CAUSE: If the user hovers back onto the card before the transition to empty finishes,
        // the transitionend listener clears the active card transition, resulting in visual glitches.
        // We guard the style reset by ensuring rect remains null.
        if (!rect) {
          card.style.transition = "";
        }
      }, { once: true });
    });
  });
}
