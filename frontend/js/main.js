import { showToast } from "./utils.js";

// Add global unhandled rejection handler
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);

  // Show user-friendly message for critical failures
  if (event.reason?.message?.includes('fetch') || event.reason?.message?.includes('network')) {
    showToast('Network error. Please check your connection.', 'error');
  }

  event.preventDefault();
});

import { initNavigation } from "./navigation.js";
import { initTheme } from "./theme.js";
import { initProjects } from "./projects.js";
import { initExperience } from "./experience.js";
import { initContactForm } from "./form.js";
import { initAnimations } from "./animations.js";
import { initHeroTitle } from "./hero-title.js";
import { initTilt } from "./tilt.js";
import { initTerminal } from "./terminal.js";
import { initAnalytics } from "./analytics.js";
import { initSkillsCarousel } from "./skills-carousel.js";
import { initRipple } from "./ripple.js";
import { initScrollToTop } from "./scroll-to-top.js";
import { initThemeCustomizer } from "./theme-customizer.js";
import { initParticles } from "./particles-config.js";

// Lazy-load chat module on first interaction
let chatLoaded = false;
let chatModulePromise = null;

function loadChatModule() {
  if (chatLoaded) return chatModulePromise;
  chatLoaded = true;
  chatModulePromise = import("./chat.js").then(module => {
    module.initChat();
    return module;
  }).catch(err => {
    chatLoaded = false;
    chatModulePromise = null;
    console.warn('Chat module failed to load:', err);
    return null;
  });
  return chatModulePromise;
}

// Lazy-load activity dashboard when the user opens it
let activityLoaded = false;
let activityModulePromise = null;

function loadActivityModule() {
  if (activityLoaded) return activityModulePromise;
  activityLoaded = true;
  activityModulePromise = import("./activity.js").then(module => {
    module.initActivity();
    return module;
  }).catch(err => {
    activityLoaded = false;
    activityModulePromise = null;
    console.warn('Activity module failed to load:', err);
    return null;
  });
  return activityModulePromise;
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initNavigation();
  initProjects();
  initExperience();
  initContactForm();
  initHeroTitle();
  initAnimations();
  initTilt();
  initTerminal();
  initAnalytics();
  initSkillsCarousel();
  initRipple();
  initScrollToTop();
  initThemeCustomizer();

  // Initialize particle effects on hero section
  const heroSection = document.querySelector('.hero');
  if (heroSection && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const particlesContainer = document.createElement('div');
    particlesContainer.id = 'particles-canvas';
    particlesContainer.style.position = 'absolute';
    particlesContainer.style.top = '0';
    particlesContainer.style.left = '0';
    particlesContainer.style.width = '100%';
    particlesContainer.style.height = '100%';
    particlesContainer.style.pointerEvents = 'none';
    particlesContainer.style.zIndex = '0';
    heroSection.style.position = 'relative';
    heroSection.insertBefore(particlesContainer, heroSection.firstChild);

    const initHeroEffects = () => {
      initParticles('particles-canvas');
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(initHeroEffects);
    } else {
      setTimeout(initHeroEffects, 200);
    }
  }

  // Lazy-load chat on first interaction with chat widget or AI section
  const chatToggle = document.getElementById('chat-toggle-btn');
  const aiSection = document.getElementById('ai');

  // BUG FIX ROOT CAUSE: Lazy-loading click listeners on document run on every click event in the viewport forever.
  // We wrap them with AbortController signals to abort them once the respective module has loaded successfully.
  const chatClickController = new AbortController();
  const loadChat = () => {
    void loadChatModule().then(module => {
      if (module) {
        try {
          chatClickController.abort();
        } catch (e) {}
      }
    });
  };

  chatToggle?.addEventListener('click', loadChat, { once: true });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-target="ai"], a[href="#ai"]')) {
      loadChat();
    }
  }, { capture: true, signal: chatClickController.signal });

  const ensureChatForActiveAiSection = () => {
    if (aiSection?.classList.contains('active') || window.location.hash === '#ai') {
      loadChat();
    }
  };

  if (aiSection) {
    new MutationObserver(ensureChatForActiveAiSection)
      .observe(aiSection, { attributes: true, attributeFilter: ['class'] });
    ensureChatForActiveAiSection();
  }

  const activitySection = document.getElementById('activity');
  const activityClickController = new AbortController();
  const loadActivity = () => {
    void loadActivityModule().then(module => {
      if (module) {
        try {
          activityClickController.abort();
        } catch (e) {}
      }
    });
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-target="activity"], a[href="#activity"]')) {
      loadActivity();
    }
  }, { capture: true, signal: activityClickController.signal });

  const ensureActivityForActiveSection = () => {
    if (activitySection?.classList.contains('active') || window.location.hash === '#activity') {
      loadActivity();
    }
  };

  if (activitySection) {
    new MutationObserver(ensureActivityForActiveSection)
      .observe(activitySection, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('hashchange', ensureActivityForActiveSection, { passive: true });
    ensureActivityForActiveSection();
  }

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
        // Silently degrade - background is non-critical
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
      navigator.serviceWorker.register("/sw.js")
        .then(registration => {
          // Check for updates periodically
          setInterval(() => {
            registration.update();
          }, 60000); // Check every minute

          // Listen for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New service worker available
                showUpdateNotification();
              }
            });
          });
        })
        .catch(console.error);
    });
  }
});

function showUpdateNotification() {
  const updateBanner = document.createElement('div');
  updateBanner.className = 'update-banner';
  updateBanner.setAttribute('role', 'alert');
  updateBanner.innerHTML = `
    <span><i class="fas fa-info-circle"></i> A new version is available!</span>
    <button type="button" class="update-refresh-btn" id="update-refresh-btn">
      <i class="fas fa-sync-alt"></i> Refresh
    </button>
  `;
  updateBanner.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: var(--accent-fill);
    color: var(--on-accent);
    padding: 16px 20px;
    border-radius: var(--radius);
    box-shadow: var(--shadow-xl);
    display: flex;
    align-items: center;
    gap: 16px;
    z-index: 10001;
    animation: slideInUp var(--motion-medium) var(--ease-enter);
  `;

  document.body.appendChild(updateBanner);

  document.getElementById('update-refresh-btn').addEventListener('click', () => {
    window.location.reload();
  });
}
