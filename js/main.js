import { initNavigation } from "./navigation.js";
import { initTheme } from "./theme.js";
import { initProjects } from "./projects.js";
import { initContactForm } from "./form.js";
import { initAnimations } from "./animations.js";
import { initTilt } from "./tilt.js";
import { initTerminal } from "./terminal.js";
import { initAnalytics } from "./analytics.js";
import { initActivity } from "./activity.js";
import { initChat } from "./chat.js";
import { initSkillsCarousel } from "./skills-carousel.js";
import { initRipple } from "./ripple.js";
import { initScrollToTop } from "./scroll-to-top.js";

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initNavigation();
  initProjects();
  initContactForm();
  initAnimations();
  initTilt();
  initTerminal();
  initAnalytics();
  initActivity();
  initChat();
  initSkillsCarousel();
  initRipple();
  initScrollToTop();

  // Defer Three.js background for faster initial paint
  // Only load on capable devices to avoid performance issues
  const loadThreeBackground = () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasGoodHardware = navigator.hardwareConcurrency > 4;
    
    if (!prefersReducedMotion && hasGoodHardware) {
      import("../three-bg.js").catch(err => {
        console.warn('Three.js background failed to load:', err);
      });
    }
  };
  
  if ("requestIdleCallback" in window) {
    requestIdleCallback(loadThreeBackground);
  } else {
    setTimeout(loadThreeBackground, 200);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    });
  }
});
