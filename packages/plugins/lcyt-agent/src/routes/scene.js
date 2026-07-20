/**
 * Scene State routes (plan_video_perception.md Phase 1 Stream B).
 *
 *   GET /scene/state — return the current scene state snapshot for the project
 */

import { Router } from 'express';
import { getSceneState } from '../scene-state.js';

/**
 * @param {import('express').RequestHandler} auth — project-scoped auth middleware
 * @returns {import('express').Router}
 */
export function createSceneRouter(auth) {
  const router = Router();
  router.use(auth);

  const sceneState = getSceneState();

  // GET /scene/state — return the current scene state snapshot
  router.get('/state', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });

    const state = sceneState.getState(apiKey);
    res.json({ ok: true, state });
  });

  return router;
}
