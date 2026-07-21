/**
 * Scene State routes (plan_video_perception.md Phase 1 Stream B).
 *
 *   GET /scene/state — return the current scene state snapshot for the project
 */

import { Router } from 'express';

/**
 * @param {import('express').RequestHandler} auth — project-scoped auth middleware
 * @param {import('../scene-state.js').SceneState} sceneState — shared instance from initAgent()
 * @returns {import('express').Router}
 */
export function createSceneRouter(auth, sceneState) {
  const router = Router();
  router.use(auth);

  // GET /scene/state — return the current scene state snapshot
  router.get('/state', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });

    const state = sceneState.getState(apiKey);
    res.json({ ok: true, state });
  });

  return router;
}
