import { loginUser, registerUser, logoutUser, getAuthToken, authenticatedFetch, requestPasswordReset, resetPassword, changePassword, deleteAccount, setup2FA, enable2FA, verify2FA, requestMagicLink, verifyMagicLink, fetchActiveSessions, revokeOtherSessions, revokeSpecificSession, clearTokens } from './auth.js';
import { API_BASE } from './analytics.js';
import { closeAllDropdowns } from './navigation.js';
import { ModalSwipeDismiss } from './swipe-handler.js';

export async function initAuthUI() {
    const modal = document.getElementById('auth-modal');
    if (modal) {
        new ModalSwipeDismiss(modal, () => {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        });
    }
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

    const changePasswordForm = document.getElementById('change-password-form');
    const changeCurrentPasswordInput = document.getElementById('change-current-password');
    const changeNewPasswordInput = document.getElementById('change-new-password');
    const changeConfirmPasswordInput = document.getElementById('change-confirm-password');
    const changePwSubmitBtn = document.getElementById('change-pw-submit-btn');
    const changeConfirmMatchText = document.getElementById('change-confirm-match-text');
    const changePwError = document.getElementById('change-pw-error');
    const changePwSuccess = document.getElementById('change-pw-success');

    const changeReqLength = document.getElementById('change-req-length');
    const changeReqUpper = document.getElementById('change-req-upper');
    const changeReqNumber = document.getElementById('change-req-number');
    const changeReqSpecial = document.getElementById('change-req-special');

    const changePwStrengthBar = document.getElementById('change-pw-strength-bar');
    const changePwStrengthText = document.getElementById('change-pw-strength-text');

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

    window.addEventListener('request-change-password-modal', () => {
        modal.classList.remove('hidden');
        switchTab('change-password');
    });

    window.addEventListener('request-delete-account-modal', () => {
        modal.classList.remove('hidden');
        switchTab('delete-account');
    });

    window.addEventListener('request-magic-link-modal', () => {
        modal.classList.remove('hidden');
        switchTab('magic-link');
    });

    window.addEventListener('request-2fa-setup-modal', async () => {
        modal.classList.remove('hidden');
        switchTab('2fa-setup');
        try {
            const data = await setup2FA();
            const qrImg = document.getElementById('2fa-qr-img');
            const secretText = document.getElementById('2fa-secret-text');
            if (qrImg) qrImg.src = data.qr_code;
            if (secretText) secretText.textContent = data.secret;
        } catch (e) {
            const errEl = document.getElementById('2fa-enable-error');
            if (errEl) errEl.textContent = e.message || 'Failed to initialize 2FA setup.';
        }
    });

    window.addEventListener('request-sessions-modal', async () => {
        modal.classList.remove('hidden');
        switchTab('sessions');
        await loadActiveSessionsUI();
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
    const hiddenTabIds = ['forgot', 'change-password', 'reset-password', 'delete-account', 'magic-link', '2fa-verify', '2fa-setup', 'sessions'];
    function switchTab(tabId) {
        resetPasswordVisibility();
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        if (hiddenTabIds.includes(tabId)) {
            if (modalTabs) modalTabs.classList.add('hidden');
            const targetTab = document.getElementById(`auth-tab-${tabId}`);
            if (targetTab) targetTab.classList.add('active');
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
        const fieldsToClear = ['change-pw-error', 'reset-pw-error', 'delete-account-error', 'magic-link-error', '2fa-verify-error', '2fa-enable-error', 'sessions-error'];
        fieldsToClear.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        });
        const successToHide = ['change-pw-success', 'reset-pw-success', 'delete-account-success', 'magic-link-success', '2fa-enable-success'];
        successToHide.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent = ''; el.style.display = 'none'; }
        });
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
        const email = (document.getElementById('login-email')?.value || '').trim();
        const password = document.getElementById('login-password')?.value || '';
        const btn = loginForm.querySelector('button[type="submit"]');
        const originalText = btn.innerHTML;

        try {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
            btn.disabled = true;
            loginError.textContent = '';

            const res = await loginUser(email, password);

            if (res && res.requires_2fa) {
                const preInput = document.getElementById('2fa-pre-auth-token-input');
                if (preInput) preInput.value = res.pre_auth_token;
                switchTab('2fa-verify');
                return;
            }

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

    const magicLinkTrigger = document.getElementById('magic-link-trigger');
    const magicBackToLoginTrigger = document.getElementById('magic-back-to-login-trigger');
    if (magicLinkTrigger) {
        magicLinkTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab('magic-link');
        });
    }
    if (magicBackToLoginTrigger) {
        magicBackToLoginTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab('login');
        });
    }

    const magicLinkForm = document.getElementById('magic-link-form');
    if (magicLinkForm) {
        magicLinkForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = (document.getElementById('magic-link-email')?.value || '').trim();
            const btn = magicLinkForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            const magicError = document.getElementById('magic-link-error');
            const magicSuccess = document.getElementById('magic-link-success');

            try {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
                btn.disabled = true;
                if (magicError) magicError.textContent = '';
                if (magicSuccess) { magicSuccess.textContent = ''; magicSuccess.style.display = 'none'; }

                await requestMagicLink(email);

                if (magicSuccess) {
                    magicSuccess.textContent = 'Magic link sent! Check your email.';
                    magicSuccess.style.display = 'block';
                }
                magicLinkForm.reset();
            } catch (err) {
                if (magicError) magicError.textContent = err.message || 'Failed to send magic link.';
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    const twoFactorVerifyForm = document.getElementById('2fa-verify-form');
    if (twoFactorVerifyForm) {
        twoFactorVerifyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const preAuthToken = document.getElementById('2fa-pre-auth-token-input').value;
            const code = document.getElementById('2fa-verify-code').value;
            const btn = twoFactorVerifyForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            const verifyError = document.getElementById('2fa-verify-error');

            try {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
                btn.disabled = true;
                if (verifyError) verifyError.textContent = '';

                await verify2FA(preAuthToken, code);

                twoFactorVerifyForm.reset();
                modal.classList.add('hidden');
                window.dispatchEvent(new Event('auth-changed'));
            } catch (err) {
                if (verifyError) verifyError.textContent = err.message || 'Invalid 2FA code.';
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    const twoFactorEnableForm = document.getElementById('2fa-enable-form');
    if (twoFactorEnableForm) {
        twoFactorEnableForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('2fa-enable-code').value;
            const btn = twoFactorEnableForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;
            const enableError = document.getElementById('2fa-enable-error');
            const enableSuccess = document.getElementById('2fa-enable-success');

            try {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enabling...';
                btn.disabled = true;
                if (enableError) enableError.textContent = '';
                if (enableSuccess) { enableSuccess.textContent = ''; enableSuccess.style.display = 'none'; }

                await enable2FA(code);

                if (enableSuccess) {
                    enableSuccess.textContent = '2FA successfully enabled!';
                    enableSuccess.style.display = 'block';
                }
                twoFactorEnableForm.reset();
                setTimeout(() => {
                    modal.classList.add('hidden');
                    window.dispatchEvent(new Event('auth-changed'));
                }, 1500);
            } catch (err) {
                if (enableError) enableError.textContent = err.message || 'Failed to enable 2FA.';
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    async function loadActiveSessionsUI() {
        const container = document.getElementById('sessions-list');
        const errEl = document.getElementById('sessions-error');
        if (!container) return;
        try {
            if (errEl) errEl.textContent = '';
            container.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">Loading active sessions...</p>';
            const sessions = await fetchActiveSessions();
            if (!sessions || sessions.length === 0) {
                container.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted);">No active sessions found.</p>';
                return;
            }
            container.innerHTML = sessions.map(s => `
                <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-color, #cdd6f4);">
                            <i class="fas fa-${(s.device_type || 'desktop').toLowerCase().includes('mobile') ? 'mobile-screen' : 'laptop'}"></i> ${s.device_type || 'Desktop Device'}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-muted, #a6adc8);">IP: ${s.ip_address}</div>
                    </div>
                    <button type="button" class="btn-revoke-session" data-session-id="${s.session_id}" style="background: none; border: 1px solid var(--color-error, #f38ba8); color: var(--color-error, #f38ba8); padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">
                        Revoke
                    </button>
                </div>
            `).join('');

            container.querySelectorAll('.btn-revoke-session').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sid = btn.getAttribute('data-session-id');
                    btn.disabled = true;
                    btn.textContent = 'Revoking...';
                    try {
                        await revokeSpecificSession(sid);
                        await loadActiveSessionsUI();
                    } catch (e) {
                        if (errEl) errEl.textContent = e.message || 'Failed to revoke session.';
                    }
                });
            });
        } catch (e) {
            if (errEl) errEl.textContent = e.message || 'Failed to load active sessions.';
        }
    }

    const revokeOthersBtn = document.getElementById('revoke-others-btn');
    if (revokeOthersBtn) {
        revokeOthersBtn.addEventListener('click', async () => {
            const errEl = document.getElementById('sessions-error');
            try {
                revokeOthersBtn.disabled = true;
                revokeOthersBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging out...';
                await revokeOtherSessions();
                await loadActiveSessionsUI();
            } catch (e) {
                if (errEl) errEl.textContent = e.message || 'Failed to revoke other sessions.';
            } finally {
                revokeOthersBtn.disabled = false;
                revokeOthersBtn.innerHTML = 'Log Out All Other Devices <i class="fas fa-right-from-bracket"></i>';
            }
        });
    }

    // Handle Register
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = (document.getElementById('register-email')?.value || '').trim();
            const password = document.getElementById('register-password')?.value || '';
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
    }

    // Handle Forgot Password
    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = (document.getElementById('forgot-email')?.value || '').trim();
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
    // Real-time Password Validation for Change Password
    function updateChangePasswordValidation() {
        if (!changeNewPasswordInput) return;

        const val = changeNewPasswordInput.value;
        const confirmVal = changeConfirmPasswordInput ? changeConfirmPasswordInput.value : '';

        const hasLength = val.length >= 8;
        const hasUpper = /[A-Z]/.test(val);
        const hasNumber = /[0-9]/.test(val);
        const hasSpecial = /[^A-Za-z0-9]/.test(val);

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

        toggleCheckItem(changeReqLength, hasLength);
        toggleCheckItem(changeReqUpper, hasUpper);
        toggleCheckItem(changeReqNumber, hasNumber);
        toggleCheckItem(changeReqSpecial, hasSpecial);

        let score = 0;
        if (val.length > 0) {
            if (hasLength) score++;
            if (hasUpper) score++;
            if (hasNumber) score++;
            if (hasSpecial) score++;
        }

        if (changePwStrengthBar && changePwStrengthText) {
            changePwStrengthBar.className = 'password-strength-meter';
            if (val.length === 0) {
                changePwStrengthBar.style.width = '0%';
                changePwStrengthText.textContent = 'Strength: Weak';
                changePwStrengthText.style.color = 'var(--text-muted)';
            } else {
                if (score <= 2) {
                    changePwStrengthBar.classList.add('weak');
                    changePwStrengthText.textContent = 'Strength: Weak';
                    changePwStrengthText.style.color = 'var(--color-error)';
                } else if (score === 3) {
                    changePwStrengthBar.classList.add('medium');
                    changePwStrengthText.textContent = 'Strength: Medium';
                    changePwStrengthText.style.color = 'var(--color-warning)';
                } else if (score === 4) {
                    changePwStrengthBar.classList.add('strong');
                    changePwStrengthText.textContent = 'Strength: Strong';
                    changePwStrengthText.style.color = 'var(--color-success)';
                }
            }
        }

        let matches = false;
        if (changeConfirmPasswordInput && changeConfirmMatchText) {
            if (confirmVal.length === 0) {
                changeConfirmMatchText.textContent = '';
                changeConfirmMatchText.className = 'confirm-password-match-text';
            } else if (val === confirmVal) {
                changeConfirmMatchText.textContent = 'Passwords match';
                changeConfirmMatchText.className = 'confirm-password-match-text valid';
                matches = true;
            } else {
                changeConfirmMatchText.textContent = 'Passwords do not match';
                changeConfirmMatchText.className = 'confirm-password-match-text invalid';
            }
        } else {
            matches = val === confirmVal;
        }

        const allCriteriaMet = hasLength && hasUpper && hasNumber && hasSpecial;
        const hasCurrentPassword = changeCurrentPasswordInput && changeCurrentPasswordInput.value.length > 0;
        if (changePwSubmitBtn) {
            changePwSubmitBtn.disabled = !(allCriteriaMet && matches && hasCurrentPassword);
        }
    }

    if (changeCurrentPasswordInput) changeCurrentPasswordInput.addEventListener('input', updateChangePasswordValidation);
    if (changeNewPasswordInput) changeNewPasswordInput.addEventListener('input', updateChangePasswordValidation);
    if (changeConfirmPasswordInput) changeConfirmPasswordInput.addEventListener('input', updateChangePasswordValidation);

    // Handle Change Password Form Submit
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = changeCurrentPasswordInput.value;
            const newPassword = changeNewPasswordInput.value;
            const btn = changePasswordForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;

            try {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
                btn.disabled = true;
                if (changePwError) changePwError.textContent = '';
                if (changePwSuccess) {
                    changePwSuccess.textContent = '';
                    changePwSuccess.style.display = 'none';
                }

                await changePassword(currentPassword, newPassword);

                if (changePwSuccess) {
                    changePwSuccess.textContent = 'Password changed successfully!';
                    changePwSuccess.style.display = 'block';
                }
                changePasswordForm.reset();
                updateChangePasswordValidation();

                setTimeout(() => {
                    modal.classList.add('hidden');
                }, 1500);
            } catch (err) {
                if (changePwError) {
                    changePwError.textContent = err.message || 'Failed to change password. Please try again.';
                }
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // Reset Password Form Handling & Real-time Validation
    const resetPasswordForm = document.getElementById('reset-password-form');
    const resetTokenInput = document.getElementById('reset-token-input');
    const resetNewPasswordInput = document.getElementById('reset-new-password');
    const resetConfirmPasswordInput = document.getElementById('reset-confirm-password');
    const resetPwSubmitBtn = document.getElementById('reset-pw-submit-btn');
    const resetConfirmMatchText = document.getElementById('reset-confirm-match-text');
    const resetPwError = document.getElementById('reset-pw-error');
    const resetPwSuccess = document.getElementById('reset-pw-success');

    const resetReqLength = document.getElementById('reset-req-length');
    const resetReqUpper = document.getElementById('reset-req-upper');
    const resetReqNumber = document.getElementById('reset-req-number');
    const resetReqSpecial = document.getElementById('reset-req-special');

    const resetPwStrengthBar = document.getElementById('reset-pw-strength-bar');
    const resetPwStrengthText = document.getElementById('reset-pw-strength-text');

    function updateResetPasswordValidation() {
        if (!resetNewPasswordInput) return;

        const val = resetNewPasswordInput.value;
        const confirmVal = resetConfirmPasswordInput ? resetConfirmPasswordInput.value : '';

        const hasLength = val.length >= 8;
        const hasUpper = /[A-Z]/.test(val);
        const hasNumber = /[0-9]/.test(val);
        const hasSpecial = /[^A-Za-z0-9]/.test(val);

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

        toggleCheckItem(resetReqLength, hasLength);
        toggleCheckItem(resetReqUpper, hasUpper);
        toggleCheckItem(resetReqNumber, hasNumber);
        toggleCheckItem(resetReqSpecial, hasSpecial);

        let score = 0;
        if (val.length > 0) {
            if (hasLength) score++;
            if (hasUpper) score++;
            if (hasNumber) score++;
            if (hasSpecial) score++;
        }

        if (resetPwStrengthBar && resetPwStrengthText) {
            resetPwStrengthBar.className = 'password-strength-meter';
            if (val.length === 0) {
                resetPwStrengthBar.style.width = '0%';
                resetPwStrengthText.textContent = 'Strength: Weak';
                resetPwStrengthText.style.color = 'var(--text-muted)';
            } else {
                if (score <= 2) {
                    resetPwStrengthBar.classList.add('weak');
                    resetPwStrengthText.textContent = 'Strength: Weak';
                    resetPwStrengthText.style.color = 'var(--color-error)';
                } else if (score === 3) {
                    resetPwStrengthBar.classList.add('medium');
                    resetPwStrengthText.textContent = 'Strength: Medium';
                    resetPwStrengthText.style.color = 'var(--color-warning)';
                } else if (score === 4) {
                    resetPwStrengthBar.classList.add('strong');
                    resetPwStrengthText.textContent = 'Strength: Strong';
                    resetPwStrengthText.style.color = 'var(--color-success)';
                }
            }
        }

        let matches = false;
        if (resetConfirmPasswordInput && resetConfirmMatchText) {
            if (confirmVal.length === 0) {
                resetConfirmMatchText.textContent = '';
                resetConfirmMatchText.className = 'confirm-password-match-text';
            } else if (val === confirmVal) {
                resetConfirmMatchText.textContent = 'Passwords match';
                resetConfirmMatchText.className = 'confirm-password-match-text valid';
                matches = true;
            } else {
                resetConfirmMatchText.textContent = 'Passwords do not match';
                resetConfirmMatchText.className = 'confirm-password-match-text invalid';
            }
        } else {
            matches = val === confirmVal;
        }

        const allCriteriaMet = hasLength && hasUpper && hasNumber && hasSpecial;
        if (resetPwSubmitBtn) {
            resetPwSubmitBtn.disabled = !(allCriteriaMet && matches);
        }
    }

    if (resetNewPasswordInput) {
        resetNewPasswordInput.addEventListener('input', updateResetPasswordValidation);
    }
    if (resetConfirmPasswordInput) {
        resetConfirmPasswordInput.addEventListener('input', updateResetPasswordValidation);
    }

    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = resetTokenInput ? resetTokenInput.value : '';
            const newPassword = resetNewPasswordInput ? resetNewPasswordInput.value : '';
            const btn = resetPasswordForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;

            try {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
                btn.disabled = true;
                if (resetPwError) resetPwError.textContent = '';
                if (resetPwSuccess) {
                    resetPwSuccess.textContent = '';
                    resetPwSuccess.style.display = 'none';
                }

                const result = await resetPassword(token, newPassword);

                if (resetPwSuccess) {
                    resetPwSuccess.textContent = result.message || 'Password reset successfully!';
                    resetPwSuccess.style.display = 'block';
                }
                resetPasswordForm.reset();
                updateResetPasswordValidation();

                setTimeout(() => {
                    switchTab('login');
                }, 2000);
            } catch (err) {
                if (resetPwError) {
                    resetPwError.textContent = err.message || 'Failed to reset password. Please try again.';
                }
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // Delete Account Form Handling & Real-time Validation
    const deleteAccountForm = document.getElementById('delete-account-form');
    const deleteCurrentPasswordInput = document.getElementById('delete-current-password');
    const deleteConfirmPhraseInput = document.getElementById('delete-confirm-phrase');
    const deleteAccountSubmitBtn = document.getElementById('delete-account-submit-btn');
    const deleteAccountError = document.getElementById('delete-account-error');
    const deleteAccountSuccess = document.getElementById('delete-account-success');

    function updateDeleteAccountValidation() {
        if (!deleteCurrentPasswordInput || !deleteConfirmPhraseInput || !deleteAccountSubmitBtn) return;
        const hasPw = deleteCurrentPasswordInput.value.length > 0;
        const phraseMatch = deleteConfirmPhraseInput.value.trim().toUpperCase() === 'DELETE';
        deleteAccountSubmitBtn.disabled = !(hasPw && phraseMatch);
    }

    if (deleteCurrentPasswordInput) deleteCurrentPasswordInput.addEventListener('input', updateDeleteAccountValidation);
    if (deleteConfirmPhraseInput) deleteConfirmPhraseInput.addEventListener('input', updateDeleteAccountValidation);

    if (deleteAccountForm) {
        deleteAccountForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = deleteCurrentPasswordInput.value;
            const phrase = deleteConfirmPhraseInput.value;
            const btn = deleteAccountForm.querySelector('button[type="submit"]');
            const originalText = btn.innerHTML;

            try {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
                btn.disabled = true;
                if (deleteAccountError) deleteAccountError.textContent = '';
                if (deleteAccountSuccess) {
                    deleteAccountSuccess.textContent = '';
                    deleteAccountSuccess.style.display = 'none';
                }

                const result = await deleteAccount(currentPassword, phrase);

                if (deleteAccountSuccess) {
                    deleteAccountSuccess.textContent = result.message || 'Account scheduled for deletion!';
                    deleteAccountSuccess.style.display = 'block';
                }
                deleteAccountForm.reset();
                updateDeleteAccountValidation();

                setTimeout(async () => {
                    modal.classList.add('hidden');
                    await logoutUser();
                }, 1800);
            } catch (err) {
                if (deleteAccountError) {
                    deleteAccountError.textContent = err.message || 'Failed to delete account. Please try again.';
                }
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }

    // Check URL query parameters for reset_token or magic_token
    const urlParams = new URLSearchParams(window.location.search);
    const resetTokenParam = urlParams.get('reset_token');
    if (resetTokenParam) {
        if (resetTokenInput) resetTokenInput.value = resetTokenParam;
        if (modal) modal.classList.remove('hidden');
        switchTab('reset-password');
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
    }

    const magicTokenParam = urlParams.get('magic_token');
    if (magicTokenParam) {
        (async () => {
            try {
                if (modal) modal.classList.remove('hidden');
                const result = await verifyMagicLink(magicTokenParam);
                if (result.requires_2fa) {
                    const preInput = document.getElementById('2fa-pre-auth-token-input');
                    if (preInput) preInput.value = result.pre_auth_token;
                    switchTab('2fa-verify');
                } else {
                    modal.classList.add('hidden');
                    window.dispatchEvent(new Event('auth-changed'));
                }
            } catch (e) {
                switchTab('login');
                if (loginError) loginError.textContent = e.message || 'Magic link verification failed.';
            }
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
        })();
    }

    // Setup Navigation UI
    setupNavUI();
    window.addEventListener('auth-changed', setupNavUI);
}

async function setupNavUI() {
    let authContainer = document.getElementById('nav-auth-container') || document.querySelector('.nav-auth-container');
    if (!authContainer) {
        const parentContainer = document.querySelector('.header-actions');
        if (!parentContainer) return;

        const themeToggleBtn = document.getElementById('theme-toggle') || document.getElementById('hamburger-toggle');
        authContainer = document.createElement('div');
        authContainer.className = 'nav-auth-container';
        authContainer.id = 'nav-auth-container';
        if (themeToggleBtn) {
            parentContainer.insertBefore(authContainer, themeToggleBtn);
        } else {
            parentContainer.appendChild(authContainer);
        }
    }

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
                        <button class="nav-dropdown-item" id="nav-2fa-btn">
                            <i class="fas fa-shield-halved"></i> ${user.is_totp_enabled ? '2FA Enabled' : 'Setup 2FA'}
                        </button>
                        <button class="nav-dropdown-item" id="nav-sessions-btn">
                            <i class="fas fa-laptop"></i> Active Devices
                        </button>
                        <button class="nav-dropdown-item" id="nav-change-pw-btn">
                            <i class="fas fa-key"></i> Change Password
                        </button>
                        <button class="nav-dropdown-item nav-dropdown-item--danger" id="nav-delete-account-btn" style="color: var(--color-error, #f38ba8);">
                            <i class="fas fa-trash-can" style="color: var(--color-error, #f38ba8);"></i> Delete Account
                        </button>
                        <button class="nav-dropdown-item" id="nav-logout-btn">
                            <i class="fas fa-right-from-bracket"></i> Logout
                        </button>
                    </div>
                `;

                const profileBtn = document.getElementById('nav-user-btn');
                const dropdown = document.getElementById('nav-user-dropdown');
                const btn2FA = document.getElementById('nav-2fa-btn');
                const sessionsBtn = document.getElementById('nav-sessions-btn');
                const changePwBtn = document.getElementById('nav-change-pw-btn');
                const deleteAccountBtn = document.getElementById('nav-delete-account-btn');
                const logoutBtn = document.getElementById('nav-logout-btn');

                profileBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isExpanded = dropdown.classList.contains('show');
                    closeAllDropdowns();
                    if (!isExpanded) {
                        dropdown.classList.add('show');
                        profileBtn.setAttribute('aria-expanded', 'true');
                    }
                });

                document.addEventListener('click', (e) => {
                    if (dropdown && !dropdown.contains(e.target) && !profileBtn.contains(e.target)) {
                        dropdown.classList.remove('show');
                        profileBtn.setAttribute('aria-expanded', 'false');
                    }
                });

                if (btn2FA) {
                    btn2FA.addEventListener('click', () => {
                        dropdown.classList.remove('show');
                        window.dispatchEvent(new Event('request-2fa-setup-modal'));
                    });
                }

                if (sessionsBtn) {
                    sessionsBtn.addEventListener('click', () => {
                        dropdown.classList.remove('show');
                        window.dispatchEvent(new Event('request-sessions-modal'));
                    });
                }

                if (changePwBtn) {
                    changePwBtn.addEventListener('click', () => {
                        dropdown.classList.remove('show');
                        window.dispatchEvent(new Event('request-change-password-modal'));
                    });
                }

                if (deleteAccountBtn) {
                    deleteAccountBtn.addEventListener('click', () => {
                        dropdown.classList.remove('show');
                        window.dispatchEvent(new Event('request-delete-account-modal'));
                    });
                }

                logoutBtn.addEventListener('click', async () => {
                    await logoutUser();
                });

                return; // Successfully setup logged-in state
            } else {
                // Token invalid or unauthenticated, clear tokens
                clearTokens();
            }
        } catch (e) {
            console.error("Failed to fetch user profile", e);
            clearTokens();
        }
    }

    // Logged out state
    authContainer.innerHTML = `
        <button class="header-icon-btn nav-auth-btn" id="nav-login-btn" title="Log In" aria-label="Log In">
            <i class="fas fa-right-to-bracket"></i>
        </button>
    `;

    const loginBtn = document.getElementById('nav-login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            window.dispatchEvent(new Event('request-login-modal'));
        });
    }
}

// Global delegated click listener for login button navigation
document.addEventListener('click', (e) => {
    const loginTrigger = e.target.closest('#nav-login-btn');
    if (loginTrigger) {
        window.dispatchEvent(new Event('request-login-modal'));
    }
});

// Auto-init when loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthUI);
} else {
    initAuthUI();
}
