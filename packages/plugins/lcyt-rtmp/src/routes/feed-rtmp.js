/**
 * Named-feed RTMP ingest callbacks — `/feed-rtmp` (plan_ingest_feeds.md §2a)
 *
 * Handles nginx-rtmp on_publish / on_publish_done callbacks for the `feed`
 * nginx-rtmp application. One static app handles arbitrarily many named
 * feeds via dynamic per-request resolution — no nginx reconfiguration is
 * needed per camera, mirroring the `stream`/`dsk` apps' single-app-many-keys
 * shape (see routes/rtmp.js, lcyt-dsk's routes/dsk-rtmp.js).
 *
 * When a broadcaster (e.g. OBS) publishes to `rtmp://<server>/feed/<cameraKey>`,
 * the stream name is resolved against prod_cameras.camera_key for a row with
 * control_type='rtmp'. A camera's mere existence with that control type is
 * the entire accept/reject gate — there is no separate admin flag to check
 * (mirrors how DSK-ingest reasoning works, just for a different table).
 *
 * prod_cameras is owned by lcyt-production, but the two plugins share one
 * SQLite db instance repo-wide, so this queries it directly rather than
 * taking a hard dependency — the same cross-plugin-query pattern already
 * used by resolveApiKeyFromIngestStreamKey() (db/relay.js) and its DSK-side
 * duplicate, and by db/relay.js's own resolveRelaySourceCameraKey(). Reuses
 * that module's hasProdCamerasTable() guard (code-review follow-up — this
 * file originally queried prod_cameras with no existence guard at all,
 * unlike the egress-side lookup added in the same PR).
 *
 * Nginx-rtmp configuration example:
 *
 *   application feed {
 *     live on;
 *     on_publish      http://localhost:3000/feed-rtmp/on_publish;
 *     on_publish_done http://localhost:3000/feed-rtmp/on_publish_done;
 *     # or: on_publish http://localhost:3000/feed-rtmp   (with call= in POST body)
 *   }
 *
 * Routes:
 *   POST /feed-rtmp               — single-URL style (call=publish|publish_done in body)
 *   POST /feed-rtmp/on_publish     — separate-URL style
 *   POST /feed-rtmp/on_publish_done — separate-URL style
 */

import express, { Router } from 'express';
import logger from 'lcyt/logger';
import { hasProdCamerasTable, getApiKeysReferencingCamera, isRelayActive, getRelays, getKey } from '../db.js';

// camera_key validation: same shape as the main relay keys / DSK app names.
const CAMERA_KEY_RE = /^[a-zA-Z0-9_-]{1,}$/;

/**
 * Resolve an incoming nginx-rtmp stream `name` to the prod_cameras row it
 * belongs to. Only rows with control_type='rtmp' are eligible — a camera's
 * mere existence with that type is the accept/reject gate. Degrades to
 * "unknown" rather than throwing when prod_cameras doesn't exist at all
 * (e.g. a test harness running only lcyt-rtmp's own migrations).
 * @param {import('better-sqlite3').Database} db
 * @param {string} cameraKey
 * @returns {{ id: string, camera_key: string }|null}
 */
function resolveFeedCamera(db, cameraKey) {
  if (!hasProdCamerasTable(db)) return null;
  return db.prepare(
    "SELECT id, camera_key FROM prod_cameras WHERE camera_key = ? AND control_type = 'rtmp'"
  ).get(cameraKey) ?? null;
}

/**
 * Create the Express router for named-feed RTMP ingest callbacks.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @returns {Router}
 */
export function createFeedRtmpRouter(db, relayManager) {
  const router = Router();

  // nginx-rtmp callbacks are application/x-www-form-urlencoded
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  /**
   * Shared handler for nginx-rtmp publish/publish_done events.
   * @param {'publish'|'publish_done'} call
   * @param {string} name  Stream name = a prod_cameras.camera_key
   * @param {import('express').Response} res
   */
  async function handleNginxCallback(call, name, res) {
    if (!name || !CAMERA_KEY_RE.test(name)) {
      return res.status(400).send('invalid stream name');
    }

    const camera = resolveFeedCamera(db, name);
    if (!camera) {
      logger.warn(`[feed-rtmp] Rejected publish: no 'rtmp'-type camera with camera_key '${name}'`);
      return res.status(403).send('unknown feed');
    }

    if (call === 'publish') {
      logger.info(`[feed-rtmp] on_publish: feed '${name}' (camera ${camera.id.slice(0, 8)}…)`);
      // Separate namespace from markPublishing/isPublishing (apiKey-keyed) —
      // camera_key is an operator-chosen string with no uniqueness
      // constraint against api_keys.key, so a colliding value must not be
      // able to spoof another project's own live status (code-review
      // follow-up).
      relayManager.markFeedPublishing(camera.camera_key);

      // A camera-only relay configuration (no program-sourced slot at all)
      // has no other trigger to ever start its MediaMTX fan-out — every
      // other trigger (routes/rtmp.js's on_publish, PUT /stream/active) keys
      // off the PRIMARY apiKey's own publish state, never a referenced
      // camera's (code-review follow-up: this was previously missing
      // entirely, so a pure named-feed egress silently never worked unless
      // the project's own ingest also happened to publish at some point).
      const apiKeys = getApiKeysReferencingCamera(db, camera.id);
      for (const apiKey of apiKeys) {
        if (!isRelayActive(db, apiKey)) continue;
        try {
          const relays = getRelays(db, apiKey);
          const keyRow = getKey(db, apiKey);
          await relayManager.startAll(apiKey, relays, { cea708DelayMs: keyRow?.cea708_delay_ms ?? 0 });
        } catch (err) {
          logger.error(`[feed-rtmp] Failed to start relay for ${apiKey.slice(0, 8)}… after feed '${name}' publish: ${err.message}`);
        }
      }

      return res.status(200).send('ok');
    }

    if (call === 'publish_done') {
      logger.info(`[feed-rtmp] on_publish_done: feed '${name}' (camera ${camera.id.slice(0, 8)}…)`);
      relayManager.markFeedNotPublishing(camera.camera_key);
      return res.status(200).send('ok');
    }

    return res.status(400).send('unknown call type');
  }

  // POST /feed-rtmp — single-URL style (call=publish or call=publish_done in body)
  router.post('/', async (req, res) => {
    const { name, call } = req.body || {};
    return handleNginxCallback(call, name, res);
  });

  // POST /feed-rtmp/on_publish — separate-URL style (nginx on_publish)
  router.post('/on_publish', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish', name, res);
  });

  // POST /feed-rtmp/on_publish_done — separate-URL style (nginx on_publish_done)
  router.post('/on_publish_done', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish_done', name, res);
  });

  return router;
}
