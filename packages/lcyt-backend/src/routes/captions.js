import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { checkAndIncrementUsage, writeCaptionError, writeAuthEvent, incrementDomainHourlyCaptions, updateKeySequence, isBackendFileEnabled } from '../db.js';
import { composeCaptionText, buildVttCue } from '../caption-files.js';
import { applyMetacodeProcessors } from '../metacode.js';
import { writeToBackendFile } from 'lcyt-files';
import { createCaptionFanout } from '../caption-fanout.js';

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
 * @param {Function|null} [soundProcessor]
 * @param {Function|null} [cueProcessor]
 * @returns {Router}
 */
export function createCaptionsRouter(store, auth, db, relayManager = null, dskProcessor = null, resolveStorage = null, soundProcessor = null, cueProcessor = null) {
  const router = Router();
  const fanOutToTargets = createCaptionFanout({ db });

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

    // Ensure the session has at least one delivery path configured.
    // Sessions in target-array mode (no primary sender) must have extraTargets.
    if (!session.sender && (!session.extraTargets || session.extraTargets.length === 0)) {
      return res.status(400).json({ error: 'No caption targets configured. Add at least one target in CC → Targets.' });
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
        // Apply core backend metacode processors in the canonical order.
        await applyMetacodeProcessors(session, resolvedCaptions, dskProcessor, soundProcessor, cueProcessor);

        // For each caption, compose text from translations and write backend files
        const sendCaptions = resolvedCaptions.map(caption => {
          const { text, translations, captionLang, showOriginal, timestamp, speechStart, fileFormats, ...rest } = caption;
          const composedText = composeCaptionText(text, captionLang, translations, showOriginal);

          // Per-language backend-file format from the client ('text' | 'youtube' | 'vtt';
          // 'original' keys the untranslated text). Anything else falls back to 'youtube'.
          const fileFormatFor = (lang) => {
            const f = fileFormats?.[lang];
            return (f === 'vtt' || f === 'text' || f === 'youtube') ? f : 'youtube';
          };

          // Write original and all translations to backend files if enabled
          const tsStr = typeof timestamp === 'string' ? timestamp
            : (timestamp instanceof Date ? timestamp.toISOString() : undefined);
          if (backendFileEnabled && resolveStorage && translations) {
            resolveStorage(session.apiKey).then(fileStorage => {
              for (const [lang, translatedText] of Object.entries(translations)) {
                writeToBackendFile(
                  { apiKey: session.apiKey, sessionId, lang, format: fileFormatFor(lang), fileHandles: session._fileHandles, sessionStartMs: session.startedAt },
                  translatedText, tsStr, db, fileStorage, buildVttCue
                );
              }
            }).catch(() => {});
          }
          if (backendFileEnabled && resolveStorage) {
            resolveStorage(session.apiKey).then(fileStorage => {
              writeToBackendFile(
                { apiKey: session.apiKey, sessionId, lang: 'original', format: fileFormatFor('original'), fileHandles: session._fileHandles, sessionStartMs: session.startedAt },
                text, tsStr, db, fileStorage, buildVttCue
              );
            }).catch(() => {});
          }

          return { text: composedText, timestamp, ...rest };
        });

        // CEA-708 caption injection: pipe the original (pre-composition) caption text to
        // the ffmpeg stdin SRT pipe when the relay is running in CEA-708 mode.
        // Done after the map so each caption is injected exactly once.
        if (relayManager?.hasCea708(session.apiKey)) {
          for (const caption of resolvedCaptions) {
            relayManager.writeCaption(session.apiKey, caption.text, {
              speechStart: caption.speechStart,
              timestamp:   caption.timestamp,
            }).catch(() => {});
          }
        }

        // Send via primary sender (legacy streamKey mode) or synthesise a result
        // when operating in target-array mode (no primary stream key configured).
        if (session.sender) {
          if (sendCaptions.length === 1) {
            const { text, timestamp } = sendCaptions[0];
            result = await session.sender.send(text, timestamp);
          } else {
            result = await session.sender.sendBatch(sendCaptions);
          }
          session.sequence = session.sender.sequence;
        } else {
          // Target-array mode: no primary sender. Increment sequence locally and
          // synthesise a 200 result; actual delivery is handled by extraTargets below.
          session.sequence = (session.sequence ?? 0) + 1;
          result = { statusCode: 200, sequence: session.sequence, serverTimestamp: null };
        }

        // Persist per-API-key sequence so it survives session expiry
        if (db) {
          try { updateKeySequence(db, session.apiKey, session.sequence); } catch (_) {}
        }
        store.touch(sessionId);

        // Fan-out to extra targets (fire-and-forget; errors do not affect the
        // primary result). Shared with server-STT delivery — see
        // src/caption-fanout.js for the per-target routed composition logic.
        fanOutToTargets(session, resolvedCaptions.map((orig, i) => ({
          text: orig.text,
          composedText: sendCaptions[i]?.text ?? orig.text,
          timestamp: orig.timestamp,
          translations: orig.translations,
          captionLang: orig.captionLang,
          showOriginal: orig.showOriginal,
          codes: orig.codes,
        })));

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
