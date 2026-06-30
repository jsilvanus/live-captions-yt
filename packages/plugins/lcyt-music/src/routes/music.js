/**
 * /music routes — server-side (HLS) audio analysis control (Phase 2).
 *
 * Mounted at /music in the main server.
 *
 * Routes:
 *   GET  /music/status      — current analysis state for the authenticated API key
 *   POST /music/start       — start analysis { streamKey? }
 *   POST /music/stop        — stop analysis
 *   GET  /music/:key/live   — public SSE stream of label_change / bpm_update events
 *
 * SSE events on GET /music/:key/live:
 *   connected     { apiKey }
 *   label_change  { label, confidence, bpm, ts }
 *   bpm_update    { bpm, confidence, ts }
 *   music_error   { error }
 *   music_stopped { apiKey }
 */

import { Router } from 'express';

/** Send an SSE event line to an Express response. */
function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * @param {import('express').RequestHandler} auth — session JWT Bearer auth middleware
 * @param {import('../music-manager.js').MusicManager} musicManager
 * @returns {import('express').Router}
 */
export function createMusicRouter(auth, musicManager) {
  const router = Router();

  // ── GET /music/status ────────────────────────────────────────────────────

  router.get('/status', auth, (req, res) => {
    const { apiKey } = req.session;
    res.json(musicManager.getStatus(apiKey));
  });

  // ── POST /music/start ────────────────────────────────────────────────────

  router.post('/start', auth, async (req, res) => {
    const { apiKey } = req.session;
    const { streamKey = null } = req.body || {};
    try {
      await musicManager.start(apiKey, { streamKey });
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /music/stop ─────────────────────────────────────────────────────

  router.post('/stop', auth, async (req, res) => {
    const { apiKey } = req.session;
    await musicManager.stop(apiKey);
    res.json({ ok: true });
  });

  // ── GET /music/:key/live (public SSE) ────────────────────────────────────

  router.get('/:key/live', (req, res) => {
    const apiKey = req.params.key;
    if (!apiKey) return res.status(400).json({ error: 'Missing key' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    sendEvent(res, 'connected', { apiKey });

    function onLabelChange({ apiKey: k, label, confidence, bpm, ts }) {
      if (k !== apiKey) return;
      sendEvent(res, 'label_change', { label, confidence, bpm, ts });
    }
    function onBpmUpdate({ apiKey: k, bpm, confidence, ts }) {
      if (k !== apiKey) return;
      sendEvent(res, 'bpm_update', { bpm, confidence, ts });
    }
    function onError({ apiKey: k, error }) {
      if (k !== apiKey) return;
      sendEvent(res, 'music_error', { error: error?.message || String(error) });
    }
    function onStopped({ apiKey: k }) {
      if (k !== apiKey) return;
      sendEvent(res, 'music_stopped', { apiKey });
    }

    musicManager.on('label_change', onLabelChange);
    musicManager.on('bpm_update', onBpmUpdate);
    musicManager.on('error', onError);
    musicManager.on('stopped', onStopped);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      musicManager.off('label_change', onLabelChange);
      musicManager.off('bpm_update', onBpmUpdate);
      musicManager.off('error', onError);
      musicManager.off('stopped', onStopped);
    });
  });

  return router;
}
