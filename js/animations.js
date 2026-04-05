import { prefersReducedMotion } from "./config.js";

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
}

export function initStats() {
  const statNumbers = Array.from(document.querySelectorAll(".stat-number[data-target]"));
  if (statNumbers.length === 0) return;

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
      else element.textContent = `${isDecimal ? target.toFixed(1) : target}${suffix}`;
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
  if (prefersReducedMotion.matches || terminalChildren.length === 0) {
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
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
  
  const animateText = () => {
    const letters = originalText.split("");
    element.textContent = "";
    const spans = letters.map(letter => {
      const s = document.createElement("span");
      s.textContent = letter;
      element.appendChild(s);
      return s;
    });
    let iterations = 0;
    let lastTime = 0;

    const tick = (time) => {
      if (!lastTime) lastTime = time;
      if (time - lastTime >= 40) {
        for (let i = 0; i < letters.length; i++) {
          if (letters[i] === " ") continue;
          if (i < iterations) {
            if (spans[i].style.color) {
              spans[i].textContent = letters[i];
              spans[i].style.color = "";
            }
          } else {
            spans[i].textContent = chars[Math.floor(Math.random() * chars.length)];
            spans[i].style.color = "var(--accent)";
          }
        }
        iterations += 1 / 3;
        lastTime = time;
      }

      if (iterations < originalText.length) requestAnimationFrame(tick);
      else element.textContent = originalText;
    };
    requestAnimationFrame(tick);
  };

  setTimeout(animateText, 100);
  element.addEventListener("mouseenter", () => {
    if (element.textContent === originalText) animateText();
  });
}

export function initAnimations() {
  initReveals();
  initStats();
  initTerminalIntro();
  initMatrixDecode();
}
