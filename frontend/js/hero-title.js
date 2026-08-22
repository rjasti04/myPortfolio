import { prefersReducedMotion, supportsHover } from "./config.js";

const HERO_TITLE_SELECTOR = "#hero-title, .hero-title";
const STAGGER_STEP_MS = 42;
const ENTRANCE_DURATION_MS = 780;

/**
 * Concept 2: Kinetic Optical Split & 3D Spring Lock
 * - Semantic structural tokenization (words & characters, preserving wrapping)
 * - 3D Perspective Roll-up with optical de-quantization and spring settling
 * - Interactive 3D Magnetic Tilt with specular accent and elastic proximity pull
 * - Accessible and reduced-motion compliant
 */
export function initHeroTitle() {
  const element = document.querySelector(HERO_TITLE_SELECTOR);
  if (!element) return;

  const originalText = element.textContent.trim();
  if (!originalText) return;

  // Immediate accessible label
  element.setAttribute("aria-label", originalText);

  // If reduced motion is preferred, keep simple layout without transforms
  if (prefersReducedMotion.matches) {
    return;
  }

  // Tokenize DOM into words and character spans
  element.textContent = "";
  const words = originalText.split(/\s+/);
  const charSpans = [];
  let globalCharIndex = 0;

  words.forEach((word, wordIndex) => {
    if (wordIndex > 0) {
      const spaceSpan = document.createElement("span");
      spaceSpan.className = "hero-word-space";
      spaceSpan.textContent = "\u00A0";
      spaceSpan.setAttribute("aria-hidden", "true");
      element.appendChild(spaceSpan);
    }

    const wordContainer = document.createElement("span");
    wordContainer.className = "hero-word";

    for (const char of word) {
      const charSpan = document.createElement("span");
      charSpan.className = "hero-char";
      charSpan.textContent = char;
      charSpan.dataset.orig = char;
      charSpan.setAttribute("aria-hidden", "true");

      const delayMs = globalCharIndex * STAGGER_STEP_MS;
      charSpan.style.setProperty("--stagger-delay", `${delayMs}ms`);

      wordContainer.appendChild(charSpan);
      charSpans.push({
        span: charSpan,
        index: globalCharIndex,
        delayMs,
      });

      globalCharIndex++;
    }

    element.appendChild(wordContainer);
  });

  element.setAttribute("data-text", originalText);

  // Start kinetic entrance animation once font rendering is ready
  const startKineticEntrance = () => {
    charSpans.forEach(({ span, delayMs }) => {
      span.classList.add("kinetic-entering");

      const totalTime = delayMs + ENTRANCE_DURATION_MS;
      setTimeout(() => {
        span.classList.remove("kinetic-entering");
        span.classList.add("kinetic-settled");
      }, totalTime);
    });
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      setTimeout(startKineticEntrance, 100);
    });
  } else {
    setTimeout(startKineticEntrance, 250);
  }

  // Interactive 3D Magnetic Elastic Tilt on Hover
  if (supportsHover.matches) {
    charSpans.forEach(({ span, index }) => {
      let rafId = null;

      const handlePointerMove = (e) => {
        if (!span.classList.contains("kinetic-settled")) return;

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const rect = span.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;

          const relX = (e.clientX - rect.left) / rect.width - 0.5;
          const relY = (e.clientY - rect.top) / rect.height - 0.5;

          const rotX = (-relY * 26).toFixed(2);
          const rotY = (relX * 26).toFixed(2);

          span.classList.remove("is-recovering");
          span.classList.add("is-hovered");
          span.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateZ(14px) scale(1.12)`;

          // Proximity elastic pull on immediate adjacent characters
          if (index > 0) {
            const prev = charSpans[index - 1].span;
            if (prev && prev.classList.contains("kinetic-settled") && !prev.classList.contains("is-hovered")) {
              prev.style.transform = `perspective(600px) rotateX(${rotX * 0.4}deg) rotateY(${rotY * 0.4}deg) translateZ(6px) scale(1.04)`;
            }
          }
          if (index < charSpans.length - 1) {
            const next = charSpans[index + 1].span;
            if (next && next.classList.contains("kinetic-settled") && !next.classList.contains("is-hovered")) {
              next.style.transform = `perspective(600px) rotateX(${rotX * 0.4}deg) rotateY(${rotY * 0.4}deg) translateZ(6px) scale(1.04)`;
            }
          }
        });
      };

      const handlePointerLeave = () => {
        if (rafId) cancelAnimationFrame(rafId);

        span.classList.remove("is-hovered");
        span.classList.add("is-recovering");
        span.style.transform = "perspective(600px) rotateX(0deg) rotateY(0deg) translateZ(0) scale(1)";

        // Reset adjacent characters
        if (index > 0) {
          const prev = charSpans[index - 1].span;
          if (prev && !prev.classList.contains("is-hovered")) {
            prev.classList.add("is-recovering");
            prev.style.transform = "perspective(600px) rotateX(0deg) rotateY(0deg) translateZ(0) scale(1)";
            setTimeout(() => {
              prev.classList.remove("is-recovering");
              if (!prev.classList.contains("is-hovered")) prev.style.transform = "";
            }, 450);
          }
        }
        if (index < charSpans.length - 1) {
          const next = charSpans[index + 1].span;
          if (next && !next.classList.contains("is-hovered")) {
            next.classList.add("is-recovering");
            next.style.transform = "perspective(600px) rotateX(0deg) rotateY(0deg) translateZ(0) scale(1)";
            setTimeout(() => {
              next.classList.remove("is-recovering");
              if (!next.classList.contains("is-hovered")) next.style.transform = "";
            }, 450);
          }
        }

        setTimeout(() => {
          span.classList.remove("is-recovering");
          if (!span.classList.contains("is-hovered")) {
            span.style.transform = "";
          }
        }, 450);
      };

      span.addEventListener("pointermove", handlePointerMove);
      span.addEventListener("pointerleave", handlePointerLeave);
    });
  }
}
