const KEY_ENGINE = 'lcyt-stt-engine';
const KEY_LANG   = 'lcyt-stt-lang';
const KEY_CFG    = 'lcyt-stt-config';

export const COMMON_LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ru-RU', label: 'Russian' },
  { code: 'nl-NL', label: 'Dutch' },
  { code: 'pl-PL', label: 'Polish' },
  { code: 'sv-SE', label: 'Swedish' },
  { code: 'da-DK', label: 'Danish' },
  { code: 'fi-FI', label: 'Finnish' },
  { code: 'nb-NO', label: 'Norwegian' },
  { code: 'tr-TR', label: 'Turkish' },
  { code: 'id-ID', label: 'Indonesian' },
  { code: 'th-TH', label: 'Thai' },
  { code: 'vi-VN', label: 'Vietnamese' },
  { code: 'uk-UA', label: 'Ukrainian' },
  { code: 'cs-CZ', label: 'Czech' },
  { code: 'ro-RO', label: 'Romanian' },
  { code: 'hu-HU', label: 'Hungarian' },
];

export const STT_MODELS = [
  { value: 'latest_long',       label: 'Latest Long' },
  { value: 'latest_short',      label: 'Latest Short' },
  { value: 'telephony',         label: 'Telephony' },
  { value: 'video',             label: 'Video' },
  { value: 'medical_dictation', label: 'Medical Dictation' },
];

export function getSttEngine() {
  return localStorage.getItem(KEY_ENGINE) || 'webkit';
}

export function setSttEngine(engine) {
  localStorage.setItem(KEY_ENGINE, engine);
  window.dispatchEvent(new CustomEvent('lcyt:stt-config-changed'));
}

export function getSttLang() {
  return localStorage.getItem(KEY_LANG) || 'en-US';
}

export function setSttLang(code) {
  localStorage.setItem(KEY_LANG, code);
}

export function getSttCloudConfig() {
  try { return JSON.parse(localStorage.getItem(KEY_CFG) || '{}'); }
  catch { return {}; }
}

export function patchSttCloudConfig(patch) {
  const cfg = getSttCloudConfig();
  try { localStorage.setItem(KEY_CFG, JSON.stringify({ ...cfg, ...patch })); } catch {}
}
