import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { YoutubeLiveCaptionSender } from 'lcyt';
import { validateApiKey, writeSessionStat, writeAuthEvent } from '../db.js';
import { makeSessionId } from '../store.js';
import { createAuthMiddleware } from '../middleware/auth.js';

/**
 * Factory for the /live router.
 *
 * POST   /live  — Register a new session (or return existing JWT, idempotent)
 * GET    /live  — Get current session status (sequence + syncOffset)
 * DELETE /live  — Tear down session and clean up sender
 * PATCH  /live  — Update session fields (e.g. sequence)
 * 
 * @param {import('better-sqlite3').Database} db
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @returns {Router}
 */
export function createLiveRouter(db, store, jwtSecret) {
  const router = Router();
  const auth = createAuthMiddleware(jwtSecret);

  // POST /live — Register session
  router.post('/', async (req, res) => {
    const { apiKey, streamKey, domain, sequence: startSeq = 0 } = req.body || {};

    // Validate required fields
    if (!apiKey || !streamKey || !domain) {
      return res.status(400).json({ error: 'apiKey, streamKey, and domain are required' });
    }

    // Validate API key against SQLite
    const validation = validateApiKey(db, apiKey);
    if (!validation.valid) {
      writeAuthEvent(db, { apiKey, eventType: validation.reason, domain });
      const status = validation.reason === 'expired' ? 401 : 401;
      return res.status(status).json({ error: `API key ${validation.reason}` });
    }

    // Generate deterministic session ID
    const sessionId = makeSessionId(apiKey, streamKey, domain);

    // Idempotent: if session already exists, return existing JWT
    if (store.has(sessionId)) {
      const existing = store.get(sessionId);
      store.touch(sessionId);
      res.setHeader('Access-Control-Allow-Origin', domain);
      return res.status(200).json({
        token: existing.jwt,
        sessionId,
        sequence: existing.sequence,
        syncOffset: existing.syncOffset,
        startedAt: existing.startedAt
      });
    }

    // Create sender and start it
    const sender = new YoutubeLiveCaptionSender({ streamKey, sequence: startSeq });
    sender.start();

    // Initial sync — best-effort
    let syncOffset = 0;
    try {
      const syncResult = await sender.sync();
      syncOffset = syncResult.syncOffset;
    } catch {
      // Not fatal — proceed without sync
    }

    // Sign JWT
    const token = jwt.sign({ sessionId, apiKey, streamKey, domain }, jwtSecret);

    // Store session
    const session = store.create({
      apiKey,
      streamKey,
      domain,
      jwt: token,
      sequence: sender.sequence,
      syncOffset,
      sender
    });

    res.setHeader('Access-Control-Allow-Origin', domain);
    return res.status(200).json({
      token,
      sessionId,
      sequence: session.sequence,
      syncOffset: session.syncOffset,
      startedAt: session.startedAt
    });
  });

  // GET /live — Session status
  router.get('/', auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    store.touch(sessionId);
    return res.status(200).json({
      sequence: session.sequence,
      syncOffset: session.syncOffset
    });
  });

  // PATCH /live — Update session fields (e.g. sequence)
  router.patch('/', auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { sequence, domain } = req.body || {};

    if (sequence !== undefined) {
      const seq = Number(sequence);
      if (!Number.isFinite(seq) || seq < 0) {
        return res.status(400).json({ error: 'sequence must be a non-negative number' });
      }
      try {
        if (typeof session.sender.setSequence === 'function') {
          session.sender.setSequence(seq);
        }
      } catch (err) {
        // Ignore sender errors but continue to update session value
      }
      session.sequence = seq;
      store.touch(sessionId);
    }

    // Echo CORS allow-origin for clients that expect it (domain comes from the JWT)
    if (session.domain) res.setHeader('Access-Control-Allow-Origin', session.domain);

    return res.status(200).json({ sequence: session.sequence });
  });

  // DELETE /live — Remove session
  router.delete('/', auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    try {
      await session.sender.end();
    } catch {
      // Best-effort cleanup
    }

    const removed = store.remove(sessionId);
    if (removed) {
      writeSessionStat(db, {
        sessionId: removed.sessionId,
        apiKey: removed.apiKey,
        domain: removed.domain,
        startedAt: new Date(removed.startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - removed.startedAt,
        captionsSent: removed.captionsSent,
        captionsFailed: removed.captionsFailed,
        finalSequence: removed.sequence,
        endedBy: 'client',
      });
    }
    return res.status(200).json({ removed: true, sessionId });
  });

  return router;
}
