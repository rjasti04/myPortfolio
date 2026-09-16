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
import { initAppsFilter } from "./apps-filter.js";
import { initExperienceGroups } from "./experience-groups.js";
import { initRipple } from "./ripple.js";
import { initScrollToTop } from "./scroll-to-top.js";
import { initThemeCustomizer, initHomeThemeShuffle } from "./theme-customizer.js";
import { initHomePortrait } from "./home-portrait.js";
import { initParticles } from "./particles-config.js";
import { desktopBackground } from "./config.js";
import { PullToRefresh } from "./swipe-handler.js";

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

/**
 * Runs one initialiser, reporting rather than propagating a failure.
 *
 * These fifteen are independent features, but they used to share a fate: a
 * bare sequence inside one handler means the first throw skips every call
 * after it. `initTheme` reading blocked storage was enough to take out
 * `initAnimations` four calls later, which is what leaves every `.reveal`
 * element - the contact form, both Apps tiles, the About cards - at opacity 0
 * with no error state on screen. A module that cannot start should cost its
 * own feature and nothing else.
 */
function boot(name, init) {
  try {
    init();
  } catch (error) {
    reportClientError(error, { source: "init", at: name });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  boot("theme", initTheme);
  boot("navigation", initNavigation);
  boot("contactForm", initContactForm);
  boot("heroTitle", initHeroTitle);
  boot("animations", initAnimations);
  boot("tilt", initTilt);
  boot("resumePdf", initResumePdf);
  boot("terminal", initTerminal);
  boot("analytics", initAnalytics);
  boot("skillsCarousel", initSkillsCarousel);
  boot("appsFilter", initAppsFilter);
  boot("experienceGroups", initExperienceGroups);
  boot("ripple", initRipple);
  boot("scrollToTop", initScrollToTop);
  boot("themeCustomizer", initThemeCustomizer);
  boot("homeThemeShuffle", initHomeThemeShuffle);
  boot("homePortrait", initHomePortrait);

  // Pull-to-refresh, one implementation for the whole site.
  //
  // The AI panel is a height-locked shell, so the browser's own gesture never
  // reaches it - see PullToRefresh for why - and it used to be the only page
  // with this indicator. Every other section scrolled the document and got
  // Chrome's native version instead: a different spinner, a different
  // threshold, and nothing at all in an installed PWA. Two instances of the
  // same class now cover both, so the pull reads identically wherever it
  // starts, and styles.css turns the native one off for `.js-enabled` so the
  // two can never both fire.
  //
  // Order matters. The AI scroller marks itself `[data-ptr-scroller]` in its
  // constructor and the document instance skips any touch that starts inside
  // one, so the nested scroller has to exist first.
  //
  // Wired here rather than in chat.js because that module is lazy: a visitor
  // landing on /#ai can pull before their first click has loaded it.
  const aiScroller = document.querySelector('#ai .ai-content-area');
  if (aiScroller) {
    new PullToRefresh(aiScroller, () => window.location.reload());
  }

  // scrollingElement is <html> in every browser that has shipped this decade;
  // the fallback is for anything that has not, jsdom included.
  const pageScroller = document.scrollingElement || document.documentElement;
  new PullToRefresh(pageScroller, () => window.location.reload());

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

  // Animated background — desktop only, and then exactly one layer.
  //
  // The full-viewport plexus (three-bg.js) and the hero particle layer render
  // the same effect: drifting nodes joined by proximity lines. Both used to be
  // mounted unconditionally, stacking two independently animated canvases over
  // the hero. The plexus is the richer of the two, so it takes capable desktops
  // and the hero layer becomes the cheap fallback for the rest.
  //
  // Neither runs on phones or tablets: `desktopBackground` requires a fine
  // pointer and a >=1024px viewport, so a coarse-pointer device gets a plain
  // gradient and never pays for a second animated canvas. styles.css hides both
  // canvases under the same condition.
  //
  // Neither runs on #home either, on ANY device. The landing view has a ground
  // of its own - the schematic backdrop in styles.css - and a plexus over it
  // reads as a second drawing rather than as depth. That is a route rule, not
  // a device rule, so it is checked here and again in three-bg.js rather than
  // being left to the stylesheet: a hidden canvas still burns a rAF loop.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let destroyHeroParticles = null;

  const homeIsActive = () =>
    document.getElementById('home')?.classList.contains('active') ?? false;

  const canAffordPlexus = () => {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    return cores >= 2 && memory >= 3;
  };

  const mountHeroParticles = () => {
    // `.home-hero` first, `.hero` only as the fallback. `.hero` is the About
    // section's two-column terminal layout; #home took over as the landing
    // view and brought its own `.home-hero`. Querying `.hero` alone mounted
    // the whole fallback field inside a `display: none` section, so every
    // device that failed canAffordPlexus() - the low-core desktops this tier
    // exists for - opened on a bare gradient and never saw a background at
    // all. The container is `position: absolute; inset: 0`, so it needs a
    // positioned ancestor either way; both hosts get one below.
    const heroSection = document.querySelector('.home-hero') || document.querySelector('.hero');
    if (!heroSection || destroyHeroParticles) return;

    // ...and `.home-hero` is inside #home, which is flat on every device now.
    // A field mounted there animates under a canvas the stylesheet hides, and
    // on every other route the router keeps #home at `display: none`, so there
    // is no view in which it would be seen. Refuse the host rather than pay
    // for an rAF loop with no visible output. The module stays wired up for a
    // host outside #home if one is ever added.
    if (heroSection.closest('#home')) return;

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
    if (!desktopBackground.matches) return;
    if (homeIsActive()) return;

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

  // #home is where nearly every visit starts, so the mount has to be able to
  // happen on the way OUT of it. loadBackground() is the only importer of
  // three-bg.js, so without this a visitor who landed on the hash-less root
  // would never see the plexus on any section. Leaving home mounts; entering it
  // tears the fallback down. three-bg.js owns the same listeners for its own
  // canvas and needs nothing from here beyond that first import.
  const syncBackgroundForRoute = () => {
    if (!homeIsActive()) {
      loadBackground();
      return;
    }
    destroyHeroParticles?.();
    destroyHeroParticles = null;
  };

  window.addEventListener('section-changed', syncBackgroundForRoute);
  window.addEventListener('hashchange', syncBackgroundForRoute, { passive: true });

  // Reduced motion can be toggled mid-session; tear the fallback down when it is.
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    destroyHeroParticles?.();
    destroyHeroParticles = null;
  });

  // The desktop threshold is crossed mid-session too - a window resized down, a
  // tablet docked to a mouse. Tear the fallback down on the way out and mount on
  // the way in; three-bg.js listens for the same query and owns its own canvas,
  // but it is only imported from here, so the first crossing has to trigger that
  // import as well.
  desktopBackground.addEventListener('change', () => {
    if (desktopBackground.matches) {
      loadBackground();
      return;
    }
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
          // Check for updates on a long timer, and whenever the tab comes
          // back to the foreground.
          //
          // This used to be a flat 60s interval that ran regardless of
          // visibility and was never cleared, so a tab left open for an hour
          // made 60 requests re-fetching and re-validating /sw.js - most of
          // them while hidden, none of them of any use to a visitor who is
          // not looking. On a phone that is pure battery and data.
          //
          // A foreground check is what actually matters: a returning visitor
          // gets the new version immediately, and the slow timer is only
          // there for a tab that stays open and focused for a long stretch.
          const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
          let lastUpdateCheck = Date.now();
          const checkForUpdate = () => {
            lastUpdateCheck = Date.now();
            registration.update();
          };

          setInterval(() => {
            if (document.hidden) return;
            checkForUpdate();
          }, UPDATE_INTERVAL_MS);

          document.addEventListener("visibilitychange", () => {
            if (document.hidden) return;
            // Debounced by the same interval, so flicking between tabs does
            // not turn into a request per switch.
            if (Date.now() - lastUpdateCheck < UPDATE_INTERVAL_MS) return;
            checkForUpdate();
          });

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

// One banner for the life of the page. `registration.update()` runs every
// minute, so every further `updatefound` used to append ANOTHER banner - each
// carrying the same id="update-refresh-btn", so the getElementById below bound
// to the first one and the newest banner's Refresh button did nothing.
let updateBanner = null;

function showUpdateNotification(registration) {
  if (updateBanner) {
    // Already offering the update; the newest waiting worker is the one to
    // activate, so just re-point the handler at it.
    updateBanner.dataset.registrationPending = "true";
    return;
  }

  updateBanner = document.createElement('div');
  updateBanner.className = 'update-banner';
  updateBanner.setAttribute('role', 'alert');

  const text = document.createElement('span');
  text.innerHTML = '<i class="fas fa-info-circle" aria-hidden="true"></i> A new version is available!';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'update-refresh-btn';
  refreshBtn.innerHTML = '<i class="fas fa-sync-alt" aria-hidden="true"></i> Refresh';

  // The banner sits over the chat toggle at the bottom-right corner and used
  // to have no way out short of reloading - which is precisely the thing the
  // visitor was declining to do.
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'update-dismiss-btn';
  dismissBtn.setAttribute('aria-label', 'Dismiss update notice');
  dismissBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';

  updateBanner.append(text, refreshBtn, dismissBtn);
  document.body.appendChild(updateBanner);

  // Bound to the element, not re-looked-up by id.
  refreshBtn.addEventListener('click', () => {
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

  dismissBtn.addEventListener('click', () => {
    updateBanner?.remove();
    updateBanner = null;
  });
}
