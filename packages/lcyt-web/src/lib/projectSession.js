import { KEYS } from './storageKeys.js';

/**
 * Activate a project as the current caption session and navigate home —
 * shared by ProjectsPage's "Enter" button and TeamPage's Projects tab.
 */
export function activateProject(backendUrl, apiKey) {
  try {
    const existing = JSON.parse(localStorage.getItem(KEYS.session.config) || '{}');
    localStorage.setItem(KEYS.session.config, JSON.stringify({
      ...existing,
      backendUrl,
      apiKey,
    }));
  } catch {
    localStorage.setItem(KEYS.session.config, JSON.stringify({ backendUrl, apiKey }));
  }
  window.location.href = '/';
}
