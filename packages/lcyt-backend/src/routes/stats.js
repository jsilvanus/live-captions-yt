import { Router } from 'express';
import { getKey, getKeyStats, anonymizeKey, getViewerKeyStats, deleteAllCaptionFiles } from '../db.js';
import { createRequireFeature } from '../middleware/feature-gate.js';
import logger from 'lcyt/logger';

/**
 * Factory for the /stats router.
 *
 * GET    /stats — Return per-key statistics for the authenticated user.
 * DELETE /stats — Erase all personal data (GDPR right to erasure). Anonymises the
 *                 API key record and deletes all associated session/error/usage data.
 *                 When resolveStorage is provided, also deletes physical storage
 *                 objects (local files, S3 objects, or WebDAV resources) for the key.
 *                 Retains email + expires_at for legitimate-interest fraud prevention.
 *
 * Both routes require a valid JWT Bearer token. Data is scoped to the API key in the token.
 *
 * Feature gate: 'stats' — when FEATURE_GATE_ENFORCE=1, blocks if not enabled.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth - Pre-created auth middleware
 * @param {import('../store.js').SessionStore} [store] - In-memory session store
 * @param {{ resolveStorage?: (apiKey: string) => Promise<object> }} [opts]
 * @returns {Router}
 */
export function createStatsRouter(db, auth, store, { resolveStorage } = {}) {
  const router = Router();
  const requireStats = createRequireFeature(db, 'stats');

  // GET /stats — Per-key usage stats (auth required)
  router.get('/', auth, requireStats, (req, res) => {
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
    const viewerStats = getViewerKeyStats(db, apiKey);

    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
    return res.status(200).json({
      apiKey,
      owner: keyRow.owner || null,
      email: keyRow.email || null,
      expires: keyRow.expires_at || null,
      usage: {
        lifetimeUsed: keyRow.lifetime_used ?? 0,
        dailyUsed: dailyRow ? dailyRow.count : 0,
        dailyLimit: keyRow.daily_limit ?? null,
        lifetimeLimit: keyRow.lifetime_limit ?? null,
      },
      sessions,
      captionErrors,
      authEvents,
      viewerStats,
    });
  });

  // DELETE /stats — GDPR right-to-erasure: anonymise key and delete all associated data
  router.delete('/', auth, async (req, res) => {
    const { sessionId, apiKey } = req.session;

    // Terminate the active in-memory session without writing a TTL stats record
    if (store && sessionId) {
      const session = store.get(sessionId);
      if (session) {
        session.emitter.emit('session_closed');
        store.remove(sessionId);
        session.sender?.end().catch(() => {});
      }
    }

    // Delete physical storage objects for this key (best-effort, non-blocking)
    if (resolveStorage) {
      try {
        const storage = await resolveStorage(apiKey);
        if (typeof storage.listObjects === 'function') {
          for await (const obj of storage.listObjects(apiKey)) {
            await storage.deleteFile(apiKey, obj.storedKey).catch(e => {
              logger.warn('[stats] Failed to delete storage object during GDPR erasure:', obj.storedKey, e.code ?? e.message);
            });
          }
        }
      } catch (err) {
        logger.warn('[stats] Could not delete storage objects during GDPR erasure:', err.message);
      }
    }

    // Delete caption file DB records
    deleteAllCaptionFiles(db, apiKey);

    const found = anonymizeKey(db, apiKey);
    if (!found) {
      return res.status(404).json({ error: 'API key not found' });
    }

    return res.status(200).json({
      ok: true,
      message: 'Account data erased. Email retained until key expiry for fraud prevention.',
    });
  });

  return router;
}
