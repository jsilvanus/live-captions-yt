/**
 * Screens connected to the computer running the browser, and the DSK viewport
 * shown on each one (Setup Hub → Screens, and Graphics → Viewports).
 *
 * Mappings (which viewport goes to which screen) live in localStorage, per
 * browser: the screens belong to this computer, and the server cannot see them.
 * Only Chromium exposes `getScreenDetails()` (Window Management API); other
 * browsers get "open manually" (see `screenApiSupported`).
 *
 * Everything except `openScreenWindow` and `listScreens` is pure, so it is
 * unit-testable under `node --test`.
 */

export const SCREEN_MAPPINGS_KEY = 'lcyt.screens.v1';
export const DEFAULT_SCREEN_BG = 'transparent';

/** Stable-enough key for a screen: label, size and position. Ids change across reboots. */
export function screenKey(screen) {
  const label = (screen?.label || '').trim() || 'screen';
  return `${label}|${screen?.width ?? 0}x${screen?.height ?? 0}@${screen?.left ?? 0},${screen?.top ?? 0}`;
}

/** Background values the card offers: 'transparent', a hex colour. */
export function normaliseBg(value) {
  if (value === 'transparent') return 'transparent';
  return /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value.toUpperCase() : DEFAULT_SCREEN_BG;
}

/** Read mappings; any storage or JSON problem gives an empty map. */
export function loadScreenMappings(storage) {
  try {
    const raw = storage?.getItem(SCREEN_MAPPINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Write mappings; returns false when storage is blocked or full. */
export function saveScreenMappings(storage, mappings) {
  try {
    storage?.setItem(SCREEN_MAPPINGS_KEY, JSON.stringify(mappings));
    return true;
  } catch {
    return false;
  }
}

/** Mapping for one screen, with defaults. */
export function mappingFor(mappings, screen) {
  const m = mappings?.[screenKey(screen)] ?? {};
  return {
    viewport: typeof m.viewport === 'string' ? m.viewport : '',
    bg: normaliseBg(m.bg),
  };
}

/** Set one field of a screen's mapping. Returns a new map. */
export function withMapping(mappings, screen, patch) {
  const key = screenKey(screen);
  const next = { ...mappings, [key]: { ...mappingFor(mappings, screen), ...patch } };
  if (next[key].bg !== undefined) next[key].bg = normaliseBg(next[key].bg);
  return next;
}

/**
 * Display URL of a viewport, the same rule as the Graphics → Viewports page:
 * the slug form /dsk/<slug>/<viewport> when the project has a slug, otherwise
 * the legacy /dsk/<apiKey>?viewport=<name> form (which exposes the key).
 * `viewport` '' means the built-in landscape page.
 */
export function displayUrl({ origin, projectSlug, apiKey, viewport, bg }) {
  const named = Boolean(viewport);
  let base;
  if (projectSlug) {
    base = `${origin}/dsk/${encodeURIComponent(projectSlug)}`;
    if (named) base += `/${encodeURIComponent(viewport)}`;
  } else {
    base = `${origin}/dsk/${encodeURIComponent(apiKey)}`;
  }
  const u = new URL(base);
  if (!projectSlug && named) u.searchParams.set('viewport', viewport);
  if (bg === 'transparent') u.searchParams.set('bg', 'transparent');
  else if (bg) u.searchParams.set('bg', bg);
  return u.toString();
}

/** True when the browser offers the Window Management API. */
export function screenApiSupported(win = globalThis.window) {
  return Boolean(win) && 'getScreenDetails' in win;
}

/** Ask for the screen list (shows the permission prompt once). Rejects if denied. */
export async function listScreens(win = globalThis.window) {
  const details = await win.getScreenDetails();
  return details.screens;
}

/**
 * Open `url` in a window placed on `screen`. Browsers only allow fullscreen
 * after a user gesture, so when the popup is not fullscreen after it loads,
 * a small "Fullscreen" button is added to the popup's page (same origin).
 * Returns the popup, or null when the browser blocked it.
 */
export function openScreenWindow(screen, url, win = globalThis.window) {
  const popup = win.open(
    url, '_blank',
    `left=${screen.left},top=${screen.top},width=${screen.width},height=${screen.height}`
  );
  if (!popup) return null;
  popup.addEventListener('load', () => {
    try { popup.document.documentElement.requestFullscreen(); } catch { /* needs a gesture */ }
    setTimeout(() => addFullscreenButton(popup), 300);
  });
  return popup;
}

function addFullscreenButton(popup) {
  try {
    const doc = popup.document;
    if (doc.fullscreenElement || doc.getElementById('lcyt-fullscreen-btn')) return;
    const btn = doc.createElement('button');
    btn.id = 'lcyt-fullscreen-btn';
    btn.textContent = 'Fullscreen';
    btn.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;padding:6px 10px;font:14px sans-serif;opacity:.6;cursor:pointer';
    btn.addEventListener('click', () => {
      doc.documentElement.requestFullscreen().then(() => btn.remove(), () => {});
    });
    doc.addEventListener('fullscreenchange', () => { if (doc.fullscreenElement) btn.remove(); });
    doc.body.appendChild(btn);
  } catch { /* popup closed or cross-origin: nothing to do */ }
}
