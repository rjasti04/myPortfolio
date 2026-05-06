import { compactViewport, prefersReducedMotion, supportsHover } from "./config.js";
import { closeModal, openModal } from "./modal.js";

let hamburger, navMenu, navLinks, sections, connectDropdown, connectToggle, connectMenu, imageModal, imageModalCloseButton, profileTrigger;

function setMobileMenuState(isOpen) {
  if (!navMenu || !hamburger) return;
  navMenu.classList.toggle("show-menu", isOpen);
  hamburger.setAttribute("aria-expanded", String(isOpen));
  document.body.classList.toggle("nav-open", Boolean(isOpen) && compactViewport.matches);

  const icon = hamburger.querySelector("i");
  if (icon) {
    icon.classList.toggle("fa-bars", !isOpen);
    icon.classList.toggle("fa-times", isOpen);
  }
}

function setConnectMenuState(isOpen) {
  if (!connectDropdown || !connectToggle || !connectMenu) return;
  connectDropdown.classList.toggle("open", isOpen);
  connectToggle.setAttribute("aria-expanded", String(isOpen));
  connectMenu.setAttribute("aria-hidden", String(!isOpen));
}

function closeTransientUi() {
  setMobileMenuState(false);
  setConnectMenuState(false);
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
  connectDropdown = document.getElementById("connect-dropdown");
  connectToggle = document.getElementById("connect-toggle");
  connectMenu = document.getElementById("connect-dropdown-menu");
  imageModal = document.getElementById("image-modal");
  imageModalCloseButton = document.getElementById("image-modal-close");
  profileTrigger = document.getElementById("profile-trigger");

  if (hamburger) {
    hamburger.addEventListener("click", () => setMobileMenuState(!navMenu?.classList.contains("show-menu")));
  }

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

  connectToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    setConnectMenuState(!connectDropdown.classList.contains("open"));
  });

  connectMenu?.addEventListener("click", (event) => event.stopPropagation());

  document.addEventListener("click", (event) => {
    if (connectDropdown && !connectDropdown.contains(event.target)) setConnectMenuState(false);
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

  // Compact header on scroll
  const headerEl = document.getElementById("header");
  if (headerEl) {
    const onScroll = () => headerEl.classList.toggle("scrolled", window.scrollY > 32);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Force scroll to top on initial load if landing on home or #about
  const currentHash = window.location.hash;
  if (!currentHash || currentHash === "#about") {
    window.scrollTo(0, 0);
  }

  // Feature 4: Keyboard shortcut hints on nav links
  if (supportsHover.matches) {
    navLinks.forEach((link, index) => {
      const kbd = document.createElement("kbd");
      kbd.className = "nav-shortcut";
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
