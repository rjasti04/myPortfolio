import { compactViewport, mobileDevice, prefersReducedMotion, supportsHover } from "./config.js";
import { handleFocusTrap } from "./modal.js";
import { onOnline, onOffline, isNetworkOnline } from "./utils.js";
import { SwipeHandler } from "./swipe-handler.js";

let hamburger, navMenu, navLinks, sections;

/**
 * True while any dialog is on screen.
 *
 * `.pdf-modal` is shown by modal.js adding `.active`; the auth modal is a
 * separate implementation that toggles `.hidden` instead. Keyboard shortcuts
 * have to respect both, or they fire through an open dialog.
 */
function isModalOpen() {
  return Boolean(
    document.querySelector(".pdf-modal.active") ||
      document.querySelector("#auth-modal:not(.hidden)")
  );
}

/** True when focus is somewhere the user is typing, so single keys are text. */
function isTypingTarget(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function setMobileMenuState(isOpen) {
  if (!navMenu || !hamburger) return;

  if (isOpen) {
    navMenu.classList.add("show-menu");
    navMenu.setAttribute("aria-hidden", "false");
    document.body.style.overflow = 'hidden';
  } else {
    navMenu.classList.remove("show-menu");
    navMenu.setAttribute("aria-hidden", "true");
    document.body.style.overflow = '';
  }

  hamburger.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("nav-open", Boolean(isOpen) && compactViewport.matches);

  const icon = hamburger.querySelector("i");
  if (icon) {
    icon.classList.toggle("fa-bars", !isOpen);
    icon.classList.toggle("fa-times", isOpen);
  }
}

export function closeAllDropdowns() {
  document.querySelectorAll('.header-dropdown.is-open').forEach(dropdown => {
    dropdown.classList.remove('is-open');
    dropdown.querySelector('button')?.setAttribute('aria-expanded', 'false');
    dropdown.querySelector('.header-dropdown-menu')?.setAttribute('aria-hidden', 'true');
  });

  const userDropdown = document.getElementById('nav-user-dropdown');
  const userBtn = document.getElementById('nav-user-btn');
  if (userDropdown) {
    userDropdown.classList.remove('show');
  }
  if (userBtn) {
    userBtn.setAttribute('aria-expanded', 'false');
  }

  document.body.classList.remove('dropdown-open');
}

function closeTransientUi() {
  setMobileMenuState(false);
  closeAllDropdowns();
}

/**
 * Retires the pre-boot router's marker.
 *
 * The inline script in index.html marks the section it activated
 * `is-boot-target`, which suppresses the entrance animation - that section is
 * the page as loaded, not a transition into it. The marker has to outlive this
 * module's own first sync, which re-applies the very same target, and die on
 * the first real navigation. `nav-ready` lands between the two, so it is the
 * flag that tells them apart.
 */
function clearBootTarget() {
  if (!document.documentElement.classList.contains("nav-ready")) return;
  document.querySelector("section.is-boot-target")?.classList.remove("is-boot-target");
}

export function setActiveSection(target) {
  if (!target || !window.AppLogic?.setActiveSection) return;
  clearBootTarget();
  window.AppLogic.setActiveSection(target, sections, navLinks);
  updateMobileNavActive(target);
  window.dispatchEvent(new CustomEvent("section-changed", { detail: { target } }));
}

export function navigateToSection(target, { updateHash = true } = {}) {
  if (!target) return;
  closeTransientUi();
  setActiveSection(target);

  if (updateHash) {
    const nextHash = `#${target}`;
    if (window.location.hash !== nextHash) history.pushState(null, "", nextHash);
  }

  window.scrollTo({ top: 0, behavior: prefersReducedMotion.matches ? "auto" : "smooth" });
}

export function syncSectionWithHash(hash = window.location.hash) {
  if (!window.AppLogic?.getValidHashTarget) return;
  const target = window.AppLogic.getValidHashTarget(hash, (id) => document.getElementById(id), "home");
  setActiveSection(target);
}

export function initNavigation() {
  hamburger = document.getElementById("hamburger-toggle");
  navMenu = document.getElementById("nav-menu");
  navLinks = Array.from(document.querySelectorAll("nav a[data-target]"));
  sections = Array.from(document.querySelectorAll("main section"));

  if (hamburger) {
    hamburger.addEventListener("click", (event) => {
      event.stopPropagation();
      const isCurrentlyOpen = navMenu?.classList.contains("show-menu");
      setMobileMenuState(!isCurrentlyOpen);
      if (!isCurrentlyOpen) {
        closeAllDropdowns();
      }
    });
  }

  const navMenuClose = document.getElementById("nav-menu-close");
  if (navMenuClose) {
    navMenuClose.addEventListener("click", (event) => {
      event.stopPropagation();
      setMobileMenuState(false);
      hamburger?.focus();
    });
  }

  const themeCustomizerClose = document.getElementById("theme-customizer-close");
  if (themeCustomizerClose) {
    themeCustomizerClose.addEventListener("click", (event) => {
      event.stopPropagation();
      closeAllDropdowns();
      document.getElementById("palette-toggle")?.focus();
    });
  }

  // Close menu when clicking on backdrop
  document.addEventListener("click", (event) => {
    if (navMenu?.classList.contains("show-menu")) {
      const isClickInsideMenu = navMenu.contains(event.target);
      const isClickOnHamburger = hamburger?.contains(event.target);

      if (!isClickInsideMenu && !isClickOnHamburger) {
        setMobileMenuState(false);
      }
    }
  });

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateToSection(link.dataset.target);
    });
  });

  document.querySelectorAll("a.nav-cta[data-target]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateToSection(link.dataset.target);
    });
  });

  document.querySelectorAll(".logo-text[data-target], #logo-home-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateToSection(link.dataset.target || "home");
    });
  });

  // Generic Dropdown Logic
  const dropdownToggles = document.querySelectorAll('.header-dropdown > button');
  dropdownToggles.forEach(toggle => {
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      const dropdown = toggle.closest('.header-dropdown');
      const menu = dropdown.querySelector('.header-dropdown-menu');
      const isOpen = dropdown.classList.contains('is-open');

      closeAllDropdowns();
      setMobileMenuState(false);

      if (!isOpen) {
        dropdown.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
        if (menu) menu.setAttribute('aria-hidden', 'false');
        document.body.classList.add('dropdown-open');

        // Move focus into the panel. Opening one used to leave focus on the
        // toggle, so a keyboard user had to Tab forward blindly and could not
        // tell the panel had opened at all. Escape already returns focus here.
        // rAF because the panel transitions from visibility:hidden and cannot
        // take focus until that has applied.
        if (menu) {
          requestAnimationFrame(() => {
            const target = menu.querySelector(
              'input:not([type="hidden"]):not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            );
            target?.focus();
          });
        }
      }
    });
  });

  document.addEventListener("click", (event) => {
    const userDropdown = document.getElementById('nav-user-dropdown');
    const userBtn = document.getElementById('nav-user-btn');
    if (userDropdown && !userDropdown.contains(event.target) && (!userBtn || !userBtn.contains(event.target))) {
      userDropdown.classList.remove('show');
      userBtn?.setAttribute('aria-expanded', 'false');
    }

    let hasOpenDropdown = false;
    document.querySelectorAll('.header-dropdown.is-open').forEach(dropdown => {
      if (!dropdown.contains(event.target)) {
        dropdown.classList.remove('is-open');
        dropdown.querySelector('button')?.setAttribute('aria-expanded', 'false');
        dropdown.querySelector('.header-dropdown-menu')?.setAttribute('aria-hidden', 'true');
      } else {
        hasOpenDropdown = true;
      }
    });

    if (!hasOpenDropdown) {
      document.body.classList.remove('dropdown-open');
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openDropdown = document.querySelector('.header-dropdown.is-open');
      const openToggle = openDropdown?.querySelector('button');
      closeTransientUi();
      openToggle?.focus();
      return;
    }

    // Trap Tab inside an open panel. The theme customiser in particular is a
    // whole form - presets, three colour buttons, a nested popover, Apply and
    // Reset - and Tab used to walk straight out of it into the page behind.
    if (event.key === "Tab") {
      const openDropdown = document.querySelector('.header-dropdown.is-open');
      const menu = openDropdown?.querySelector('.header-dropdown-menu');
      if (menu) handleFocusTrap(event, menu);
    }
  });

  window.addEventListener("hashchange", () => syncSectionWithHash());
  window.addEventListener("popstate", () => syncSectionWithHash());

  if (typeof compactViewport.addEventListener === "function") {
    compactViewport.addEventListener("change", (event) => {
      if (!event.matches) setMobileMenuState(false);
    });
  }

  syncSectionWithHash();

  // The router is live from here, so the pre-boot `:target` guard in
  // styles.css - which hides #home while the markup still says it is the
  // active section - has to stop applying: pushState leaves :target stale in
  // some browsers, and a stale match would hide whatever the router activated
  // next. See the SECTION ROUTER region for the pair of rules.
  document.documentElement.classList.add("nav-ready");

  // Initialize mobile bottom navigation
  initMobileBottomNav();

  // Swipe navigation, phones only.
  //
  // Was gated on compactViewport (<=1150px), so horizontal swipes navigated
  // sections on 1024px laptops and tablets with trackpads. `mobileDevice` is
  // the query that actually means "phone" - coarse pointer AND <=768px - and
  // is what chat.js already uses for its drawer layout.
  //
  // Re-evaluated on change, too: this ran once at load, so rotating a tablet
  // into portrait never enabled it and rotating out never disabled it.
  let swipeGestures = null;
  const syncSwipeGestures = () => {
    if (mobileDevice.matches && !swipeGestures) {
      swipeGestures = initSwipeGestures();
    } else if (!mobileDevice.matches && swipeGestures) {
      swipeGestures.destroy();
      swipeGestures = null;
    }
  };
  syncSwipeGestures();
  mobileDevice.addEventListener("change", syncSwipeGestures);

  // Compact header on scroll
  const headerEl = document.getElementById("header");
  if (headerEl) {
    let scrollTicking = false;
    const onScroll = () => {
      if (!scrollTicking) {
        requestAnimationFrame(() => {
          headerEl.classList.toggle("scrolled", window.scrollY > 32);
          scrollTicking = false;
        });
        scrollTicking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Force scroll to top on initial load if landing on home or #about
  const currentHash = window.location.hash;
  if (!currentHash || currentHash === "#about") {
    window.scrollTo(0, 0);
  }

  // Offline indicator
  const offlineBanner = document.createElement('div');
  offlineBanner.className = 'offline-banner';
  offlineBanner.setAttribute('role', 'alert');
  offlineBanner.innerHTML = '<i class="fas fa-wifi" style="text-decoration: line-through;"></i> You are offline';
  offlineBanner.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 24px;
    background: #fde68a;
    color: #0f172a;
    padding: 12px 20px;
    border-radius: var(--radius-full);
    font-size: 14px;
    font-weight: 600;
    box-shadow: var(--shadow-lg);
    z-index: 10000;
    transform: translateY(150%);
    transition: transform var(--motion-medium) var(--ease-standard);
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  document.body.appendChild(offlineBanner);

  function showOfflineBanner() {
    offlineBanner.style.transform = 'translateY(0)';
  }

  function hideOfflineBanner() {
    offlineBanner.style.transform = 'translateY(150%)';
  }

  if (!isNetworkOnline()) {
    showOfflineBanner();
  }

  onOffline(showOfflineBanner);
  onOnline(hideOfflineBanner);

  // Feature 4: Keyboard shortcut hints on nav links
  const visibleNavLinks = navLinks.filter((link) => !link.hasAttribute("hidden") && link.style.display !== "none");

  if (supportsHover.matches) {
    visibleNavLinks.forEach((link, index) => {
      const kbd = document.createElement("kbd");
      kbd.className = "nav-shortcut";
      // BUG FIX ROOT CAUSE: Guide numbers inside kbd tag are announced by screen readers, creating audio noise
      // (e.g. "About one, link"). We set aria-hidden="true" so screen readers ignore the helper number.
      kbd.setAttribute("aria-hidden", "true");
      kbd.textContent = String(index + 1);
      link.appendChild(kbd);
    });
  }

  // Number key navigation
  document.addEventListener("keydown", (event) => {
    // A number pressed over an open dialog used to change the section behind
    // it: the modal stayed up, the body stayed scroll-locked, and closing it
    // later restored a scroll offset from a section the user had left.
    if (isModalOpen()) return;
    if (isTypingTarget(document.activeElement)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= visibleNavLinks.length) {
      event.preventDefault();
      const target = visibleNavLinks[num - 1]?.dataset.target;
      if (target) navigateToSection(target);
    }
  });

  // Feature: Keyboard overlay toggle
  const overlay = document.getElementById("keyboard-overlay");
  const closeBtn = document.getElementById("close-overlay-btn");

  if (overlay && closeBtn) {
    const toggleOverlay = () => {
      const isActive = overlay.classList.contains("active");
      if (isActive) {
        overlay.classList.remove("active");
        overlay.setAttribute("aria-hidden", "true");
      } else {
        overlay.classList.add("active");
        overlay.setAttribute("aria-hidden", "false");
      }
    };

    document.addEventListener("keydown", (event) => {
      if (isTypingTarget(document.activeElement)) return;
      // Opening the shortcut overlay on top of a dialog stacks two things
      // competing for Escape.
      if (isModalOpen() && !overlay.classList.contains("active")) return;

      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        toggleOverlay();
      }

      if (event.key === "Escape" && overlay.classList.contains("active")) {
        event.preventDefault();
        toggleOverlay();
      }
    });

    closeBtn.addEventListener("click", toggleOverlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) toggleOverlay();
    });
  }
}

function initMobileBottomNav() {
  // Create mobile bottom navigation
  const mobileNav = document.createElement('nav');
  mobileNav.className = 'mobile-bottom-nav';
  mobileNav.setAttribute('aria-label', 'Mobile navigation');

  // Every section a visitor can reach, with the same icon, label, and order as
  // the header nav - the About entry read "Home" behind a house icon here while
  // the header called it "About" behind a person, so the two bars disagreed
  // about what the first section was.
  //
  // This listed four of the six, so Hobbies and Activity were reachable on a
  // phone only through the hamburger - and on a phone the bottom bar *is* the
  // navigation.
  //
  // Eight entries since Apps joined the header nav. At 320px, the narrowest
  // width still worth supporting, `flex: 1 1 0` divides the bar into 40px
  // columns - 36px of content box once padding is taken, and too narrow for
  // "Activity" at the default label size. The <=380px block in the MOBILE
  // BOTTOM NAV region drops the label ramp to fit. That block is now sized for
  // eight and has no headroom left: a ninth entry needs an overflow affordance,
  // not a further shrink.
  //
  // Portfolio is deliberately absent: its nav link is still `hidden` pending
  // the decision recorded as BUG-02.
  const navItems = [
    { target: 'home', icon: 'fa-home', label: 'Home' },
    { target: 'about', icon: 'fa-user', label: 'About' },
    { target: 'resume', icon: 'fa-briefcase', label: 'Work' },
    { target: 'hobbies', icon: 'fa-heart', label: 'Hobbies' },
    { target: 'apps', icon: 'fa-cubes', label: 'Apps' },
    { target: 'activity', icon: 'fa-chart-line', label: 'Activity' },
    { target: 'ai', icon: 'fa-robot', label: 'AI' },
    { target: 'contact', icon: 'fa-envelope', label: 'Contact' }
  ];

  navItems.forEach(item => {
    const link = document.createElement('a');
    link.href = `#${item.target}`;
    link.dataset.target = item.target;
    link.innerHTML = `
      <i class="fas ${item.icon}"></i>
      <span class="mobile-bottom-nav-label">${item.label}</span>
    `;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToSection(item.target);
      updateMobileNavActive(item.target);
    });

    mobileNav.appendChild(link);
  });

  document.body.appendChild(mobileNav);

  // Set initial active state
  const currentSection = document.querySelector('main section.active')?.id || 'home';
  updateMobileNavActive(currentSection);
}

function updateMobileNavActive(target) {
  const mobileNav = document.querySelector('.mobile-bottom-nav');
  if (!mobileNav) return;

  mobileNav.querySelectorAll('a').forEach(link => {
    const isActive = link.dataset.target === target;
    link.classList.toggle('active', isActive);

    // This bar is the whole navigation on a phone, and the current section was
    // signalled only by colour and a 3px rule - nothing a screen reader could
    // read. The header nav has carried aria-current since app-logic.js:13; the
    // bar is built after initNavigation() captures `navLinks`, so it is not in
    // that list and has to set it here.
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function initSwipeGestures() {
  const sectionOrder = ['home', 'about', 'resume', 'hobbies', 'apps', 'activity', 'ai', 'contact'];

  // Returned so the caller can tear it down when the viewport stops being a
  // phone; the handler binds to document, so leaving it attached would keep
  // navigating sections on a resized desktop window.
  return new SwipeHandler({
    threshold: 75,
    onSwipeLeft: () => {
      const currentSection = document.querySelector('main section.active')?.id;
      const currentIndex = sectionOrder.indexOf(currentSection);
      if (currentIndex !== -1 && currentIndex < sectionOrder.length - 1) {
        const nextSection = sectionOrder[currentIndex + 1];
        navigateToSection(nextSection);
        updateMobileNavActive(nextSection);
      }
    },
    onSwipeRight: () => {
      const currentSection = document.querySelector('main section.active')?.id;
      const currentIndex = sectionOrder.indexOf(currentSection);
      if (currentIndex > 0) {
        const prevSection = sectionOrder[currentIndex - 1];
        navigateToSection(prevSection);
        updateMobileNavActive(prevSection);
      }
    }
  });
}
