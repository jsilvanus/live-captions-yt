import { Router } from 'express';
import { getKey, getKeyStats } from '../db.js';

/**
 * Factory for the /stats router.
 *
 * GET /stats — Return per-key statistics for the authenticated user.
 * Requires a valid JWT (Bearer token). Returns data scoped to the API key
 * embedded in the token — no cross-key access.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth - Pre-created auth middleware
 * @returns {Router}
 */
export function createStatsRouter(db, auth) {
  const router = Router();

  // GET /stats — Per-key usage stats (auth required)
  router.get('/', auth, (req, res) => {
    const { apiKey } = req.session;

    const keyRow = getKey(db, apiKey);
    if (!keyRow) {
      return res.status(404).json({ error: 'API key not found' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const dailyRow = db.prepare(
      'SELECT count FROM caption_usage WHERE api_key = ? AND date = ?'
    ).get(apiKey, today);

    const { sessions, captionErrors, authEvents } = getKeyStats(db, apiKey);

    return res.status(200).json({
      apiKey,
      usage: {
        lifetimeUsed: keyRow.lifetime_used ?? 0,
        dailyUsed: dailyRow ? dailyRow.count : 0,
        dailyLimit: keyRow.daily_limit ?? null,
        lifetimeLimit: keyRow.lifetime_limit ?? null,
      },
      sessions,
      captionErrors,
      authEvents,
    });
  });

  return router;
}
