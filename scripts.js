// Navigation & Hamburger Logic
const hamburger = document.getElementById("hamburger-toggle");
const navMenu = document.getElementById("nav-menu");
const navLinks = document.querySelectorAll("nav a");
const sections = document.querySelectorAll("main section");
const authDropdown = document.getElementById("auth-dropdown");
const authToggle = document.getElementById("auth-toggle");
const loginDropdown = document.getElementById("login-dropdown");

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
  if (!target) return;
  sections.forEach((section) => {
    section.classList.toggle("active", section.id === target);
  });

  navLinks.forEach((link) => {
    const isActive = link.dataset.target === target;
    link.classList.toggle("active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
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
  link.addEventListener("click", (e) => {
    const target = link.dataset.target;
    if (!target) return;

    e.preventDefault();
    setActiveSection(target);
    history.replaceState(null, "", `#${target}`);
    closeMobileMenu();
    closeAuthDropdown();

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });
});

const initialHashTarget = window.location.hash.replace("#", "");
if (initialHashTarget && document.getElementById(initialHashTarget)) {
  setActiveSection(initialHashTarget);
}

if (authDropdown && authToggle && loginDropdown) {
  authToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !authDropdown.classList.contains("open");
    setAuthDropdownState(isOpen);
  });

  loginDropdown.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.addEventListener("click", (e) => {
    if (!authDropdown.contains(e.target)) {
      closeAuthDropdown();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAuthDropdown();
    }
  });
}

// Theme Toggle
const themeBtn = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");

if (themeBtn && themeIcon) {
  themeBtn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-theme");
    themeIcon.className = isDark ? "fas fa-sun" : "fas fa-moon";
    localStorage.setItem("theme", isDark ? "dark" : "light");
  });
}

if (localStorage.getItem("theme") === "dark") {
  document.body.classList.add("dark-theme");
  if (themeIcon) {
    themeIcon.className = "fas fa-sun";
  }
}

// Profile Modal Logic
const imageModal = document.getElementById("image-modal");
const profileTrigger = document.getElementById("profile-trigger");
if (imageModal && profileTrigger) {
  profileTrigger.addEventListener("click", () => imageModal.classList.add("active"));
  imageModal.addEventListener("click", () => imageModal.classList.remove("active"));
}

// Cursor Glow
const glow = document.getElementById("cursor-glow");
if (glow) {
  window.addEventListener("mousemove", (e) => {
    glow.style.left = `${e.clientX}px`;
    glow.style.top = `${e.clientY}px`;
  });
}

// Login / Sign-up Forms
document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const rememberInput = document.getElementById("remember");
  const forgetPasswordButton = document.getElementById("forget-password");
  const signupModal = document.getElementById("signup-modal");
  const signupOpenButton = document.getElementById("open-signup");
  const backToLoginButton = document.getElementById("back-to-login");

  const signupForm = document.getElementById("signup-form");
  const signupEmailInput = document.getElementById("signup-email");
  const signupPasswordInput = document.getElementById("signup-password");
  const confirmPasswordInput = document.getElementById("confirm-password");
  const passwordError = document.getElementById("password-error");

  const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{12,18}$/;

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
  }

  if (loginForm && emailInput && passwordInput && rememberInput) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const remember = rememberInput.checked;

      if (email && password) {
        if (remember) {
          localStorage.setItem("rememberedEmail", email);
        } else {
          localStorage.removeItem("rememberedEmail");
        }
        closeAuthDropdown();
        alert("Login successful! (This is a demo)");
      } else {
        alert("Please fill in all fields.");
      }
    });

    const rememberedEmail = localStorage.getItem("rememberedEmail");
    if (rememberedEmail) {
      emailInput.value = rememberedEmail;
      rememberInput.checked = true;
    }
  }

  if (forgetPasswordButton) {
    forgetPasswordButton.addEventListener("click", () => {
      alert("Password reset link sent to your email! (Demo)");
    });
  }

  if (signupModal && signupOpenButton && backToLoginButton) {
    signupOpenButton.addEventListener("click", () => {
      signupModal.classList.add("active");
      closeAuthDropdown();
    });

    backToLoginButton.addEventListener("click", () => {
      signupModal.classList.remove("active");
      openAuthDropdown();
    });

    signupModal.addEventListener("click", (e) => {
      if (e.target === signupModal) {
        signupModal.classList.remove("active");
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
    signupForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const email = signupEmailInput.value.trim();
      const password = signupPasswordInput.value;
      const confirmPassword = confirmPasswordInput.value;

      if (!email || !password || !confirmPassword) {
        alert("Please fill in all fields.");
        return;
      }

      if (!passwordRegex.test(password)) {
        alert("Password must be 12-18 characters with at least one uppercase letter, one number, and one special character.");
        return;
      }

      if (password !== confirmPassword) {
        passwordError.textContent = "Passwords do not match";
        alert("Passwords do not match.");
        return;
      }

      passwordError.textContent = "";
      alert("Sign up successful! (This is a demo)");
      signupModal.classList.remove("active");
    });
  }
});
