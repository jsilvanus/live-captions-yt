/**
 * Named-feed RTMP ingest callbacks — `/feed-rtmp` (plan_ingest_feeds.md §2a)
 *
 * Handles nginx-rtmp on_publish / on_publish_done callbacks for the `feed`
 * nginx-rtmp application. One static app handles arbitrarily many named
 * feeds via dynamic per-request resolution — no nginx reconfiguration is
 * needed per camera, mirroring the `stream`/`dsk` apps' single-app-many-keys
 * shape (see routes/rtmp.js, lcyt-dsk's routes/dsk-rtmp.js).
 *
 * When a broadcaster (e.g. OBS) publishes to `rtmp://<server>/feed/<feedKey>`,
 * the stream name is resolved against prod_feeds.feed_key for a row with
 * transport 'rtmp'. A feed's mere existence with that transport is the entire
 * accept/reject gate: there is no separate admin flag to check.
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
import { getApiKeysReferencingFeed, isRelayActive, getRelays, getKey } from '../db.js';
import { readThrough } from '../ownership.js';
import { startCropsForFeed, stopCropsForFeed } from '../crop-outputs.js';

// feed_key validation: same shape as the main relay keys / DSK app names.
const FEED_KEY_RE = /^[a-zA-Z0-9_-]{1,}$/;

/**
 * Resolve an incoming nginx-rtmp stream `name` to a feed: a prod_feeds row with transport 'rtmp'.
 * @param {object} db  Prisma client
 * @param {string} key
 * @returns {Promise<{ key: string, feedId: string, ownerApiKey: string }|null>}
 */
async function resolveFeed(db, key) {
  const feed = await db.prod_feeds.findUnique({ where: { feed_key: key }, select: { id: true, feed_key: true, transport: true, owner_api_key: true } });
  if (feed && feed.transport === 'rtmp') return { key: feed.feed_key, feedId: feed.id, ownerApiKey: feed.owner_api_key };
  return null;
}

/**
 * Create the Express router for named-feed RTMP ingest callbacks.
 *
 * @param {object} db  Prisma client
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @param {import('../crop-manager.js').CropManager} [cropManager]  starts/stops the crops whose source is this feed
 * @returns {Router}
 */
export function createFeedRtmpRouter(db, relayManager, cropManager = null) {
  const router = Router();

  // nginx-rtmp callbacks are application/x-www-form-urlencoded
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  /**
   * Shared handler for nginx-rtmp publish/publish_done events.
   * @param {'publish'|'publish_done'} call
   * @param {string} name  Stream name = a prod_feeds.feed_key
   * @param {import('express').Response} res
   */
  async function handleNginxCallback(call, name, res) {
    if (!name || !FEED_KEY_RE.test(name)) {
      return res.status(400).send('invalid stream name');
    }

    const feed = await resolveFeed(db, name);
    if (!feed) {
      logger.warn(`[feed-rtmp] Rejected publish: no 'rtmp' feed with key '${name}'`);
      return res.status(403).send('unknown feed');
    }

    if (call === 'publish') {
      logger.info(`[feed-rtmp] on_publish: feed '${name}' (feed ${feed.feedId.slice(0, 8)}…)`);
      // Separate namespace from markPublishing/isPublishing (apiKey-keyed) —
      // feed_key is an operator-chosen string with no uniqueness constraint
      // against api_keys.key, so a colliding value must not be able to spoof
      // another project's own live status (code-review follow-up).
      relayManager.markFeedPublishing(feed.key);

      // A feed-only relay configuration (no program-sourced slot at all) has
      // no other trigger to ever start its MediaMTX fan-out: every other
      // trigger (routes/rtmp.js's on_publish, PUT /stream/active) keys off
      // the PRIMARY apiKey's own publish state, never a referenced feed's.
      const apiKeys = await getApiKeysReferencingFeed(db, feed.feedId);
      for (const apiKey of apiKeys) {
        if (!(await isRelayActive(db, apiKey))) continue;
        try {
          const relays = await getRelays(db, apiKey);
          const keyRow = await getKey(db, apiKey);
          await relayManager.startAll(apiKey, relays, { cea708DelayMs: keyRow?.cea708_delay_ms ?? 0 });
        } catch (err) {
          logger.error(`[feed-rtmp] Failed to start relay for ${apiKey.slice(0, 8)}… after feed '${name}' publish: ${err.message}`);
        }
      }

      if (cropManager && feed.ownerApiKey) await startCropsForFeed(db, cropManager, readThrough, feed.ownerApiKey, feed.feedId);

      return res.status(200).send('ok');
    }

    if (call === 'publish_done') {
      logger.info(`[feed-rtmp] on_publish_done: feed '${name}' (feed ${feed.feedId.slice(0, 8)}…)`);
      relayManager.markFeedNotPublishing(feed.key);
      if (cropManager && feed.ownerApiKey) await stopCropsForFeed(db, cropManager, readThrough, feed.ownerApiKey, feed.feedId);
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
