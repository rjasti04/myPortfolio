const CONTACT_EMAIL = "inboxtorj@gmail.com";
const LINKEDIN_URL = "https://www.linkedin.com/in/rajeev-jasti-326080169";
const GITHUB_URL = "https://github.com/rjasti04";
const RESUME_URL = "rajeev_jasti.pdf";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
const compactViewport = window.matchMedia("(max-width: 900px)");
const supportsHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const hamburger = document.getElementById("hamburger-toggle");
const navMenu = document.getElementById("nav-menu");
const navLinks = Array.from(document.querySelectorAll("nav a[data-target]"));
const sections = Array.from(document.querySelectorAll("main section"));
const connectDropdown = document.getElementById("connect-dropdown");
const connectToggle = document.getElementById("connect-toggle");
const connectMenu = document.getElementById("connect-dropdown-menu");
const imageModal = document.getElementById("image-modal");
const imageModalCloseButton = document.getElementById("image-modal-close");
const profileTrigger = document.getElementById("profile-trigger");
const projectDetailModal = document.getElementById("project-detail-modal");
const projectDetailClose = document.getElementById("project-detail-close");
const projectDetailIcon = document.getElementById("project-detail-icon");
const projectDetailTitle = document.getElementById("project-detail-title");
const projectDetailDescription = document.getElementById("project-detail-description");
const projectDetailStack = document.getElementById("project-detail-stack");
const projectDetailOutcomes = document.getElementById("project-detail-outcomes");
const themeBtn = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");
const toastContainer = document.getElementById("toast-container");
const backToTopBtn = document.getElementById("back-to-top");
const footerYear = document.getElementById("footer-year");

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalFocusReturn = new WeakMap();

function showToast(message, type = "info") {
  if (!toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("toast-show");
    });
  });

  window.setTimeout(() => {
    toast.classList.remove("toast-show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 3200);
}

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    const isVisible = element.offsetParent !== null || element.getClientRects().length > 0;
    return isVisible && element.getAttribute("aria-hidden") !== "true";
  });
}

function handleFocusTrap(event, modal) {
  if (event.key !== "Tab") return;

  const focusable = getFocusableElements(modal);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openModal(modal, { initialFocus = null } = {}) {
  if (!modal) return;
  modalFocusReturn.set(modal, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal(modal);
      return;
    }

    handleFocusTrap(event, modal);
  };

  modal.__keydownHandler = onKeydown;
  document.addEventListener("keydown", onKeydown);

  const focusable = getFocusableElements(modal);
  const target = initialFocus || focusable[0] || modal;
  if (target && typeof target.focus === "function") {
    target.focus();
  }
}

function closeModal(modal, { restoreFocus = true } = {}) {
  if (!modal || !modal.classList.contains("active")) return;
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");

  if (modal.__keydownHandler) {
    document.removeEventListener("keydown", modal.__keydownHandler);
    modal.__keydownHandler = null;
  }

  if (restoreFocus) {
    const focusReturn = modalFocusReturn.get(modal);
    if (focusReturn && typeof focusReturn.focus === "function") {
      focusReturn.focus();
    }
  }
}

function closeTransientUi() {
  setMobileMenuState(false);
  setConnectMenuState(false);
}

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

function applyTheme(isDark) {
  document.body.classList.toggle("dark-theme", isDark);
  if (themeIcon) {
    themeIcon.className = isDark ? "fas fa-sun" : "fas fa-moon";
  }
  if (themeBtn) {
    themeBtn.setAttribute("aria-pressed", String(isDark));
  }
}

function setActiveSection(target) {
  if (!target || !window.AppLogic?.setActiveSection) return;
  window.AppLogic.setActiveSection(target, sections, navLinks);
}

function navigateToSection(target, { updateHash = true } = {}) {
  if (!target) return;
  closeTransientUi();
  closeModal(projectDetailModal, { restoreFocus: false });
  setActiveSection(target);

  if (updateHash) {
    const nextHash = `#${target}`;
    if (window.location.hash !== nextHash) {
      history.pushState(null, "", nextHash);
    }
  }

  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion.matches ? "auto" : "smooth",
  });
}

function syncSectionWithHash(hash = window.location.hash) {
  if (!window.AppLogic?.getValidHashTarget) return;
  const target = window.AppLogic.getValidHashTarget(hash, (id) => document.getElementById(id), "about");
  setActiveSection(target);
}

function fillProjectDetails(card) {
  if (!card) return;

  const icon = card.dataset.icon || "fas fa-code";
  const title = card.dataset.title || "";
  const description = card.dataset.description || "";
  const stack = (card.dataset.stack || "").split(",").map((value) => value.trim()).filter(Boolean);
  const outcomes = (card.dataset.outcomes || "").split("|").map((value) => value.trim()).filter(Boolean);

  if (projectDetailIcon) {
    const iconElement = document.createElement("i");
    iconElement.className = icon;
    projectDetailIcon.replaceChildren(iconElement);
  }
  if (projectDetailTitle) projectDetailTitle.textContent = title;
  if (projectDetailDescription) projectDetailDescription.textContent = description;

  if (projectDetailStack) {
    projectDetailStack.replaceChildren(
      ...stack.map((item) => {
        const tag = document.createElement("span");
        tag.className = "detail-tag";
        tag.textContent = item;
        return tag;
      }),
    );
  }

  if (projectDetailOutcomes) {
    projectDetailOutcomes.replaceChildren(
      ...outcomes.map((outcome) => {
        const li = document.createElement("li");
        li.textContent = outcome;
        return li;
      }),
    );
  }
}

function filterProjects() {
  const projectCards = Array.from(document.querySelectorAll(".project-card"));
  const projectFilters = Array.from(document.querySelectorAll(".project-filter"));
  const projectSearchInput = document.getElementById("project-search");
  const projectResults = document.getElementById("project-results");
  let activeFilter = "all";

  const syncVisibleCards = () => {
    const projects = projectCards.map((card) => ({
      card,
      description: card.dataset.description || "",
      tags: card.dataset.tags || "",
      title: card.dataset.title || "",
    }));

    const filteredProjects = window.AppLogic?.filterProjects
      ? window.AppLogic.filterProjects(projects, activeFilter, projectSearchInput?.value || "")
      : projects.map((project) => ({ ...project, visible: true }));

    const visibleCount = filteredProjects.reduce((count, project) => {
      if (project.visible) {
        project.card.hidden = false;
        requestAnimationFrame(() => project.card.classList.remove("fade-out"));
      } else {
        project.card.classList.add("fade-out");
        clearTimeout(project.card.hideTimeout);
        project.card.hideTimeout = setTimeout(() => {
          if (project.card.classList.contains("fade-out")) {
            project.card.hidden = true;
          }
        }, 400);
      }
      return count + (project.visible ? 1 : 0);
    }, 0);

    if (projectResults) {
      if (visibleCount === 0) {
        projectResults.textContent = "No projects found. Try a different search or filter.";
        projectResults.dataset.empty = "true";
      } else {
        projectResults.textContent = `${visibleCount} project${visibleCount === 1 ? "" : "s"} shown`;
        delete projectResults.dataset.empty;
      }
    }
  };

  projectFilters.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";
      projectFilters.forEach((filterButton) => {
        const isActive = filterButton === button;
        filterButton.classList.toggle("active", isActive);
        filterButton.setAttribute("aria-pressed", String(isActive));
      });
      syncVisibleCards();
    });
  });

  projectSearchInput?.addEventListener("input", syncVisibleCards);
  syncVisibleCards();
}

function setFormStatus(element, message, state = "info") {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

function clearFormStatus(element) {
  if (!element) return;
  element.textContent = "";
  delete element.dataset.state;
}

function copyEmailToClipboard() {
  if (!navigator.clipboard?.writeText) {
    showToast("Clipboard access is unavailable. Please copy the email manually.", "error");
    return;
  }

  navigator.clipboard.writeText(CONTACT_EMAIL)
    .then(() => showToast("Email copied to clipboard.", "success"))
    .catch(() => showToast("Clipboard copy failed. Please copy the email manually.", "error"));
}

function openExternal(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function initReveals() {
  const revealElements = Array.from(document.querySelectorAll(".reveal"));
  if (revealElements.length === 0) return;

  if (prefersReducedMotion.matches || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("active"));
    return;
  }

  const observer = new IntersectionObserver((entries, intersectionObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        intersectionObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });

  revealElements.forEach((element) => observer.observe(element));
}

function initStats() {
  const statNumbers = Array.from(document.querySelectorAll(".stat-number[data-target]"));
  if (statNumbers.length === 0) return;

  const animateStat = (element) => {
    if (element.dataset.animated) return;
    element.dataset.animated = "true";

    const target = Number.parseFloat(element.dataset.target || "0");
    const suffix = element.dataset.suffix || "";
    const isDecimal = !Number.isInteger(target);
    const duration = prefersReducedMotion.matches ? 0 : 1200;

    if (duration === 0) {
      element.textContent = `${isDecimal ? target.toFixed(1) : target}${suffix}`;
      return;
    }

    let startTime = 0;
    const step = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;
      element.textContent = `${isDecimal ? current.toFixed(1) : Math.floor(current)}${suffix}`;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        element.textContent = `${isDecimal ? target.toFixed(1) : target}${suffix}`;
      }
    };

    requestAnimationFrame(step);
  };

  if (!("IntersectionObserver" in window)) {
    statNumbers.forEach(animateStat);
    return;
  }

  const observer = new IntersectionObserver((entries, intersectionObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateStat(entry.target);
        intersectionObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.45 });

  statNumbers.forEach((element) => observer.observe(element));
}

function initTerminalIntro() {
  const terminalChildren = Array.from(document.querySelectorAll(".terminal-body > *"));
  if (prefersReducedMotion.matches) {
    terminalChildren.forEach((child) => {
      child.style.opacity = "1";
    });
    return;
  }

  let delay = 180;
  terminalChildren.forEach((child) => {
    child.style.opacity = "0";
    child.style.animation = `slide-up 0.35s ease-out forwards ${delay}ms`;
    delay += 180;
  });
}

function initContactForm() {
  const contactForm = document.getElementById("contact-form");
  const contactStatus = document.getElementById("contact-status");
  const copyEmailBtn = document.getElementById("copy-email-btn");
  let nativeFallbackInProgress = false;

  copyEmailBtn?.addEventListener("click", copyEmailToClipboard);

  if (!contactForm || !contactStatus) return;

  const submitNatively = () => {
    nativeFallbackInProgress = true;

    let nextField = contactForm.querySelector('input[name="_next"]');
    if (!nextField) {
      nextField = document.createElement("input");
      nextField.type = "hidden";
      nextField.name = "_next";
      contactForm.append(nextField);
    }
    nextField.value = `${window.location.href.split("#")[0]}#contact`;
    contactForm.submit();
  };

  contactForm.addEventListener("input", () => clearFormStatus(contactStatus));
  contactForm.addEventListener("submit", async (event) => {
    if (nativeFallbackInProgress || typeof window.fetch !== "function") {
      return;
    }

    event.preventDefault();
    if (!contactForm.reportValidity()) return;

    const submitBtn = contactForm.querySelector('button[type="submit"]');
    const name = contactForm.querySelector("#contact-name")?.value.trim() || "";
    const email = contactForm.querySelector("#contact-email")?.value.trim() || "";
    const message = contactForm.querySelector("#contact-message")?.value.trim() || "";
    const originalLabel = submitBtn?.innerHTML || "";

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }

    try {
      const response = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          _subject: "New portfolio message from rajeevjasti.com",
          email,
          message,
          name,
        }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      contactForm.reset();
      setFormStatus(contactStatus, "Message sent successfully. Thanks for reaching out.", "success");
      showToast("Message sent successfully.", "success");
    } catch (error) {
      console.error(error);
      setFormStatus(contactStatus, "Trying the standard form submission flow...", "info");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalLabel;
      }
      submitNatively();
      return;
    } finally {
      if (submitBtn && !nativeFallbackInProgress) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalLabel;
      }
    }
  });
}

function initMatrixDecode() {
  const element = document.querySelector(".hero-title");
  if (!element || prefersReducedMotion.matches) return;

  const originalText = element.textContent;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
  
  const animateText = () => {
    let iterations = 0;
    let lastTime = 0;
    
    const tick = (time) => {
      if (!lastTime) lastTime = time;
      if (time - lastTime >= 40) {
        element.innerHTML = originalText.split("").map((letter, index) => {
          if (letter === " ") return " ";
          if (index < iterations) return letter;
          return `<span style="color: var(--accent);">${chars[Math.floor(Math.random() * chars.length)]}</span>`;
        }).join("");
        
        iterations += 1 / 3;
        lastTime = time;
      }
      
      if (iterations < originalText.length) {
        requestAnimationFrame(tick);
      } else {
        element.textContent = originalText;
      }
    };

    requestAnimationFrame(tick);
  };

  setTimeout(animateText, 100);

  element.addEventListener("mouseenter", () => {
    if (element.textContent === originalText) {
      animateText();
    }
  });
}

if (hamburger) {
  hamburger.addEventListener("click", () => {
    const isOpen = !navMenu?.classList.contains("show-menu");
    setMobileMenuState(Boolean(isOpen));
  });
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

connectMenu?.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("click", (event) => {
  if (connectDropdown && !connectDropdown.contains(event.target)) {
    setConnectMenuState(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setConnectMenuState(false);
    setMobileMenuState(false);
  }
});

themeBtn?.addEventListener("click", () => {
  const nextValue = !document.body.classList.contains("dark-theme");
  applyTheme(nextValue);
  localStorage.setItem("theme", nextValue ? "dark" : "light");
});

profileTrigger?.addEventListener("click", (event) => {
  event.preventDefault();
  openModal(imageModal, { initialFocus: imageModalCloseButton || imageModal });
});

imageModalCloseButton?.addEventListener("click", () => closeModal(imageModal));
imageModal?.addEventListener("click", (event) => {
  if (event.target === imageModal) {
    closeModal(imageModal);
  }
});

document.querySelectorAll(".project-details-btn").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const card = button.closest(".project-card");
    fillProjectDetails(card);
    openModal(projectDetailModal, { initialFocus: projectDetailClose || projectDetailModal });
  });
});

projectDetailClose?.addEventListener("click", () => closeModal(projectDetailModal));
projectDetailModal?.addEventListener("click", (event) => {
  if (event.target === projectDetailModal) {
    closeModal(projectDetailModal);
  }
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
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion.matches ? "auto" : "smooth",
    });
  });
}

const savedTheme = localStorage.getItem("theme");
applyTheme(savedTheme === "dark" || (!savedTheme && prefersDarkScheme.matches));
syncSectionWithHash();
filterProjects();
initContactForm();
initReveals();
initStats();
initTerminalIntro();
initMatrixDecode();

if (footerYear) {
  footerYear.textContent = new Date().getFullYear();
}

window.addEventListener("hashchange", () => syncSectionWithHash());
window.addEventListener("popstate", () => syncSectionWithHash());
prefersDarkScheme.addEventListener("change", (event) => {
  if (!localStorage.getItem("theme")) {
    applyTheme(event.matches);
  }
});
if (typeof compactViewport.addEventListener === "function") {
  compactViewport.addEventListener("change", (event) => {
    if (!event.matches) {
      setMobileMenuState(false);
    }
  });
}
