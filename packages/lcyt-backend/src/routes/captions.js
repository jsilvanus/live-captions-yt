import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { resolve, join, basename } from 'node:path';
import { checkAndIncrementUsage, writeCaptionError, writeAuthEvent, incrementDomainHourlyCaptions, updateKeySequence, isBackendFileEnabled, getImageByShorthand, safeApiKey } from '../db.js';
import { broadcastToViewers, registerViewerKeyOwner } from './viewer.js';
import { composeCaptionText, writeToBackendFile } from '../caption-files.js';

// Base directory for uploaded graphics (same default as routes/images.js)
const GRAPHICS_BASE_DIR = resolve(process.env.GRAPHICS_DIR || '/data/images');

// Regex to detect and extract <!-- graphics:... --> metadata codes.
// Matches anywhere in the caption text (own line or inline with text).
const GRAPHICS_CODE_RE = /<!--\s*graphics\s*:(.*?)-->/i;

/**
 * Strip any <!-- graphics:... --> code from caption text and return
 * the cleaned text plus the parsed list of shorthand names.
 *
 * @param {string} text
 * @returns {{ cleanText: string, graphicsNames: string[]|null }}
 *   graphicsNames is null when no graphics code was present,
 *   an empty array for <!-- graphics: --> (clear command),
 *   or a non-empty array of trimmed names.
 */
function extractGraphicsCode(text) {
  const match = text.match(GRAPHICS_CODE_RE);
  if (!match) return { cleanText: text, graphicsNames: null };

  const names = match[1]
    .split(',')
    .map(n => n.trim())
    .filter(Boolean);

  const cleanText = text.replace(GRAPHICS_CODE_RE, '').trim();
  return { cleanText, graphicsNames: names };
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
        // Extract graphics codes from captions and emit DSK events.
        // The graphics code is stripped from the text before delivery to YouTube.
        for (const caption of resolvedCaptions) {
          const { cleanText, graphicsNames } = extractGraphicsCode(caption.text || '');
          if (graphicsNames !== null) {
            // Mutate in place so downstream processing uses the stripped text
            caption.text = cleanText;
            // Emit DSK event to any open /dsk/:apikey/events SSE connections
            store.emitDskEvent(session.apiKey, 'graphics', {
              names: graphicsNames,
              ts: Date.now(),
            });
            // In CC mode, also emit the stripped text as a separate event so the
            // DSK CC overlay can display it
            if (cleanText) {
              store.emitDskEvent(session.apiKey, 'text', {
                text: cleanText,
                ts: Date.now(),
              });
            }

            // Server-side DSK overlay: update the RTMP relay process with the new images.
            // Only raster formats (PNG/WebP) are supported; SVG is skipped.
            if (relayManager) {
              const imagePaths = graphicsNames.flatMap(name => {
                const row = getImageByShorthand(db, session.apiKey, name);
                if (!row || row.mime_type === 'image/svg+xml') return [];
                // Reconstruct the absolute path using the same convention as routes/images.js
                return [join(GRAPHICS_BASE_DIR, safeApiKey(session.apiKey), basename(row.filename))];
              });
              // Fire-and-forget — DSK update failures are logged inside setDskOverlay
              relayManager.setDskOverlay(session.apiKey, graphicsNames, imagePaths).catch(() => {});
            }
          }
        }

        // For each caption, compose text from translations and write backend files
        const sendCaptions = resolvedCaptions.map(caption => {
          const { text, translations, captionLang, showOriginal, timestamp, speechStart, ...rest } = caption;
          const composedText = composeCaptionText(text, captionLang, translations, showOriginal);

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

        // CEA-708 caption injection: pipe the original (pre-composition) caption text to
        // the ffmpeg stdin SRT pipe when the relay is running in CEA-708 mode.
        // Done after the map so each caption is injected exactly once.
        if (relayManager?.hasCea708(session.apiKey)) {
          for (const caption of resolvedCaptions) {
            relayManager.writeCaption(session.apiKey, caption.text, {
              speechStart: caption.speechStart,
              timestamp:   caption.timestamp,
            });
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

        // Fan-out to extra targets (fire-and-forget; errors do not affect the primary result)
        if (session.extraTargets && session.extraTargets.length > 0) {
          const source = session.domain;

          // Build the full per-caption payload for generic targets.
          // Includes the original text, the composed/translated text, and all
          // translation metadata so downstream services can apply their own logic.
          //
          // Single caption example:
          // { source, sequence, captions: [{ text, composedText, timestamp,
          //     captionLang, translations: { 'fi-FI': '...' }, showOriginal }] }
          //
          // Batch example (same structure, multiple entries in captions array):
          // { source, sequence, captions: [{ text, composedText, timestamp, ... },
          //     { text, composedText, timestamp, ... }] }
          const genericCaptions = resolvedCaptions.map((orig, i) => {
            const { text, translations, captionLang, showOriginal, timestamp, codes } = orig;
            const tsStr = typeof timestamp === 'string' ? timestamp
              : (timestamp instanceof Date ? timestamp.toISOString() : undefined);
            return {
              text,
              composedText: sendCaptions[i]?.text ?? text,
              timestamp: tsStr,
              ...(translations && { translations }),
              ...(captionLang && { captionLang }),
              ...(showOriginal !== undefined && { showOriginal }),
              ...(codes && typeof codes === 'object' && { codes }),
            };
          });

          for (const target of session.extraTargets) {
            if (target.type === 'youtube' && target.sender) {
              for (const caption of sendCaptions) {
                target.sender.send(caption.text, caption.timestamp).catch(err => {
                  console.warn(`[captions] Extra YouTube target ${target.id} error: ${err.message}`);
                });
              }
            } else if (target.type === 'generic' && target.url) {
              fetch(target.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(target.headers || {}) },
                body: JSON.stringify({ source, sequence: session.sequence, captions: genericCaptions }),
              }).catch(err => {
                console.warn(`[captions] Generic target ${target.id} error: ${err.message}`);
              });
            } else if (target.type === 'viewer' && target.viewerKey) {
              // Register the owner mapping so viewer stats can be attributed to this API key
              registerViewerKeyOwner(target.viewerKey, session.apiKey);
              // Broadcast each caption to viewer SSE subscribers.
              // Include original text, composed text, all translations, and metadata codes
              // so viewer pages can filter/display by language and show section info.
              for (const caption of genericCaptions) {
                broadcastToViewers(target.viewerKey, {
                  text: caption.text,
                  composedText: caption.composedText,
                  sequence: session.sequence,
                  timestamp: caption.timestamp,
                  ...(caption.translations && { translations: caption.translations }),
                  ...(caption.codes && { codes: caption.codes }),
                });
              }
            }
          }
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
