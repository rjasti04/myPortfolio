import { prefersDarkScheme, prefersReducedMotion } from "./config.js";
import { trackEvent } from "./analytics.js";
import { animateSpring } from "./physics.js";
import { reapplyCustomTheme } from "./theme-customizer.js";

let themeBtn, themeIcon, themeColorMeta;

export function applyTheme(isDark) {
  document.body.classList.toggle("dark-theme", isDark);
  if (themeIcon) {
    themeIcon.className = isDark ? "fas fa-sun" : "fas fa-moon";
  }
  if (themeBtn) {
    themeBtn.setAttribute("aria-pressed", String(isDark));
  }
  
  if (typeof reapplyCustomTheme === "function") {
    reapplyCustomTheme(isDark);
  }

  if (themeColorMeta) {
    // Use computed CSS variable instead of hardcoded color
    // Read from body because customizer applies properties on body
    const accentColor = getComputedStyle(document.body)
      .getPropertyValue('--accent-fill').trim();
    themeColorMeta.setAttribute("content", accentColor || (isDark ? "#0a0a0b" : "#c02645"));
  }
}

function spinToggle() {
  if (!themeBtn || prefersReducedMotion.matches) return;
  animateSpring({
    from: 0,
    to: 360,
    onUpdate: (deg) => {
      themeBtn.style.transform = `rotate(${deg}deg) scale(${1 + Math.sin(deg * Math.PI / 180) * 0.15})`;
    },
    onComplete: () => { themeBtn.style.transform = ""; },
    config: { stiffness: 300, damping: 20 }
  });
}

export function initTheme() {
  themeBtn = document.getElementById("theme-toggle");
  themeIcon = document.getElementById("theme-icon");
  themeColorMeta = document.querySelector('meta[name="theme-color"]');

  const savedTheme = localStorage.getItem("theme");
  applyTheme(savedTheme !== "light");

  themeBtn?.addEventListener("click", () => {
    const nextValue = !document.body.classList.contains("dark-theme");
    trackEvent("theme_change", { theme: nextValue ? "dark" : "light" });
    applyTheme(nextValue);
    localStorage.setItem("theme", nextValue ? "dark" : "light");
    spinToggle();
  });

  prefersDarkScheme.addEventListener("change", (event) => {
    if (!localStorage.getItem("theme")) {
      applyTheme(event.matches);
    }
  });
}
