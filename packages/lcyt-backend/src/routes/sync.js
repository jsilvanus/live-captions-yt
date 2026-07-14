import { Router } from 'express';

/**
 * Factory for the /sync router.
 *
 * POST /sync — Trigger an NTP-style clock sync for the session's sender.
 * Requires JWT auth (passed as middleware).
 *
 * Accepts both session JWTs (with sessionId) and project-scoped JWTs (with apiKey).
 *
 * @param {import('../store.js').SessionStore} store
 * @param {import('express').RequestHandler} auth - Pre-created auth middleware
 * @returns {Router}
 */
export function createSyncRouter(store, auth) {
  const router = Router();

  // POST /sync — Clock synchronization (auth required)
  router.post('/', auth, async (req, res) => {
    const { sessionId, apiKey, projectId } = req.session;

    // Resolve session: prefer sessionId if available (session JWT),
    // otherwise try apiKey or projectId (project-scoped JWT)
    const resolvedSessionId = sessionId || apiKey || projectId;
    let session = null;

    if (sessionId) {
      // Direct session lookup using sessionId from session JWT
      session = store.get(sessionId);
    } else if (apiKey || projectId) {
      // Project-scoped JWT: find a session for this project/apiKey
      // Search through all sessions to find one matching the apiKey
      const projectKey = apiKey || projectId;
      for (const [sid, sess] of store.entries()) {
        if (sess.apiKey === projectKey) {
          session = sess;
          break;
        }
      }
    }

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    try {
      const syncResult = await session.sender.sync();

      // Update session syncOffset with the newly computed value
      session.syncOffset = syncResult.syncOffset;
      store.touch(sessionId);

      return res.status(200).json({
        syncOffset: syncResult.syncOffset,
        roundTripTime: syncResult.roundTripTime,
        serverTimestamp: syncResult.serverTimestamp,
        statusCode: syncResult.statusCode
      });
    } catch (err) {
      return res.status(502).json({
        error: err.message || 'Sync failed: YouTube server did not respond',
        statusCode: 502
      });
    }
  });

  return router;
}
