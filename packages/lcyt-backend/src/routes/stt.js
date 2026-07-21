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
import { getSttConfig, setSttConfig, getSttSourceLanguages, addSttSourceLanguage, updateSttSourceLanguage, deleteSttSourceLanguage } from 'lcyt-rtmp';
import { extractSseToken, verifySessionToken } from '../middleware/auth.js';
import { getMetricsInstance } from '../metrics/index.js';

const VALID_PROVIDERS    = ['google', 'whisper_http', 'openai'];
const VALID_AUDIO_SOURCE = ['hls', 'rtmp', 'whep'];

/** Send an SSE event line to an Express response. */
function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * @param {import('express').RequestHandler} auth
 * @param {import('../../plugins/lcyt-rtmp/src/stt-manager.js').SttManager} sttManager
 * @param {import('better-sqlite3').Database} db
 * @param {string} jwtSecret — for verifying the SSE ?token= / Bearer session JWT
 */
export function createSttRouter(auth, sttManager, db, jwtSecret, settings = null) {
  const router = Router();

  // Meter STT wall-clock time per project (plan_metering_audit §3.2). One
  // module-level subscription — the per-connection SSE listeners below are
  // per-client and would multiply the count.
  sttManager.on('stopped', ({ apiKey, durationMs = 0 }) => {
    if (durationMs > 0) getMetricsInstance()?.count('stt.seconds', durationMs / 1000, { project: apiKey });
  });

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
      provider             = (settings ? settings.get('stt.provider') : null) || 'google',
      language             = (settings ? settings.get('stt.default_language') : null) || 'en-US',
      audioSource          = (settings ? settings.get('stt.audio_source') : null) || 'hls',
      streamKey            = null,
      confidenceThreshold  = null,
    } = req.body || {};

    if (!VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Supported: ${VALID_PROVIDERS.join(', ')}` });
    }
    if (!VALID_AUDIO_SOURCE.includes(audioSource)) {
      return res.status(400).json({ error: `Invalid audioSource. Supported: ${VALID_AUDIO_SOURCE.join(', ')}` });
    }

    try {
      await sttManager.start(apiKey, { provider, language, audioSource, streamKey, confidenceThreshold });
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
    const token = extractSseToken(req);
    if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

    const apiKey = verifySessionToken(token, jwtSecret)?.apiKey ?? null;
    if (!apiKey) return res.status(401).json({ error: 'Invalid or expired token' });

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
    res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
    if (!cfg) {
      return res.json({
        provider:            (settings ? settings.get('stt.provider') : null) || 'google',
        language:            (settings ? settings.get('stt.default_language') : null) || 'en-US',
        audioSource:         (settings ? settings.get('stt.audio_source') : null) || 'hls',
        streamKey:           null,
        autoStart:           false,
        confidenceThreshold: null,
      });
    }
    res.json(cfg);
  });

  // ── PUT /stt/config ────────────────────────────────────────────────────────

  router.put('/config', auth, (req, res) => {
    const { apiKey } = req.session;
    const { provider, language, audioSource, streamKey, autoStart, confidenceThreshold } = req.body || {};

    if (provider !== undefined && !VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Supported: ${VALID_PROVIDERS.join(', ')}` });
    }
    if (audioSource !== undefined && !VALID_AUDIO_SOURCE.includes(audioSource)) {
      return res.status(400).json({ error: `Invalid audioSource. Supported: ${VALID_AUDIO_SOURCE.join(', ')}` });
    }
    if (confidenceThreshold !== undefined && confidenceThreshold !== null) {
      const ct = Number(confidenceThreshold);
      if (isNaN(ct) || ct < 0 || ct > 1) {
        return res.status(400).json({ error: 'confidenceThreshold must be a number between 0 and 1' });
      }
    }

    try {
      setSttConfig(db, apiKey, { provider, language, audioSource, streamKey, autoStart, confidenceThreshold });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /stt/source-languages ──────────────────────────────────────────────

  router.get('/source-languages', auth, (req, res) => {
    const { apiKey } = req.session;
    const languages = getSttSourceLanguages(db, apiKey);
    res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
    res.json({ languages });
  });

  // ── POST /stt/source-languages ─────────────────────────────────────────────

  router.post('/source-languages', auth, (req, res) => {
    const { apiKey } = req.session;
    const { lang, label, sortOrder } = req.body || {};

    if (!lang) {
      return res.status(400).json({ error: 'lang is required' });
    }

    const result = addSttSourceLanguage(db, apiKey, lang, { label, sortOrder });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.status(201).json(result.language);
  });

  // ── PUT /stt/source-languages/:id ──────────────────────────────────────────

  router.put('/source-languages/:id', auth, (req, res) => {
    const { apiKey } = req.session;
    const { id } = req.params;
    const { label, sortOrder } = req.body || {};

    const result = updateSttSourceLanguage(db, apiKey, parseInt(id, 10), { label, sortOrder });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result.language);
  });

  // ── DELETE /stt/source-languages/:id ───────────────────────────────────────

  router.delete('/source-languages/:id', auth, (req, res) => {
    const { apiKey } = req.session;
    const { id } = req.params;

    const deleted = deleteSttSourceLanguage(db, apiKey, parseInt(id, 10));
    if (!deleted) {
      return res.status(404).json({ error: 'Language not found' });
    }
    res.json({ ok: true });
  });

  // ── POST /stt/config/source-language ───────────────────────────────────────
  // Fast-switch active language: validate against predefined list, update config,
  // restart STT if running (Phase 5 feature)

  router.post('/config/source-language', auth, async (req, res) => {
    const { apiKey } = req.session;
    const { lang } = req.body || {};

    if (!lang) {
      return res.status(400).json({ error: 'lang is required' });
    }

    // Validate that the language is in the project's predefined list
    const predefined = getSttSourceLanguages(db, apiKey);
    const isValid = predefined.some(l => l.lang === lang);
    if (predefined.length > 0 && !isValid) {
      return res.status(400).json({ error: `Language not in predefined list. Valid: ${predefined.map(l => l.lang).join(', ')}` });
    }

    // Update the config
    try {
      setSttConfig(db, apiKey, { language: lang });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    // If STT is currently running, restart it with the new language
    const isRunning = sttManager.isRunning(apiKey);
    if (isRunning) {
      const currentStatus = sttManager.getStatus(apiKey);
      try {
        await sttManager.stop(apiKey);
        // Brief delay to ensure clean shutdown
        await new Promise(resolve => setTimeout(resolve, 100));
        await sttManager.start(apiKey, {
          provider:            currentStatus.provider,
          language:            lang,
          audioSource:         currentStatus.audioSource,
          streamKey:           currentStatus.streamKey,
          confidenceThreshold: currentStatus.confidenceThreshold,
        });
      } catch (err) {
        return res.status(500).json({ error: `Failed to restart STT: ${err.message}` });
      }
    }

    res.json({ ok: true, language: lang, restarted: isRunning });
  });

  return router;
}
