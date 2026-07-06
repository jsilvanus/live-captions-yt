/**
 * Server-side translation module (Phase 5)
 *
 * Supports the same vendors as the client-side lib/translate.js:
 * - MyMemory (free, no auth)
 * - Google Cloud Translation
 * - DeepL
 * - LibreTranslate
 *
 * Vendor credentials are read from translation_vendor_config table.
 * Used by SttManager._deliverTranscript to translate server-STT transcripts
 * into all enabled target languages before delivery.
 */

function toLang2(code) {
  return code ? code.split('-')[0].toLowerCase() : 'en';
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

async function translateGoogle(text, sourceLang, targetLang, vendorApiKey) {
  if (!vendorApiKey) throw new Error('Google Cloud Translation API key not configured');
  const src = toLang2(sourceLang);
  const tgt = toLang2(targetLang);
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(vendorApiKey)}`;
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

async function translateDeepL(text, sourceLang, targetLang, vendorApiKey) {
  if (!vendorApiKey) throw new Error('DeepL API key not configured');
  const src = toLang2(sourceLang).toUpperCase();
  const tgt = targetLang.toUpperCase();
  const baseUrl = vendorApiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${vendorApiKey}`,
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

async function translateLibre(text, sourceLang, targetLang, libreUrl, libreKey) {
  if (!libreUrl) throw new Error('LibreTranslate URL not configured');
  const src = toLang2(sourceLang);
  const tgt = toLang2(targetLang);
  const body = { q: text, source: src, target: tgt, format: 'text' };
  if (libreKey) body.api_key = libreKey;
  const res = await fetch(`${libreUrl.replace(/\/$/, '')}/translate`, {
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

/**
 * Translate text to a single target language using the configured vendor.
 * @param {string} text
 * @param {string} sourceLang - BCP-47 code
 * @param {string} targetLang - BCP-47 code
 * @param {{vendor: string, vendorApiKey?: string, libreUrl?: string, libreKey?: string}} vendorConfig
 * @returns {Promise<string>} Translated text, or original text if translation fails
 */
export async function translateText(text, sourceLang, targetLang, vendorConfig) {
  const { vendor, vendorApiKey, libreUrl, libreKey } = vendorConfig || {};

  try {
    switch (vendor) {
      case 'google':
        return await translateGoogle(text, sourceLang, targetLang, vendorApiKey);
      case 'deepl':
        return await translateDeepL(text, sourceLang, targetLang, vendorApiKey);
      case 'libretranslate':
        return await translateLibre(text, sourceLang, targetLang, libreUrl, libreKey);
      case 'mymemory':
      default:
        return await translateMyMemory(text, sourceLang, targetLang);
    }
  } catch (err) {
    // Log error but don't break the delivery pipeline — fall back to original text
    console.warn(`[translate-server] Failed to translate: ${err.message}`);
    return text;
  }
}

/**
 * Check if source and target resolve to the same base language.
 */
export function isSameLanguage(sourceLang, targetLang) {
  return toLang2(sourceLang) === toLang2(targetLang);
}
