/**
 * On-device (processLocally) support for the browser SpeechRecognition API.
 *
 * Chrome's availability API changed shape: the current form is
 * `SpeechRecognition.available({ langs, processLocally })` and `install({ langs, processLocally })`,
 * an older form took `(lang, { processLocally })`. Both are tried; results are normalised to
 * 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'.
 * Not verified against a real Chrome build; the helpers never throw.
 */

const ALIASES = {
  available: 'available',
  readily: 'available',
  downloadable: 'downloadable',
  'after-download': 'downloadable',
  downloading: 'downloading',
  unavailable: 'unavailable',
  no: 'unavailable',
};

export function normalizeAvailability(value) {
  return ALIASES[String(value)] || 'unavailable';
}

function getSR() {
  return typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : undefined;
}

/** True when this browser exposes `processLocally` on recognizer instances. */
export function supportsProcessLocally(SR = getSR()) {
  return !!SR && 'processLocally' in SR.prototype;
}

async function callBothForms(fn, lang) {
  try {
    return await fn({ langs: [lang], processLocally: true });
  } catch {
    return await fn(lang, { processLocally: true });
  }
}

/** @returns {Promise<'available'|'downloadable'|'downloading'|'unavailable'|'unsupported'>} */
export async function checkLocalSpeech(lang, SR = getSR()) {
  if (!SR || typeof SR.available !== 'function') return 'unsupported';
  try {
    return normalizeAvailability(await callBothForms(SR.available.bind(SR), lang));
  } catch {
    return 'unsupported';
  }
}

/** Download the on-device language pack. @returns {Promise<boolean>} true when the call succeeded */
export async function installLocalSpeech(lang, SR = getSR()) {
  if (!SR || typeof SR.install !== 'function') return false;
  try {
    await callBothForms(SR.install.bind(SR), lang);
    return true;
  } catch {
    return false;
  }
}
