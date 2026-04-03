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
        'generate_template',
        'edit_template',
        'suggest_styles',
        'generate_rundown',
        'edit_rundown',
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

  // POST /agent/generate-template — { prompt, width?, height? } -> { ok, template }
  router.post('/generate-template', auth, async (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { prompt, width, height } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const template = await agent.generateTemplate(apiKey, prompt, { width, height });
    if (!template) return res.status(503).json({ error: 'AI provider not configured' });
    res.json({ ok: true, template });
  });

  // POST /agent/edit-template — { template, prompt } -> { ok, template }
  router.post('/edit-template', auth, async (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { template, prompt } = req.body || {};
    if (!template || !prompt) return res.status(400).json({ error: 'template and prompt are required' });
    const out = await agent.editTemplate(apiKey, template, prompt);
    if (!out) return res.status(503).json({ error: 'AI provider not configured' });
    res.json({ ok: true, template: out });
  });

  // POST /agent/suggest-styles — { template } -> { ok, suggestions }
  router.post('/suggest-styles', auth, async (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { template } = req.body || {};
    if (!template) return res.status(400).json({ error: 'template is required' });
    const suggestions = await agent.suggestStyles(apiKey, template);
    if (!Array.isArray(suggestions)) return res.status(503).json({ error: 'AI provider not configured' });
    res.json({ ok: true, suggestions });
  });

  // POST /agent/generate-rundown — { prompt, templateId? } -> { ok, content }
  router.post('/generate-rundown', auth, async (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { prompt, templateId } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const content = await agent.generateRundown(apiKey, prompt, { templateId });
    if (content === null) return res.status(503).json({ error: 'AI provider not configured' });
    res.json({ ok: true, content });
  });

  // POST /agent/edit-rundown — { content, prompt } -> { ok, content }
  router.post('/edit-rundown', auth, async (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { content, prompt } = req.body || {};
    if (typeof content !== 'string' || !prompt) return res.status(400).json({ error: 'content (string) and prompt are required' });
    const out = await agent.editRundown(apiKey, content, prompt);
    if (out === null) return res.status(503).json({ error: 'AI provider not configured' });
    res.json({ ok: true, content: out });
  });

  return router;
}
