import { initNavigation } from "./navigation.js";
import { initTheme } from "./theme.js";
import { initProjects } from "./projects.js";
import { initContactForm } from "./form.js";
import { initAnimations } from "./animations.js";
import { initTilt } from "./tilt.js";
import { initTerminal } from "./terminal.js";
import { initAnalytics } from "./analytics.js";
import { initActivity } from "./activity.js";
import { initSkillsCarousel } from "./skills-carousel.js";
import { initRipple } from "./ripple.js";
import { initScrollToTop } from "./scroll-to-top.js";
import { initThemeCustomizer } from "./theme-customizer.js";

// Lazy-load chat module on first interaction
let chatLoaded = false;
function loadChatModule() {
  if (chatLoaded) return;
  chatLoaded = true;
  import("./chat.js").then(module => {
    module.initChat();
  }).catch(err => {
    console.warn('Chat module failed to load:', err);
  });
}

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
  initSkillsCarousel();
  initRipple();
  initScrollToTop();
  initThemeCustomizer();

  // Lazy-load chat on first interaction with chat widget or AI section
  const chatToggle = document.getElementById('chat-toggle-btn');
  const aiSection = document.getElementById('ai');
  const heroChatBtn = document.getElementById('hero-chat-btn');
  
  const loadChat = () => {
    loadChatModule();
    // Remove listeners after first load
    chatToggle?.removeEventListener('click', loadChat);
    aiSection?.removeEventListener('mouseenter', loadChat);
    heroChatBtn?.removeEventListener('click', loadChat);
  };
  
  chatToggle?.addEventListener('click', loadChat, { once: true });
  aiSection?.addEventListener('mouseenter', loadChat, { once: true });
  heroChatBtn?.addEventListener('click', loadChat, { once: true });

  // Defer Three.js background for faster initial paint
  // Only load on capable devices to avoid performance issues
  const loadThreeBackground = () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    const isMobileViewport = window.matchMedia('(pointer: coarse) and (max-width: 768px)').matches;
    const hasGoodHardware = isMobileViewport ? cores >= 4 : cores >= 2;
    const hasEnoughMemory = memory >= 3;
    
    if (!prefersReducedMotion && hasGoodHardware && hasEnoughMemory) {
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
