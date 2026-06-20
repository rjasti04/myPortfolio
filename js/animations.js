import { prefersReducedMotion, mobileDevice, supportsHover } from "./config.js";
import { animateSpring } from "./physics.js";

// Animation timing constants
const REVEAL_STAGGER_MS = 80;
const STAT_COUNT_DURATION_MS = 900;
const TERMINAL_INTRO_START_MS = 180;
const TERMINAL_INTRO_STEP_MS = 180;
const MATRIX_FRAME_MS = 28;
const MATRIX_ITERATION_STEP = 0.2;

function initReveals() {
  const revealElements = Array.from(document.querySelectorAll(".reveal"));
  if (revealElements.length === 0) return;

  if (prefersReducedMotion.matches || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("active"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, intersectionObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("active");
          intersectionObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
  );

  revealElements.forEach((element) => observer.observe(element));

  // Stagger delays for grid children (stats, skills, project cards)
  document
    .querySelectorAll(
      ".stats-grid, .skills-grid, .portfolio-grid, .articles-grid",
    )
    .forEach((grid) => {
      const children = Array.from(grid.querySelectorAll(".reveal"));
      children.forEach((child, i) => {
        child.style.setProperty("--reveal-delay", `${i * REVEAL_STAGGER_MS}ms`);
      });
    });
}

function initStats() {
  const statNumbers = Array.from(
    document.querySelectorAll(".stat-number[data-target]"),
  );
  if (statNumbers.length === 0) return;

  const springPop = (el) => {
    if (prefersReducedMotion.matches) return;
    // Quick scale pop: 1.15 → 1 with snappy spring
    animateSpring({
      from: 1.15,
      to: 1,
      onUpdate: (v) => {
        el.style.transform = `scale(${v})`;
      },
      onComplete: () => {
        el.style.transform = "";
      },
      config: { stiffness: 400, damping: 18 },
    });
  };

  const animateStat = (element) => {
    if (element.dataset.animated) return;
    element.dataset.animated = "true";

    const target = Number.parseFloat(element.dataset.target || "0");
    const suffix = element.dataset.suffix || "";
    const isDecimal = !Number.isInteger(target);
    const duration = prefersReducedMotion.matches ? 0 : STAT_COUNT_DURATION_MS;

    if (duration === 0) {
      element.textContent = `${isDecimal ? target.toFixed(1) : target}${suffix}`;
      return;
    }

    let startTime = 0;
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;
      element.textContent = `${isDecimal ? current.toFixed(1) : Math.floor(current)}${suffix}`;
      if (progress < 1) requestAnimationFrame(step);
      else {
        element.textContent = `${isDecimal ? target.toFixed(1) : target}${suffix}`;
        springPop(element);
      }
    };
    requestAnimationFrame(step);
  };

  if (!("IntersectionObserver" in window)) {
    statNumbers.forEach(animateStat);
    return;
  }

  const observer = new IntersectionObserver(
    (entries, intersectionObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateStat(entry.target);
          intersectionObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.45 },
  );

  statNumbers.forEach((element) => observer.observe(element));
}

function initTerminalIntro() {
  const terminalChildren = Array.from(
    document.querySelectorAll(".terminal-body > *:not(.terminal-input-line)"),
  );
  if (
    mobileDevice.matches ||
    prefersReducedMotion.matches ||
    terminalChildren.length === 0
  ) {
    terminalChildren.forEach((child) => {
      child.style.opacity = "1";
    });
    return;
  }

  let delay = TERMINAL_INTRO_START_MS;
  terminalChildren.forEach((child) => {
    child.style.opacity = "0";
    child.style.animation = `slide-up var(--motion-medium) var(--ease-enter) forwards ${delay}ms`;
    delay += TERMINAL_INTRO_STEP_MS;
  });
}

function initMatrixDecode() {
  const element = document.querySelector(".hero-title");
  if (!element || prefersReducedMotion.matches) return;

  const originalText = element.textContent.trim();
  const chars = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ";

  // Pre-generate spans
  const letters = originalText.split("");
  element.textContent = "";
  const spans = letters.map((letter) => {
    const s = document.createElement("span");
    s.textContent = letter;
    s.dataset.scrambled = "false";
    element.appendChild(s);
    return s;
  });

  // Ensure data-text is set immediately for pseudo-elements
  element.setAttribute("data-text", originalText);

  /** Enable CSS glitch animations after decode finishes to avoid repaint conflicts */
  const enableGlitch = () => {
    element.classList.add("glitch-active");
    // Release GPU compositing layers after 30s to save memory
    setTimeout(() => {
      element.style.willChange = "auto";
    }, 30000);
  };

  const animateText = (isInitial = false) => {
    let iterations = 0;
    let lastTime = 0;

    const tick = (time) => {
      if (!lastTime) lastTime = time;
      const elapsed = time - lastTime;
      if (elapsed >= MATRIX_FRAME_MS) {
        let currentString = "";
        for (let i = 0; i < letters.length; i++) {
          if (letters[i] === " ") {
            currentString += " ";
            continue;
          }
          if (i < iterations) {
            if (spans[i].dataset.scrambled === "true") {
              spans[i].textContent = letters[i];
              spans[i].style.color = "";
              spans[i].dataset.scrambled = "false";
            }
          } else {
            spans[i].textContent =
              chars[Math.floor(Math.random() * chars.length)];
            spans[i].style.color = "var(--accent-text)";
            spans[i].dataset.scrambled = "true";
          }
          currentString += spans[i].textContent;
        }
        element.setAttribute("data-text", currentString);
        iterations += MATRIX_ITERATION_STEP;
        lastTime = time;
      }

      if (iterations < originalText.length) {
        requestAnimationFrame(tick);
      } else {
        spans.forEach((s, i) => {
          s.textContent = letters[i];
          s.style.color = "";
          s.dataset.scrambled = "false";
        });
        element.setAttribute("data-text", originalText);
        if (isInitial) enableGlitch();
      }
    };
    requestAnimationFrame(tick);
  };

  const startAnimation = () => {
    // Only set fixed widths if fonts are loaded and we get non-zero widths

    // Pure read phase: collect widths first to avoid layout thrashing
    // First iteration: clear explicit widths (pure write)
    spans.forEach((s, i) => {
      if (letters[i] !== " ") s.style.width = "";
    });

    // Second iteration: collect layout widths (pure read)
    const widths = spans.map((s, i) => {
      if (letters[i] === " ") return 0;
      return s.getBoundingClientRect().width;
    });

    // Pure write phase: apply styles all at once
    spans.forEach((s, i) => {
      if (letters[i] === " ") {
        s.dataset.scrambled = "false";
        return;
      }
      if (widths[i] > 0) {
        s.style.cssText = `display: inline-block; width: ${widths[i]}px; text-align: center;`;
        s.dataset.scrambled = "false";
      }
    });

    animateText(true);
  };

  // Use document.fonts if available to wait for Jakarta Sans
  if (document.fonts) {
    document.fonts.ready.then(() => {
      setTimeout(startAnimation, 100);
    });
  } else {
    setTimeout(startAnimation, 500);
  }

  element.addEventListener("mouseenter", () => {
    if (element.getAttribute("data-text") === originalText) animateText(false);
  });
}

function initSpringHovers() {
  if (prefersReducedMotion.matches || !supportsHover.matches) return;

  const springConfig = { stiffness: 400, damping: 30 };

  // Centralized event delegation for spring hovers
  document.body.addEventListener("mouseover", (e) => {
    const btn = e.target.closest("[data-spring-hover]");
    if (btn && !btn.contains(e.relatedTarget)) {
      animateSpring({
        from: 0,
        to: -3,
        onUpdate: (y) => {
          btn.style.transform = `translateY(${y}px) scale(${1 + Math.abs(y) * 0.01})`;
        },
        config: springConfig,
      });
    }

    const card = e.target.closest("[data-spring-card-hover]");
    if (card && !card.contains(e.relatedTarget)) {
      animateSpring({
        from: -3,
        to: 0,
        onUpdate: (y) => {
          btn.style.transform = `translateY(${y}px)`;
        },
        onComplete: () => {
          btn.style.transform = "";
        },
        config: springConfig,
      });
    }
  });

  document.body.addEventListener("mouseout", (e) => {
    const btn = e.target.closest("[data-spring-hover]");
    if (btn && !btn.contains(e.relatedTarget)) {
      animateSpring({
        from: 0,
        to: -8,
        onUpdate: (y) => {
          card.style.transform = `translateY(${y}px) scale(1.01)`;
        },
        config: springConfig,
      });
    }

    const card = e.target.closest("[data-spring-card-hover]");
    if (card && !card.contains(e.relatedTarget)) {
      animateSpring({
        from: -8,
        to: 0,
        onUpdate: (y) => {
          card.style.transform = `translateY(${y}px)`;
        },
        onComplete: () => {
          card.style.transform = "";
        },
        config: springConfig,
      });
    }
  });
}

export function initAnimations() {
  initReveals();
  initStats();
  initTerminalIntro();
  initMatrixDecode();
  initSpringHovers();
  initPageTransitions();
}

// Enhanced page transition animations
function initPageTransitions() {
  if (prefersReducedMotion.matches) return;

  const sections = document.querySelectorAll("main section");

  sections.forEach((section) => {
    // Add transition classes
    section.style.transition = "opacity 0.3s ease, transform 0.3s ease";

    // Observe section activation
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          const isActive = section.classList.contains("active");

          if (isActive) {
            // Entering animation
            section.style.opacity = "0";
            section.style.transform = "translateY(20px)";

            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                section.style.opacity = "1";
                section.style.transform = "translateY(0)";
              });
            });

            // Re-trigger reveal animations for elements in this section
            const reveals = section.querySelectorAll(".reveal");
            reveals.forEach((el, index) => {
              el.classList.remove("active");
              setTimeout(
                () => {
                  el.classList.add("active");
                },
                100 + index * REVEAL_STAGGER_MS,
              );
            });
          }
        }
      });
    });

    observer.observe(section, { attributes: true });
  });
}
