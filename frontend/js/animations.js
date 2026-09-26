import { prefersReducedMotion, mobileDevice, supportsHover, motionMs } from "./config.js";
import { animateSpring } from "./physics.js";

// Animation timing constants. These four have no CSS counterpart - nothing in
// the stylesheet stages the reveal, counts the stats or steps the matrix - so
// they are constants here rather than tokens read back from the cascade.
const REVEAL_STAGGER_MS = 80;
const STAT_COUNT_DURATION_MS = 900;
const MATRIX_FRAME_MS = 28;
const MATRIX_ITERATION_STEP = 0.2;

/* The terminal intro's start delay and per-line step were both a literal 180,
   which is --motion-base restated in JS: change the token and these silently
   kept the old cadence. Read from the scale instead, with 180 as the fallback
   so a missing stylesheet degrades to exactly what it used to do. Lazily,
   because module scope runs before the stylesheet is guaranteed to apply. */
const terminalIntroStartMs = () => motionMs("base", 180);
const terminalIntroStepMs = () => motionMs("base", 180);

/* The section fade lives entirely in CSS - `.js-enabled section.active` runs
   `section-enter` at --motion-page in the SECTION ROUTER region. A JS
   `initPageTransitions()` used to set an inline `transition` plus inline
   opacity/transform on every section on top of that. It never rendered: a CSS
   animation outranks an inline declaration in the cascade, and `forwards`
   fill keeps it applied after the run, so the inline values were dead the
   whole time. It also re-triggered every `.reveal` in the section on a
   `100 + i * 80ms` timer, which fought the IntersectionObserver below and
   stacked on top of the CSS `--reveal-delay`: #about has 12 of them, so the
   last one began its 520ms transition well over a second after the click.
   Do not reintroduce it - change the keyframes in styles.css instead. */
function initReveals() {
  const revealElements = Array.from(document.querySelectorAll(".reveal"));
  if (revealElements.length === 0) return;

  if (prefersReducedMotion.matches || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("active"));
    return;
  }

  // Arms `.reveals-armed .reveal` in styles.css. Set here, synchronously, one
  // statement before the observer that clears it - so no code path can hide
  // these elements without the code that reveals them already running.
  document.documentElement.classList.add("reveals-armed");

  const observer = new IntersectionObserver((entries, intersectionObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        intersectionObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });

  revealElements.forEach((element) => observer.observe(element));

  // Stagger delays for grid children (stats, skills, project cards, app tiles)
  document.querySelectorAll(".stats-grid, .skills-grid, .hobbies-grid, .app-grid").forEach((grid) => {
    const children = Array.from(grid.querySelectorAll(".reveal"));
    children.forEach((child, i) => {
      child.style.setProperty("--reveal-delay", `${i * REVEAL_STAGGER_MS}ms`);
    });
  });
}

function initStats() {
  const statNumbers = Array.from(document.querySelectorAll(".stat-number[data-target]"));
  if (statNumbers.length === 0) return;

  const springPop = (el) => {
    if (prefersReducedMotion.matches) return;
    // Quick scale pop: 1.15 → 1 with snappy spring
    animateSpring({
      from: 1.15,
      to: 1,
      onUpdate: (v) => { el.style.transform = `scale(${v})`; },
      onComplete: () => { el.style.transform = ""; },
      config: { stiffness: 400, damping: 18 }
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

  const observer = new IntersectionObserver((entries, intersectionObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateStat(entry.target);
        intersectionObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.45 });

  statNumbers.forEach((element) => observer.observe(element));
}

function initTerminalIntro() {
  const terminalChildren = Array.from(document.querySelectorAll(".terminal-body > *:not(.terminal-input-line)"));
  if (mobileDevice.matches || prefersReducedMotion.matches || terminalChildren.length === 0) {
    terminalChildren.forEach((child) => { child.style.opacity = "1"; });
    return;
  }

  let delay = terminalIntroStartMs();
  terminalChildren.forEach((child) => {
    child.style.opacity = "0";
    child.style.animation = `slide-up var(--motion-medium) var(--ease-enter) forwards ${delay}ms`;
    delay += terminalIntroStepMs();
  });
}

function initMatrixDecode() {
  // hero-title animation is now handled by hero-title.js — skip it here
  const element = document.querySelector(".hero-title:not(#hero-title)");
  if (!element || prefersReducedMotion.matches) return;

  const originalText = element.textContent.trim();
  const chars = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ";

  // Pre-generate spans
  const letters = originalText.split("");
  element.textContent = "";
  const spans = letters.map(letter => {
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
    setTimeout(() => { element.style.willChange = "auto"; }, 30000);
  };

  // BUG FIX ROOT CAUSE: Hovering the title repeatedly or before the initial load animation finishes
  // triggers multiple requestAnimationFrame ticks. These concurrent loops clash over span text and styles.
  // We lock the execution using an isDecoding boolean state flag.
  let isDecoding = false;

  const animateText = (isInitial = false) => {
    if (isDecoding) return;
    isDecoding = true;

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
            spans[i].textContent = chars[Math.floor(Math.random() * chars.length)];
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
        isDecoding = false;
        if (isInitial) enableGlitch();
      }
    };
    requestAnimationFrame(tick);
  };

  const startAnimation = () => {
    // Only set fixed widths if fonts are loaded and we get non-zero widths
    spans.forEach((s, i) => {
      if (letters[i] === " ") {
        s.dataset.scrambled = "false";
        return;
      }
      // Reset width before measuring if this is a re-run
      s.style.width = "";
      const w = s.getBoundingClientRect().width;
      if (w > 0) {
        s.style.cssText = `display: inline-block; width: ${w}px; text-align: center;`;
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

  // Optional spring hover for explicitly marked elements. Default controls use CSS motion tokens.
  document.querySelectorAll("[data-spring-hover]").forEach((btn) => {
    btn.addEventListener("mouseenter", () => {
      animateSpring({
        from: 0, to: -3,
        onUpdate: (y) => { btn.style.transform = `translateY(${y}px) scale(${1 + Math.abs(y) * 0.01})`; },
        config: springConfig
      });
    });
    btn.addEventListener("mouseleave", () => {
      animateSpring({
        from: -3, to: 0,
        onUpdate: (y) => { btn.style.transform = `translateY(${y}px)`; },
        onComplete: () => { btn.style.transform = ""; },
        config: springConfig
      });
    });
  });

  document.querySelectorAll("[data-spring-card-hover]").forEach((card) => {
    card.addEventListener("mouseenter", () => {
      animateSpring({
        from: 0, to: -8,
        onUpdate: (y) => { card.style.transform = `translateY(${y}px) scale(1.01)`; },
        config: springConfig
      });
    });
    card.addEventListener("mouseleave", () => {
      animateSpring({
        from: -8, to: 0,
        onUpdate: (y) => { card.style.transform = `translateY(${y}px)`; },
        onComplete: () => { card.style.transform = ""; },
        config: springConfig
      });
    });
  });
}

export function initAnimations() {
  initReveals();
  initStats();
  initTerminalIntro();
  initMatrixDecode();
  initSpringHovers();
}
