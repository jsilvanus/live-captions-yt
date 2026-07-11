/**
 * Backend caption-file writer for delivery paths that bypass POST /captions.
 *
 * routes/captions.js writes backend caption files inline; server-side STT
 * (lcyt-rtmp's SttManager._deliverTranscript) delivers transcripts directly
 * to session targets and never passes through that route, so it receives
 * this writer via setDeliveryHelpers() instead. Same semantics as the
 * captions route: original + every translation, per-language format
 * whitelist ('text' | 'youtube' | 'vtt', default 'youtube'), fire-and-forget.
 */

import { writeToBackendFile } from 'lcyt-files';
import { isBackendFileEnabled } from './db/files.js';
import { buildVttCue } from './caption-files.js';
import logger from 'lcyt/logger';

const FILE_FORMATS = new Set(['text', 'youtube', 'vtt']);

/**
 * @param {{ db: object, resolveStorage: (apiKey: string) => Promise<object> }} deps
 * @returns {(session: object, entry: { text: string, translations?: Record<string,string>, fileFormats?: Record<string,string>, timestamp?: string }) => void}
 */
export function createSessionCaptionFileWriter({ db, resolveStorage }) {
  return function writeSessionCaptionFiles(session, { text, translations, fileFormats, timestamp } = {}) {
    if (!db || !resolveStorage || !session) return;

    let enabled = false;
    try { enabled = isBackendFileEnabled(db, session.apiKey); } catch {}
    if (!enabled) return;

    if (!session._fileHandles) session._fileHandles = new Map();

    const fmtFor = (lang) => {
      const f = fileFormats?.[lang];
      return FILE_FORMATS.has(f) ? f : 'youtube';
    };
    const baseContext = {
      apiKey: session.apiKey,
      sessionId: session.sessionId,
      fileHandles: session._fileHandles,
      sessionStartMs: session.startedAt,
    };

    resolveStorage(session.apiKey).then(storage => {
      if (typeof text === 'string' && text.length > 0) {
        writeToBackendFile(
          { ...baseContext, lang: 'original', format: fmtFor('original') },
          text, timestamp, db, storage, buildVttCue
        ).catch(() => {});
      }
      for (const [lang, translated] of Object.entries(translations || {})) {
        writeToBackendFile(
          { ...baseContext, lang, format: fmtFor(lang) },
          translated, timestamp, db, storage, buildVttCue
        ).catch(() => {});
      }
    }).catch(err => {
      logger.debug(`[files] session caption-file write skipped: ${err.message}`);
    });
  };
}
