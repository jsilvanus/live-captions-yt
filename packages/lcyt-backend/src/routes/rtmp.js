import { Router } from 'express';
import express from 'express';
import { isRelayAllowed, getRelay } from '../db.js';

/**
 * Factory for the /rtmp router.
 *
 * This endpoint is called by nginx-rtmp as an HTTP callback (always POST,
 * with an application/x-www-form-urlencoded body). A single URL handles
 * both on_publish and on_publish_done — the `call` field in the body
 * distinguishes them:
 *
 *   call=publish       → start ffmpeg relay (on_publish)
 *   call=publish_done  → stop ffmpeg relay  (on_publish_done)
 *
 * nginx-rtmp fields present in every request:
 *   app   — RTMP application name (validated against RTMP_APPLICATION env)
 *   name  — stream name (used as the API key)
 *   call  — "publish" | "publish_done"
 *
 * No JWT auth — nginx is the caller, not a browser.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @returns {Router}
 */
export function createRtmpRouter(db, relayManager) {
  const router = Router();

  // Parse application/x-www-form-urlencoded bodies (nginx-rtmp format)
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  router.post('/', async (req, res) => {
    const { app: appName, name: apiKey, call } = req.body || {};

    // Validate application name when RTMP_APPLICATION is configured.
    // Read env at request time so it can be changed in tests or via hot config.
    const expectedApp = process.env.RTMP_APPLICATION || null;
    if (expectedApp && appName !== expectedApp) {
      console.warn(`[rtmp] Rejected request: app '${appName}' !== expected '${expectedApp}'`);
      return res.status(403).send('wrong application');
    }

    if (!apiKey) {
      return res.status(400).send('missing name');
    }

    // Handle on_publish: call=publish
    if (call === 'publish') {
      if (!isRelayAllowed(db, apiKey)) {
        // nginx-rtmp: 4xx = deny the publish, 2xx = allow
        return res.status(403).send('relay not allowed');
      }

      const relay = getRelay(db, apiKey);
      if (relay) {
        try {
          await relayManager.start(apiKey, relay.targetUrl, {
            targetName:  relay.targetName,
            captionMode: relay.captionMode,
          });
        } catch (err) {
          console.error(`[rtmp] Failed to start relay for ${apiKey.slice(0, 8)}…: ${err.message}`);
        }
      }

      // Always 200 to allow the publish (relay start is best-effort)
      return res.status(200).send('ok');
    }

    // Handle on_publish_done: call=publish_done
    if (call === 'publish_done') {
      try {
        await relayManager.stop(apiKey);
      } catch (err) {
        console.error(`[rtmp] Failed to stop relay for ${apiKey.slice(0, 8)}…: ${err.message}`);
      }
      return res.status(200).send('ok');
    }

    return res.status(400).send('unknown call type');
  });

  return router;
}
