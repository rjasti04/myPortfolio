import { initNavigation } from "./navigation.js";
import { initTheme } from "./theme.js";
import { initProjects } from "./projects.js";
import { initContactForm } from "./form.js";
import { initAnimations } from "./animations.js";
import { initTilt } from "./tilt.js";
import { initTerminal } from "./terminal.js";
import { initInfoBar } from "./info-bar.js";
import { initAnalytics } from "./analytics.js";
import { initActivity } from "./activity.js";
import { initChat } from "./chat.js";
import { initSkillsCarousel } from "./skills-carousel.js";

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initNavigation();
  initProjects();
  initContactForm();
  initAnimations();
  initTilt();
  initTerminal();
  initInfoBar();
  initAnalytics();
  initActivity();
  initChat();
  initSkillsCarousel();
  const footerYear = document.getElementById("footer-year");
  if (footerYear) footerYear.textContent = new Date().getFullYear();

  // Defer Three.js background for faster initial paint
  const loadThreeBackground = () => import("../three-bg.js");
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
