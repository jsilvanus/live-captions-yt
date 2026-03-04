import {
  getTranslationVendor,
  getTranslationApiKey,
  getTranslationLibreUrl,
  getTranslationLibreKey,
} from './translationConfig.js';

// Converts a BCP-47 code to a 2-char ISO 639-1 base (e.g. 'en-US' → 'en').
function toLang2(code) {
  return code ? code.split('-')[0].toLowerCase() : 'en';
}

// Returns true when source and target resolve to the same base language.
export function isSameLanguage(sourceLang, targetLang) {
  return toLang2(sourceLang) === toLang2(targetLang);
}

async function translateMyMemory(text, sourceLang, targetLang) {
  const src = toLang2(sourceLang);
  const tgt = toLang2(targetLang);
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${src}|${tgt}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(data.responseDetails || 'MyMemory error');
  return data.responseData?.translatedText || text;
}

async function translateGoogle(text, sourceLang, targetLang) {
  const key = getTranslationApiKey();
  if (!key) throw new Error('Google Cloud Translation API key not configured');
  const src = toLang2(sourceLang);
  const tgt = toLang2(targetLang);
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: src, target: tgt, format: 'text' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Google Translate HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.data?.translations?.[0]?.translatedText || text;
}

async function translateDeepL(text, sourceLang, targetLang) {
  const key = getTranslationApiKey();
  if (!key) throw new Error('DeepL API key not configured');
  const src = toLang2(sourceLang).toUpperCase();
  // DeepL accepts full BCP-47 codes (e.g. EN-US, PT-BR) as target language.
  const tgt = targetLang.toUpperCase();
  const baseUrl = key.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: [text], source_lang: src, target_lang: tgt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `DeepL HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.translations?.[0]?.text || text;
}

async function translateLibre(text, sourceLang, targetLang) {
  const baseUrl = getTranslationLibreUrl();
  if (!baseUrl) throw new Error('LibreTranslate URL not configured');
  const apiKey = getTranslationLibreKey();
  const src = toLang2(sourceLang);
  const tgt = toLang2(targetLang);
  const body = { q: text, source: src, target: tgt, format: 'text' };
  if (apiKey) body.api_key = apiKey;
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `LibreTranslate HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.translatedText || text;
}

export async function translateText(text, sourceLang, targetLang) {
  const vendor = getTranslationVendor();
  switch (vendor) {
    case 'google':         return translateGoogle(text, sourceLang, targetLang);
    case 'deepl':          return translateDeepL(text, sourceLang, targetLang);
    case 'libretranslate': return translateLibre(text, sourceLang, targetLang);
    case 'mymemory':
    default:               return translateMyMemory(text, sourceLang, targetLang);
  }
}

/**
 * Translate `text` to all enabled translation targets.
 *
 * Returns:
 *   {
 *     translationsMap: { 'fi-FI': 'käännetty', ... },  // all langs (captions + backend-file)
 *     captionLang: 'fi-FI' | null,                     // the "captions" target lang, if any
 *     localFileEntries: [{ lang, text, format }],       // langs targeting local "file"
 *   }
 *
 * Skips translation when source and target language are the same.
 *
 * @param {string} text - Original text
 * @param {string} sourceLang - Source language code
 * @param {Array} enabledTranslations - From getEnabledTranslations()
 * @returns {Promise<object>}
 */
export async function translateAll(text, sourceLang, enabledTranslations) {
  const translationsMap = {};
  let captionLang = null;
  const localFileEntries = [];

  await Promise.allSettled(
    enabledTranslations.map(async (t) => {
      // Skip if source and target are same language
      const translated = isSameLanguage(sourceLang, t.lang)
        ? text
        : await translateText(text, sourceLang, t.lang).catch(() => text);

      if (t.target === 'file') {
        localFileEntries.push({ lang: t.lang, text: translated, format: t.format || 'youtube' });
      } else {
        // 'captions' or 'backend-file' — include in map for backend
        translationsMap[t.lang] = translated;
        if (t.target === 'captions') captionLang = t.lang;
      }
    })
  );

  return { translationsMap, captionLang, localFileEntries };
}

// ─── Local file writing (File System Access API) ─────────────────────────────

/**
 * Open a writable file using the File System Access API.
 * Returns a FileSystemWritableFileStream or null if not supported / user cancels.
 * The caller must keep this handle open for the session and close it on teardown.
 *
 * @param {string} suggestedName - Default filename
 * @returns {Promise<{ handle: FileSystemFileHandle, writable: FileSystemWritableFileStream } | null>}
 */
export async function openLocalCaptionFile(suggestedName) {
  if (!window.showSaveFilePicker) return null;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        { description: 'Caption file', accept: { 'text/plain': ['.vtt', '.txt'] } },
      ],
    });
    const writable = await handle.createWritable({ keepExistingData: false });
    return { handle, writable };
  } catch {
    return null;
  }
}

/**
 * Format a single caption entry as a VTT cue string.
 * @param {number} seqIndex - 1-based sequence index for cue ID
 * @param {string} startIso - ISO start time string
 * @param {string} endIso - ISO end time string (optional, defaults to start + 3s)
 * @param {string} text - Caption text
 * @returns {string}
 */
export function formatVttCue(seqIndex, startIso, endIso, text) {
  function toVttTime(iso) {
    const d = new Date(iso);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }
  const start = toVttTime(startIso);
  const end = endIso ? toVttTime(endIso) : toVttTime(new Date(new Date(startIso).getTime() + 3000).toISOString());
  return `${seqIndex}\n${start} --> ${end}\n${text}\n\n`;
}

/**
 * Format a single caption entry in YouTube ingest format (bare text, one per line).
 * @param {string} text - Caption text
 * @returns {string}
 */
export function formatYouTubeLine(text) {
  return text + '\n';
}
