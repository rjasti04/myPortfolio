import { initNavigation } from "./navigation.js";
import { initTheme } from "./theme.js";
import { initProjects } from "./projects.js";
import { initContactForm } from "./form.js";
import { initAnimations } from "./animations.js";
import { initTilt } from "./tilt.js";

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initNavigation();
  initProjects();
  initContactForm();
  initAnimations();
  initTilt();
  
  const footerYear = document.getElementById("footer-year");
  if (footerYear) footerYear.textContent = new Date().getFullYear();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    });
  }
});
