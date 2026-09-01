import { API_BASE } from './analytics.js';

export const AUTH_TOKEN_KEY = 'rj_access_token';
export const REFRESH_TOKEN_KEY = 'rj_refresh_token';

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setTokens(access, refresh) {
  if (access) localStorage.setItem(AUTH_TOKEN_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function getErrorMessage(errorData, fallback) {
  if (!errorData || errorData.detail === undefined || errorData.detail === null) {
    return fallback;
  }
  if (typeof errorData.detail === 'string') {
    return errorData.detail;
  }
  if (Array.isArray(errorData.detail)) {
    return errorData.detail
      .map(item => (typeof item === 'string' ? item : item.msg || item.detail || JSON.stringify(item)))
      .join(', ');
  }
  return fallback;
}

export async function loginUser(email, password) {
  try {
    const cleanEmail = typeof email === 'string' ? email.trim() : email;
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(getErrorMessage(errorData, 'Login failed'));
    }

    const data = await response.json();
    if (data.requires_2fa) {
      return data;
    }
    setTokens(data.access_token, data.refresh_token);
    return data;
  } catch (err) {
    console.error('Login error:', err);
    throw err;
  }
}

export async function setup2FA() {
  const res = await authenticatedFetch(`${API_BASE}/auth/2fa/setup`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Failed to setup 2FA'));
  }
  return await res.json();
}

export async function enable2FA(code) {
  const res = await authenticatedFetch(`${API_BASE}/auth/2fa/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Failed to enable 2FA'));
  }
  return await res.json();
}

export async function disable2FA(currentPassword, code) {
  const res = await authenticatedFetch(`${API_BASE}/auth/2fa/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, code })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Failed to disable 2FA'));
  }
  return await res.json();
}

export async function verify2FA(preAuthToken, code) {
  const res = await fetch(`${API_BASE}/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pre_auth_token: preAuthToken, code })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Invalid 2FA code'));
  }
  const data = await res.json();
  if (data.access_token && data.refresh_token) {
    setTokens(data.access_token, data.refresh_token);
  }
  return data;
}

export async function requestMagicLink(email) {
  const cleanEmail = typeof email === 'string' ? email.trim() : email;
  const res = await fetch(`${API_BASE}/auth/magic-link/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cleanEmail })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Failed to send magic link'));
  }
  return await res.json();
}

export async function verifyMagicLink(token) {
  const res = await fetch(`${API_BASE}/auth/magic-link/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Failed to verify magic link'));
  }
  const data = await res.json();
  if (!data.requires_2fa && data.access_token && data.refresh_token) {
    setTokens(data.access_token, data.refresh_token);
  }
  return data;
}

export async function fetchActiveSessions() {
  const res = await authenticatedFetch(`${API_BASE}/auth/sessions`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Failed to fetch sessions'));
  }
  return await res.json();
}

export async function revokeOtherSessions() {
  const res = await authenticatedFetch(`${API_BASE}/auth/sessions/revoke-others`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Failed to revoke other sessions'));
  }
  return await res.json();
}

export async function revokeSpecificSession(sessionId) {
  const res = await authenticatedFetch(`${API_BASE}/auth/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Failed to revoke session'));
  }
  return await res.json();
}

export async function registerUser(email, password) {
  try {
    const cleanEmail = typeof email === 'string' ? email.trim() : email;
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(getErrorMessage(errorData, 'Registration failed'));
    }

    // Auto-login after successful registration
    return await loginUser(cleanEmail, password);
  } catch (err) {
    console.error('Registration error:', err);
    throw err;
  }
}

export async function requestPasswordReset(email) {
  try {
    const cleanEmail = typeof email === 'string' ? email.trim() : email;
    const response = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(getErrorMessage(errorData, 'Failed to request password reset'));
    }

    return await response.json();
  } catch (err) {
    console.error('Request password reset error:', err);
    throw err;
  }
}

export async function resetPassword(token, newPassword) {
  try {
    const response = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: newPassword })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(getErrorMessage(errorData, 'Failed to reset password'));
    }

    return await response.json();
  } catch (err) {
    console.error('Reset password error:', err);
    throw err;
  }
}

export async function changePassword(currentPassword, newPassword) {
  try {
    const response = await authenticatedFetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(getErrorMessage(errorData, 'Failed to change password'));
    }

    return await response.json();
  } catch (err) {
    console.error('Change password error:', err);
    throw err;
  }
}

export async function deleteAccount(currentPassword, confirmationPhrase) {
  try {
    const response = await authenticatedFetch(`${API_BASE}/auth/delete-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, confirmation_phrase: confirmationPhrase })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(getErrorMessage(errorData, 'Failed to delete account'));
    }

    return await response.json();
  } catch (err) {
    console.error('Delete account error:', err);
    throw err;
  }
}

export async function logoutUser() {
    // Notify server if needed (optional)
    try {
        await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
    } catch(e) {}

    clearTokens();
    // Dispatch event so other parts of the app can update
    window.dispatchEvent(new Event('auth-changed'));
}

// In-flight refresh, shared by every caller that 401s at the same time.
//
// The server rotates refresh tokens: `refresh_user_token` revokes the presented
// token and issues a new one. Without this, concurrent 401s - which is exactly
// what the AI page produces on load, with /chat/history, /auth/me and
// /auth/sessions all firing at once - each sent the *same* refresh token. The
// first won; the rest were told the token had been revoked, fell through to
// clearTokens(), and signed the user out mid-session. Whichever loser finished
// last also overwrote the winner's new token pair in localStorage.
let refreshInFlight = null;

/**
 * Refreshes the access token at most once at a time.
 * @returns {Promise<string|null>} the new access token, or null if refresh failed.
 */
function refreshAccessTokenOnce() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    try {
      const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (!refreshResponse.ok) return null;

      const data = await refreshResponse.json();
      setTokens(data.access_token, data.refresh_token);
      return data.access_token;
    } catch (e) {
      console.error('Failed to refresh token', e);
      return null;
    }
  })();

  // Cleared before the awaiting callers resume, so a later 401 starts a fresh
  // attempt rather than reusing this settled promise.
  refreshInFlight = refreshInFlight.finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function authenticatedFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = {
    ...options.headers,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 && token) {
      const newAccessToken = await refreshAccessTokenOnce();

      if (newAccessToken) {
          // Retry the original request with the refreshed credential.
          return fetch(url, {
              ...options,
              headers: { ...options.headers, 'Authorization': `Bearer ${newAccessToken}` }
          });
      }

      // Refresh genuinely failed (or there was no refresh token): sign out.
      clearTokens();
      window.dispatchEvent(new Event('auth-changed'));
  }

  return response;
}
