// Navigation & Hamburger Logic
const hamburger = document.getElementById("hamburger-toggle");
const navMenu = document.getElementById("nav-menu");
const navLinks = document.querySelectorAll("nav a");
const sections = document.querySelectorAll("main section");

// Toggle Menu
hamburger.addEventListener("click", () => {
  navMenu.classList.toggle("show-menu");
  const icon = hamburger.querySelector("i");
  icon.classList.toggle("fa-bars");
  icon.classList.toggle("fa-times");
});

// Navigation and closing menu on click
navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const target = link.dataset.target;

    // UI Updates
    navLinks.forEach((l) => l.classList.remove("active"));
    link.classList.add("active");

    sections.forEach((s) => {
      s.classList.remove("active");
      if (s.id === target) s.classList.add("active");
    });

    // Close mobile menu
    navMenu.classList.remove("show-menu");
    const icon = hamburger.querySelector("i");
    icon.classList.add("fa-bars");
    icon.classList.remove("fa-times");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  });
});

// Theme Toggle
const themeBtn = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");

themeBtn.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark-theme");
  themeIcon.className = isDark ? "fas fa-sun" : "fas fa-moon";
  localStorage.setItem("theme", isDark ? "dark" : "light");
});

if (localStorage.getItem("theme") === "dark") {
  document.body.classList.add("dark-theme");
  themeIcon.className = "fas fa-sun";
}

// Modal Logic
const modal = document.getElementById("image-modal");
document
  .getElementById("profile-trigger")
  .addEventListener("click", () => modal.classList.add("active"));
modal.addEventListener("click", () => modal.classList.remove("active"));

// Cursor Glow
const glow = document.getElementById("cursor-glow");
window.addEventListener("mousemove", (e) => {
  glow.style.left = e.clientX + "px";
  glow.style.top = e.clientY + "px";
});

// Login Form
document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;
      const remember = document.getElementById("remember").checked;
      // Basic validation
      if (email && password) {
        if (remember) {
          localStorage.setItem("rememberedEmail", email);
        } else {
          localStorage.removeItem("rememberedEmail");
        }
        alert("Login successful! (This is a demo)");
        // Here you can add actual login logic, e.g., API call
      } else {
        alert("Please fill in all fields.");
      }
    });

    // Load remembered email
    const rememberedEmail = localStorage.getItem("rememberedEmail");
    if (rememberedEmail) {
      document.getElementById("email").value = rememberedEmail;
      document.getElementById("remember").checked = true;
    }

    // Forget password link
    const forgetLink = document.querySelector(".forget-password");
    forgetLink.addEventListener("click", (e) => {
      e.preventDefault();
      alert("Password reset link sent to your email! (Demo)");
    });

    // Sign Up Modal
    const signupModal = document.getElementById("signup-modal");
    const signupLink = document.querySelector(".login-footer .login-link");
    const backToLoginLink = document.getElementById("back-to-login");

    signupLink.addEventListener("click", (e) => {
      e.preventDefault();
      signupModal.classList.add("active");
    });

    backToLoginLink.addEventListener("click", (e) => {
      e.preventDefault();
      signupModal.classList.remove("active");
    });

    signupModal.addEventListener("click", (e) => {
      if (e.target === signupModal) {
        signupModal.classList.remove("active");
      }
    });

    // Sign Up Form
    const signupForm = document.getElementById("signup-form");
    if (signupForm) {
      signupForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = document.getElementById("signup-email").value;
        const password = document.getElementById("signup-password").value;
        const confirmPassword = document.getElementById("confirm-password").value;

        // Password validation: 12-18 chars, 1 number, 1 special char, 1 uppercase
        const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{12,18}$/;

        if (email && password && confirmPassword) {
          if (!passwordRegex.test(password)) {
            alert("Password must be 12-18 characters with at least one uppercase letter, one number, and one special character.");
            return;
          }
          if (password === confirmPassword) {
            alert("Sign up successful! (This is a demo)");
            signupModal.classList.remove("active");
            // Here you can add actual sign up logic, e.g., API call
          } else {
            alert("Passwords do not match.");
          }
        } else {
          alert("Please fill in all fields.");
        }
      });
    }
  }
});
