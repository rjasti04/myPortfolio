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

export async function loginUser(email, password) {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Login failed');
    }

    const data = await response.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch (err) {
    console.error('Login error:', err);
    throw err;
  }
}

export async function registerUser(email, password) {
  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Registration failed');
    }

    // Auto-login after successful registration
    return await loginUser(email, password);
  } catch (err) {
    console.error('Registration error:', err);
    throw err;
  }
}

export async function requestPasswordReset(email) {
  try {
    const response = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to request password reset');
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
      throw new Error(errorData.detail || 'Failed to reset password');
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
      throw new Error(errorData.detail || 'Failed to change password');
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
      throw new Error(errorData.detail || 'Failed to delete account');
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

export async function authenticatedFetch(url, options = {}) {
  let token = getAuthToken();
  const headers = {
    ...options.headers,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  let response = await fetch(url, { ...options, headers });

  if (response.status === 401 && token) {
      // Try refresh
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      if (refreshToken) {
          try {
              const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ refresh_token: refreshToken })
              });

              if (refreshResponse.ok) {
                  const data = await refreshResponse.json();
                  setTokens(data.access_token, data.refresh_token);

                  // Retry original request
                  const newHeaders = {
                      ...options.headers,
                      'Authorization': `Bearer ${data.access_token}`
                  };
                  return fetch(url, { ...options, headers: newHeaders });
              }
          } catch (e) {
              console.error('Failed to refresh token', e);
          }
      }

      // If refresh failed or no refresh token, clear tokens
      clearTokens();
      window.dispatchEvent(new Event('auth-changed'));
  }

  return response;
}
