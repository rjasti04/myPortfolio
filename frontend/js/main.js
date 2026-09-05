import { showToast } from "./utils.js";
import { reportClientError } from "./error-handler.js";

// Uncaught synchronous errors. Nothing listened for these at all, so a thrown
// exception during init - the kind that leaves half the page inert - was
// visible only to whoever had devtools open at the time.
window.addEventListener("error", (event) => {
  reportClientError(event.error ?? event.message, {
    source: "onerror",
    at: `${event.filename ?? ""}:${event.lineno ?? 0}`,
  });
});

// Global unhandled rejection handler.
//
// `preventDefault()` is what tells the browser the rejection was handled, so
// calling it unconditionally suppressed *every* unhandled rejection from the
// console and from window.onerror. Nothing reports errors to the server either,
// so production failures were invisible to everyone. Only suppress the case
// actually handled here - the one that shows the user a toast.
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  reportClientError(event.reason, { source: 'unhandledrejection' });

  const message = String(event.reason?.message ?? event.reason ?? '');
  if (/fetch|network/i.test(message)) {
    showToast('Network error. Please check your connection.', 'error');
    event.preventDefault();
  }
});

import { initNavigation } from "./navigation.js";
import { initTheme } from "./theme.js";
import { initContactForm } from "./form.js";
import { initAnimations } from "./animations.js";
import { initHeroTitle } from "./hero-title.js";
import { initTilt } from "./tilt.js";
import { initResumePdf } from "./resume-pdf.js";
import { initTerminal } from "./terminal/index.js";
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
  initContactForm();
  initHeroTitle();
  initAnimations();
  initTilt();
  initResumePdf();
  initTerminal();
  initAnalytics();
  initSkillsCarousel();
  initRipple();
  initScrollToTop();
  initThemeCustomizer();

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

  // Animated background — exactly one layer, chosen by device capability.
  //
  // The full-viewport plexus (three-bg.js) and the hero particle layer render
  // the same effect: drifting nodes joined by proximity lines. Both used to be
  // mounted unconditionally, stacking two independently animated canvases over
  // the hero. The plexus is the richer of the two, so it takes capable devices
  // and the hero layer becomes the cheap fallback for everything else.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let destroyHeroParticles = null;

  const canAffordPlexus = () => {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    const isMobileViewport = window.matchMedia('(pointer: coarse) and (max-width: 768px)').matches;
    return (isMobileViewport ? cores >= 4 : cores >= 2) && memory >= 3;
  };

  const mountHeroParticles = () => {
    // `.home-hero` first, `.hero` only as the fallback. `.hero` is the About
    // section's two-column terminal layout; #home took over as the landing
    // view and brought its own `.home-hero`. Querying `.hero` alone mounted
    // the whole fallback field inside a `display: none` section, so every
    // device that failed canAffordPlexus() - the mid-range phones this tier
    // exists for - opened on a bare gradient and never saw a background at
    // all. The container is `position: absolute; inset: 0`, so it needs a
    // positioned ancestor either way; both hosts get one below.
    const heroSection = document.querySelector('.home-hero') || document.querySelector('.hero');
    if (!heroSection || destroyHeroParticles) return;

    let particlesContainer = document.getElementById('particles-canvas');
    if (!particlesContainer) {
      particlesContainer = document.createElement('div');
      particlesContainer.id = 'particles-canvas';
      particlesContainer.style.position = 'absolute';
      particlesContainer.style.inset = '0';
      particlesContainer.style.pointerEvents = 'none';
      particlesContainer.style.zIndex = '0';
      heroSection.style.position = 'relative';
      heroSection.insertBefore(particlesContainer, heroSection.firstChild);
    }

    destroyHeroParticles = initParticles('particles-canvas');
  };

  const loadBackground = () => {
    if (reducedMotion.matches) return;

    if (canAffordPlexus()) {
      // three-bg.js mounts itself on import and manages its own reduced-motion
      // and viewport-profile listeners.
      import("../three-bg.js").catch(err => {
        console.warn('Plexus background failed to load; falling back:', err);
        mountHeroParticles();
      });
      return;
    }

    mountHeroParticles();
  };

  // Reduced motion can be toggled mid-session; tear the fallback down when it is.
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    destroyHeroParticles?.();
    destroyHeroParticles = null;
  });

  if ("requestIdleCallback" in window) {
    requestIdleCallback(loadBackground, { timeout: 2000 });
  } else {
    setTimeout(loadBackground, 200);
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
                showUpdateNotification(registration);
              }
            });
          });
        })
        .catch(console.error);
    });
  }
});

function showUpdateNotification(registration) {
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
    // Tell the waiting worker to take over, then reload once it has. The worker
    // used to call skipWaiting() during install, so it activated before this
    // banner was ever shown and a plain reload could still land on the old
    // asset set.
    const waiting = registration?.waiting;
    if (waiting) {
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  });
}
