/**
 * DSK caption processor.
 *
 * Extracts the <!-- graphics:... --> metadata from caption text, emits DSK SSE
 * events to subscribed overlay pages, and updates the RTMP relay overlay.
 *
 * Used by lcyt-backend's captions route via dependency injection:
 *   const { captionProcessor } = await initDskControl(db, store, relayManager);
 *   app.use('/captions', createCaptionsRouter(store, auth, db, relayManager, captionProcessor));
 */

import { join, resolve, basename } from 'node:path';
import { getImageByShorthand, safeApiKey } from './db/images.js';

const GRAPHICS_CODE_RE = /<!--\s*graphics\s*:(.*?)-->/i;
const GRAPHICS_BASE_DIR = resolve(process.env.GRAPHICS_DIR || '/data/images');

/**
 * Create a DSK caption processor function.
 *
 * @param {{ db: import('better-sqlite3').Database, store: object, relayManager: object|null }} opts
 * @returns {(apiKey: string, text: string) => Promise<string>}
 *   Always returns the cleaned caption text (with the <!-- graphics:... --> code removed).
 *   If no graphics code is present the text is returned unchanged.
 */
export function createDskCaptionProcessor({ db, store, relayManager }) {
  return async function processDskCaption(apiKey, text) {
    const match = text.match(GRAPHICS_CODE_RE);
    if (!match) return text; // no DSK code — fast path

    const graphicsNames = match[1]
      .split(',')
      .map(n => n.trim())
      .filter(Boolean);

    const cleanText = text.replace(GRAPHICS_CODE_RE, '').trim();

    // Emit SSE events to any open /dsk/:apikey/events subscribers (client-side overlay)
    store.emitDskEvent(apiKey, 'graphics', { names: graphicsNames, ts: Date.now() });
    if (cleanText) {
      store.emitDskEvent(apiKey, 'text', { text: cleanText, ts: Date.now() });
    }

    // Server-side DSK overlay: update the RTMP relay process with the new image files.
    // SVG is not supported by ffmpeg's overlay filter; only PNG/WebP are included.
    if (relayManager) {
      const imagePaths = graphicsNames.flatMap(name => {
        const row = getImageByShorthand(db, apiKey, name);
        if (!row || row.mime_type === 'image/svg+xml') return [];
        return [join(GRAPHICS_BASE_DIR, safeApiKey(apiKey), basename(row.filename))];
      });
      relayManager.setDskOverlay(apiKey, graphicsNames, imagePaths).catch(() => {});
    }

    return cleanText;
  };
}
