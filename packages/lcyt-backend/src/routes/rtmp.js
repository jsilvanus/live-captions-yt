import { Router } from 'express';
import { isRelayAllowed, getRelay } from '../db.js';

/**
 * Factory for the /rtmp router.
 *
 * These endpoints are called by nginx-rtmp as HTTP callbacks.
 * They must be permissive (no JWT auth) because nginx sends them, not the browser.
 *
 * GET/POST /rtmp?start  — called by nginx on_publish:  start ffmpeg relay if configured
 * GET/POST /rtmp?stop   — called by nginx on_publish_done: kill the ffmpeg process
 *
 * The API key is expected as the stream name / last path segment that nginx passes
 * via the `name` query/body parameter (nginx-rtmp sets it automatically).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @returns {Router}
 */
export function createRtmpRouter(db, relayManager) {
  const router = Router();

  // nginx-rtmp sends the stream name as the `name` form field (POST) or query param.
  function resolveApiKey(req) {
    return (req.body && req.body.name) || req.query.name || null;
  }

  // POST/GET /rtmp?start — on_publish callback
  async function handleStart(req, res) {
    const apiKey = resolveApiKey(req);
    if (!apiKey) {
      return res.status(400).send('missing name');
    }

    if (!isRelayAllowed(db, apiKey)) {
      // nginx-rtmp: 2xx = allow publish, 4xx = deny
      return res.status(403).send('relay not allowed');
    }

    const relay = getRelay(db, apiKey);
    if (relay) {
      try {
        await relayManager.start(apiKey, relay.targetUrl);
      } catch (err) {
        console.error(`[rtmp] Failed to start relay for ${apiKey}:`, err.message);
      }
    }

    // Always return 200 so nginx-rtmp allows the publish
    return res.status(200).send('ok');
  }

  // POST/GET /rtmp?stop — on_publish_done callback
  async function handleStop(req, res) {
    const apiKey = resolveApiKey(req);
    if (apiKey) {
      try {
        await relayManager.stop(apiKey);
      } catch (err) {
        console.error(`[rtmp] Failed to stop relay for ${apiKey}:`, err.message);
      }
    }
    return res.status(200).send('ok');
  }

  router.post('/', (req, res) => {
    if ('start' in req.query) return handleStart(req, res);
    if ('stop' in req.query) return handleStop(req, res);
    return res.status(400).send('missing action (?start or ?stop)');
  });

  router.get('/', (req, res) => {
    if ('start' in req.query) return handleStart(req, res);
    if ('stop' in req.query) return handleStop(req, res);
    return res.status(400).send('missing action (?start or ?stop)');
  });

  return router;
}
