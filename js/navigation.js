import { compactViewport, prefersReducedMotion, supportsHover } from "./config.js";
import { closeModal, openModal } from "./modal.js";
import { onOnline, onOffline, isNetworkOnline } from "./utils.js";
import { SwipeHandler } from "./swipe-handler.js";

let hamburger, navMenu, navLinks, sections, imageModal, imageModalCloseButton, profileTrigger;

function setMobileMenuState(isOpen) {
  if (!navMenu || !hamburger) return;

  if (isOpen) {
    navMenu.classList.add("show-menu");
    document.body.style.overflow = 'hidden';
  } else {
    navMenu.classList.remove("show-menu");
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

function closeAllDropdowns() {
  document.querySelectorAll('.header-dropdown.is-open').forEach(dropdown => {
    dropdown.classList.remove('is-open');
    dropdown.querySelector('button')?.setAttribute('aria-expanded', 'false');
    dropdown.querySelector('.header-dropdown-menu')?.setAttribute('aria-hidden', 'true');
  });
}

function closeTransientUi() {
  setMobileMenuState(false);
  closeAllDropdowns();
}

export function setActiveSection(target) {
  if (!target || !window.AppLogic?.setActiveSection) return;
  window.AppLogic.setActiveSection(target, sections, navLinks);
}

export function navigateToSection(target, { updateHash = true } = {}) {
  if (!target) return;
  closeTransientUi();
  const projectDetailModal = document.getElementById("project-detail-modal");
  closeModal(projectDetailModal, { restoreFocus: false });
  setActiveSection(target);

  if (updateHash) {
    const nextHash = `#${target}`;
    if (window.location.hash !== nextHash) history.pushState(null, "", nextHash);
  }

  window.scrollTo({ top: 0, behavior: prefersReducedMotion.matches ? "auto" : "smooth" });
}

export function syncSectionWithHash(hash = window.location.hash) {
  if (!window.AppLogic?.getValidHashTarget) return;
  const target = window.AppLogic.getValidHashTarget(hash, (id) => document.getElementById(id), "about");
  setActiveSection(target);
}

export function initNavigation() {
  hamburger = document.getElementById("hamburger-toggle");
  navMenu = document.getElementById("nav-menu");
  navLinks = Array.from(document.querySelectorAll("nav a[data-target]"));
  sections = Array.from(document.querySelectorAll("main section"));
  imageModal = document.getElementById("image-modal");
  imageModalCloseButton = document.getElementById("image-modal-close");
  profileTrigger = document.getElementById("profile-trigger");

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
      }
    });
  });

  document.addEventListener("click", (event) => {
    document.querySelectorAll('.header-dropdown.is-open').forEach(dropdown => {
      if (!dropdown.contains(event.target)) {
        dropdown.classList.remove('is-open');
        dropdown.querySelector('button')?.setAttribute('aria-expanded', 'false');
        dropdown.querySelector('.header-dropdown-menu')?.setAttribute('aria-hidden', 'true');
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTransientUi();
  });

  profileTrigger?.addEventListener("click", (event) => {
    event.preventDefault();
    openModal(imageModal, { initialFocus: imageModalCloseButton || imageModal });
  });

  imageModalCloseButton?.addEventListener("click", () => closeModal(imageModal));
  imageModal?.addEventListener("click", (event) => {
    if (event.target === imageModal) closeModal(imageModal);
  });

  window.addEventListener("hashchange", () => syncSectionWithHash());
  window.addEventListener("popstate", () => syncSectionWithHash());

  if (typeof compactViewport.addEventListener === "function") {
    compactViewport.addEventListener("change", (event) => {
      if (!event.matches) setMobileMenuState(false);
    });
  }

  syncSectionWithHash();

  // Initialize mobile bottom navigation
  initMobileBottomNav();

  // Initialize swipe gestures for mobile
  if (compactViewport.matches) {
    initSwipeGestures();
  }

  // Compact header on scroll
  const headerEl = document.getElementById("header");
  if (headerEl) {
    let scrollTicking = false;
    const onScroll = () => {
      if (!scrollTicking) {
        requestAnimationFrame(() => {
          headerEl.classList.toggle("scrolled", window.scrollY > 32);

          // Update scroll progress bar
          const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
          const scrollProgress = (window.scrollY / scrollHeight) * 100;
          headerEl.style.setProperty('--scroll-progress', `${Math.min(scrollProgress, 100)}%`);

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
    background: var(--color-warning);
    color: var(--on-warning);
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
  if (supportsHover.matches) {
    navLinks.forEach((link, index) => {
      const kbd = document.createElement("kbd");
      kbd.className = "nav-shortcut";
      // BUG FIX ROOT CAUSE: Guide numbers inside kbd tag are announced by screen readers, creating audio noise
      // (e.g. "About one, link"). We set aria-hidden="true" so screen readers ignore the helper number.
      kbd.setAttribute("aria-hidden", "true");
      kbd.textContent = String(index + 1);
      link.appendChild(kbd);
    });
  }

  // Number key navigation (1-5)
  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= navLinks.length) {
      event.preventDefault();
      const target = navLinks[num - 1]?.dataset.target;
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
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

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

  const navItems = [
    { target: 'about', icon: 'fa-home', label: 'Home' },
    { target: 'portfolio', icon: 'fa-briefcase', label: 'Work' },
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
  const currentSection = document.querySelector('main section.active')?.id || 'about';
  updateMobileNavActive(currentSection);
}

function updateMobileNavActive(target) {
  const mobileNav = document.querySelector('.mobile-bottom-nav');
  if (!mobileNav) return;

  mobileNav.querySelectorAll('a').forEach(link => {
    const isActive = link.dataset.target === target;
    link.classList.toggle('active', isActive);
  });
}

function initSwipeGestures() {
  const sectionOrder = ['about', 'resume', 'portfolio', 'hobbies', 'activity', 'ai', 'contact'];

  new SwipeHandler({
    threshold: 75,
    onSwipeLeft: () => {
      const currentSection = document.querySelector('main section.active')?.id;
      const currentIndex = sectionOrder.indexOf(currentSection);
      if (currentIndex < sectionOrder.length - 1) {
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
