import { Router } from 'express';
import { isRelayAllowed, getRelay, upsertRelay, deleteRelay } from '../db.js';

/**
 * Factory for the /stream router.
 *
 * Authenticated (JWT Bearer) CRUD for per-key RTMP relay configuration.
 * One relay target per API key. The key must have relay_allowed = true.
 *
 * POST   /stream            — configure relay target URL (create or replace)
 * GET    /stream            — get current relay config + running status
 * PUT    /stream            — update relay target URL
 * DELETE /stream            — remove relay config and stop any running relay
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @returns {Router}
 */
export function createStreamRouter(db, auth, relayManager) {
  const router = Router();

  // Middleware: check relay_allowed for this API key
  function requireRelayAllowed(req, res, next) {
    const apiKey = req.session?.apiKey;
    if (!apiKey || !isRelayAllowed(db, apiKey)) {
      return res.status(403).json({ error: 'RTMP relay not enabled for this API key' });
    }
    next();
  }

  function validateTargetUrl(req, res) {
    const { targetUrl } = req.body || {};
    if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith('rtmp')) {
      res.status(400).json({ error: 'targetUrl must be a valid rtmp:// or rtmps:// URL' });
      return null;
    }
    return targetUrl.trim();
  }

  // POST /stream — create or replace relay config
  router.post('/', auth, requireRelayAllowed, (req, res) => {
    const targetUrl = validateTargetUrl(req, res);
    if (!targetUrl) return;
    const relay = upsertRelay(db, req.session.apiKey, targetUrl);
    return res.status(201).json({ ok: true, relay });
  });

  // GET /stream — get config + running status
  router.get('/', auth, requireRelayAllowed, (req, res) => {
    const relay = getRelay(db, req.session.apiKey);
    if (!relay) {
      return res.status(404).json({ error: 'No relay configured' });
    }
    const running = relayManager.isRunning(req.session.apiKey);
    return res.status(200).json({ relay, running });
  });

  // PUT /stream — update relay target URL
  router.put('/', auth, requireRelayAllowed, (req, res) => {
    const existing = getRelay(db, req.session.apiKey);
    if (!existing) {
      return res.status(404).json({ error: 'No relay configured — use POST /stream to create one' });
    }
    const targetUrl = validateTargetUrl(req, res);
    if (!targetUrl) return;
    const relay = upsertRelay(db, req.session.apiKey, targetUrl);
    return res.status(200).json({ ok: true, relay });
  });

  // DELETE /stream — stop relay and remove config
  router.delete('/', auth, requireRelayAllowed, async (req, res) => {
    const apiKey = req.session.apiKey;
    try {
      await relayManager.stop(apiKey);
    } catch (err) {
      // Best-effort stop
      console.warn(`[stream] stop relay on DELETE failed: ${err.message}`);
    }
    const deleted = deleteRelay(db, apiKey);
    return res.status(200).json({ ok: true, deleted });
  });

  return router;
}
