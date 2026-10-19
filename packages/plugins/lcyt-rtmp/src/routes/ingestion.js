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
 *   GET   /ingestion/streams
 *     Response: { available, streams: [{ path, kind: 'video'|'dsk'|'feed', label, video, audio, codecs,
 *                 readers, readyTime, bytesReceived }] }
 *     The project's incoming streams that MediaMTX reports as ready (publisher connected). `available: false`
 *     (never an error) when no MediaMTX API is configured or it cannot be reached.
 *
 *   GET   /ingestion/streams/unclaimed
 *     Response: { available, streams: [{ path, key, kind: 'video'|'dsk', video, audio, codecs, readers,
 *                 readyTime, bytesReceived, attachable }] }
 *     "Discover": ready MediaMTX paths that no project owns yet. Needs Setup-tier project access (read
 *     requests too), since it shows stream names that belong to nobody. `attachable` paths can be bound to
 *     the project as a named feed (`POST /feeds` with transport 'rtmp').
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
import logger from 'lcyt/logger';
import { getKey } from '../db.js';
import { listIngestStreams, listUnclaimedStreams } from '../ingest-streams.js';

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

async function hasIngestFeature(db, apiKey) {
  const row = await db.project_features.findUnique({
    where: { api_key_feature_code: { api_key: apiKey, feature_code: 'ingest' } },
    select: { enabled: true },
  });
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
 * @param {object} db  Prisma client
 * @param {import('express').RequestHandler} auth  Project-access Bearer middleware
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @param {{ get: (key: string) => * }} [settings]  lcyt-backend's SettingsService (plan_env_to_ui_settings.md)
 * @param {import('express').RequestHandler} [requireSetup]  Setup-tier write gate (plan_project_roles.md); no-op passthrough when omitted (e.g. tests constructing this router directly)
 * @returns {import('express').Router}
 */
export function createIngestionRouter(db, auth, relayManager, settings = null, requireSetup = (req, res, next) => next()) {
  const router = Router();
  router.use(auth);
  router.use(requireSetup);

  async function buildConfig(apiKey) {
    const keyRow = await getKey(db, apiKey) || {};
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

  router.get('/config', async (req, res) => {
    res.json(await buildConfig(req.session.apiKey));
  });

  router.get('/streams', async (req, res) => {
    const mediamtx = relayManager.mediamtx;
    if (!mediamtx) return res.json({ available: false, streams: [] });
    const apiKey = req.session.apiKey;
    try {
      const keyRow = await getKey(db, apiKey) || {};
      const keys = [{ key: keyRow.ingest_stream_key || apiKey, kind: 'video' }];
      if (keyRow.ingest_stream_key) keys.push({ key: apiKey, kind: 'video' });
      const feeds = await db.prod_feeds.findMany({
        where: { owner_api_key: apiKey, transport: 'rtmp' },
        select: { feed_key: true, name: true, label: true },
      });
      for (const f of feeds) keys.push({ key: f.feed_key, kind: 'feed', label: f.label || f.name });
      return res.json({ available: true, streams: await listIngestStreams(mediamtx, keys) });
    } catch (err) {
      logger.warn(`[ingestion] stream list failed: ${err.message}`);
      return res.json({ available: false, streams: [] });
    }
  });

  // requireSetup only checks writes; run it as a write to hold reads to the same tier.
  const requireSetupForRead = (req, res, next) => {
    const method = req.method;
    req.method = 'POST';
    requireSetup(req, res, (err) => { req.method = method; next(err); });
  };

  router.get('/streams/unclaimed', requireSetupForRead, async (req, res) => {
    const mediamtx = relayManager.mediamtx;
    if (!mediamtx) return res.json({ available: false, streams: [] });
    try {
      const known = new Set();
      for (const k of await db.api_keys.findMany({ select: { key: true, ingest_stream_key: true } })) {
        known.add(k.key);
        if (k.ingest_stream_key) known.add(k.ingest_stream_key);
      }
      for (const f of await db.prod_feeds.findMany({ select: { feed_key: true } })) known.add(f.feed_key);
      return res.json({ available: true, streams: await listUnclaimedStreams(mediamtx, known) });
    } catch (err) {
      logger.warn(`[ingestion] unclaimed stream list failed: ${err.message}`);
      return res.json({ available: false, streams: [] });
    }
  });

  router.patch('/config', async (req, res) => {
    const apiKey = req.session.apiKey;
    const { video, dsk } = req.body || {};

    // Apply video.enabled first — a combined { video, dsk } request should
    // still apply the (implemented) video change even though dsk.enabled
    // has no real gate to flip yet and always 501s below.
    if (video?.enabled !== undefined) {
      if (typeof video.enabled !== 'boolean') {
        return res.status(400).json({ error: 'video.enabled must be a boolean' });
      }
      if (isFeatureGateEnforced() && !(await hasIngestFeature(db, apiKey))) {
        return res.status(403).json({ error: "Feature 'ingest' is not enabled for this project", feature: 'ingest' });
      }
      await db.api_keys.updateMany({ where: { key: apiKey }, data: { relay_allowed: video.enabled ? 1 : 0 } });
    }

    if (dsk?.enabled !== undefined) {
      return res.status(501).json({ error: 'DSK ingest enable/disable is not implemented yet' });
    }

    res.json(await buildConfig(apiKey));
  });

  router.post('/config/rotate', async (req, res) => {
    const apiKey = req.session.apiKey;
    const streamKey = randomUUID();
    await db.api_keys.updateMany({ where: { key: apiKey }, data: { ingest_stream_key: streamKey } });
    const videoApp = settings ? (settings.get('media.rtmp_application') || settings.get('media.rtmp_app')) : (process.env.RTMP_APPLICATION || process.env.RTMP_APP || 'stream');
    res.json({ streamKey, ingestUrl: buildIngestUrl(videoApp, streamKey, settings) });
  });

  return router;
}
