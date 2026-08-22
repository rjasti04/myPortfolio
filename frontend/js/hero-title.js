import { prefersReducedMotion, supportsHover } from "./config.js";

const HERO_TITLE_SELECTOR = "#hero-title";
const STAGGER_DELAY_MS = 80;
const INITIAL_DELAY_MS = 100;

/**
 * Split the hero title text into per-word and per-character <span> elements,
 * then trigger staggered animations on page load and on hover.
 */
export function initHeroTitle() {
  const titleEl = document.querySelector(HERO_TITLE_SELECTOR);
  if (!titleEl) return;

  const text = titleEl.textContent.trim();
  if (!text) return;

  // Build DOM: word wrappers → character spans
  titleEl.textContent = "";
  const words = text.split(/\s+/);
  let globalIndex = 0;

  words.forEach((word, wordIndex) => {
    // Insert word-space between words
    if (wordIndex > 0) {
      const spacer = document.createElement("span");
      spacer.className = "hero-word-space";
      spacer.textContent = "\u00A0"; // &nbsp;
      titleEl.appendChild(spacer);
    }

    const wordSpan = document.createElement("span");
    wordSpan.className = "hero-word";

    for (const char of word) {
      const charSpan = document.createElement("span");
      charSpan.className = "hero-char";
      charSpan.dataset.anim = String((globalIndex % 5) + 1);
      charSpan.textContent = char;
      wordSpan.appendChild(charSpan);
      globalIndex++;
    }

    titleEl.appendChild(wordSpan);
  });

  // Bail on animations if reduced motion is preferred
  if (prefersReducedMotion.matches) return;

  const allChars = Array.from(titleEl.querySelectorAll(".hero-char"));

  // Staggered page-load animation
  allChars.forEach((charSpan, i) => {
    setTimeout(() => {
      charSpan.classList.add("active");
    }, INITIAL_DELAY_MS + i * STAGGER_DELAY_MS);
  });

  // Hover re-trigger (desktop only — touch devices skip)
  if (!supportsHover.matches) return;

  allChars.forEach((charSpan) => {
    charSpan.addEventListener("mouseenter", () => {
      charSpan.classList.remove("active");
      // Force synchronous reflow so the browser registers the removal
      void charSpan.offsetWidth;
      charSpan.classList.add("active");
    });
  });
}
