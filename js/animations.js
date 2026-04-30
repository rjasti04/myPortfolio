import { prefersReducedMotion, mobileDevice, supportsHover } from "./config.js";
import { animateSpring } from "./physics.js";

export function initReveals() {
  const revealElements = Array.from(document.querySelectorAll(".reveal"));
  if (revealElements.length === 0) return;

  if (prefersReducedMotion.matches || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("active"));
    return;
  }

  const observer = new IntersectionObserver((entries, intersectionObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        intersectionObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });

  revealElements.forEach((element) => observer.observe(element));

  // Stagger delays for grid children (stats, skills, project cards)
  document.querySelectorAll(".stats-grid, .skills-grid, .portfolio-grid, .articles-grid").forEach((grid) => {
    const children = Array.from(grid.querySelectorAll(".reveal"));
    children.forEach((child, i) => {
      child.style.setProperty("--reveal-delay", `${i * 80}ms`);
    });
  });
}

export function initStats() {
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
    const duration = prefersReducedMotion.matches ? 0 : 1200;

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

export function initTerminalIntro() {
  const terminalChildren = Array.from(document.querySelectorAll(".terminal-body > *:not(.terminal-input-line)"));
  if (mobileDevice.matches || prefersReducedMotion.matches || terminalChildren.length === 0) {
    terminalChildren.forEach((child) => { child.style.opacity = "1"; });
    return;
  }

  let delay = 180;
  terminalChildren.forEach((child) => {
    child.style.opacity = "0";
    child.style.animation = `slide-up 0.35s ease-out forwards ${delay}ms`;
    delay += 180;
  });
}

export function initMatrixDecode() {
  const element = document.querySelector(".hero-title");
  if (!element || prefersReducedMotion.matches) return;

  const originalText = element.textContent.trim();
  const chars = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ";

  // Pre-generate spans
  const letters = originalText.split("");
  element.textContent = "";
  const spans = letters.map(letter => {
    const s = document.createElement("span");
    s.textContent = letter;
    element.appendChild(s);
    return s;
  });

  // Ensure data-text is set immediately for pseudo-elements
  element.setAttribute("data-text", originalText);

  const animateText = () => {
    let iterations = 0;
    let lastTime = 0;

    const tick = (time) => {
      if (!lastTime) lastTime = time;
      const elapsed = time - lastTime;
      if (elapsed >= 28) {
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
            spans[i].style.color = "var(--accent)";
            spans[i].dataset.scrambled = "true";
          }
          currentString += spans[i].textContent;
        }
        element.setAttribute("data-text", currentString);
        iterations += 0.2;
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
      }
    };
    requestAnimationFrame(tick);
  };

  const startAnimation = () => {
    // Only set fixed widths if fonts are loaded and we get non-zero widths
    spans.forEach((s, i) => {
      if (letters[i] === " ") return;
      // Reset width before measuring if this is a re-run
      s.style.width = "";
      const w = s.getBoundingClientRect().width;
      if (w > 0) {
        s.style.display = "inline-block";
        s.style.width = `${w}px`;
        s.style.textAlign = "center";
        s.style.overflow = "hidden";
      }
    });
    animateText();
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
    if (element.getAttribute("data-text") === originalText) animateText();
  });
  
  setInterval(() => {
    if (element.getAttribute("data-text") === originalText) animateText();
  }, 12000);
}

export function initSpringHovers() {
  if (prefersReducedMotion.matches || !supportsHover.matches) return;

  const springConfig = { stiffness: 400, damping: 30 };

  // Spring hover for .btn elements
  document.querySelectorAll(".btn").forEach((btn) => {
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

  // Spring hover for .item cards (non-tilt)
  document.querySelectorAll(".item:not(.tilt-card)").forEach((card) => {
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
