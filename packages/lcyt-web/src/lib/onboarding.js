/**
 * onboarding.js — plan_ui.md v2 §2a's "lcyt:onboarded flag" for the
 * onboarding auto-trigger, scoped per project (apiKey) rather than
 * globally: a user can own several projects, and finishing the wizard for
 * one shouldn't silence the nudge for a different, still-unconfigured one.
 */
const PREFIX = 'lcyt.onboarded.';

export function isOnboarded(apiKey) {
  if (!apiKey) return true; // nothing to scope the flag to — don't nag
  try {
    return localStorage.getItem(PREFIX + apiKey) === '1';
  } catch {
    return true;
  }
}

export function markOnboarded(apiKey) {
  if (!apiKey) return;
  try {
    localStorage.setItem(PREFIX + apiKey, '1');
  } catch { /* storage unavailable/full — nothing to do */ }
}
