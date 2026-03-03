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
