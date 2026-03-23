/**
 * /stt routes — Server-side Speech-to-Text (Phase 1)
 *
 * All endpoints require the standard session Bearer token (same as /captions).
 *
 * Routes:
 *   GET  /stt/status   — current STT state for the authenticated API key
 *   POST /stt/start    — start STT { provider?, language?, audioSource?, streamKey? }
 *   POST /stt/stop     — stop STT
 *   GET  /stt/events   — SSE stream of transcript events (Bearer or ?token=)
 *   GET  /stt/config   — get per-key STT config from DB
 *   PUT  /stt/config   — update per-key STT config
 *
 * SSE events:
 *   connected    { apiKey, provider, language }
 *   transcript   { text, confidence, timestamp, provider }
 *   stt_started  { provider, language, audioSource }
 *   stt_stopped  { apiKey }
 *   stt_error    { error }
 *
 * @param {import('express').RequestHandler} auth  Session JWT Bearer middleware
 * @param {import('lcyt-rtmp').SttManager}   sttManager
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */

import { Router } from 'express';
import { getSttConfig, setSttConfig } from 'lcyt-rtmp';

const VALID_PROVIDERS    = ['google', 'whisper_http', 'openai'];
const VALID_AUDIO_SOURCE = ['hls'];

/** Send an SSE event line to an Express response. */
function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * @param {import('express').RequestHandler} auth
 * @param {import('../../plugins/lcyt-rtmp/src/stt-manager.js').SttManager} sttManager
 * @param {import('better-sqlite3').Database} db
 */
export function createSttRouter(auth, sttManager, db) {
  const router = Router();

  // ── GET /stt/status ────────────────────────────────────────────────────────

  router.get('/status', auth, (req, res) => {
    const { apiKey } = req.session;
    const status = sttManager.getStatus(apiKey);
    res.json(status);
  });

  // ── POST /stt/start ────────────────────────────────────────────────────────

  router.post('/start', auth, async (req, res) => {
    const { apiKey } = req.session;
    const {
      provider    = process.env.STT_PROVIDER          || 'google',
      language    = process.env.STT_DEFAULT_LANGUAGE  || 'en-US',
      audioSource = process.env.STT_AUDIO_SOURCE      || 'hls',
      streamKey   = null,
    } = req.body || {};

    if (!VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Supported: ${VALID_PROVIDERS.join(', ')}` });
    }
    if (!VALID_AUDIO_SOURCE.includes(audioSource)) {
      return res.status(400).json({ error: `Invalid audioSource. Supported: ${VALID_AUDIO_SOURCE.join(', ')}` });
    }

    try {
      await sttManager.start(apiKey, { provider, language, audioSource, streamKey });
      res.status(200).json({ ok: true, provider, language, audioSource });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /stt/stop ─────────────────────────────────────────────────────────

  router.post('/stop', auth, async (req, res) => {
    const { apiKey } = req.session;
    await sttManager.stop(apiKey);
    res.json({ ok: true });
  });

  // ── GET /stt/events (SSE) ──────────────────────────────────────────────────

  router.get('/events', (req, res) => {
    // Support both Bearer and ?token= for SSE (EventSource can't set headers)
    let apiKey;
    const tokenParam = req.query.token;
    if (tokenParam) {
      // Minimal JWT decode — we need the apiKey without full verification here
      // because EventSource can't send Authorization headers.
      // Use the same approach as /events route in events.js.
      try {
        const payload = JSON.parse(Buffer.from(tokenParam.split('.')[1], 'base64url').toString());
        apiKey = payload.apiKey;
      } catch {
        return res.status(401).json({ error: 'Invalid token' });
      }
    } else {
      // Parse from Authorization: Bearer header via req.session set by auth middleware
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing Bearer token' });
      }
      try {
        const payload = JSON.parse(Buffer.from(authHeader.slice(7).split('.')[1], 'base64url').toString());
        apiKey = payload.apiKey;
      } catch {
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    if (!apiKey) return res.status(401).json({ error: 'Missing apiKey' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const status = sttManager.getStatus(apiKey);
    sendEvent(res, 'connected', {
      apiKey,
      provider: status.provider ?? null,
      language: status.language ?? null,
    });

    function onTranscript({ apiKey: k, text, confidence, timestamp, provider }) {
      if (k !== apiKey) return;
      sendEvent(res, 'transcript', { text, confidence, timestamp, provider });
    }
    function onError({ apiKey: k, error }) {
      if (k !== apiKey) return;
      sendEvent(res, 'stt_error', { error: error?.message || String(error) });
    }
    function onStarted({ apiKey: k, provider, language, audioSource }) {
      if (k !== apiKey) return;
      sendEvent(res, 'stt_started', { provider, language, audioSource });
    }
    function onStopped({ apiKey: k }) {
      if (k !== apiKey) return;
      sendEvent(res, 'stt_stopped', { apiKey });
    }

    sttManager.on('transcript', onTranscript);
    sttManager.on('error',      onError);
    sttManager.on('started',    onStarted);
    sttManager.on('stopped',    onStopped);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sttManager.off('transcript', onTranscript);
      sttManager.off('error',      onError);
      sttManager.off('started',    onStarted);
      sttManager.off('stopped',    onStopped);
    });
  });

  // ── GET /stt/config ────────────────────────────────────────────────────────

  router.get('/config', auth, (req, res) => {
    const { apiKey } = req.session;
    const cfg = getSttConfig(db, apiKey);
    if (!cfg) {
      return res.json({
        provider:    process.env.STT_PROVIDER         || 'google',
        language:    process.env.STT_DEFAULT_LANGUAGE || 'en-US',
        audioSource: process.env.STT_AUDIO_SOURCE     || 'hls',
        streamKey:   null,
        autoStart:   false,
      });
    }
    res.json(cfg);
  });

  // ── PUT /stt/config ────────────────────────────────────────────────────────

  router.put('/config', auth, (req, res) => {
    const { apiKey } = req.session;
    const { provider, language, audioSource, streamKey, autoStart } = req.body || {};

    if (provider !== undefined && !VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Supported: ${VALID_PROVIDERS.join(', ')}` });
    }
    if (audioSource !== undefined && !VALID_AUDIO_SOURCE.includes(audioSource)) {
      return res.status(400).json({ error: `Invalid audioSource. Supported: ${VALID_AUDIO_SOURCE.join(', ')}` });
    }

    try {
      setSttConfig(db, apiKey, { provider, language, audioSource, streamKey, autoStart });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
