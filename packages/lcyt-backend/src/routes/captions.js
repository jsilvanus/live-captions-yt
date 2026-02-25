import { Router } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Factory for the /captions router.
 *
 * POST /captions — Queue a caption send and return 202 immediately.
 * The actual YouTube delivery is serialised per session and the result
 * is pushed to the client via the GET /events SSE stream.
 *
 * @param {import('../store.js').SessionStore} store
 * @param {import('express').RequestHandler} auth - Pre-created auth middleware
 * @returns {Router}
 */
export function createCaptionsRouter(store, auth) {
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
    session._sendQueue = session._sendQueue.then(async () => {
      let result;
      try {
        if (resolvedCaptions.length === 1) {
          const { text, timestamp } = resolvedCaptions[0];
          result = await session.sender.send(text, timestamp);
        } else {
          result = await session.sender.sendBatch(resolvedCaptions);
        }

        session.sequence = session.sender.sequence;
        store.touch(sessionId);

        if (result.statusCode >= 200 && result.statusCode < 300) {
          session.emitter.emit('caption_result', {
            requestId,
            sequence: result.sequence,
            ...(result.count !== undefined && { count: result.count }),
            statusCode: result.statusCode,
            serverTimestamp: result.serverTimestamp,
          });
        } else {
          session.emitter.emit('caption_error', {
            requestId,
            error: `YouTube returned status ${result.statusCode}`,
            statusCode: result.statusCode,
            sequence: result.sequence,
          });
        }
      } catch (err) {
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
