import { Router } from 'express';

/**
 * Factory for the /captions router.
 *
 * POST /captions — Send one or more captions through the session's sender.
 * Requires JWT auth (passed as middleware).
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

    try {
      let result;
      if (resolvedCaptions.length === 1) {
        const { text, timestamp } = resolvedCaptions[0];
        result = await session.sender.send(text, timestamp);
      } else {
        result = await session.sender.sendBatch(resolvedCaptions);
      }

      // Update session sequence from sender (incremented on success inside sendBatch)
      session.sequence = session.sender.sequence;
      store.touch(sessionId);

      if (result.statusCode >= 200 && result.statusCode < 300) {
        if (resolvedCaptions.length === 1) {
          return res.status(200).json({
            sequence: result.sequence,
            timestamp: result.timestamp,
            statusCode: result.statusCode,
            serverTimestamp: result.serverTimestamp
          });
        } else {
          return res.status(200).json({
            sequence: result.sequence,
            count: result.count,
            statusCode: result.statusCode,
            serverTimestamp: result.serverTimestamp
          });
        }
      } else {
        // YouTube returned a non-2xx status — pass it through
        return res.status(result.statusCode).json({
          error: `YouTube returned status ${result.statusCode}`,
          statusCode: result.statusCode,
          sequence: result.sequence
        });
      }
    } catch (err) {
      // Network or validation errors
      return res.status(502).json({
        error: err.message || 'Failed to send captions',
        statusCode: 502
      });
    }
  });

  return router;
}
