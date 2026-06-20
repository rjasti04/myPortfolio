import {
  loginUser,
  registerUser,
  logoutUser,
  getAuthToken,
  authenticatedFetch,
} from "./auth.js";
import { API_BASE } from "./analytics.js";

export function initAuthUI() {
  const modal = document.getElementById("auth-modal");
  const closeBtn = document.getElementById("auth-modal-close");
  const tabs = document.querySelectorAll(".auth-tab");
  const tabContents = document.querySelectorAll(".auth-tab-content");

  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const loginError = document.getElementById("login-error");
  const registerError = document.getElementById("register-error");

  // Show modal via custom event
  window.addEventListener("request-login-modal", () => {
    modal.classList.remove("hidden");
    switchTab("login");
  });

  // Close modal
  closeBtn.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  // Close on click outside
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.add("hidden");
    }
  });

  // Tab switching
  function switchTab(tabId) {
    tabs.forEach((t) => t.classList.remove("active"));
    tabContents.forEach((c) => c.classList.remove("active"));

    document
      .querySelector(`.auth-tab[data-tab="${tabId}"]`)
      .classList.add("active");
    document.getElementById(`auth-tab-${tabId}`).classList.add("active");

    loginError.textContent = "";
    registerError.textContent = "";
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Handle Login
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    const btn = loginForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;

    try {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
      btn.disabled = true;
      loginError.textContent = "";

      await loginUser(email, password);

      // Success
      loginForm.reset();
      modal.classList.add("hidden");
      window.dispatchEvent(new Event("auth-changed"));
    } catch (err) {
      loginError.textContent = err.message || "Login failed. Please try again.";
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });

  // Handle Register
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("register-email").value;
    const password = document.getElementById("register-password").value;
    const btn = registerForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;

    try {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
      btn.disabled = true;
      registerError.textContent = "";

      await registerUser(email, password);

      // Success
      registerForm.reset();
      modal.classList.add("hidden");
      window.dispatchEvent(new Event("auth-changed"));
    } catch (err) {
      registerError.textContent =
        err.message || "Registration failed. Please try again.";
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });

  // Setup Navigation UI
  setupNavUI();
  window.addEventListener("auth-changed", setupNavUI);
}

async function setupNavUI() {
  const themeToggleBtn = document.getElementById("theme-toggle");
  if (!themeToggleBtn) return;
  const parentContainer = themeToggleBtn.parentElement;

  // Remove existing auth container if it exists
  const existing = document.querySelector(".nav-auth-container");
  if (existing) existing.remove();

  const authContainer = document.createElement("div");
  authContainer.className = "nav-auth-container";

  if (getAuthToken()) {
    try {
      // Fetch user info
      const res = await authenticatedFetch(`${API_BASE}/auth/me`);
      if (res.ok) {
        const user = await res.json();
        const initial = (user.username || user.email).charAt(0).toUpperCase();

        authContainer.innerHTML = `
                    <div class="nav-user-profile" id="nav-user-btn" aria-haspopup="true" aria-expanded="false">
                        <div class="nav-user-icon">${initial}</div>
                        <i class="fas fa-chevron-down" style="font-size: 0.7rem; margin-left: 2px;"></i>
                    </div>
                    <div class="nav-user-dropdown" id="nav-user-dropdown">
                        <button class="nav-dropdown-item" id="nav-logout-btn">
                            <i class="fas fa-sign-out-alt"></i> Logout
                        </button>
                    </div>
                `;

        parentContainer.insertBefore(authContainer, themeToggleBtn);

        const profileBtn = document.getElementById("nav-user-btn");
        const dropdown = document.getElementById("nav-user-dropdown");
        const logoutBtn = document.getElementById("nav-logout-btn");

        profileBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const isExpanded = dropdown.classList.contains("show");
          dropdown.classList.toggle("show");
          profileBtn.setAttribute("aria-expanded", !isExpanded);
        });

        document.addEventListener("click", () => {
          dropdown.classList.remove("show");
          profileBtn.setAttribute("aria-expanded", "false");
        });

        logoutBtn.addEventListener("click", async () => {
          await logoutUser();
        });

        return; // Successfully setup logged-in state
      } else {
        // Token invalid, clear it
        localStorage.removeItem("rj_access_token");
      }
    } catch (e) {
      console.error("Failed to fetch user profile", e);
    }
  }

  // Logged out state
  authContainer.innerHTML = `
        <button class="header-icon-btn nav-auth-btn" id="nav-login-btn" title="Log In" aria-label="Log In">
            <i class="fas fa-sign-in-alt"></i>
        </button>
    `;
  parentContainer.insertBefore(authContainer, themeToggleBtn);

  document.getElementById("nav-login-btn").addEventListener("click", () => {
    window.dispatchEvent(new Event("request-login-modal"));
  });
}

// Auto-init when loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthUI);
} else {
  initAuthUI();
}
