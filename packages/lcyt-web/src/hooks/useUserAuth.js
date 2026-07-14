import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'lcyt-user';

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStored(data) {
  if (data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Hook for managing user-level authentication (email + password login).
 * Separate from the caption session (API key + JWT).
 *
 * Persists { token, backendUrl } to localStorage under 'lcyt-user'.
 */
export function useUserAuth() {
  const [user, setUser] = useState(null);     // { userId, email, name }
  const [token, setToken] = useState(null);   // user JWT string
  const [backendUrl, setBackendUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount: verify stored token against /auth/me
  useEffect(() => {
    const stored = loadStored();
    if (!stored?.token || !stored?.backendUrl) {
      setLoading(false);
      return;
    }
    const base = stored.backendUrl.replace(/\/$/, '');
    fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${stored.token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.userId) {
          setToken(stored.token);
          setBackendUrl(stored.backendUrl);
          setUser({ userId: data.userId, email: data.email, name: data.name, isAdmin: !!data.isAdmin });
        } else {
          saveStored(null);
        }
      })
      .catch(() => {
        // Network error — keep stored creds, will retry on next action
        setToken(stored.token);
        setBackendUrl(stored.backendUrl);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (url, email, password) => {
    const base = url.replace(/\/$/, '');
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    saveStored({ token: data.token, backendUrl: base });
    setToken(data.token);
    setBackendUrl(base);
    setUser({ userId: data.userId, email: data.email, name: data.name, isAdmin: !!data.isAdmin });
    return data;
  }, []);

  const register = useCallback(async (url, email, password, name) => {
    const base = url.replace(/\/$/, '');
    const res = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    saveStored({ token: data.token, backendUrl: base });
    setToken(data.token);
    setBackendUrl(base);
    setUser({ userId: data.userId, email: data.email, name: data.name, isAdmin: !!data.isAdmin });
    return data;
  }, []);

  const logout = useCallback(() => {
    saveStored(null);
    setToken(null);
    setBackendUrl(null);
    setUser(null);
  }, []);

  const requestProjectAccessToken = useCallback(async (projectId) => {
    if (!token || !backendUrl) throw new Error('Not logged in');
    const base = backendUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/auth/project-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ projectId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create project access token');
    const projectAccessToken = data.projectAccessToken || data.accessToken || data.token;
    if (!projectAccessToken) throw new Error('Project access token was not returned by the server');
    return {
      ...data,
      projectId: data.projectId || projectId,
      projectAccessToken,
      projectRole: data.projectRole || data.role || null,
    };
  }, [token, backendUrl]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!token || !backendUrl) throw new Error('Not logged in');
    const res = await fetch(`${backendUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Password change failed');
    return data;
  }, [token, backendUrl]);

  // Self-service display-name update (BACKEND_PROJECT.md item 1).
  const updateProfile = useCallback(async (name) => {
    if (!token || !backendUrl) throw new Error('Not logged in');
    const res = await fetch(`${backendUrl}/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save name');
    setUser(u => u ? { ...u, name: data.name } : u);
    return data;
  }, [token, backendUrl]);

  // Self-service GDPR data export (BACKEND_PROJECT.md item 2).
  const exportData = useCallback(async () => {
    if (!token || !backendUrl) throw new Error('Not logged in');
    const res = await fetch(`${backendUrl}/auth/me/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Export is not available on this backend yet');
    return data;
  }, [token, backendUrl]);

  // Self-service "remove all my data" — deletes owned projects, keeps the account (BACKEND_PROJECT.md item 3).
  const removeData = useCallback(async () => {
    if (!token || !backendUrl) throw new Error('Not logged in');
    const res = await fetch(`${backendUrl}/auth/me/data`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Data removal is not available on this backend yet');
    return data;
  }, [token, backendUrl]);

  // Self-service full account deletion (BACKEND_PROJECT.md item 4).
  const deleteAccount = useCallback(async () => {
    if (!token || !backendUrl) throw new Error('Not logged in');
    const res = await fetch(`${backendUrl}/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Account deletion is not available on this backend yet');
    logout();
    return data;
  }, [token, backendUrl, logout]);

  return {
    user, token, backendUrl, loading, login, register, logout, changePassword,
    updateProfile, exportData, removeData, deleteAccount, requestProjectAccessToken,
  };
}
