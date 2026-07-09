import { loginUser, registerUser, logoutUser, getAuthToken, authenticatedFetch, requestPasswordReset } from './auth.js';
import { API_BASE } from './analytics.js';

export function initAuthUI() {
    const modal = document.getElementById('auth-modal');
    const closeBtn = document.getElementById('auth-modal-close');
    const tabs = document.querySelectorAll('.auth-tab');
    const tabContents = document.querySelectorAll('.auth-tab-content');

    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const forgotForm = document.getElementById('forgot-form');
    const loginError = document.getElementById('login-error');
    const registerError = document.getElementById('register-error');
    const forgotError = document.getElementById('forgot-error');
    const forgotSuccess = document.getElementById('forgot-success');

    const forgotTrigger = document.getElementById('forgot-password-trigger');
    const backToLoginTrigger = document.getElementById('back-to-login-trigger');
    const modalTabs = document.querySelector('.auth-modal-tabs');

    const registerPasswordInput = document.getElementById('register-password');
    const registerConfirmPasswordInput = document.getElementById('register-confirm-password');
    const registerSubmitBtn = document.getElementById('register-submit-btn');
    const confirmMatchText = document.getElementById('confirm-match-text');

    const reqLength = document.getElementById('req-length');
    const reqUpper = document.getElementById('req-upper');
    const reqNumber = document.getElementById('req-number');
    const reqSpecial = document.getElementById('req-special');

    const pwStrengthBar = document.getElementById('pw-strength-bar');
    const pwStrengthText = document.getElementById('pw-strength-text');

    // Helper to reset password visibility state
    function resetPasswordVisibility() {
        const toggleBtns = document.querySelectorAll('.password-toggle-btn');
        toggleBtns.forEach(btn => {
            const targetId = btn.getAttribute('data-toggle-target');
            const input = document.getElementById(targetId);
            if (input && input.type === 'text') {
                input.type = 'password';
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.className = 'fas fa-eye';
                }
                btn.setAttribute('aria-label', 'Show password');
            }
        });
    }

    // Show modal via custom event
    window.addEventListener('request-login-modal', () => {
        modal.classList.remove('hidden');
        switchTab('login');
    });

    // Close modal
    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        resetPasswordVisibility();
    });

    // Close on click outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
            resetPasswordVisibility();
        }
    });

    // Tab switching
    function switchTab(tabId) {
        resetPasswordVisibility();
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        if (tabId === 'forgot') {
            if (modalTabs) modalTabs.classList.add('hidden');
            const forgotTab = document.getElementById('auth-tab-forgot');
            if (forgotTab) forgotTab.classList.add('active');
        } else {
            if (modalTabs) modalTabs.classList.remove('hidden');
            const targetTab = document.querySelector(`.auth-tab[data-tab="${tabId}"]`);
            if (targetTab) targetTab.classList.add('active');
            const targetContent = document.getElementById(`auth-tab-${tabId}`);
            if (targetContent) targetContent.classList.add('active');
        }

        loginError.textContent = '';
        registerError.textContent = '';
        if (forgotError) forgotError.textContent = '';
        if (forgotSuccess) {
            forgotSuccess.textContent = '';
            forgotSuccess.style.display = 'none';
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    if (forgotTrigger) {
        forgotTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab('forgot');
        });
    }

    if (backToLoginTrigger) {
        backToLoginTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab('login');
        });
    }

    // Setup Password Visibility Toggle
    const passwordToggleBtns = document.querySelectorAll('.password-toggle-btn');
    passwordToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-toggle-target');
            const input = document.getElementById(targetId);
            if (!input) return;

            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';

            // Toggle eye icon class
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
            }

            // Update screen reader accessibility attributes
            btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        });
    });

    // Real-time Password Validation for Registration
    function updatePasswordValidation() {
        if (!registerPasswordInput) return;

        const val = registerPasswordInput.value;
        const confirmVal = registerConfirmPasswordInput ? registerConfirmPasswordInput.value : '';

        // 1. Check criteria
        const hasLength = val.length >= 8;
        const hasUpper = /[A-Z]/.test(val);
        const hasNumber = /[0-9]/.test(val);
        const hasSpecial = /[^A-Za-z0-9]/.test(val);

        // Update Checklist UI
        function toggleCheckItem(el, isValid) {
            if (!el) return;
            const icon = el.querySelector('i');
            if (isValid) {
                el.className = 'checklist-item valid';
                if (icon) icon.className = 'fas fa-check-circle';
            } else {
                if (val.length > 0) {
                    el.className = 'checklist-item invalid';
                    if (icon) icon.className = 'fas fa-times-circle';
                } else {
                    el.className = 'checklist-item';
                    if (icon) icon.className = 'far fa-circle';
                }
            }
        }

        toggleCheckItem(reqLength, hasLength);
        toggleCheckItem(reqUpper, hasUpper);
        toggleCheckItem(reqNumber, hasNumber);
        toggleCheckItem(reqSpecial, hasSpecial);

        // 2. Strength Calculation
        let score = 0;
        if (val.length > 0) {
            if (hasLength) score++;
            if (hasUpper) score++;
            if (hasNumber) score++;
            if (hasSpecial) score++;
        }

        if (pwStrengthBar && pwStrengthText) {
            pwStrengthBar.className = 'password-strength-meter';
            if (val.length === 0) {
                pwStrengthBar.style.width = '0%';
                pwStrengthText.textContent = 'Strength: Weak';
                pwStrengthText.style.color = 'var(--text-muted)';
            } else {
                if (score <= 2) {
                    pwStrengthBar.classList.add('weak');
                    pwStrengthText.textContent = 'Strength: Weak';
                    pwStrengthText.style.color = 'var(--color-error)';
                } else if (score === 3) {
                    pwStrengthBar.classList.add('medium');
                    pwStrengthText.textContent = 'Strength: Medium';
                    pwStrengthText.style.color = 'var(--color-warning)';
                } else if (score === 4) {
                    pwStrengthBar.classList.add('strong');
                    pwStrengthText.textContent = 'Strength: Strong';
                    pwStrengthText.style.color = 'var(--color-success)';
                }
            }
        }

        // 3. Confirm Password equality
        let matches = false;
        if (registerConfirmPasswordInput && confirmMatchText) {
            if (confirmVal.length === 0) {
                confirmMatchText.textContent = '';
                confirmMatchText.className = 'confirm-password-match-text';
            } else if (val === confirmVal) {
                confirmMatchText.textContent = 'Passwords match';
                confirmMatchText.className = 'confirm-password-match-text valid';
                matches = true;
            } else {
                confirmMatchText.textContent = 'Passwords do not match';
                confirmMatchText.className = 'confirm-password-match-text invalid';
            }
        } else {
            matches = val === confirmVal;
        }

        // 4. Submit button enablement
        const allCriteriaMet = hasLength && hasUpper && hasNumber && hasSpecial;
        if (registerSubmitBtn) {
            registerSubmitBtn.disabled = !(allCriteriaMet && matches);
        }
    }

    if (registerPasswordInput) {
        registerPasswordInput.addEventListener('input', updatePasswordValidation);
    }
    if (registerConfirmPasswordInput) {
        registerConfirmPasswordInput.addEventListener('input', updatePasswordValidation);
    }

    // Handle Login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const btn = loginForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;

        try {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            btn.disabled = true;
            loginError.textContent = '';

            await loginUser(email, password);

            // Success
            loginForm.reset();
            modal.classList.add('hidden');
            window.dispatchEvent(new Event('auth-changed'));

        } catch (err) {
            loginError.textContent = err.message || 'Login failed. Please try again.';
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    // Handle Register
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const btn = registerForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;

        try {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            btn.disabled = true;
            registerError.textContent = '';

            await registerUser(email, password);

            // Success
            registerForm.reset();
            if (typeof updatePasswordValidation === 'function') {
                updatePasswordValidation();
            }
            modal.classList.add('hidden');
            window.dispatchEvent(new Event('auth-changed'));

        } catch (err) {
            registerError.textContent = err.message || 'Registration failed. Please try again.';
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    // Handle Forgot Password
    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('forgot-email').value;
            const btn = forgotForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;

            try {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
                btn.disabled = true;
                forgotError.textContent = '';
                forgotSuccess.textContent = '';
                forgotSuccess.style.display = 'none';

                await requestPasswordReset(email);

                // Success
                forgotSuccess.textContent = 'Reset link sent!';
                forgotSuccess.style.display = 'block';
                forgotForm.reset();
            } catch (err) {
                forgotError.textContent = err.message || 'Failed to send reset link. Please try again.';
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // Setup Navigation UI
    setupNavUI();
    window.addEventListener('auth-changed', setupNavUI);
}

async function setupNavUI() {
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (!themeToggleBtn) return;
    const parentContainer = themeToggleBtn.parentElement;

    // Remove existing auth container if it exists
    const existing = document.querySelector('.nav-auth-container');
    if (existing) existing.remove();

    const authContainer = document.createElement('div');
    authContainer.className = 'nav-auth-container';

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

                const profileBtn = document.getElementById('nav-user-btn');
                const dropdown = document.getElementById('nav-user-dropdown');
                const logoutBtn = document.getElementById('nav-logout-btn');

                profileBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isExpanded = dropdown.classList.contains('show');
                    dropdown.classList.toggle('show');
                    profileBtn.setAttribute('aria-expanded', !isExpanded);
                });

                document.addEventListener('click', () => {
                    dropdown.classList.remove('show');
                    profileBtn.setAttribute('aria-expanded', 'false');
                });

                logoutBtn.addEventListener('click', async () => {
                    await logoutUser();
                });

                return; // Successfully setup logged-in state
            } else {
                // Token invalid, clear it
                localStorage.removeItem('rj_access_token');
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

    document.getElementById('nav-login-btn').addEventListener('click', () => {
        window.dispatchEvent(new Event('request-login-modal'));
    });
}

// Auto-init when loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthUI);
} else {
    initAuthUI();
}
