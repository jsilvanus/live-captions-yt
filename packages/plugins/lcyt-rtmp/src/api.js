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
 *   // Always initialize (runs DB migrations, creates manager instances).
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

import { runMigrations, writeRtmpStreamStart, writeRtmpStreamEnd, incrementRtmpAnonDailyStat } from './db.js';
import { RtmpRelayManager, probeFfmpeg } from './rtmp-manager.js';
import logger from 'lcyt/logger';
import { HlsManager } from './hls-manager.js';
import { RadioManager } from './radio-manager.js';
import { PreviewManager } from './preview-manager.js';
import { HlsSubsManager } from './hls-subs-manager.js';
import { SttManager } from './stt-manager.js';
import { createRtmpRouter } from './routes/rtmp.js';
import { createStreamRouter } from './routes/stream.js';
import { createStreamHlsRouter } from './routes/stream-hls.js';
import { createRadioRouter } from './routes/radio.js';
import { createPreviewRouter } from './routes/preview.js';
import { NginxManager } from './nginx-manager.js';
import { MediaMtxClient } from './mediamtx-client.js';
export { MediaMtxClient, MediaMtxApiError } from './mediamtx-client.js';
export { NginxManager } from './nginx-manager.js';
export { getSttConfig, setSttConfig } from './db.js';

/**
 * Initialize the RTMP relay plugin.
 *
 * Runs DB migrations and creates all manager instances.
 * Safe to call regardless of RTMP_RELAY_ACTIVE — migrations are
 * always idempotent and managers are lightweight.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../../lcyt-backend/src/store.js').SessionStore} [store]
 *   Optional session store — injected into SttManager for transcript delivery.
 *   Pass after the store is created in server.js.
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
export async function initRtmpControl(db, store = null) {
  runMigrations(db);

  const ffmpegCaps = process.env.RTMP_RELAY_ACTIVE === '1'
    ? probeFfmpeg()
    : { available: false, hasLibx264: false, hasEia608: false, hasSubrip: false };

  // Stat tracking: map from `${apiKey}:${slot}` → rtmp_stream_stats row id
  const _rtmpStatIds = new Map();

  // Build MediaMTX client when API URL is configured.
  // Created before relayManager so the same instance can be shared across all managers.
  const mediamtxClient = process.env.MEDIAMTX_API_URL
    ? new MediaMtxClient()
    : null;

  const relayManager = new RtmpRelayManager({
    ffmpegCaps,
    mediamtxClient,
    onStreamStarted(apiKey, slot, { targetUrl, targetName, captionMode, startedAt }) {
      try {
        const id = writeRtmpStreamStart(db, {
          apiKey,
          slot,
          targetUrl,
          targetName,
          captionMode,
          startedAt: startedAt.toISOString(),
        });
        _rtmpStatIds.set(`${apiKey}:${slot}`, id);
      } catch (err) {
        logger.error(`[rtmp] Failed to write stream start stat: ${err.message}`);
      }
    },
    onStreamEnded(apiKey, slot, { targetUrl, captionMode, startedAt, endedAt, durationMs, captionsSent = 0 }) {
      try {
        const statKey = `${apiKey}:${slot}`;
        const statId  = _rtmpStatIds.get(statKey);
        _rtmpStatIds.delete(statKey);
        if (statId) {
          writeRtmpStreamEnd(db, {
            streamStatId: statId,
            endedAt: endedAt.toISOString(),
            durationMs,
            captionsSent: captionsSent || 0,
          });
        }
        incrementRtmpAnonDailyStat(db, { targetUrl, captionMode, durationMs });
      } catch (err) {
        logger.error(`[rtmp] Failed to write stream end stat: ${err.message}`);
      }
    },
  });

  // NginxManager handles writing nginx proxy locations for MediaMTX radio streams.
  // When NGINX_RADIO_CONFIG_PATH is not set, NginxManager operates in no-op mode
  // (slugs are computed but nginx config is not written).
  const nginxManager = new NginxManager();

  const radioManager   = new RadioManager({ mediamtxClient, nginxManager });
  const hlsManager     = new HlsManager({ mediamtxClient });
  const hlsSubsManager = new HlsSubsManager();
  const previewManager = new PreviewManager({ mediamtxClient });
  const sttManager     = new SttManager(store);

  if (nginxManager.isEnabled) {
    logger.info(`[lcyt-rtmp] NginxManager active → ${process.env.NGINX_RADIO_CONFIG_PATH}`);
  }
  if (mediamtxClient) {
    logger.info(`[lcyt-rtmp] MediaMTX API: ${process.env.MEDIAMTX_API_URL}`);
  }

  async function stop() {
    relayManager.stopAll();
    hlsManager.stopAll();
    radioManager.stopAll();
    previewManager.stopAll();
    await sttManager.stopAll();
  }

  return { relayManager, hlsManager, radioManager, previewManager, hlsSubsManager, sttManager, stop };
}

/**
 * Create the RTMP relay Express routers.
 *
 * Mount the returned routers only when RTMP relay is active.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth  Session JWT Bearer middleware
 * @param {{ relayManager: RtmpRelayManager, hlsManager: HlsManager, radioManager: RadioManager, previewManager: PreviewManager }} managers
 * @param {{ allowedRtmpDomains?: string }} [opts]
 * @returns {{
 *   rtmpRouter: import('express').Router,
 *   streamRouter: import('express').Router,
 *   streamHlsRouter: import('express').Router,
 *   radioRouter: import('express').Router,
 *   previewRouter: import('express').Router
 * }}
 */
export function createRtmpRouters(db, auth, { relayManager, hlsManager, radioManager, previewManager, sttManager }, { allowedRtmpDomains } = {}) {
  return {
    rtmpRouter:      createRtmpRouter(db, relayManager),
    streamRouter:    createStreamRouter(db, auth, relayManager, allowedRtmpDomains),
    streamHlsRouter: createStreamHlsRouter(db, hlsManager),
    radioRouter:     createRadioRouter(db, radioManager, sttManager),
    previewRouter:   createPreviewRouter(previewManager),
  };
}