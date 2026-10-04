/**
 * /production/arming — the per-project ARMED / SAFE switch
 * (plan_backend_actions.md).
 *
 *   GET /production/arming          → { armed, broadcastId, status }  (any member)
 *   PUT /production/arming { armed } → same shape; operator+ (production tier)
 *
 * While SAFE, cue-triggered actions log their device steps as skipped; manual
 * runs always work. Going live arms and the session ending disarms
 * automatically; this route is the manual override.
 */
import { Router } from 'express';
import { getArming, setArmed, publishArmingChange } from '../db/arming.js';
import { requireProjectRole } from '../middleware/project-access.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {import('lcyt/event-bus').EventBus|null} eventBus
 */
export function createArmingRouter(db, auth, eventBus = null) {
  const router = Router();
  const requireProduction = requireProjectRole(db, 'production');

  router.get('/', auth, (req, res) => {
    res.json(getArming(db, req.session.apiKey));
  });

  router.put('/', auth, requireProduction, (req, res) => {
    const { armed } = req.body || {};
    if (typeof armed !== 'boolean') return res.status(400).json({ error: 'armed must be true or false' });
    const apiKey = req.session.apiKey;
    const result = setArmed(db, apiKey, armed);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    if (result.changed) publishArmingChange(eventBus, apiKey, { armed: result.armed, broadcastId: result.broadcastId, reason: 'manual' });
    res.json(getArming(db, apiKey));
  });

  return router;
}
