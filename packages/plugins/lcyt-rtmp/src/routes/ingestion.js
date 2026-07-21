/**
 * /ingestion/config routes — self-service RTMP ingestion status, enable/disable,
 * and stream-key rotation (plan/selfservice_config_backend §2/§2a).
 *
 * Session Bearer auth. Two ingest "slots" per project, mirroring the Setup
 * Hub's Ingestion card (`IngestionCard.dc.html`): the primary video RTMP app
 * and the DSK overlay-source RTMP app.
 *
 *   GET   /ingestion/config
 *     Response: {
 *       video: { enabled, active, streamKey, ingestUrl, rotatable: true, live },
 *       dsk:   { enabled, ingestUrl, live: boolean|null }
 *     }
 *
 *   PATCH /ingestion/config
 *     Body: { video?: { enabled? }, dsk?: { enabled? } }
 *     Response: same shape as GET
 *     `video.enabled` flips relay_allowed — this is the piece moving from
 *     admin-only to self-service, gated behind the `ingest` feature code when
 *     FEATURE_GATE_ENFORCE=1. `dsk.enabled` has no real gate to flip yet (see
 *     the plan's §2a note) and returns 501 until one is designed.
 *
 *   POST  /ingestion/config/rotate
 *     Effect: generates a new random video ingest_stream_key, replacing any
 *             previous value. Any encoder still configured with the old value
 *             gets rejected on its next publish attempt once the lookup no
 *             longer resolves it.
 *     Response: { streamKey, ingestUrl }
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getKey } from '../db.js';

/**
 * Returns true when feature-gate enforcement is active (mirrors
 * lcyt-backend's middleware/feature-gate.js; duplicated here rather than
 * imported since plugins query core tables directly instead of depending on
 * lcyt-backend modules — see e.g. isRelayAllowed()).
 * @returns {boolean}
 */
function isFeatureGateEnforced() {
  const v = process.env.FEATURE_GATE_ENFORCE;
  return v === '1' || v === 'true';
}

function hasIngestFeature(db, apiKey) {
  const row = db.prepare(
    "SELECT enabled FROM project_features WHERE api_key = ? AND feature_code = 'ingest'"
  ).get(apiKey);
  return row?.enabled === 1;
}

/**
 * Compose a public rtmp:// ingest URL from configured/default host+app.
 * No new env vars — reuses RTMP_HOST/RTMP_APPLICATION/RTMP_APP the same way
 * GET /health's `rtmpIngest` object already does.
 */
function buildIngestUrl(app, streamName, settings = null) {
  const host = settings ? settings.get('media.rtmp_host') : (process.env.RTMP_HOST || 'rtmp.lcyt.fi');
  return `rtmp://${host}/${app}/${streamName}`;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth  Session JWT Bearer middleware
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @param {{ get: (key: string) => * }} [settings]  lcyt-backend's SettingsService (plan_env_to_ui_settings.md)
 * @returns {import('express').Router}
 */
export function createIngestionRouter(db, auth, relayManager, settings = null) {
  const router = Router();
  router.use(auth);

  function buildConfig(apiKey) {
    const keyRow = getKey(db, apiKey) || {};
    const videoApp = settings ? (settings.get('media.rtmp_application') || settings.get('media.rtmp_app')) : (process.env.RTMP_APPLICATION || process.env.RTMP_APP || 'stream');
    const dskApp = settings ? settings.get('graphics.dsk_rtmp_app') : (process.env.DSK_RTMP_APP || 'dsk');
    const videoStreamKey = keyRow.ingest_stream_key || apiKey;

    return {
      video: {
        enabled:    keyRow.relay_allowed === 1,
        active:     keyRow.relay_active === 1,
        streamKey:  videoStreamKey,
        ingestUrl:  buildIngestUrl(videoApp, videoStreamKey, settings),
        rotatable:  true,
        live:       relayManager.isPublishing(apiKey),
      },
      dsk: {
        // No independent self-service gate exists for the DSK ingest app yet —
        // graphics_enabled is a broader feature entitlement, not an ingest-specific
        // one, surfaced here read-only until that's untangled (see plan §2a).
        enabled:    keyRow.graphics_enabled === 1,
        ingestUrl:  buildIngestUrl(dskApp, apiKey, settings),
        // No publish-tracking exists in lcyt-dsk yet — null means "unknown",
        // not "offline" (the frontend renders it as a dim/neutral status dot).
        live:       null,
      },
    };
  }

  router.get('/config', (req, res) => {
    res.json(buildConfig(req.session.apiKey));
  });

  router.patch('/config', (req, res) => {
    const apiKey = req.session.apiKey;
    const { video, dsk } = req.body || {};

    // Apply video.enabled first — a combined { video, dsk } request should
    // still apply the (implemented) video change even though dsk.enabled
    // has no real gate to flip yet and always 501s below.
    if (video?.enabled !== undefined) {
      if (typeof video.enabled !== 'boolean') {
        return res.status(400).json({ error: 'video.enabled must be a boolean' });
      }
      if (isFeatureGateEnforced() && !hasIngestFeature(db, apiKey)) {
        return res.status(403).json({ error: "Feature 'ingest' is not enabled for this project", feature: 'ingest' });
      }
      db.prepare('UPDATE api_keys SET relay_allowed = ? WHERE key = ?').run(video.enabled ? 1 : 0, apiKey);
    }

    if (dsk?.enabled !== undefined) {
      return res.status(501).json({ error: 'DSK ingest enable/disable is not implemented yet' });
    }

    res.json(buildConfig(apiKey));
  });

  router.post('/config/rotate', (req, res) => {
    const apiKey = req.session.apiKey;
    const streamKey = randomUUID();
    db.prepare('UPDATE api_keys SET ingest_stream_key = ? WHERE key = ?').run(streamKey, apiKey);
    const videoApp = settings ? (settings.get('media.rtmp_application') || settings.get('media.rtmp_app')) : (process.env.RTMP_APPLICATION || process.env.RTMP_APP || 'stream');
    res.json({ streamKey, ingestUrl: buildIngestUrl(videoApp, streamKey, settings) });
  });

  return router;
}
