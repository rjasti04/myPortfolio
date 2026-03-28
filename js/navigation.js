import { compactViewport, prefersReducedMotion } from "./config.js";
import { closeModal, openModal } from "./modal.js";

let hamburger, navMenu, navLinks, sections, connectDropdown, connectToggle, connectMenu, imageModal, imageModalCloseButton, profileTrigger, backToTopBtn;

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
  backToTopBtn = document.getElementById("back-to-top");

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

  if (backToTopBtn) {
    let isScrolling = false;
    window.addEventListener("scroll", () => {
      if (!isScrolling) {
        window.requestAnimationFrame(() => {
          backToTopBtn.classList.toggle("visible", window.scrollY > 280);
          isScrolling = false;
        });
        isScrolling = true;
      }
    }, { passive: true });

    backToTopBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion.matches ? "auto" : "smooth" });
    });
  }

  window.addEventListener("hashchange", () => syncSectionWithHash());
  window.addEventListener("popstate", () => syncSectionWithHash());

  if (typeof compactViewport.addEventListener === "function") {
    compactViewport.addEventListener("change", (event) => {
      if (!event.matches) setMobileMenuState(false);
    });
  }

  syncSectionWithHash();
}
