import { Router } from 'express';

/**
 * Factory for the /mic router.
 *
 * POST /mic — Claim or release the soft mic lock for a session.
 *
 * Body: { action: 'claim' | 'release', clientId: string }
 *
 * A claim overwrites any existing holder (soft lock — advisory only).
 * A release is a no-op if the requester does not currently hold the lock.
 * After every mutation, a `mic_state` event is emitted to all SSE subscribers.
 *
 * @param {import('../store.js').SessionStore} store
 * @param {import('express').RequestHandler} auth
 * @returns {Router}
 */
export function createMicRouter(store, auth) {
  const router = Router();

  router.post('/', auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { action, clientId } = req.body;

    if (!clientId || typeof clientId !== 'string') {
      return res.status(400).json({ error: 'clientId required' });
    }
    if (action !== 'claim' && action !== 'release') {
      return res.status(400).json({ error: 'action must be claim or release' });
    }

    if (action === 'claim') {
      session.micHolder = clientId;
    } else if (session.micHolder === clientId) {
      session.micHolder = null;
    }

    const holder = session.micHolder ?? null;
    session.emitter.emit('mic_state', { holder });
    res.json({ ok: true, holder });
  });

  return router;
}
