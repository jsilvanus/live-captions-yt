import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { registerCaptionFile, updateCaptionFileSize } from './db.js';

// Directory where per-key caption files are stored.
// Configurable via FILES_DIR env var; defaults to /data/files (Docker volume).
const FILES_BASE_DIR = resolve(process.env.FILES_DIR || '/data/files');

/**
 * Compose the final caption text from the original + caption-target translation.
 * If showOriginal is true and a translation exists, produces "original<br>translated".
 * If showOriginal is false (or undefined) and translation exists, produces just the translation.
 * Falls back to original text when no translation is provided.
 *
 * @param {string} text
 * @param {string|null} captionLang
 * @param {object} translations
 * @param {boolean} showOriginal
 * @returns {string}
 */
export function composeCaptionText(text, captionLang, translations, showOriginal) {
  if (!captionLang || !translations || !translations[captionLang]) return text;
  const translated = translations[captionLang];
  if (translated === text) return text; // same language — no-op
  return showOriginal ? `${text}<br>${translated}` : translated;
}

/**
 * Ensure the per-key directory exists and return its path.
 * @param {string} apiKey
 * @returns {string}
 */
export function ensureKeyDir(apiKey) {
  // Use a safe subdirectory name derived from the key (first 32 chars, alphanum only)
  const safe = apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
  const dir = join(FILES_BASE_DIR, safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Format a VTT cue string.
 */
export function formatVttTime(ms) {
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const msStr = String(ms % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${msStr}`;
}

export function buildVttCue(seq, startMs, endMs, text) {
  return `${seq}\n${formatVttTime(startMs)} --> ${formatVttTime(endMs)}\n${text}\n\n`;
}

/**
 * Write caption text to a backend file (append-mode).
 * @param {{ apiKey, sessionId, lang, format, fileHandles }} context
 * @param {string} text
 * @param {string} timestamp ISO string of caption
 * @param {object} db
 */
export function writeToBackendFile(context, text, timestamp, db) {
  try {
    const { apiKey, sessionId, lang, format } = context;
    const fileHandles = context.fileHandles;

    // Sanitize lang to only allow safe characters for filenames
    const langKey = (lang || 'original').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20);
    const fileKey = `${langKey}:${format}`;

    if (!fileHandles.has(fileKey)) {
      let dir;
      try { dir = ensureKeyDir(apiKey); } catch { return; }
      const ext = format === 'vtt' ? 'vtt' : 'txt';
      const date = new Date().toISOString().slice(0, 10);
      const filename = `${date}-${sessionId.slice(0, 8)}-${langKey}.${ext}`;
      const filepath = join(dir, filename);
      let stream;
      try { stream = createWriteStream(filepath, { flags: 'a' }); } catch { return; }
      // Write VTT header if needed
      if (format === 'vtt') { stream.write('WEBVTT\n\n'); }
      const seq = { current: 0 };
      const dbId = registerCaptionFile(db, { apiKey, sessionId, filename, lang, format, type: 'captions' });
      fileHandles.set(fileKey, { stream, seq, filepath, dbId });
    }

    const handle = fileHandles.get(fileKey);
    handle.seq.current++;
    let line;
    if (format === 'vtt') {
      const startMs = timestamp ? new Date(timestamp).getTime() : Date.now();
      const endMs = startMs + 3000;
      line = buildVttCue(handle.seq.current, startMs, endMs, text);
    } else {
      line = text + '\n';
    }
    const WRITE_TIMEOUT_MS = 5000;
    const writeTimer = setTimeout(() => {
      console.warn('[captions] Backend file write timed out after 5 s:', handle.filepath);
    }, WRITE_TIMEOUT_MS);
    handle.stream.write(line, () => {
      clearTimeout(writeTimer);
      try {
        const { size } = statSync(handle.filepath);
        updateCaptionFileSize(db, handle.dbId, size);
      } catch {}
    });
  } catch (err) {
    console.warn('[captions] Backend file write error:', err.message);
  }
}
