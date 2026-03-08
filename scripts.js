// Navigation & Hamburger Logic
const hamburger = document.getElementById("hamburger-toggle");
const navMenu = document.getElementById("nav-menu");
const navLinks = document.querySelectorAll("nav a");
const sections = document.querySelectorAll("main section");
const authDropdown = document.getElementById("auth-dropdown");
const authToggle = document.getElementById("auth-toggle");
const loginDropdown = document.getElementById("login-dropdown");
const imageModal = document.getElementById("image-modal");
const imageModalCloseButton = document.getElementById("image-modal-close");
const profileTrigger = document.getElementById("profile-trigger");

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalFocusReturn = new WeakMap();

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

function closeMobileMenu() {
  if (!navMenu || !hamburger) return;
  navMenu.classList.remove("show-menu");
  const icon = hamburger.querySelector("i");
  if (icon) {
    icon.classList.add("fa-bars");
    icon.classList.remove("fa-times");
  }
}

function setAuthDropdownState(isOpen) {
  if (!authDropdown || !authToggle || !loginDropdown) return;
  authDropdown.classList.toggle("open", isOpen);
  authToggle.setAttribute("aria-expanded", String(isOpen));
  loginDropdown.setAttribute("aria-hidden", String(!isOpen));
}

function closeAuthDropdown() {
  setAuthDropdownState(false);
}

function openAuthDropdown() {
  setAuthDropdownState(true);
}

function setActiveSection(target) {
  if (!target || !window.AppLogic?.setActiveSection) return;
  window.AppLogic.setActiveSection(target, sections, navLinks);
}

function syncSectionWithHash(hash = window.location.hash) {
  if (!window.AppLogic?.getValidHashTarget) return;
  const target = window.AppLogic.getValidHashTarget(hash, (id) => document.getElementById(id), "about");
  setActiveSection(target);
}

if (hamburger && navMenu) {
  hamburger.addEventListener("click", () => {
    navMenu.classList.toggle("show-menu");
    const icon = hamburger.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-bars");
      icon.classList.toggle("fa-times");
    }
  });
}

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = link.dataset.target;
    if (!target) return;

    event.preventDefault();
    setActiveSection(target);
    history.replaceState(null, "", `#${target}`);
    closeMobileMenu();
    closeAuthDropdown();

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  });
});

// Secondary CTA "View Projects" button in hero
document.querySelectorAll("a.nav-cta[data-target]").forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = link.dataset.target;
    if (!target) return;
    event.preventDefault();
    setActiveSection(target);
    history.replaceState(null, "", `#${target}`);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
  });
});

syncSectionWithHash();

window.addEventListener("hashchange", () => {
  syncSectionWithHash();
});

if (authDropdown && authToggle && loginDropdown) {
  authToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !authDropdown.classList.contains("open");
    setAuthDropdownState(isOpen);
  });

  loginDropdown.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", (event) => {
    if (!authDropdown.contains(event.target)) {
      closeAuthDropdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAuthDropdown();
    }
  });
}

// Theme Toggle — respects both localStorage and system preference
const themeBtn = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");

function applyTheme(isDark) {
  document.body.classList.toggle("dark-theme", isDark);
  if (themeIcon) {
    themeIcon.className = isDark ? "fas fa-sun" : "fas fa-moon";
  }
}

if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-theme");
    if (themeIcon) themeIcon.className = isDark ? "fas fa-sun" : "fas fa-moon";
    localStorage.setItem("theme", isDark ? "dark" : "light");
  });
}

// Apply saved theme or fall back to system preference
const savedTheme = localStorage.getItem("theme");
const prefersDarkSystem = window.matchMedia("(prefers-color-scheme: dark)").matches;
applyTheme(savedTheme === "dark" || (!savedTheme && prefersDarkSystem));

// Profile Modal Logic
if (imageModal && profileTrigger) {
  profileTrigger.addEventListener("click", () => {
    openModal(imageModal, { initialFocus: imageModalCloseButton || imageModal });
  });

  if (imageModalCloseButton) {
    imageModalCloseButton.addEventListener("click", () => {
      closeModal(imageModal);
    });
  }

  imageModal.addEventListener("click", (event) => {
    if (event.target === imageModal) {
      closeModal(imageModal);
    }
  });
}

// Cursor Glow — throttled via requestAnimationFrame
const glow = document.getElementById("cursor-glow");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
if (glow && !prefersReducedMotion.matches) {
  let rafId = null;
  window.addEventListener("mousemove", (event) => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
      rafId = null;
    });
  });
}

// Toast Notification System
const toastContainer = document.getElementById("toast-container");

function showToast(message, type = "info") {
  if (!toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "alert");
  toast.textContent = message;
  toastContainer.appendChild(toast);

  // Double rAF ensures transition plays after element is in DOM
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add("toast-show");
    });
  });

  setTimeout(() => {
    toast.classList.remove("toast-show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 3500);
}

// Back to Top Button
const backToTopBtn = document.getElementById("back-to-top");
if (backToTopBtn) {
  window.addEventListener("scroll", () => {
    backToTopBtn.classList.toggle("visible", window.scrollY > 300);
  });

  backToTopBtn.addEventListener("click", () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  });
}

// Stat Counter Animation via IntersectionObserver
const statNumbers = document.querySelectorAll(".stat-number[data-target]");

function animateStat(el) {
  if (el.dataset.animated) return;
  el.dataset.animated = "true";

  const target = parseFloat(el.dataset.target);
  const suffix = el.dataset.suffix || "";
  const isDecimal = !Number.isInteger(target);
  const duration = 1500;
  let startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const progress = Math.min((timestamp - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = target * eased;
    el.textContent = (isDecimal ? current.toFixed(1) : Math.floor(current)) + suffix;
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = (isDecimal ? target.toFixed(1) : target) + suffix;
    }
  }

  requestAnimationFrame(step);
}

if (statNumbers.length > 0 && "IntersectionObserver" in window) {
  const statObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateStat(entry.target);
          statObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 },
  );
  statNumbers.forEach((el) => statObserver.observe(el));
}

// Footer Year
const footerYear = document.getElementById("footer-year");
if (footerYear) {
  footerYear.textContent = new Date().getFullYear();
}

// Project Detail Modal
const projectDetailModal = document.getElementById("project-detail-modal");
const projectDetailClose = document.getElementById("project-detail-close");
const projectDetailIcon = document.getElementById("project-detail-icon");
const projectDetailTitle = document.getElementById("project-detail-title");
const projectDetailDescription = document.getElementById("project-detail-description");
const projectDetailStack = document.getElementById("project-detail-stack");
const projectDetailOutcomes = document.getElementById("project-detail-outcomes");

if (projectDetailModal) {
  document.querySelectorAll(".project-details-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".project-card");
      if (!card) return;

      const icon = card.dataset.icon || "fas fa-code";
      const title = card.dataset.title || "";
      const description = card.dataset.description || "";
      const stack = (card.dataset.stack || "").split(",").map((s) => s.trim()).filter(Boolean);
      const outcomes = (card.dataset.outcomes || "").split("|").map((s) => s.trim()).filter(Boolean);

      if (projectDetailIcon) {
        const i = document.createElement("i");
        i.className = icon;
        projectDetailIcon.replaceChildren(i);
      }
      if (projectDetailTitle) projectDetailTitle.textContent = title;
      if (projectDetailDescription) projectDetailDescription.textContent = description;

      if (projectDetailStack) {
        projectDetailStack.replaceChildren(
          ...stack.map((s) => {
            const span = document.createElement("span");
            span.className = "detail-tag";
            span.textContent = s;
            return span;
          }),
        );
      }

      if (projectDetailOutcomes) {
        projectDetailOutcomes.replaceChildren(
          ...outcomes.map((o) => {
            const li = document.createElement("li");
            li.textContent = o;
            return li;
          }),
        );
      }

      const modalInner = projectDetailModal.querySelector(".modal-inner");
      openModal(projectDetailModal, { initialFocus: projectDetailClose || modalInner });
    });
  });

  if (projectDetailClose) {
    projectDetailClose.addEventListener("click", () => closeModal(projectDetailModal));
  }

  projectDetailModal.addEventListener("click", (event) => {
    if (event.target === projectDetailModal) closeModal(projectDetailModal);
  });
}

// Login / Sign-up / Contact Forms
document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const rememberInput = document.getElementById("remember");
  const forgetPasswordButton = document.getElementById("forget-password");
  const loginStatus = document.getElementById("login-status");

  const signupModal = document.getElementById("signup-modal");
  const signupModalContent = signupModal?.querySelector(".modal-content");
  const signupOpenButton = document.getElementById("open-signup");
  const backToLoginButton = document.getElementById("back-to-login");
  const signupCloseButton = document.getElementById("signup-modal-close");

  const signupForm = document.getElementById("signup-form");
  const signupEmailInput = document.getElementById("signup-email");
  const signupPasswordInput = document.getElementById("signup-password");
  const confirmPasswordInput = document.getElementById("confirm-password");
  const passwordError = document.getElementById("password-error");
  const signupStatus = document.getElementById("signup-status");

  const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{12,18}$/;

  const projectFilters = Array.from(document.querySelectorAll(".project-filter"));
  const projectSearchInput = document.getElementById("project-search");
  const projectCards = Array.from(document.querySelectorAll(".project-card"));
  const projectResults = document.getElementById("project-results");

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

  // Copy Email Button
  const copyEmailBtn = document.getElementById("copy-email-btn");
  if (copyEmailBtn) {
    copyEmailBtn.addEventListener("click", () => {
      navigator.clipboard
        .writeText("inboxtorj@gmail.com")
        .then(() => showToast("Email copied to clipboard!", "success"))
        .catch(() => showToast("Could not copy — please copy manually.", "error"));
    });
  }

  // Contact Form (demo mode — swap fetch URL for Formspree in production)
  const contactForm = document.getElementById("contact-form");
  const contactStatus = document.getElementById("contact-status");
  if (contactForm) {
    contactForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = document.getElementById("contact-name")?.value.trim();
      const email = document.getElementById("contact-email")?.value.trim();
      const message = document.getElementById("contact-message")?.value.trim();

      if (!name || !email || !message) {
        setFormStatus(contactStatus, "Please fill in all fields.", "error");
        return;
      }

      // To connect a real backend, replace this block with:
      // fetch("https://formspree.io/f/YOUR_FORM_ID", { method: "POST", body: new FormData(contactForm) })
      setFormStatus(contactStatus, "Message sent! I'll get back to you soon. (Demo mode)", "success");
      showToast("Message sent successfully!", "success");
      contactForm.reset();
    });
  }

  // Project Filters
  function applyProjectFilters(activeFilter = "all", searchTerm = "") {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    let visibleCount = 0;

    projectCards.forEach((card) => {
      const tags = (card.dataset.tags || "").toLowerCase();
      const title = (card.dataset.title || "").toLowerCase();
      const passesFilter = activeFilter === "all" || tags.includes(activeFilter);
      const passesSearch = !normalizedSearch || tags.includes(normalizedSearch) || title.includes(normalizedSearch);
      const visible = passesFilter && passesSearch;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    if (projectResults) {
      projectResults.textContent = `${visibleCount} project${visibleCount === 1 ? "" : "s"} shown`;
    }
  }

  if (signupPasswordInput && confirmPasswordInput && passwordError) {
    const validatePasswordMatch = () => {
      const password = signupPasswordInput.value;
      const confirmPassword = confirmPasswordInput.value;
      if (confirmPassword && password !== confirmPassword) {
        passwordError.textContent = "Passwords do not match";
      } else {
        passwordError.textContent = "";
      }
    };

    signupPasswordInput.addEventListener("input", validatePasswordMatch);
    confirmPasswordInput.addEventListener("input", validatePasswordMatch);
    signupEmailInput?.addEventListener("input", () => clearFormStatus(signupStatus));
    signupPasswordInput.addEventListener("input", () => clearFormStatus(signupStatus));
    confirmPasswordInput.addEventListener("input", () => clearFormStatus(signupStatus));
  }

  if (projectFilters.length > 0 && projectCards.length > 0) {
    let activeFilter = "all";

    projectFilters.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.filter || "all";
        projectFilters.forEach((filterButton) => {
          const isActive = filterButton === button;
          filterButton.classList.toggle("active", isActive);
          filterButton.setAttribute("aria-pressed", String(isActive));
        });
        applyProjectFilters(activeFilter, projectSearchInput?.value || "");
      });
    });

    projectSearchInput?.addEventListener("input", () => {
      applyProjectFilters(activeFilter, projectSearchInput.value);
    });

    applyProjectFilters(activeFilter, "");
  }

  if (loginForm && emailInput && passwordInput && rememberInput) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const remember = rememberInput.checked;

      if (!email || !password) {
        setFormStatus(loginStatus, "Please enter both email and password.", "error");
        return;
      }

      if (remember) {
        localStorage.setItem("rememberedEmail", email);
      } else {
        localStorage.removeItem("rememberedEmail");
      }

      closeAuthDropdown();
      setFormStatus(loginStatus, "Login successful! (Demo mode)", "success");
      showToast("Logged in successfully! (Demo mode)", "success");
    });

    const rememberedEmail = localStorage.getItem("rememberedEmail");
    if (rememberedEmail) {
      emailInput.value = rememberedEmail;
      rememberInput.checked = true;
    }

    emailInput.addEventListener("input", () => clearFormStatus(loginStatus));
    passwordInput.addEventListener("input", () => clearFormStatus(loginStatus));
  }

  if (forgetPasswordButton) {
    forgetPasswordButton.addEventListener("click", () => {
      setFormStatus(loginStatus, "Password reset link sent! (Demo mode)", "info");
    });
  }

  if (signupModal && signupOpenButton && backToLoginButton) {
    signupOpenButton.addEventListener("click", () => {
      clearFormStatus(signupStatus);
      if (passwordError) passwordError.textContent = "";
      openModal(signupModal, { initialFocus: signupModalContent || signupEmailInput || signupModal });
      closeAuthDropdown();
    });

    backToLoginButton.addEventListener("click", () => {
      closeModal(signupModal);
      openAuthDropdown();
    });

    signupCloseButton?.addEventListener("click", () => {
      closeModal(signupModal);
    });

    signupModal.addEventListener("click", (event) => {
      if (event.target === signupModal) {
        closeModal(signupModal);
      }
    });
  }

  if (
    signupForm &&
    signupEmailInput &&
    signupPasswordInput &&
    confirmPasswordInput &&
    passwordError &&
    signupModal
  ) {
    signupForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const email = signupEmailInput.value.trim();
      const password = signupPasswordInput.value;
      const confirmPassword = confirmPasswordInput.value;

      if (!email || !password || !confirmPassword) {
        setFormStatus(signupStatus, "Please fill in all fields.", "error");
        return;
      }

      if (!passwordRegex.test(password)) {
        setFormStatus(
          signupStatus,
          "Password must be 12-18 chars with uppercase, number, and special character.",
          "error",
        );
        return;
      }

      if (password !== confirmPassword) {
        passwordError.textContent = "Passwords do not match";
        setFormStatus(signupStatus, "Please make sure both password fields match.", "error");
        return;
      }

      passwordError.textContent = "";
      setFormStatus(signupStatus, "Sign up successful! (Demo mode)", "success");
      closeModal(signupModal);
      openAuthDropdown();
      setFormStatus(loginStatus, "Account created. You can now log in. (Demo mode)", "success");
      showToast("Account created successfully! (Demo mode)", "success");
    });
  }
});
