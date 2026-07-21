import { Router } from 'express';
import express from 'express';
import { isRelayAllowed, isRelayActive, getRelays, getKey, resolveApiKeyFromIngestStreamKey, getCropConfig } from '../db.js';
import logger from 'lcyt/logger';

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
 * @param {import('../crop-manager.js').CropManager} [cropManager]  Vertical-crop renderer lifecycle
 * @param {import('lcyt-music/src/music-manager.js').MusicManager} [musicManager]  Music detection manager
 * @param {{ get: (key: string) => * }} [settings]  lcyt-backend's SettingsService (plan_env_to_ui_settings.md)
 * @returns {Router}
 */
export function createRtmpRouter(db, relayManager, cropManager = null, musicManager = null, settings = null) {
  const router = Router();

  // Parse application/x-www-form-urlencoded bodies (nginx-rtmp format)
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  router.post('/', async (req, res) => {
    const { app: appName, name, call } = req.body || {};

    // Validate application name when RTMP_APPLICATION is configured.
    // Read env at request time so it can be changed in tests or via hot config.
    const expectedApp = process.env.RTMP_APPLICATION || null;
    if (expectedApp && appName !== expectedApp) {
      logger.warn(`[rtmp] Rejected request: app '${appName}' !== expected '${expectedApp}'`);
      return res.status(403).send('wrong application');
    }

    if (!name) {
      return res.status(400).send('missing name');
    }

    // Resolve the stream name to the project's api_key — this is a no-op
    // (returns `name` unchanged) unless the project has rotated its ingest
    // stream key via POST /ingestion/config/rotate.
    const apiKey = resolveApiKeyFromIngestStreamKey(db, name);

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
            logger.error(`[rtmp] Failed to start relay fan-out for ${apiKey.slice(0, 8)}…: ${err.message}`);
          }
        }
      } else {
        logger.info(`[rtmp] Relay not active for ${apiKey.slice(0, 8)}…; accepting stream but not fanning out`);
      }

      // Vertical-crop renderer: start when the project has crop enabled
      // (best-effort, parallel to the relay fan-out above).
      if (cropManager) {
        try {
          const cropConfig = getCropConfig(db, apiKey);
          if (cropConfig.enabled && !cropManager.isRunning(apiKey)) {
            cropManager.start(apiKey, cropConfig).catch(err => {
              logger.error(`[rtmp] Crop renderer start failed for ${apiKey.slice(0, 8)}…: ${err.message}`);
            });
          }
        } catch (err) {
          logger.error(`[rtmp] Crop config lookup failed for ${apiKey.slice(0, 8)}…: ${err.message}`);
        }
      }

      // Music detection: auto-start if enabled (best-effort, parallel to others).
      if (musicManager && (settings ? settings.get('music.detection_active') : process.env.MUSIC_DETECTION_ACTIVE === '1')) {
        try {
          // Defer getMusicConfig import to avoid hard dependency on lcyt-music
          // (the music plugin may not be installed in minimal deployments)
          const { getMusicConfig } = await import('lcyt-music');
          const musicConfig = getMusicConfig(db, apiKey);
          if (musicConfig.enabled && musicConfig.autoStart && !musicManager.isRunning(apiKey)) {
            // Check ffmpeg availability before attempting to start
            if (!musicManager.ffmpegVersion) {
              logger.error(`[rtmp] Music detection auto-start skipped for ${apiKey.slice(0, 8)}…: ffmpeg not available`);
            } else {
              musicManager.start(apiKey, { streamKey: apiKey }).catch(err => {
                logger.error(`[rtmp] Music detection start failed for ${apiKey.slice(0, 8)}…: ${err.message}`);
              });
            }
          }
        } catch (err) {
          logger.error(`[rtmp] Music config lookup or start failed for ${apiKey.slice(0, 8)}…: ${err.message}`);
        }
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
        logger.error(`[rtmp] Failed to stop relay for ${apiKey.slice(0, 8)}…: ${err.message}`);
      }
      if (cropManager?.isRunning(apiKey)) {
        cropManager.stop(apiKey).catch(err => {
          logger.error(`[rtmp] Crop renderer stop failed for ${apiKey.slice(0, 8)}…: ${err.message}`);
        });
      }
      // Music detection: stop when stream ends (best-effort).
      if (musicManager?.isRunning(apiKey)) {
        musicManager.stop(apiKey).catch(err => {
          logger.error(`[rtmp] Music detection stop failed for ${apiKey.slice(0, 8)}…: ${err.message}`);
        });
      }
      return res.status(200).send('ok');
    }

    return res.status(400).send('unknown call type');
  });

  return router;
}