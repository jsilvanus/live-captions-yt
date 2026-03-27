/**
 * Caption file write helpers.
 *
 * These functions are called from the caption send queue (captions.js) to persist
 * caption text to the configured storage backend.
 *
 * Pure utilities (composeCaptionText, formatVttTime, buildVttCue) are kept in
 * lcyt-backend/src/caption-files.js. This module covers only the I/O path.
 */

import { registerCaptionFile, updateCaptionFileSize } from 'lcyt-backend/db';

/**
 * Write caption text to a backend file (append-mode).
 *
 * Uses the injected storage adapter so the same code path serves both
 * local-FS and S3 deployments.
 *
 * On first call for a given (lang, format) pair in a session, a new file is
 * created and registered in the DB. Subsequent calls append to the same handle.
 *
 * @param {{ apiKey: string, sessionId: string, lang: string, format: string, fileHandles: Map }} context
 * @param {string} text
 * @param {string|undefined} timestamp  ISO string of caption time
 * @param {object} db
 * @param {import('./adapters/types.js').StorageAdapter} storage
 * @param {(seq: number, startMs: number, endMs: number, text: string) => string} buildVttCue
 * @param {(ms: number) => string} _formatVttTime  (used indirectly via buildVttCue)
 */
export async function writeToBackendFile(context, text, timestamp, db, storage, buildVttCue) {
  try {
    const { apiKey, sessionId, lang, format, fileHandles } = context;

    // Sanitize lang to only allow safe characters for filenames
    const langKey = (lang || 'original').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20);
    const fileKey = `${langKey}:${format}`;

    if (!fileHandles.has(fileKey)) {
      const ext = format === 'vtt' ? 'vtt' : 'txt';
      const date = new Date().toISOString().slice(0, 10);
      const filename = `${date}-${sessionId.slice(0, 8)}-${langKey}.${ext}`;

      let handle;
      try {
        handle = storage.openAppend(apiKey, filename);
      } catch {
        return;
      }

      // Write VTT header if needed
      if (format === 'vtt') {
        await handle.write('WEBVTT\n\n').catch(() => {});
      }

      const seq = { current: 0 };
      const dbId = registerCaptionFile(db, {
        apiKey,
        sessionId,
        filename: handle.storedKey,   // store the adapter's key (filepath or S3 object key)
        lang,
        format,
        type: 'captions',
      });
      fileHandles.set(fileKey, { handle, seq, dbId });
    }

    const entry = fileHandles.get(fileKey);
    entry.seq.current++;

    let line;
    if (format === 'vtt') {
      const startMs = timestamp ? new Date(timestamp).getTime() : Date.now();
      const endMs = startMs + 3000;
      line = buildVttCue(entry.seq.current, startMs, endMs, text);
    } else {
      line = text + '\n';
    }

    await entry.handle.write(line).catch(err => {
      console.warn('[captions] Backend file write error:', err.message);
    });

    // Update DB size after write
    const sizeBytes = entry.handle.sizeBytes();
    if (sizeBytes > 0) {
      updateCaptionFileSize(db, entry.dbId, sizeBytes);
    }
  } catch (err) {
    console.warn('[captions] Backend file write error:', err.message);
  }
}

/**
 * Close all open file handles for a session (required for S3 multipart uploads).
 * Safe to call multiple times; handles are cleared after closing.
 *
 * @param {Map} fileHandles  session._fileHandles
 */
export async function closeFileHandles(fileHandles) {
  if (!fileHandles || fileHandles.size === 0) return;
  const closes = [];
  for (const entry of fileHandles.values()) {
    closes.push(entry.handle.close().catch(err => {
      console.warn('[files] Error closing file handle:', err.message);
    }));
  }
  await Promise.allSettled(closes);
  fileHandles.clear();
}
