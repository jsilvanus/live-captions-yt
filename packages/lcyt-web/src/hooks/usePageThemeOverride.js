import { useEffect } from 'react';

/**
 * usePageThemeOverride — applies a per-page theme preference (set on the
 * Account page's "Editor theme" / "Planner theme" pickers) for as long as
 * the calling page is mounted, then restores whatever theme was active
 * before. Client-only, no backend involved.
 *
 * Uses the same `data-theme` attribute on <html> that the global theme
 * setting (KEYS.ui.theme) already uses, so it works with the app's existing
 * CSS (`:root[data-theme="dark"]` / `:root[data-theme="light"]`) — no new
 * CSS variables needed.
 *
 * @param {string} storageKey - e.g. KEYS.ui.editorTheme
 */
export function usePageThemeOverride(storageKey) {
  useEffect(() => {
    let override = null;
    try { override = localStorage.getItem(storageKey); } catch { /* ignore */ }
    if (!override || override === 'auto') return;

    const html = document.documentElement;
    const previous = html.getAttribute('data-theme');

    if (override === 'dark' || override === 'light') {
      html.setAttribute('data-theme', override);
    }

    return () => {
      if (previous) html.setAttribute('data-theme', previous);
      else html.removeAttribute('data-theme');
    };
  }, [storageKey]);
}
