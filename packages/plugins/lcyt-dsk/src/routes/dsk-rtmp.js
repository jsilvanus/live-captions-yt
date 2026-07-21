/**
 * DSK RTMP ingest callbacks — `/dsk-rtmp`
 *
 * Handles nginx-rtmp on_publish / on_publish_done callbacks for the `dsk` nginx-rtmp
 * application.  When a broadcaster (e.g. OBS) publishes to
 * `rtmp://<server>/dsk/<apiKey>`, the relay process for that API key is restarted
 * with the DSK stream composited on top of the main RTMP signal using ffmpeg's
 * `overlay` filter.
 *
 * The stream name (nginx `$name`) is the API key that identifies the relay session.
 *
 * Nginx-rtmp configuration example:
 *
 *   application dsk {
 *     live on;
 *     on_publish      http://localhost:3000/dsk-rtmp/on_publish;
 *     on_publish_done http://localhost:3000/dsk-rtmp/on_publish_done;
 *     # or: on_publish http://localhost:3000/dsk-rtmp   (with call= in POST body)
 *   }
 *
 * Routes:
 *   POST /dsk-rtmp               — single-URL style (call=publish|publish_done in body)
 *   POST /dsk-rtmp/on_publish     — separate-URL style
 *   POST /dsk-rtmp/on_publish_done — separate-URL style
 */

import express, { Router } from 'express';
import logger from 'lcyt/logger';
import { isViewportStream } from '../stream-names.js';
import { getCompositeChromaKey } from '../db/viewports.js';

// The local nginx-rtmp base URL and DSK application name.
// These must match the nginx-rtmp config on the server.
const DEFAULT_LOCAL_RTMP = process.env.DSK_LOCAL_RTMP || process.env.RADIO_LOCAL_RTMP || 'rtmp://127.0.0.1:1935';
const DEFAULT_DSK_APP    = process.env.DSK_RTMP_APP   || 'dsk';

// API key validation: same rules as the main relay keys
const API_KEY_RE = /^[a-zA-Z0-9_-]{3,}$/;

/**
 * Resolve the local RTMP base, preserving the legacy DSK_LOCAL_RTMP →
 * RADIO_LOCAL_RTMP → literal-default fallback chain: graphics.dsk_local_rtmp
 * only "wins" over media.radio_local_rtmp when it was actually set (env or
 * DB), not just resolved to its own registry default.
 * @param {{ get: (key: string) => *, source: (key: string) => string }} [settings]
 */
function resolveDskLocalRtmp(settings) {
  if (!settings) return DEFAULT_LOCAL_RTMP;
  if (settings.source('graphics.dsk_local_rtmp') !== 'default') return settings.get('graphics.dsk_local_rtmp');
  return settings.get('media.radio_local_rtmp');
}

/**
 * Build the local RTMP URL for a DSK stream.
 * @param {string} apiKey
 * @param {{ get: (key: string) => *, source: (key: string) => string }} [settings]
 * @returns {string}
 */
function dskSourceUrl(apiKey, settings = null) {
  const localRtmp = resolveDskLocalRtmp(settings);
  const dskApp = settings ? settings.get('graphics.dsk_rtmp_app') : DEFAULT_DSK_APP;
  return `${localRtmp}/${dskApp}/${apiKey}`;
}

/**
 * Resolve an incoming nginx-rtmp stream `name` to the api_key it belongs to.
 * Mirrors `resolveApiKeyFromIngestStreamKey()` in lcyt-rtmp's db/relay.js —
 * duplicated here (rather than imported) since lcyt-dsk has no dependency on
 * lcyt-rtmp; both plugins query the shared `api_keys` table directly instead.
 * @param {import('better-sqlite3').Database} db
 * @param {string} name
 * @returns {string}
 */
function resolveApiKeyFromIngestStreamKey(db, name) {
  const row = db.prepare('SELECT key FROM api_keys WHERE ingest_stream_key = ?').get(name);
  return row ? row.key : name;
}

/**
 * Create the Express router for DSK RTMP ingest callbacks.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @param {{ get: (key: string) => *, source: (key: string) => string }} [settings] -
 *   lcyt-backend's SettingsService (plan_env_to_ui_settings.md), duck-typed.
 * @returns {Router}
 */
export function createDskRtmpRouter(db, relayManager, settings = null) {
  const router = Router();

  // nginx-rtmp callbacks are application/x-www-form-urlencoded
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  /**
   * Shared handler for nginx-rtmp publish/publish_done events.
   * @param {'publish'|'publish_done'} call
   * @param {string} name  Stream name = API key (or a rotated ingest stream key)
   * @param {import('express').Response} res
   */
  async function handleNginxCallback(call, name, res) {
    if (!name || !API_KEY_RE.test(name)) {
      return res.status(400).send('invalid stream name');
    }

    // Per-viewport renderer streams (`<key>__<viewport>`) are standalone —
    // they publish to the dsk app but must NOT restart the program relay with
    // a DSK composite (that is only for a bare-key program push). Ack and skip.
    if (isViewportStream(name)) {
      logger.info(`[dsk-rtmp] ${call}: viewport stream ${name} — no program composite`);
      return res.status(200).send('ok');
    }

    const apiKey = resolveApiKeyFromIngestStreamKey(db, name);
    const rtmpUrl = dskSourceUrl(apiKey, settings);

    if (call === 'publish') {
      // Phase 5: key the program composite with the composite viewport's chromaKey (if any).
      let chromaKey = null;
      try { chromaKey = getCompositeChromaKey(db, apiKey); } catch { /* pre-migration schema */ }
      logger.info(`[dsk-rtmp] on_publish: key=${apiKey.slice(0, 8)}… → ${rtmpUrl}${chromaKey ? ' (keyed)' : ''}`);
      try {
        await relayManager.setDskRtmpSource(apiKey, rtmpUrl, { chromaKey });
      } catch (err) {
        logger.error(`[dsk-rtmp] Failed to set DSK RTMP source for ${apiKey.slice(0, 8)}…: ${err.message}`);
        // Return 200 so nginx allows the ingest; DSK is best-effort
      }
      return res.status(200).send('ok');
    }

    if (call === 'publish_done') {
      logger.info(`[dsk-rtmp] on_publish_done: key=${apiKey.slice(0, 8)}…`);
      try {
        await relayManager.setDskRtmpSource(apiKey, null);
      } catch (err) {
        logger.error(`[dsk-rtmp] Failed to clear DSK RTMP source for ${apiKey.slice(0, 8)}…: ${err.message}`);
      }
      return res.status(200).send('ok');
    }

    return res.status(400).send('unknown call type');
  }

  // POST /dsk-rtmp — single-URL style (call=publish or call=publish_done in body)
  router.post('/', async (req, res) => {
    const { name, call } = req.body || {};
    return handleNginxCallback(call, name, res);
  });

  // POST /dsk-rtmp/on_publish — separate-URL style (nginx on_publish)
  router.post('/on_publish', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish', name, res);
  });

  // POST /dsk-rtmp/on_publish_done — separate-URL style (nginx on_publish_done)
  router.post('/on_publish_done', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish_done', name, res);
  });

  return router;
}