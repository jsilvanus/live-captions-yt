import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkAndIncrementUsage, writeCaptionError, writeAuthEvent, incrementDomainHourlyCaptions, updateKeySequence, isBackendFileEnabled, registerCaptionFile, updateCaptionFileSize } from '../db.js';

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
function composeCaptionText(text, captionLang, translations, showOriginal) {
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
function ensureKeyDir(apiKey) {
  // Use a safe subdirectory name derived from the key (first 32 chars, alphanum only)
  const safe = apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
  const dir = join(FILES_BASE_DIR, safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Format a VTT cue string.
 */
function formatVttTime(ms) {
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const msStr = String(ms % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${msStr}`;
}

function buildVttCue(seq, startMs, endMs, text) {
  return `${seq}\n${formatVttTime(startMs)} --> ${formatVttTime(endMs)}\n${text}\n\n`;
}

/**
 * Write caption text to a backend file (append-mode).
 * @param {{ apiKey, sessionId, lang, format, fileHandles }} context
 * @param {string} text
 * @param {string} timestamp ISO string of caption
 * @param {object} db
 */
function writeToBackendFile(context, text, timestamp, db) {
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
    handle.stream.write(line, () => {
      try {
        const { size } = statSync(handle.filepath);
        updateCaptionFileSize(db, handle.dbId, size);
      } catch {}
    });
  } catch (err) {
    console.warn('[captions] Backend file write error:', err.message);
  }
}

/**
 * Factory for the /captions router.
 *
 * POST /captions — Queue a caption send and return 202 immediately.
 * The actual YouTube delivery is serialised per session and the result
 * is pushed to the client via the GET /events SSE stream.
 *
 * @param {import('../store.js').SessionStore} store
 * @param {import('express').RequestHandler} auth - Pre-created auth middleware
 * @param {object} db
 * @param {import('../rtmp-manager.js').RtmpRelayManager|null} [relayManager]
 * @returns {Router}
 */
export function createCaptionsRouter(store, auth, db, relayManager = null) {
  const router = Router();

  // POST /captions — Send captions (auth required)
  router.post('/', auth, async (req, res) => {
    const { captions } = req.body || {};

    // Validate captions array
    if (!Array.isArray(captions) || captions.length === 0) {
      return res.status(400).json({ error: 'captions must be a non-empty array' });
    }

    // Look up session
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // If any RTMP relay slot is running in CEA-708 mode, batch sends are not supported
    // because each caption must be injected at the correct video PTS immediately.
    if (captions.length > 1 && relayManager?.hasCea708(session.apiKey)) {
      return res.status(400).json({ error: 'Batch captions not supported in CEA-708 mode' });
    }

    // Enforce per-key usage limits (no-op for keys with null limits)
    const usage = checkAndIncrementUsage(db, session.apiKey);
    if (!usage.allowed) {
      writeAuthEvent(db, { apiKey: session.apiKey, eventType: usage.reason, domain: session.domain });
      return res.status(429).json({ error: usage.reason });
    }

    // Check if backend file saving is enabled for this key
    let backendFileEnabled = false;
    try { backendFileEnabled = isBackendFileEnabled(db, session.apiKey); } catch {}

    // Ensure session has a file handle map
    if (!session._fileHandles) session._fileHandles = new Map();

    // Resolve relative `time` fields to absolute timestamps.
    // time (ms since session start) → session.startedAt + time + session.syncOffset
    const resolvedCaptions = captions.map(caption => {
      if (caption.time !== undefined && caption.timestamp === undefined) {
        return {
          ...caption,
          timestamp: new Date(session.startedAt + caption.time + session.syncOffset)
        };
      }
      return caption;
    });

    const requestId = randomUUID();

    // Chain onto the session's send queue so concurrent POST /captions requests
    // are serialised and sequence numbers stay monotonically increasing.
    const isBatch = resolvedCaptions.length > 1;

    session._sendQueue = session._sendQueue.then(async () => {
      let result;
      try {
        // For each caption, compose text from translations and write backend files
        const sendCaptions = resolvedCaptions.map(caption => {
          const { text, translations, captionLang, showOriginal, timestamp, speechStart, ...rest } = caption;
          const composedText = composeCaptionText(text, captionLang, translations, showOriginal);

          // Inject into the CEA-708 ffmpeg pipe when relay is active in cea708 mode.
          // Use plain text (no HTML) for the SEI NAL payload.
          if (relayManager?.hasCea708(session.apiKey)) {
            const written = relayManager.writeCaption(session.apiKey, text, { speechStart, timestamp });
            if (!written) {
              console.warn(`[captions] CEA-708 writeCaption failed for ${session.apiKey.slice(0, 8)}: pipe unavailable or invalid timing`);
            }
          }

          // Write original and all translations to backend files if enabled
          if (backendFileEnabled && translations) {
            for (const [lang, translatedText] of Object.entries(translations)) {
              writeToBackendFile(
                { apiKey: session.apiKey, sessionId, lang, format: 'youtube', fileHandles: session._fileHandles },
                translatedText,
                typeof timestamp === 'string' ? timestamp : (timestamp instanceof Date ? timestamp.toISOString() : undefined),
                db
              );
            }
          }
          if (backendFileEnabled) {
            writeToBackendFile(
              { apiKey: session.apiKey, sessionId, lang: 'original', format: 'youtube', fileHandles: session._fileHandles },
              text,
              typeof timestamp === 'string' ? timestamp : (timestamp instanceof Date ? timestamp.toISOString() : undefined),
              db
            );
          }

          return { text: composedText, timestamp, ...rest };
        });

        if (sendCaptions.length === 1) {
          const { text, timestamp } = sendCaptions[0];
          result = await session.sender.send(text, timestamp);
        } else {
          result = await session.sender.sendBatch(sendCaptions);
        }

        session.sequence = session.sender.sequence;
        store.touch(sessionId);
        // Persist per-API-key sequence so it survives session expiry
        if (db) {
          try { updateKeySequence(db, session.apiKey, session.sequence); } catch (_) {}
        }

        if (result.statusCode >= 200 && result.statusCode < 300) {
          session.captionsSent++;
          incrementDomainHourlyCaptions(db, session.domain, { sent: 1, batches: isBatch ? 1 : 0 });
          session.emitter.emit('caption_result', {
            requestId,
            sequence: result.sequence,
            ...(result.count !== undefined && { count: result.count }),
            statusCode: result.statusCode,
            serverTimestamp: result.serverTimestamp,
          });
        } else {
          session.captionsFailed++;
          incrementDomainHourlyCaptions(db, session.domain, { failed: 1 });
          writeCaptionError(db, {
            apiKey: session.apiKey,
            sessionId,
            errorCode: result.statusCode,
            errorMsg: `YouTube returned status ${result.statusCode}`,
            batchSize: resolvedCaptions.length,
          });
          session.emitter.emit('caption_error', {
            requestId,
            error: `YouTube returned status ${result.statusCode}`,
            statusCode: result.statusCode,
            sequence: result.sequence,
          });
        }
      } catch (err) {
        session.captionsFailed++;
        incrementDomainHourlyCaptions(db, session.domain, { failed: 1 });
        writeCaptionError(db, {
          apiKey: session.apiKey,
          sessionId,
          errorCode: err.statusCode || 502,
          errorMsg: err.message || 'Failed to send captions',
          batchSize: resolvedCaptions.length,
        });
        session.emitter.emit('caption_error', {
          requestId,
          error: err.message || 'Failed to send captions',
          statusCode: err.statusCode || 502,
        });
      }
    });

    return res.status(202).json({ ok: true, requestId });
  });

  return router;
}
