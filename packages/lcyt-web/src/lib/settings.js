/**
 * Shared settings utilities used across multiple modal/panel components.
 *
 * Consolidates helpers that were previously duplicated in SettingsModal,
 * CCModal, and CaptionsModal.
 */

// ─── Advanced mode ────────────────────────────────────────────

export function getAdvancedMode() {
  try { return localStorage.getItem('lcyt:advanced-mode') === '1'; } catch { return false; }
}

export function setAdvancedMode(val) {
  try { localStorage.setItem('lcyt:advanced-mode', val ? '1' : '0'); } catch {}
}

// ─── Theme ────────────────────────────────────────────────────

export function applyTheme(value) {
  const html = document.documentElement;
  if (value === 'dark') {
    html.setAttribute('data-theme', 'dark');
  } else if (value === 'light') {
    html.setAttribute('data-theme', 'light');
  } else {
    html.removeAttribute('data-theme');
  }
  try { localStorage.setItem('lcyt-theme', value); } catch {}
}

// ─── Caption text size ────────────────────────────────────────

export function applyTextSize(px) {
  document.documentElement.style.setProperty('--caption-text-size', px + 'px');
  try { localStorage.setItem('lcyt:textSize', String(px)); } catch {}
}
