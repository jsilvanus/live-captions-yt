// Manual active-code state for ActionsPanel / QuickActions
const KEY = 'lcyt:active-codes';

export function getActiveCodes() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export function setActiveCode(codeKey, value) {
  try {
    const codes = getActiveCodes();
    if (value === null || value === undefined || value === '') {
      delete codes[codeKey];
    } else {
      codes[codeKey] = value;
    }
    localStorage.setItem(KEY, JSON.stringify(codes));
    window.dispatchEvent(new CustomEvent('lcyt:active-codes-changed'));
  } catch {}
}

export function clearActiveCode(codeKey) {
  setActiveCode(codeKey, null);
}

export function clearAllActiveCodes() {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent('lcyt:active-codes-changed'));
  } catch {}
}
