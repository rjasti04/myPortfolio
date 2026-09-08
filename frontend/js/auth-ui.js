import { loginUser, registerUser, logoutUser, getAuthToken, authenticatedFetch, requestPasswordReset, resetPassword, changePassword, deleteAccount, setup2FA, enable2FA, verify2FA, requestMagicLink, verifyMagicLink, fetchActiveSessions, revokeOtherSessions, revokeSpecificSession, clearTokens } from './auth.js';
import { API_BASE } from './analytics.js';
import { closeAllDropdowns } from './navigation.js';
import { closeModal, openModal } from './modal.js';
import { confirmAction } from './confirm-dialog.js';
import { showToast } from './utils.js';

/* --- Submit readiness ---------------------------------------------------
   Four forms used to set `submitBtn.disabled` from a live validity check. A
   disabled button is not focusable and announces nothing, so a keyboard or
   screen-reader user tabbed past it and found the form had no way forward and
   no statement of why. The contact form in this same codebase takes the
   opposite approach: stay enabled, report on attempt. These two helpers make
   that the rule here as well - readiness is recorded on the element, and the
   submit handler turns "not ready" into a message in the form's existing
   role="alert" node plus focus on the field to fix. */
function setSubmitReadiness(btn, ready, reason) {
    if (!btn) return;
    btn.dataset.ready = String(ready);
    btn.dataset.blockedReason = ready ? '' : reason;
    // Announced, not enforced: the button stays operable.
    btn.setAttribute('aria-disabled', String(!ready));
}

function blockedBeforeSubmit(btn, errorEl, focusTarget) {
    if (!btn || btn.dataset.ready !== 'false') return false;
    if (errorEl) errorEl.textContent = btn.dataset.blockedReason || 'Please complete every field.';
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
    return true;
}

export async function initAuthUI() {
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


    // The auth modal is a real dialog and now behaves like one. modal.js already
    // implements the focus trap, Escape, reference-counted scroll lock and focus
    // restore used by the image and project dialogs; this routes the auth modal
    // through the same code instead of toggling a class.
    //
    // `hidden` drives the CSS (visibility/opacity); `active` is what modal.js
    // keys its own state on. Both are needed, and `hidden` has to come off
    // before openModal runs or there is nothing focusable to move focus to.
    const TAB_TITLE_IDS = {
        login: 'auth-modal-title',
        register: 'auth-title-register',
        forgot: 'auth-title-forgot',
        'reset-password': 'auth-title-reset-password',
        'change-password': 'auth-title-change-password',
        'magic-link': 'auth-title-magic-link',
        '2fa-verify': 'auth-title-2fa-verify',
        '2fa-setup': 'auth-title-2fa-setup',
        sessions: 'auth-title-sessions',
        'delete-account': 'auth-title-delete-account',
    };

    function firstFieldOf(tabId) {
        const panel = document.getElementById(`auth-tab-${tabId}`);
        return panel?.querySelector('input:not([type="hidden"]):not([disabled]), textarea, select') || null;
    }

    function openAuthModal(tabId) {
        modal.classList.remove('hidden');
        // Cleared explicitly: a swipe-dismiss used to leave aria-hidden="true"
        // behind, and nothing removed it, so every later open was invisible to
        // screen readers.
        modal.removeAttribute('aria-hidden');
        switchTab(tabId);
        // The `hidden` bookkeeping hangs off onClose rather than living only in
        // closeAuthModal, because modal.js closes this dialog itself on Escape
        // and on swipe-dismiss. Without the hook those paths released the scroll
        // lock but left the overlay on screen.
        openModal(modal, {
            initialFocus: firstFieldOf(tabId),
            onClose: () => {
                modal.classList.add('hidden');
                resetPasswordVisibility();
                // renderAuthUI rebuilds #nav-auth-container with innerHTML, so
                // the button that opened the dialog may no longer be in the
                // document. modal.js would then focus a detached node and
                // focus would land on <body>.
                requestAnimationFrame(() => {
                    if (document.activeElement && document.activeElement !== document.body) return;
                    const fallback = document.getElementById('nav-login-btn')
                        || document.getElementById('nav-user-btn');
                    fallback?.focus();
                });
            },
        });
    }

    function closeAuthModal() {
        // closeModal fires the onClose above, which restores `hidden`.
        closeModal(modal);
    }

    // Show modal via custom event
    window.addEventListener('request-login-modal', () => {
        openAuthModal('login');
    });

    window.addEventListener('request-change-password-modal', () => {
        openAuthModal('change-password');
    });

    window.addEventListener('request-delete-account-modal', () => {
        openAuthModal('delete-account');
    });

    window.addEventListener('request-magic-link-modal', () => {
        openAuthModal('magic-link');
    });

    window.addEventListener('request-2fa-setup-modal', async () => {
        openAuthModal('2fa-setup');
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
        openAuthModal('sessions');
        await loadActiveSessionsUI();
    });

    // Close modal
    closeBtn.addEventListener('click', () => {
        closeAuthModal();
    });

    // Close on click outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeAuthModal();
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

        // Roving tabindex + selection state for the two real tabs. Without this
        // they were styled buttons with no announced state.
        tabs.forEach((tab) => {
            const selected = tab.dataset.tab === tabId;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });

        // Name the dialog after the panel actually showing. aria-labelledby was
        // pinned to the login heading, which is hidden on the other nine views,
        // leaving the dialog effectively unnamed.
        const titleId = TAB_TITLE_IDS[tabId];
        if (titleId && document.getElementById(titleId)) {
            modal.setAttribute('aria-labelledby', titleId);
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

    if (modalTabs) {
        modalTabs.addEventListener('keydown', (event) => {
            const order = Array.from(tabs);
            const current = order.indexOf(document.activeElement);
            if (current === -1) return;
            let next = null;
            if (event.key === 'ArrowRight') next = (current + 1) % order.length;
            else if (event.key === 'ArrowLeft') next = (current - 1 + order.length) % order.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = order.length - 1;
            if (next === null) return;
            event.preventDefault();
            switchTab(order[next].dataset.tab);
            order[next].focus();
        });
    }

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

        // 4. Submit readiness - recorded, not enforced by disabling.
        const allCriteriaMet = hasLength && hasUpper && hasNumber && hasSpecial;
        setSubmitReadiness(
            registerSubmitBtn,
            allCriteriaMet && matches,
            !allCriteriaMet
                ? 'Your password needs at least 8 characters, an uppercase letter, a number and a symbol.'
                : 'The two passwords do not match.'
        );
    }

    if (registerPasswordInput) {
        registerPasswordInput.addEventListener('input', updatePasswordValidation);
    }
    if (registerConfirmPasswordInput) {
        registerConfirmPasswordInput.addEventListener('input', updatePasswordValidation);
    }
    // Seeded once so readiness is never merely "unset". The four forms are
    // `required` throughout, which stops an entirely empty submit, but the
    // cross-field rules - complexity, "passwords match", the typed DELETE -
    // only ran on `input`, so a browser autofill that fires no input event
    // would have left the guard with nothing to check.
    updatePasswordValidation();


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

            // Success. The dialog just vanishes and the only other signal is
            // the nav icon swapping - small, in the header, easy to miss on a
            // phone, and announced to nobody.
            loginForm.reset();
            closeAuthModal();
            showToast('Signed in.', 'success');
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
                    magicSuccess.textContent = 'If that email has an account, a sign-in link is on its way.';
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
                closeAuthModal();
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
                    closeAuthModal();
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

    /**
     * Builds one row of the active-sessions list.
     *
     * Every value here is server data, and `device_type` derives from a
     * client-supplied User-Agent, so it is written with textContent rather
     * than interpolated into innerHTML. The whole row used to be a template
     * string of inline styles: rgba(255,255,255,0.05) on a near-white modal
     * (an invisible card with an invisible border) and a device name painted
     * `var(--text-color, #cdd6f4)` - a variable defined nowhere in the
     * project, so it always fell back to a pale grey at roughly 1.5:1.
     */
    function buildSessionRow(session, onRevoke) {
        const row = document.createElement('div');
        row.className = 'auth-session-row';

        const details = document.createElement('div');
        details.className = 'auth-session-details';

        const name = document.createElement('div');
        name.className = 'auth-session-device';
        const deviceType = session.device_type || 'Desktop Device';
        const icon = document.createElement('i');
        icon.className = deviceType.toLowerCase().includes('mobile')
            ? 'fas fa-mobile-screen'
            : 'fas fa-laptop';
        icon.setAttribute('aria-hidden', 'true');
        name.append(icon, document.createTextNode(` ${deviceType}`));

        const ip = document.createElement('div');
        ip.className = 'auth-session-ip';
        ip.textContent = `IP: ${session.ip_address ?? 'unknown'}`;

        details.append(name, ip);

        const revokeBtn = document.createElement('button');
        revokeBtn.type = 'button';
        revokeBtn.className = 'btn-revoke-session';
        revokeBtn.dataset.sessionId = session.session_id;
        revokeBtn.textContent = 'Revoke';
        revokeBtn.setAttribute('aria-label', `Revoke the session on ${deviceType}`);
        revokeBtn.addEventListener('click', () => onRevoke(session, revokeBtn, deviceType));

        row.append(details, revokeBtn);
        return row;
    }

    async function loadActiveSessionsUI() {
        const container = document.getElementById('sessions-list');
        const errEl = document.getElementById('sessions-error');
        if (!container) return;

        const note = (text) => {
            const p = document.createElement('p');
            p.className = 'auth-session-note';
            p.textContent = text;
            container.replaceChildren(p);
        };

        try {
            if (errEl) errEl.textContent = '';
            note('Loading active sessions...');
            const sessions = await fetchActiveSessions();
            if (!sessions || sessions.length === 0) {
                note('No active sessions found.');
                return;
            }

            const onRevoke = async (session, btn, deviceType) => {
                // Revoking logs a device out and cannot be undone; it used to
                // happen on a single click, in the same dialog where deleting
                // the account correctly demands a password and a typed phrase.
                const ok = await confirmAction({
                    title: 'Revoke this session?',
                    body: `The session on ${deviceType} will be signed out immediately.`,
                    confirmLabel: 'Revoke',
                });
                if (!ok) return;

                const originalText = btn.textContent;
                btn.disabled = true;
                btn.textContent = 'Revoking...';
                try {
                    await revokeSpecificSession(session.session_id);
                    await loadActiveSessionsUI();
                    showToast('Session revoked.', 'success');
                } catch (e) {
                    if (errEl) errEl.textContent = e.message || 'Failed to revoke session.';
                    // Without this the row stayed disabled reading "Revoking..."
                    // until the modal was closed and reopened - every other
                    // async handler in this file restores its button.
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            };

            container.replaceChildren(...sessions.map((session) => buildSessionRow(session, onRevoke)));
        } catch (e) {
            if (errEl) errEl.textContent = e.message || 'Failed to load active sessions.';
            note('Could not load your active sessions.');
        }
    }

    const revokeOthersBtn = document.getElementById('revoke-others-btn');
    if (revokeOthersBtn) {
        revokeOthersBtn.addEventListener('click', async () => {
            const errEl = document.getElementById('sessions-error');
            const ok = await confirmAction({
                title: 'Log out all other devices?',
                body: 'Every session except this one will be signed out immediately.',
                confirmLabel: 'Log them out',
            });
            if (!ok) return;
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
            if (blockedBeforeSubmit(btn, registerError, registerPasswordInput)) return;
            const originalText = btn.innerHTML;

            try {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
                btn.disabled = true;
                registerError.textContent = '';

                await registerUser(email, password);

                // Success
                showToast('Account created. You are signed in.', 'success');
                registerForm.reset();
                if (typeof updatePasswordValidation === 'function') {
                    updatePasswordValidation();
                }
                closeAuthModal();
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
                forgotSuccess.textContent = 'If that email has an account, a reset link is on its way.';
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
        setSubmitReadiness(
            changePwSubmitBtn,
            allCriteriaMet && matches && hasCurrentPassword,
            !hasCurrentPassword
                ? 'Enter your current password.'
                : !allCriteriaMet
                    ? 'Your new password needs at least 8 characters, an uppercase letter, a number and a symbol.'
                    : 'The two new passwords do not match.'
        );
    }

    if (changeCurrentPasswordInput) changeCurrentPasswordInput.addEventListener('input', updateChangePasswordValidation);
    if (changeNewPasswordInput) changeNewPasswordInput.addEventListener('input', updateChangePasswordValidation);
    if (changeConfirmPasswordInput) changeConfirmPasswordInput.addEventListener('input', updateChangePasswordValidation);
    // Seeded once so readiness is never merely "unset". The four forms are
    // `required` throughout, which stops an entirely empty submit, but the
    // cross-field rules - complexity, "passwords match", the typed DELETE -
    // only ran on `input`, so a browser autofill that fires no input event
    // would have left the guard with nothing to check.
    updateChangePasswordValidation();


    // Handle Change Password Form Submit
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = changeCurrentPasswordInput.value;
            const newPassword = changeNewPasswordInput.value;
            const btn = changePasswordForm.querySelector('button[type="submit"]');
            if (blockedBeforeSubmit(btn, document.getElementById('change-pw-error'), changeCurrentPasswordInput)) return;
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
                    closeAuthModal();
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
        setSubmitReadiness(
            resetPwSubmitBtn,
            allCriteriaMet && matches,
            !allCriteriaMet
                ? 'Your new password needs at least 8 characters, an uppercase letter, a number and a symbol.'
                : 'The two passwords do not match.'
        );
    }

    if (resetNewPasswordInput) {
        resetNewPasswordInput.addEventListener('input', updateResetPasswordValidation);
    }
    if (resetConfirmPasswordInput) {
        resetConfirmPasswordInput.addEventListener('input', updateResetPasswordValidation);
    }
    // Seeded once so readiness is never merely "unset". The four forms are
    // `required` throughout, which stops an entirely empty submit, but the
    // cross-field rules - complexity, "passwords match", the typed DELETE -
    // only ran on `input`, so a browser autofill that fires no input event
    // would have left the guard with nothing to check.
    updateResetPasswordValidation();


    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = resetTokenInput ? resetTokenInput.value : '';
            const newPassword = resetNewPasswordInput ? resetNewPasswordInput.value : '';
            const btn = resetPasswordForm.querySelector('button[type="submit"]');
            if (blockedBeforeSubmit(btn, document.getElementById('reset-pw-error'), resetNewPasswordInput)) return;
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
        setSubmitReadiness(
            deleteAccountSubmitBtn,
            hasPw && phraseMatch,
            !hasPw ? 'Enter your current password.' : 'Type DELETE to confirm.'
        );
    }

    if (deleteCurrentPasswordInput) deleteCurrentPasswordInput.addEventListener('input', updateDeleteAccountValidation);
    if (deleteConfirmPhraseInput) deleteConfirmPhraseInput.addEventListener('input', updateDeleteAccountValidation);
    // Seeded once so readiness is never merely "unset". The four forms are
    // `required` throughout, which stops an entirely empty submit, but the
    // cross-field rules - complexity, "passwords match", the typed DELETE -
    // only ran on `input`, so a browser autofill that fires no input event
    // would have left the guard with nothing to check.
    updateDeleteAccountValidation();


    if (deleteAccountForm) {
        deleteAccountForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = deleteCurrentPasswordInput.value;
            const phrase = deleteConfirmPhraseInput.value;
            const btn = deleteAccountForm.querySelector('button[type="submit"]');
            if (blockedBeforeSubmit(btn, deleteAccountError, deleteCurrentPasswordInput)) return;
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
                    closeAuthModal();
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
        if (modal) openAuthModal('reset-password');
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
    }

    const magicTokenParam = urlParams.get('magic_token');
    if (magicTokenParam) {
        (async () => {
            try {
                if (modal) openAuthModal('login');
                const result = await verifyMagicLink(magicTokenParam);
                if (result.requires_2fa) {
                    const preInput = document.getElementById('2fa-pre-auth-token-input');
                    if (preInput) preInput.value = result.pre_auth_token;
                    switchTab('2fa-verify');
                } else {
                    closeAuthModal();
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
                    // Same reason as the sign-in toast: the nav icon swapping
                    // back is not feedback anyone hears, or reliably notices.
                    showToast('Signed out.', 'success');
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

    // No direct listener here: the delegated document-level handler below
    // already fires `request-login-modal` for #nav-login-btn, and it keeps
    // working across the innerHTML re-render this function performs. Binding
    // both meant one click dispatched the event twice.
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
