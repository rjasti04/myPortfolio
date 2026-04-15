import { prefersDarkScheme } from "./config.js";

let themeBtn, themeIcon;

export function applyTheme(isDark) {
  document.body.classList.toggle("dark-theme", isDark);
  if (themeIcon) {
    themeIcon.className = isDark ? "fas fa-sun" : "fas fa-moon";
  }
  if (themeBtn) {
    themeBtn.setAttribute("aria-pressed", String(isDark));
  }
}

export function initTheme() {
  themeBtn = document.getElementById("theme-toggle");
  themeIcon = document.getElementById("theme-icon");

  const savedTheme = localStorage.getItem("theme");
  applyTheme(savedTheme !== "light");

  themeBtn?.addEventListener("click", () => {
    const nextValue = !document.body.classList.contains("dark-theme");
    applyTheme(nextValue);
    localStorage.setItem("theme", nextValue ? "dark" : "light");
  });

  prefersDarkScheme.addEventListener("change", (event) => {
    if (!localStorage.getItem("theme")) {
      applyTheme(event.matches);
    }
  });
}
