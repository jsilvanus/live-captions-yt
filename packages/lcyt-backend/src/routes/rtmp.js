import { Router } from 'express';
import express from 'express';
import { isRelayAllowed, isRelayActive, getRelays, getKey } from '../db.js';

/**
 * Factory for the /rtmp router.
 *
 * This endpoint is called by nginx-rtmp as an HTTP callback (always POST,
 * with an application/x-www-form-urlencoded body). A single URL handles
 * both on_publish and on_publish_done — the `call` field in the body
 * distinguishes them:
 *
 *   call=publish       → start ffmpeg fan-out (all configured slots) and allow publish
 *   call=publish_done  → stop all ffmpeg slots; nginx drops the publisher automatically
 *
 * nginx-rtmp fields present in every request:
 *   app   — RTMP application name (validated against RTMP_APPLICATION env)
 *   name  — stream name (used as the API key)
 *   call  — "publish" | "publish_done"
 *
 * No JWT auth — nginx is the caller, not a browser.
 *
 * Stream stopping flow:
 *   Client calls DELETE /stream → backend calls relayManager.stopKey() then
 *   relayManager.dropPublisher() → nginx sends on_publish_done → this route
 *   calls stopKey() again (idempotent, all procs already gone).
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

      // Track that nginx is currently publishing for this key.
      // This allows PUT /stream/active to start fan-out immediately
      // even if the stream was already in progress when the user activated the relay.
      relayManager.markPublishing(apiKey);

      // Fan-out: start all configured relay slots in parallel,
      // but only if the user has activated the relay (relay_active toggle).
      if (isRelayActive(db, apiKey)) {
        const relays = getRelays(db, apiKey);
        if (relays.length > 0) {
          try {
            const keyRow = getKey(db, apiKey);
            const cea708DelayMs = keyRow?.cea708_delay_ms ?? 0;
            await relayManager.startAll(apiKey, relays, { cea708DelayMs });
          } catch (err) {
            console.error(`[rtmp] Failed to start relay fan-out for ${apiKey.slice(0, 8)}…: ${err.message}`);
          }
        }
      } else {
        console.log(`[rtmp] Relay not active for ${apiKey.slice(0, 8)}…; accepting stream but not fanning out`);
      }

      // Always 200 to allow the publish (relay fan-out is best-effort)
      return res.status(200).send('ok');
    }

    // Handle on_publish_done: call=publish_done
    if (call === 'publish_done') {
      relayManager.markNotPublishing(apiKey);
      try {
        await relayManager.stopKey(apiKey);
      } catch (err) {
        console.error(`[rtmp] Failed to stop relay for ${apiKey.slice(0, 8)}…: ${err.message}`);
      }
      return res.status(200).send('ok');
    }

    return res.status(400).send('unknown call type');
  });

  return router;
}
