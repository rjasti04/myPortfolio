import { prefersReducedMotion, supportsHover } from "./config.js";

const HERO_TITLE_SELECTOR = "#hero-title, .hero-title";
const MATRIX_CHARS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ";
const MATRIX_FRAME_MS = 28;
const MATRIX_ITERATION_STEP = 0.22;

/**
 * Ultimate Matrix Decode Animation for the Hero Title:
 * - Word-wrapped structural containment (zero mid-word line breaking)
 * - Holographic laser scanline leading edge (.matrix-leading)
 * - Tactile spring overshoot lock-in pops (.matrix-locked)
 * - Proximity "liquid wave" hover ripples across neighboring characters
 * - Organic non-linear cryptographic resolve jitter
 */
export function initHeroTitle() {
  const element = document.querySelector(HERO_TITLE_SELECTOR);
  if (!element || prefersReducedMotion.matches) return;

  const originalText = element.textContent.trim();
  if (!originalText) return;

  // Build clean DOM hierarchy: words → character spans
  element.textContent = "";
  const words = originalText.split(/\s+/);
  const charSpans = [];

  words.forEach((word, wordIndex) => {
    if (wordIndex > 0) {
      const spaceSpan = document.createElement("span");
      spaceSpan.className = "hero-word-space";
      spaceSpan.textContent = "\u00A0"; // &nbsp;
      element.appendChild(spaceSpan);
    }

    const wordContainer = document.createElement("span");
    wordContainer.className = "hero-word";

    for (const char of word) {
      const charSpan = document.createElement("span");
      charSpan.className = "hero-char";
      charSpan.textContent = char;
      charSpan.dataset.orig = char;
      charSpan.dataset.scrambled = "false";
      wordContainer.appendChild(charSpan);
      charSpans.push(charSpan);
    }

    element.appendChild(wordContainer);
  });

  element.setAttribute("data-text", originalText);

  let isDecoding = false;

  // Trigger tactile spring overshoot pop on lock-in
  const triggerLockPop = (span) => {
    span.classList.remove("matrix-locked");
    void span.offsetWidth; // Force synchronous reflow
    span.classList.add("matrix-locked");
    setTimeout(() => {
      span.classList.remove("matrix-locked");
    }, 280);
  };

  // Main Sweep Decryption Animation
  const animateText = () => {
    if (isDecoding) return;
    isDecoding = true;

    // Organic cryptographic jitter per character
    const jitter = charSpans.map(() => (Math.random() - 0.5) * 0.65);

    let iterations = 0;
    let lastTime = 0;

    const tick = (time) => {
      if (!lastTime) lastTime = time;
      const elapsed = time - lastTime;

      if (elapsed >= MATRIX_FRAME_MS) {
        let leadingFound = false;

        for (let i = 0; i < charSpans.length; i++) {
          const span = charSpans[i];
          const origChar = span.dataset.orig;
          const threshold = i + jitter[i];

          if (iterations >= threshold) {
            // Character has resolved
            if (span.dataset.scrambled === "true") {
              span.textContent = origChar;
              span.dataset.scrambled = "false";
              span.classList.remove("matrix-leading", "matrix-scrambled");
              triggerLockPop(span);
            }
          } else {
            // Character is in scrambled matrix state
            span.textContent = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
            span.dataset.scrambled = "true";
            span.classList.add("matrix-scrambled");

            // Holographic leading edge laser
            if (!leadingFound) {
              span.classList.add("matrix-leading");
              leadingFound = true;
            } else {
              span.classList.remove("matrix-leading");
            }
          }
        }

        iterations += MATRIX_ITERATION_STEP;
        lastTime = time;
      }

      if (iterations < charSpans.length + 0.8) {
        requestAnimationFrame(tick);
      } else {
        // Complete sweep
        charSpans.forEach((span) => {
          span.textContent = span.dataset.orig;
          span.dataset.scrambled = "false";
          span.classList.remove("matrix-leading", "matrix-scrambled");
          span.style.width = "";
        });
        element.setAttribute("data-text", originalText);
        isDecoding = false;
      }
    };

    requestAnimationFrame(tick);
  };

  // Measure stable character geometry once fonts are loaded
  const startAnimation = () => {
    charSpans.forEach((span) => {
      span.style.width = "";
      const w = span.getBoundingClientRect().width;
      if (w > 0) {
        span.style.width = `${Math.ceil(w)}px`;
      }
    });
    animateText();
  };

  if (document.fonts) {
    document.fonts.ready.then(() => {
      setTimeout(startAnimation, 120);
    });
  } else {
    setTimeout(startAnimation, 400);
  }

  // Liquid Proximity Wave on Hover
  if (supportsHover.matches) {
    // Mini-scramble helper for a specific span
    const scrambleSingle = (span, ticks, delay = 0) => {
      if (!span || span.dataset.scrambling === "true" || isDecoding) return;
      span.dataset.scrambling = "true";

      setTimeout(() => {
        span.classList.add("matrix-scrambled", "matrix-leading");
        let count = 0;
        const orig = span.dataset.orig;

        const interval = setInterval(() => {
          span.textContent = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
          count++;

          if (count >= ticks) {
            clearInterval(interval);
            span.textContent = orig;
            span.classList.remove("matrix-scrambled", "matrix-leading");
            span.dataset.scrambling = "false";
            triggerLockPop(span);
          }
        }, 34);
      }, delay);
    };

    charSpans.forEach((span, index) => {
      span.addEventListener("mouseenter", (e) => {
        e.stopPropagation();
        if (isDecoding) return;

        // Scramble targeted character (primary wave)
        scrambleSingle(span, 6, 0);

        // Ripple out to immediate neighbors (decaying wave)
        if (index > 0) {
          scrambleSingle(charSpans[index - 1], 3, 20);
        }
        if (index < charSpans.length - 1) {
          scrambleSingle(charSpans[index + 1], 3, 20);
        }
      });
    });
  }
}
