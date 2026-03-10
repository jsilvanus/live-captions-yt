/**
 * Pure utility functions shared by ViewerPage and EmbedViewerPage.
 *
 * These functions are free of React and browser-global dependencies so that
 * they can be imported by the viewer components AND exercised by Node.js tests.
 */

/**
 * Resolve the text that should be displayed for a single viewer caption event
 * given the `lang` URL parameter.
 *
 * @param {object} data   Caption SSE event payload:
 *                        { text, composedText?, translations?: { [lang]: string }, codes? }
 * @param {string} lang   The `?lang=` param value.
 *                        '' / undefined → composed text (original + translation)
 *                        'original'    → raw original text only
 *                        '<BCP-47>'    → that translation; falls back to composed then original
 *                        'all'         → not handled here (use collectLangTexts instead)
 * @returns {string}
 */
export function resolveViewerText(data, lang) {
  if (!lang) return data.composedText ?? data.text ?? '';
  if (lang === 'original') return data.text ?? '';
  if (lang === 'all') return data.composedText ?? data.text ?? '';
  const specific = data.translations?.[lang];
  return specific ?? data.composedText ?? data.text ?? '';
}

/**
 * Build a map of all available language texts from a caption event.
 * Used when `?lang=all` is active to populate each language column.
 *
 * @param {object} data  Caption SSE event payload.
 * @returns {{ original: string, [lang: string]: string }}
 */
export function collectLangTexts(data) {
  const map = { original: data.text || '' };
  if (data.translations && typeof data.translations === 'object') {
    for (const [l, t] of Object.entries(data.translations)) {
      if (t) map[l] = t;
    }
  }
  return map;
}
