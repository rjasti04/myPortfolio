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
        const error = new Error(getErrorMessage(errorData, 'Login failed'));
        // 403 is only ever "confirm your email" on this route. Tagged rather
        // than string-matched so the UI can offer a resend without depending on
        // the wording of a server message.
        if (response.status === 403) error.needsEmailVerification = true;
        throw error;
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

export async function enable2FA(currentPassword, code) {
  const res = await authenticatedFetch(`${API_BASE}/auth/2fa/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, code })
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

export async function verifyEmail(token) {
  const res = await fetch(`${API_BASE}/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Could not confirm that email address'));
  }
  return await res.json();
}

export async function resendVerification(email) {
  const cleanEmail = typeof email === 'string' ? email.trim() : email;
  const res = await fetch(`${API_BASE}/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cleanEmail })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(getErrorMessage(err, 'Could not send a new confirmation link'));
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

    /* No auto-login. This used to call loginUser() here, which was right when
       registration handed back a usable account - but `authenticate_user`
       refuses an address that has not been confirmed, and every registration
       now creates exactly that. So the login could never succeed: it returned
       403 "Confirm your email address", registerUser rethrew it, and the
       modal's catch painted that into the *error* slot of a form whose
       account had in fact just been created. The visitor saw a red message,
       no success toast, an open dialog - and got "Email already registered"
       if they tried again.

       It also spent a second request on /auth/login, which shares the strict
       5-per-minute auth budget with /auth/register, on a call guaranteed to
       fail.

       The created user is returned instead; the caller tells the visitor to
       go and confirm. */
    return await response.json();
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
    // Ends this device's session on the server, and only this one. The refresh
    // token is the credential being ended, so it is what gets sent. This used
    // to send only the access token: after thirty minutes of reading that had
    // expired, the server answered 401, nothing was revoked, and the refresh
    // token stayed valid for thirty days behind a UI that said "Signed out."
    // The bearer is the fallback for a session that somehow holds no refresh
    // token, and with neither there is nothing to end.
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const accessToken = getAuthToken();
    if (refreshToken || accessToken) {
        try {
            await fetch(`${API_BASE}/auth/logout`, refreshToken
                ? {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: refreshToken })
                }
                : {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
        } catch(e) {
            // Offline: the sign-out below still happens here, but the server
            // copy lives until it expires. Nothing on this device can use it.
        }
    }

    clearTokens();
    // Dispatch event so other parts of the app can update
    window.dispatchEvent(new Event('auth-changed'));
}

// In-flight refresh, shared by every caller in this tab that 401s at the same
// time.
//
// The server rotates refresh tokens: `refresh_user_token` revokes the presented
// token and issues a new one. Without this, concurrent 401s - which is exactly
// what the AI page produces on load, with /chat/history, /auth/me and
// /auth/sessions all firing at once - each sent the *same* refresh token. The
// first won; the rest were told the token had been revoked, fell through to
// clearTokens(), and signed the user out mid-session. Whichever loser finished
// last also overwrote the winner's new token pair in localStorage.
//
// This variable only de-duplicates within one tab. Two tabs share
// localStorage, so two tabs whose tokens expired together (a laptop waking up)
// raced exactly the same way, and the loser's clearTokens() deleted the pair
// the winner had just stored - signing out both. withRefreshLock() and the
// re-read in refreshAccessTokenOnce() are the cross-tab half.
let refreshInFlight = null;

/* Runs `fn` under a lock every tab of this origin shares, where the browser has
   Web Locks, so only one tab at a time can spend the refresh token and the
   next one finds the rotated pair already in storage. Read at call time rather
   than import time so a test can install one. Where there is no lock manager
   the call runs directly, and the post-401 re-read below is the fallback. */
function withRefreshLock(fn) {
  const locks = globalThis.navigator?.locks;
  if (locks && typeof locks.request === 'function') {
    return locks.request('rj-auth-refresh', fn);
  }
  return fn();
}

/* Whether a failed request means the *credential* was rejected, or only that
   the request did not get through.

   Everything that reads a token used to treat the two the same: any non-ok
   response, and any thrown fetch, ended in clearTokens(). So a 429 from the
   rate limiter, a 503 while the database was restarting, a 502 mid-deploy or a
   few seconds offline destroyed a refresh token that was still valid for
   thirty days server-side, and the visitor had to log in again. Only 401 and
   403 are the server actually refusing the credential; a 5xx is the server
   failing to answer at all, and 408/429 are it declining to answer yet. */
export function isCredentialRejection(status) {
  return status === 401 || status === 403;
}

/**
 * Refreshes the access token at most once at a time.
 * @param {string|null} sentRefreshToken The refresh token that was stored when
 *   the failed request was made. If storage holds a different one by the time
 *   this runs, another tab (or an earlier refresh in this one) has already
 *   rotated the pair, and its access token is the one to retry with.
 * @returns {Promise<{token: string|null, rejected: boolean}>} `token` is the
 *   new access token when the refresh succeeded. `rejected` is true only when
 *   the server refused the refresh token itself - the one case where signing
 *   the visitor out is the correct response.
 */
function refreshAccessTokenOnce(sentRefreshToken) {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = withRefreshLock(async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    // No refresh token at all is a genuine dead end, not a transient failure.
    if (!refreshToken) return { token: null, rejected: true };

    // Rotated while this request was in flight or while waiting for the lock.
    // The pair in storage was issued moments ago, so spending it again would
    // only revoke it out from under the tab that holds it.
    if (sentRefreshToken && refreshToken !== sentRefreshToken) {
      return { token: getAuthToken(), rejected: false };
    }

    try {
      const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (!refreshResponse.ok) {
        if (!isCredentialRejection(refreshResponse.status)) {
          return { token: null, rejected: false };
        }
        // Without a lock manager another tab can spend the same token at the
        // same moment and win. If it has stored its new pair by now, this 401
        // is about the token that tab already replaced, not about the session.
        const stored = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (stored && stored !== refreshToken) {
          return { token: getAuthToken(), rejected: false };
        }
        return { token: null, rejected: true };
      }

      const data = await refreshResponse.json();
      setTokens(data.access_token, data.refresh_token);
      return { token: data.access_token, rejected: false };
    } catch (e) {
      // The request never completed - offline, DNS, a dropped connection.
      // The stored credential is untouched and is very likely still good.
      console.error('Failed to refresh token', e);
      return { token: null, rejected: false };
    }
  });

  // Cleared before the awaiting callers resume, so a later 401 starts a fresh
  // attempt rather than reusing this settled promise.
  refreshInFlight = refreshInFlight.finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/* 401s that authenticatedFetch() could not resolve for a reason that says
   nothing about the credential: the refresh was rate-limited, the server
   failed, or the request never completed. The caller still gets the original
   401 - but it is not a rejection, and isRejectedResponse() says so. */
const unresolvedAuthFailures = new WeakSet();

/**
 * Whether a response from authenticatedFetch() means the server refused the
 * credential. Prefer this to `isCredentialRejection(res.status)` for those
 * responses: a 401 whose refresh failed transiently has already been judged
 * safe to keep, and treating it as a rejection clears tokens that are still
 * good for thirty days.
 * @param {Response} response
 * @returns {boolean}
 */
export function isRejectedResponse(response) {
  return isCredentialRejection(response.status) && !unresolvedAuthFailures.has(response);
}

export async function authenticatedFetch(url, options = {}) {
  const token = getAuthToken();
  const sentRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  const headers = {
    ...options.headers,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 && token) {
      const { token: newAccessToken, rejected } = await refreshAccessTokenOnce(sentRefreshToken);

      if (newAccessToken) {
          // Retry the original request with the refreshed credential.
          return fetch(url, {
              ...options,
              headers: { ...options.headers, 'Authorization': `Bearer ${newAccessToken}` }
          });
      }

      // Only when the server refused the refresh token itself. A 429, a 5xx or
      // a dropped connection leaves the credential in place: the caller sees
      // the failure and the next attempt refreshes normally.
      if (rejected) {
          clearTokens();
          window.dispatchEvent(new Event('auth-changed'));
      } else {
          unresolvedAuthFailures.add(response);
      }
  }

  return response;
}
