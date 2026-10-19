/**
 * lcyt-rtmp plugin entry point.
 *
 * Provides RTMP relay, HLS streaming, audio-only radio, stream preview,
 * and CEA-708 caption injection. HLS and radio are served by MediaMTX;
 * the backend proxies HLS requests and proxies thumbnail previews from the
 * MediaMTX API. ffmpeg is only used for CEA-708 caption injection and DSK
 * overlay composition in the relay manager.
 *
 * Usage in lcyt-backend:
 *
 *   import { initRtmpControl, createRtmpRouters } from 'lcyt-rtmp';
 *
 *   // Always initialize (creates manager instances).
 *   const rtmp = await initRtmpControl(db);
 *
 *   // Wire hlsSubsManager into the viewer route for subtitle sidecar support.
 *   setHlsSubsManager(rtmp.hlsSubsManager);
 *   rtmp.hlsSubsManager.sweepStaleDir().catch(() => {});
 *
 *   // Mount routes only when RTMP relay is active.
 *   if (process.env.RTMP_RELAY_ACTIVE === '1') {
 *     const routers = createRtmpRouters(db, auth, rtmp, { allowedRtmpDomains });
 *     app.use('/rtmp',       routers.rtmpRouter);
 *     app.use('/feed-rtmp',  routers.feedRtmpRouter);
 *     app.use('/ingestion',  routers.ingestionRouter);
 *     app.use('/feeds',      routers.feedsRouter);
 *     app.use('/stream',     routers.streamRouter);
 *     app.use('/stream-hls', routers.streamHlsRouter);
 *     app.use('/radio',      routers.radioRouter);
 *     app.use('/preview',    routers.previewRouter);
 *   }
 *
 *   // Pass relayManager + hlsSubsManager to other routes that need them.
 *   app.use('/video',    createVideoRouter(db, rtmp.hlsManager, rtmp.hlsSubsManager));
 *   app.use('/captions', createCaptionsRouter(store, auth, db, rtmp.relayManager, dskProcessor));
 *
 *   // In graceful shutdown:
 *   await rtmp.stop();
 */

import { createMediaMtxHookRouter } from './routes/mediamtx-hook.js';
import { writeRtmpStreamStart, writeRtmpStreamEnd, incrementRtmpAnonDailyStat } from './db.js';
import { RtmpRelayManager, probeFfmpeg } from './rtmp-manager.js';
import logger from 'lcyt/logger';
import { HlsManager } from './hls-manager.js';
import { RadioManager } from './radio-manager.js';
import { PreviewManager } from './preview-manager.js';
import { HlsSubsManager } from './hls-subs-manager.js';
import { SttManager } from './stt-manager.js';
import { CropManager } from './crop-manager.js';
import { createRtmpRouter } from './routes/rtmp.js';
import { createFeedRtmpRouter } from './routes/feed-rtmp.js';
import { createCropRouter } from './routes/crop.js';
import { createIngestionRouter } from './routes/ingestion.js';
import { createFeedsRouter } from './routes/feeds.js';
import { createStreamRouter } from './routes/stream.js';
import { createStreamHlsRouter } from './routes/stream-hls.js';
import { createRadioRouter } from './routes/radio.js';
import { createPreviewRouter } from './routes/preview.js';
import { NginxManager } from './nginx-manager.js';
import { withOwnership, RELAY_OWNERSHIP, CROP_OWNERSHIP, STT_OWNERSHIP } from './ownership.js';
import { MediaMtxClient } from './mediamtx-client.js';
export { MediaMtxClient, MediaMtxApiError } from './mediamtx-client.js';
export { programPathName, dskPathName } from './rtmp-manager.js';
export { withOwnership, readThrough, ownedElsewhere, RELAY_OWNERSHIP, CROP_OWNERSHIP, STT_OWNERSHIP } from './ownership.js';
export { NginxManager } from './nginx-manager.js';
export {
  backfillFeeds, backfillPrimaryFeeds, listFeeds, getFeed, getFeedByKey, listFeedsForDevice, unlinkDeviceFeeds,
  getPrimaryFeedKey, getPrimaryFeedId, ensurePrimaryFeed, setPrimaryFeed,
} from './db/feeds.js';
export {
  backfillOutputs, ensureProjectOutputs, listOutputs, getOutput, createOutput, updateOutput, deleteOutput,
  MAX_OUTPUT_CHAIN_DEPTH, OUTPUT_SOURCE_TYPES,
} from './db/outputs.js';
export { getSttConfig, setSttConfig, getSttSourceLanguages, addSttSourceLanguage, updateSttSourceLanguage, deleteSttSourceLanguage } from './db.js';
export { getRadioConfig, setRadioConfig } from './db.js';
// crop.* tools (packages/lcyt-tools, plan_vertical_crop.md §4) — read-side
// helpers only; mutation goes through CropManager.applyPosition() itself.
export { getCropConfig, getCropPreset, listCropPresets } from './db.js';
export { targetCenter, xNormForCenter, createFollowSmoother } from './crop-follow.js';

/**
 * Initialize the RTMP relay plugin.
 *
 * Creates all manager instances. Safe to call regardless of
 * RTMP_RELAY_ACTIVE — managers are lightweight. The tables come from the
 * backend's Prisma schema, the plugin runs no migrations.
 *
 * @param {object} db  Prisma client
 * @param {import('../../lcyt-backend/src/store.js').SessionStore} [store]
 *   Optional session store — injected into SttManager for transcript delivery.
 *   Pass after the store is created in server.js.
 * @param {{ metrics?: { count: Function, gauge: Function, max: Function }, resolveStorage?: Function }} [opts]
 *   Optional backend metrics handle (plan_metering_audit §4.1) — bumps
 *   rtmp.streams / rtmp.stream_seconds usage counters on stream end.
 *   Optional resolveStorage function (from lcyt-files) for HLS segment/playlist publishing.
 * @returns {Promise<{
 *   relayManager: RtmpRelayManager,
 *   hlsManager: HlsManager,
 *   radioManager: RadioManager,
 *   previewManager: PreviewManager,
 *   hlsSubsManager: HlsSubsManager,
 *   sttManager: SttManager,
 *   stop: () => Promise<void>
 * }>}
 */
export async function initRtmpControl(db, store = null, { metrics = null, resolveStorage = null, settings = null, hlsSubsStore = null, ownership = null } = {}) {
  const ffmpegCaps = (settings ? settings.get('media.rtmp_relay_active') : process.env.RTMP_RELAY_ACTIVE === '1')
    ? probeFfmpeg()
    : { available: false, hasLibx264: false, hasEia608: false, hasSubrip: false };

  // Stat tracking: map from `${apiKey}:${slot}` → promise of the rtmp_stream_stats row id
  const _rtmpStatIds = new Map();

  // Build MediaMTX client when API URL is configured. MediaMtxClient's
  // constructor already accepts explicit { baseUrl, user, password, webrtcBaseUrl }
  // opts, falling back to process.env only when a given opt is omitted — so
  // settings-resolved values are passed through here rather than widening
  // that class further.
  // Created before relayManager so the same instance can be shared across all managers.
  const mediamtxApiUrl = settings ? settings.get('mediamtx.api_url') : process.env.MEDIAMTX_API_URL;
  const mediamtxClient = mediamtxApiUrl
    ? new MediaMtxClient(settings ? {
        baseUrl: mediamtxApiUrl,
        user: settings.get('mediamtx.api_user') || null,
        password: settings.get('mediamtx.api_password') || null,
      } : undefined)
    : null;

  const relayManager = new RtmpRelayManager({
    ffmpegCaps,
    mediamtxClient,
    settings,
    async onStreamStarted(apiKey, slot, { targetUrl, targetName, captionMode, startedAt }) {
      try {
        // Keep the promise so an end that races with the insert still finds the row id.
        const idPromise = writeRtmpStreamStart(db, {
          apiKey,
          slot,
          targetUrl,
          targetName,
          captionMode,
          startedAt: startedAt.toISOString(),
        });
        _rtmpStatIds.set(`${apiKey}:${slot}`, idPromise);
        await idPromise;
      } catch (err) {
        _rtmpStatIds.delete(`${apiKey}:${slot}`);
        logger.error(`[rtmp] Failed to write stream start stat: ${err.message}`);
      }
    },
    async onStreamEnded(apiKey, slot, { targetUrl, captionMode, startedAt, endedAt, durationMs, captionsSent = 0 }) {
      try {
        const statKey = `${apiKey}:${slot}`;
        const statId  = await _rtmpStatIds.get(statKey);
        _rtmpStatIds.delete(statKey);
        if (statId) {
          await writeRtmpStreamEnd(db, {
            streamStatId: statId,
            endedAt: endedAt.toISOString(),
            durationMs,
            captionsSent: captionsSent || 0,
          });
        }
        await incrementRtmpAnonDailyStat(db, { targetUrl, captionMode, durationMs });
        metrics?.count('rtmp.streams', 1, { project: apiKey });
        if (durationMs > 0) metrics?.count('rtmp.stream_seconds', durationMs / 1000, { project: apiKey });
      } catch (err) {
        logger.error(`[rtmp] Failed to write stream end stat: ${err.message}`);
      }
    },
  });

  // NginxManager handles writing nginx proxy locations for MediaMTX radio streams.
  // When NGINX_RADIO_CONFIG_PATH is not set, NginxManager operates in no-op mode
  // (slugs are computed but nginx config is not written). configPath/testCmd/
  // reloadCmd stay env-only (Tier A — executed/path); mediamtxHlsBase/prefix
  // are Tier B, so passed through explicitly when settings is available —
  // NginxManager already supports these as constructor overrides.
  const nginxManager = new NginxManager(settings ? {
    mediamtxHlsBase: settings.get('mediamtx.hls_base_url'),
    prefix: settings.get('media.nginx_radio_prefix'),
  } : undefined);

  const radioManager   = new RadioManager({ mediamtxClient, nginxManager, settings });
  const hlsManager     = new HlsManager({ mediamtxClient, settings });
  // hlsSubsStore (shared object store) lets several backend instances serve the
  // same subtitle track; without it segments stay on local disk.
  const hlsSubsManager = new HlsSubsManager(settings ? {
    segmentDuration: settings.get('media.hls_subs_segment_duration'),
    windowSize: settings.get('media.hls_subs_window_size'),
    store: hlsSubsStore,
  } : { store: hlsSubsStore });
  const previewManager = new PreviewManager({ mediamtxClient, webrtcBase: settings ? settings.get('mediamtx.webrtc_base_url') : undefined });
  const sttManager     = new SttManager(store, db, settings);
  const cropManager    = new CropManager({ ffmpegCaps, mediamtxClient, settings });

  if (nginxManager.isEnabled) {
    logger.info(`[lcyt-rtmp] NginxManager active → ${process.env.NGINX_RADIO_CONFIG_PATH}`);
  }
  if (mediamtxClient) {
    logger.info(`[lcyt-rtmp] MediaMTX API: ${mediamtxApiUrl}`);
  }

  async function stop() {
    await Promise.allSettled([
      relayManager.stopAll(),
      hlsManager.stopAll(),
      radioManager.stopAll(),
      previewManager.stopAll(),
      sttManager.stopAll(),
      cropManager.stopAll(),
    ]);
  }

  if (!ownership) {
    return { relayManager, hlsManager, radioManager, previewManager, hlsSubsManager, sttManager, cropManager, owned: null, stop };
  }

  // Several backend instances on one database: relay, crop and STT starts take a lease and every
  // start/stop/control call is routed to the instance that holds it (see ownership.js). The
  // wrappers are what the rest of the backend gets; `owned` lets the internal route run a
  // forwarded call on this instance without forwarding it again.
  const wrap = (target, base, extraRouted = {}) => withOwnership(target, {
    ...base, routed: { ...base.routed, ...extraRouted }, ownership, log: logger,
  });
  const ownedRelay = wrap(relayManager, RELAY_OWNERSHIP);
  const ownedCrop = wrap(cropManager, CROP_OWNERSHIP, {
    applyForSource: {
      keyIndex: 1,
      forwardKeyIndex: 0,
      forwardArgs: (a) => a.slice(1),
      localArgs: (a) => [db, ...a],
    },
  });
  const ownedStt = wrap(sttManager, STT_OWNERSHIP);
  logger.info('[lcyt-rtmp] process ownership active: relay, crop and STT calls follow the lease holder');
  return {
    relayManager: ownedRelay, hlsManager, radioManager, previewManager, hlsSubsManager,
    sttManager: ownedStt, cropManager: ownedCrop,
    owned: { relay: ownedRelay, crop: ownedCrop, stt: ownedStt },
    stop,
  };
}

/**
 * Create the RTMP relay Express routers.
 *
 * Mount the returned routers only when RTMP relay is active.
 *
 * @param {object} db  Prisma client
 * @param {import('express').RequestHandler} auth  Project-access Bearer middleware — applied to the config-only sub-routers (ingestion/stream/radio-config/crop); the public/callback sub-routers (rtmp, feed-rtmp, stream-hls, preview) never consume it
 * @param {{ relayManager: RtmpRelayManager, hlsManager: HlsManager, radioManager: RadioManager, previewManager: PreviewManager }} managers
 * @param {{ allowedRtmpDomains?: string, metrics?: object, settings?: object, requireSetup?: import('express').RequestHandler }} [opts]  requireSetup gates config-only writes at the Setup tier (plan_project_roles.md); defaults to a no-op passthrough
 * @returns {{
 *   rtmpRouter: import('express').Router,
 *   feedRtmpRouter: import('express').Router,
 *   ingestionRouter: import('express').Router,
 *   feedsRouter: import('express').Router,
 *   streamRouter: import('express').Router,
 *   streamHlsRouter: import('express').Router,
 *   radioRouter: import('express').Router,
 *   previewRouter: import('express').Router
 * }}
 */
export function createRtmpRouters(db, auth, { relayManager, hlsManager, radioManager, previewManager, sttManager, cropManager, musicManager }, { allowedRtmpDomains, metrics = null, settings = null, requireSetup = (req, res, next) => next() } = {}) {
  return {
    rtmpRouter:      createRtmpRouter(db, relayManager, cropManager, musicManager, settings),
    feedRtmpRouter:  createFeedRtmpRouter(db, relayManager),
    mediamtxHookRouter: createMediaMtxHookRouter({ relayManager, settings }),
    ingestionRouter: createIngestionRouter(db, auth, relayManager, settings, requireSetup),
    feedsRouter:     createFeedsRouter(db, auth, relayManager, settings, requireSetup),
    streamRouter:    createStreamRouter(db, auth, relayManager, allowedRtmpDomains, requireSetup),
    streamHlsRouter: createStreamHlsRouter(db, hlsManager, metrics),
    radioRouter:     createRadioRouter(db, radioManager, sttManager, auth, metrics, requireSetup),
    previewRouter:   createPreviewRouter(previewManager),
    cropRouter:      createCropRouter(db, auth, cropManager, relayManager, requireSetup),
  };
}