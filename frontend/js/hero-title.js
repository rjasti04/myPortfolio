import { prefersReducedMotion, supportsHover } from "./config.js";

const HERO_TITLE_SELECTOR = "#hero-title, .hero-title, #home .home-name";
const STAGGER_STEP_MS = 42;
const ENTRANCE_DURATION_MS = 780;

/**
 * Kinetic Optical Split & 3D Spring Lock
 * - Semantic structural tokenization (words & characters, preserving wrapping)
 * - 3D Perspective Roll-up with optical de-quantization and spring settling
 * - Interactive 3D Magnetic Tilt with specular accent and elastic proximity pull
 * - Accessible and reduced-motion compliant
 *
 * The same treatment is intentionally shared by the About title and the Home
 * name so the identity treatment is consistent across the two entry points.
 */
export function initHeroTitle() {
  injectPortfolioPolish();

  const elements = Array.from(document.querySelectorAll(HERO_TITLE_SELECTOR));
  if (!elements.length) return;

  elements.forEach((element) => {
    initKineticTitle(element);
  });
}

function initKineticTitle(element) {
  const originalText = element.textContent.trim();
  if (!originalText) return;

  element.setAttribute("aria-label", originalText);

  if (prefersReducedMotion.matches) {
    return;
  }

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
      charSpans.push({ span: charSpan, index: globalCharIndex, delayMs });
      globalCharIndex++;
    }

    element.appendChild(wordContainer);
  });

  element.setAttribute("data-text", originalText);

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
    document.fonts.ready.then(() => setTimeout(startKineticEntrance, 100));
  } else {
    setTimeout(startKineticEntrance, 250);
  }

  if (!supportsHover.matches) return;

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

      if (index > 0) resetAdjacent(charSpans[index - 1]?.span);
      if (index < charSpans.length - 1) resetAdjacent(charSpans[index + 1]?.span);

      setTimeout(() => {
        span.classList.remove("is-recovering");
        if (!span.classList.contains("is-hovered")) span.style.transform = "";
      }, 450);
    };

    span.addEventListener("pointermove", handlePointerMove);
    span.addEventListener("pointerleave", handlePointerLeave);
  });
}

function resetAdjacent(span) {
  if (!span || span.classList.contains("is-hovered")) return;
  span.classList.add("is-recovering");
  span.style.transform = "perspective(600px) rotateX(0deg) rotateY(0deg) translateZ(0) scale(1)";
  setTimeout(() => {
    span.classList.remove("is-recovering");
    if (!span.classList.contains("is-hovered")) span.style.transform = "";
  }, 450);
}

function injectPortfolioPolish() {
  if (document.getElementById("portfolio-polish-overrides")) return;

  const style = document.createElement("style");
  style.id = "portfolio-polish-overrides";
  style.textContent = `
    /* Mobile: hide, don't delete, the generated bottom navigation. */
    @media (max-width: 768px) {
      .mobile-bottom-nav {
        display: none !important;
      }

      .skills-carousel-arrow {
        display: none !important;
      }
    }

    /* Keep the hamburger centered while all other header actions stay grouped right. */
    @media (max-width: 1150px) {
      header {
        position: sticky;
      }

      header .header-actions {
        margin-left: auto;
      }

      header .hamburger-btn {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        margin: 0;
      }
    }

    /* The Home title now uses the exact kinetic character treatment as About. */
    #home .home-name {
      color: var(--text);
      font-weight: 800;
      letter-spacing: var(--tracking-tight);
      line-height: var(--leading-tight);
      perspective: 600px;
      transform-style: preserve-3d;
      margin-bottom: 8px;
    }

    #home .home-name .hero-word {
      display: inline-block;
      white-space: nowrap;
    }

    #home .home-name .hero-char {
      display: inline-block;
      color: var(--text);
      will-change: transform, opacity;
      transform-style: preserve-3d;
      backface-visibility: hidden;
    }

    /* Match About's Principal Data Engineer eyebrow: bold uppercase accent gradient. */
    #home .home-role {
      font-weight: 800;
      letter-spacing: var(--tracking-caps);
      text-transform: uppercase;
      background: linear-gradient(135deg, var(--accent-text) 0%, var(--secondary-text) 100%);
      background-size: 200% 200%;
      background-clip: text;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      color: var(--accent-text);
      text-wrap: balance;
    }

    /* Cleaner hero composition: less empty vertical space, stronger visual hierarchy. */
    #home .home-hero {
      gap: clamp(28px, 5vw, 72px);
      align-items: center;
    }

    #home .home-intro {
      max-width: 620px;
    }

    #home .home-greeting {
      letter-spacing: var(--tracking-wide);
      font-weight: 600;
    }

    #home .home-actions {
      margin-top: 10px;
    }

    #home .home-socials {
      margin-top: 20px;
    }

    /* The About identity is already represented by Home; keep the About hero focused on its body copy. */
    #about .hero-subtitle,
    #about #hero-title {
      display: none !important;
    }

    #about .hero-text {
      padding-top: 0;
    }

    /* Contact channel added by JS: retain the same visual rhythm as the email row. */
    .contact-mobile-phone {
      margin-top: 12px;
      display: inline-flex;
      align-items: center;
      gap: 12px;
      width: min(100%, 460px);
      text-decoration: none;
    }

    .contact-mobile-phone .contact-channel-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    /* Avoid accidental horizontal overflow after the mobile header is centered. */
    @media (max-width: 540px) {
      #home .home-hero {
        gap: 22px;
      }

      #home .home-intro {
        width: 100%;
      }

      #home .home-name {
        letter-spacing: -0.025em;
      }
    }
  `;
  document.head.appendChild(style);

  // The photo remains visible, but clicking it no longer opens a lightbox/new tab.
  const profileTrigger = document.getElementById("profile-trigger");
  if (profileTrigger) {
    const cleanProfile = profileTrigger.cloneNode(true);
    cleanProfile.removeAttribute("href");
    cleanProfile.removeAttribute("target");
    cleanProfile.removeAttribute("rel");
    cleanProfile.setAttribute("aria-label", "Profile photo");
    profileTrigger.replaceWith(cleanProfile);
  }

  // Keep the phone number in the same primary contact block without changing the existing form.
  const contactPrimary = document.querySelector("#contact .contact-primary");
  if (contactPrimary && !document.querySelector(".contact-mobile-phone")) {
    const phone = document.createElement("a");
    phone.className = "contact-primary-link contact-mobile-phone";
    phone.href = "tel:+1980216851";
    phone.setAttribute("aria-label", "Call Rajeev Jasti at plus 1 980 216 851");
    phone.innerHTML = `
      <span class="contact-channel-icon"><i class="fas fa-phone" aria-hidden="true"></i></span>
      <span class="contact-channel-text">
        <span class="contact-channel-label">Mobile</span>
        <span class="contact-channel-value">(+1) 980-216-851</span>
      </span>
      <i class="fas fa-arrow-up-right-from-square contact-channel-go" aria-hidden="true"></i>
    `;
    contactPrimary.insertAdjacentElement("afterend", phone);
  }
}
