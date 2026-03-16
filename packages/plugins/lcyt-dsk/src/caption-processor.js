/**
 * DSK caption processor.
 *
 * Extracts <!-- graphics:... --> and <!-- graphics[viewport,...]:... --> metadata from caption
 * text, emits DSK SSE events to subscribed overlay pages, and updates the RTMP relay overlay.
 *
 * Metacode syntax:
 *   <!-- graphics:logo,banner -->                         default: all viewports get logo + banner
 *   <!-- graphics[vertical-left]:stanza,logo -->          vertical-left gets stanza+logo (overrides default)
 *   <!-- graphics[v1,v2]:stanza -->                       v1 AND v2 both get stanza (overrides default for each)
 *   <!-- graphics[vertical-right]: -->                    vertical-right gets nothing (cleared)
 *
 * Override rule: if a viewport-specific section exists for a viewport, it REPLACES the
 * default for that viewport. Viewports not mentioned use the default section.
 *
 * SSE 'graphics' event payload:
 *   { default: string[]|null, viewports: { [name]: string[] }, ts: number }
 *   - default: null if no all-viewport section was found
 *   - viewports: viewport-specific overrides (empty array = clear that viewport)
 *
 * Used by lcyt-backend's captions route via dependency injection:
 *   const { captionProcessor } = await initDskControl(db, store, relayManager);
 *   app.use('/captions', createCaptionsRouter(store, auth, db, relayManager, captionProcessor));
 */

import { join, resolve, basename } from 'node:path';
import { getImageByShorthand, safeApiKey } from './db/images.js';

// Matches <!-- graphics[v1,v2]:name1, name2 --> (viewport-targeted section)
const VP_CODE_RE = /<!--\s*graphics\[([^\]]+)\]\s*:\s*(.*?)-->/gi;
// Matches <!-- graphics:name1, name2 --> (default / all-viewports section)
const DEFAULT_CODE_RE = /<!--\s*graphics\s*:\s*(.*?)-->/i;

const GRAPHICS_BASE_DIR = resolve(process.env.GRAPHICS_DIR || '/data/images');

/**
 * Parse all DSK metacodes from a caption string.
 *
 * @param {string} text
 * @returns {{ defaultNames: string[]|null, viewportNames: Object<string,string[]>, cleanText: string }}
 */
function parseDskMetacodes(text) {
  /** @type {Object<string,string[]>} */
  const viewportNames = {};

  // 1. Extract viewport-specific sections (<!-- graphics[v1,v2]:names -->)
  let m;
  VP_CODE_RE.lastIndex = 0;
  while ((m = VP_CODE_RE.exec(text)) !== null) {
    const vpList = m[1].split(',').map(v => v.trim()).filter(Boolean);
    const names  = m[2].split(',').map(n => n.trim()).filter(Boolean);
    for (const vp of vpList) {
      viewportNames[vp] = names;
    }
  }

  // 2. Remove viewport-specific sections before looking for the default section,
  //    to prevent the default regex from matching inside them.
  const textWithoutVpSections = text.replace(/<!--\s*graphics\[[^\]]+\][^>]*-->/gi, '');

  // 3. Extract default (all-viewport) section
  const defMatch = textWithoutVpSections.match(DEFAULT_CODE_RE);
  const defaultNames = defMatch
    ? defMatch[1].split(',').map(n => n.trim()).filter(Boolean)
    : null;

  // 4. Build clean text: remove ALL graphics metacodes
  const cleanText = text
    .replace(/<!--\s*graphics(?:\[[^\]]+\])?\s*:[^>]*-->/gi, '')
    .trim();

  return { defaultNames, viewportNames, cleanText };
}

/**
 * Create a DSK caption processor function.
 *
 * @param {{ db: import('better-sqlite3').Database, store: object, relayManager: object|null }} opts
 * @returns {(apiKey: string, text: string) => Promise<string>}
 *   Always returns the cleaned caption text (with all <!-- graphics:... --> codes removed).
 *   If no graphics codes are present the text is returned unchanged.
 */
export function createDskCaptionProcessor({ db, store, relayManager }) {
  return async function processDskCaption(apiKey, text) {
    // Quick check: does the text contain any DSK metacode at all?
    if (!text.includes('<!--') || !/graphics/i.test(text)) return text;

    const { defaultNames, viewportNames, cleanText } = parseDskMetacodes(text);

    // If nothing was parsed (no default and no viewport sections), return unchanged
    if (defaultNames === null && Object.keys(viewportNames).length === 0) return text;

    // Emit SSE 'graphics' event to all open /dsk/:apikey/events subscribers
    store.emitDskEvent(apiKey, 'graphics', {
      default:   defaultNames,
      viewports: viewportNames,
      ts:        Date.now(),
    });

    if (cleanText) {
      store.emitDskEvent(apiKey, 'text', { text: cleanText, ts: Date.now() });
    }

    // Server-side DSK overlay (RTMP relay): use the default names for the landscape stream.
    // SVG is not supported by ffmpeg's overlay filter; only PNG/WebP are included.
    if (relayManager && defaultNames !== null) {
      const imagePaths = defaultNames.flatMap(name => {
        const row = getImageByShorthand(db, apiKey, name);
        if (!row || row.mime_type === 'image/svg+xml') return [];
        return [join(GRAPHICS_BASE_DIR, safeApiKey(apiKey), basename(row.filename))];
      });
      relayManager.setDskOverlay(apiKey, defaultNames, imagePaths).catch(() => {});
    }

    return cleanText;
  };
}
