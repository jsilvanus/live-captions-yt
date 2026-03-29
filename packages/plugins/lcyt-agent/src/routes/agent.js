/**
 * Express router for the lcyt-agent plugin.
 *
 * Routes:
 *   GET  /agent/status   — agent engine status and capabilities
 *   GET  /agent/context   — current context window for the authenticated key
 *   POST /agent/context   — add a context entry manually
 *   DELETE /agent/context — clear the context window
 *   GET  /agent/events    — recent agent events
 *   POST /agent/analyse   — analyse a preview image (future)
 *
 * All routes require session JWT Bearer authentication.
 */

import { Router } from 'express';
import { getRecentAgentEvents } from '../db.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {Function} auth — JWT auth middleware
 * @param {import('../agent-engine.js').AgentEngine} agent
 * @returns {Router}
 */
export function createAgentRouter(db, auth, agent) {
  const router = Router();

  // GET /agent/status — capabilities and configuration state
  router.get('/status', auth, (req, res) => {
    res.set('Cache-Control', 'private, max-age=3600, stale-while-revalidate=3600');
    res.json({
      ok: true,
      capabilities: [
        'context_window',
        // Future: 'image_analysis', 'event_cues', 'scene_description'
      ],
      contextSize: agent.getContext(req.session?.apiKey || '').length,
    });
  });

  // GET /agent/context — current context window
  router.get('/context', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ ok: true, entries: agent.getContext(apiKey) });
  });

  // POST /agent/context — add a context entry
  router.post('/context', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { type, text } = req.body || {};
    if (!type || !text) return res.status(400).json({ error: 'type and text are required' });
    agent.addContext(apiKey, type, text);
    res.json({ ok: true });
  });

  // DELETE /agent/context — clear context window
  router.delete('/context', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    agent.clearContext(apiKey);
    res.json({ ok: true });
  });

  // GET /agent/events — recent agent events
  router.get('/events', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const events = getRecentAgentEvents(db, apiKey, limit);
    res.set('Cache-Control', 'private, max-age=15');
    res.json({ ok: true, events });
  });

  return router;
}
