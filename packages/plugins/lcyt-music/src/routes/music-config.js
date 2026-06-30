/**
 * /music/config routes — per-API-key server-side detector settings (Phase 2).
 *
 * Mounted at /music in the main server, alongside routes/music.js.
 *
 * Routes:
 *   GET /music/config  — get the current config (defaults if none saved yet)
 *   PUT /music/config  — update config (partial patch; omitted fields keep current value)
 */

import { Router } from 'express';
import { getMusicConfig, setMusicConfig } from '../db.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — session JWT Bearer auth middleware
 * @returns {import('express').Router}
 */
export function createMusicConfigRouter(db, auth) {
  const router = Router();

  router.get('/config', auth, (req, res) => {
    const { apiKey } = req.session;
    res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
    res.json(getMusicConfig(db, apiKey));
  });

  router.put('/config', auth, (req, res) => {
    const { apiKey } = req.session;
    const {
      silenceThreshold, flatnessThreshold, zcrThreshold,
      confirmSegments, bpmEnabled, bpmMin, bpmMax, autoStart,
    } = req.body || {};

    for (const [name, value] of [
      ['silenceThreshold', silenceThreshold],
      ['flatnessThreshold', flatnessThreshold],
      ['zcrThreshold', zcrThreshold],
    ]) {
      if (value !== undefined && (typeof value !== 'number' || value < 0 || value > 1)) {
        return res.status(400).json({ error: `${name} must be a number between 0 and 1` });
      }
    }
    if (confirmSegments !== undefined && (!Number.isInteger(confirmSegments) || confirmSegments < 1)) {
      return res.status(400).json({ error: 'confirmSegments must be a positive integer' });
    }
    if (bpmMin !== undefined && (!Number.isInteger(bpmMin) || bpmMin < 1)) {
      return res.status(400).json({ error: 'bpmMin must be a positive integer' });
    }
    if (bpmMax !== undefined && (!Number.isInteger(bpmMax) || bpmMax < 1)) {
      return res.status(400).json({ error: 'bpmMax must be a positive integer' });
    }
    if (bpmMin !== undefined && bpmMax !== undefined && bpmMin >= bpmMax) {
      return res.status(400).json({ error: 'bpmMin must be less than bpmMax' });
    }

    // Only pass through fields the caller actually provided — setMusicConfig's
    // {...current, ...patch} merge would otherwise overwrite existing values
    // with `undefined` for any omitted key present in the patch object.
    const patch = {};
    for (const [key, value] of Object.entries({
      silenceThreshold, flatnessThreshold, zcrThreshold,
      confirmSegments, bpmEnabled, bpmMin, bpmMax, autoStart,
    })) {
      if (value !== undefined) patch[key] = value;
    }

    try {
      const merged = setMusicConfig(db, apiKey, patch);
      res.json(merged);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
