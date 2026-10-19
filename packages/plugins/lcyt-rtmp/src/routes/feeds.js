/**
 * /feeds — the named incoming feeds of a project (Feeds card; plan feeds-and-devices-plan-2026-10-19).
 *
 *   GET    /feeds        { feeds: [...] }  the project's feeds, with live status and ingest URL. The project's main
 *                        stream is an ordinary row marked `primary: true` (api_keys.primary_feed_id; created on first
 *                        read from the old ingest key, same key). Only the DSK path is still a synthesized, read-only
 *                        entry (id 'managed:dsk'): it is named after the api key in the dsk app, so it cannot be a row
 *                        (feed keys are unique across apps).
 *   POST   /feeds        { name, kind?, transport?, label?, feedKey?, deviceType?, deviceId? } → 201 feed
 *   PATCH  /feeds/:id    any of the same fields (the primary feed keeps transport rtmp and its ingest key follows feedKey)
 *   POST   /feeds/:id/primary  make this feed the project's main stream
 *   DELETE /feeds/:id    (409 for the primary feed: pick another one first)
 *
 * Session Bearer auth; writes are Setup tier (plan_project_roles.md). `live` is true/false from MediaMTX, or null
 * when no MediaMTX API is configured or it cannot be reached.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import logger from 'lcyt/logger';
import {
  listFeeds, getFeed, createFeed, updateFeed, deleteFeed, validateFeedInput, generateFeedKey,
  deviceExists, isFeedKeyFree, ensurePrimaryFeed, getPrimaryFeedId, setPrimaryFeed, syncIngestStreamKey,
} from '../db/feeds.js';

const FEED_APP = process.env.FEED_RTMP_APP || 'feed';

function rtmpUrl(app, name, settings) {
  const host = settings ? settings.get('media.rtmp_host') : (process.env.RTMP_HOST || 'rtmp.lcyt.fi');
  return `rtmp://${host}/${app}/${name}`;
}

/**
 * @param {object} db  Prisma client
 * @param {import('express').RequestHandler} auth
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @param {object} [settings]
 * @param {import('express').RequestHandler} [requireSetup]
 */
export function createFeedsRouter(db, auth, relayManager, settings = null, requireSetup = (req, res, next) => next()) {
  const router = Router();
  router.use(auth);
  router.use(requireSetup);

  async function isLive(feedKey) {
    const mediamtx = relayManager.mediamtx;
    if (!mediamtx) return null;
    try { return !!(await mediamtx.isPathPublishing(feedKey)); } catch { return null; }
  }

  function videoApp() {
    return settings ? (settings.get('media.rtmp_application') || settings.get('media.rtmp_app')) : (process.env.RTMP_APPLICATION || process.env.RTMP_APP || 'stream');
  }

  /** @param {object} feed  @param {{ primaryId?: string|null, apiKey?: string }} [ctx] */
  async function present(feed, { primaryId = null, apiKey = null } = {}) {
    const primary = !!primaryId && feed.id === primaryId;
    // The main stream is published to the video app and tracked per project; other feeds use the feed app.
    const live = primary && apiKey ? relayManager.isPublishing(apiKey) : await isLive(feed.feedKey);
    const mediamtx = relayManager.mediamtx;
    return {
      ...feed,
      managed: false,
      primary,
      live,
      ingestUrl: feed.transport === 'rtmp' ? rtmpUrl(primary ? videoApp() : FEED_APP, feed.feedKey, settings) : null,
      whipUrl: feed.transport === 'whip' && mediamtx?.webrtcBaseUrl
        ? `${mediamtx.webrtcBaseUrl}/${encodeURIComponent(feed.feedKey)}/whip`
        : null,
    };
  }

  function dskFeed(apiKey) {
    const dskApp = settings ? settings.get('graphics.dsk_rtmp_app') : (process.env.DSK_RTMP_APP || 'dsk');
    return {
      managed: true, primary: false, transport: 'rtmp', deviceType: null, deviceId: null, sortOrder: -1, createdAt: null, whipUrl: null,
      id: 'managed:dsk', name: 'DSK', kind: 'dsk', label: 'dsk',
      // The DSK path is named after the API key (see GET /ingestion/config); no publish tracking exists, so live is unknown.
      feedKey: apiKey, ingestUrl: rtmpUrl(dskApp, apiKey, settings), live: null,
    };
  }

  const refuseManaged = (req, res, next) => {
    if (String(req.params.id).startsWith('managed:')) {
      return res.status(400).json({ error: 'The DSK feed follows the project key and cannot be changed here' });
    }
    next();
  };

  /** Shared checks of a validated body against the database. Returns an error response body or null. */
  async function checkReferences(apiKey, v, { exceptFeedId = null } = {}) {
    if (v.deviceType && !(await deviceExists(db, apiKey, v.deviceType, v.deviceId))) {
      return { status: 400, error: `${v.deviceType} '${v.deviceId}' not found in this project` };
    }
    if (v.feedKey !== undefined) {
      if (!(await isFeedKeyFree(db, v.feedKey, { exceptFeedId }))) {
        return { status: 409, error: `feedKey '${v.feedKey}' is already in use` };
      }
    }
    return null;
  }

  router.get('/', async (req, res) => {
    const apiKey = req.session.apiKey;
    try {
      await ensurePrimaryFeed(db, apiKey);
      const primaryId = await getPrimaryFeedId(db, apiKey);
      const rows = await listFeeds(db, apiKey);
      const feeds = await Promise.all(rows.map((f) => present(f, { primaryId, apiKey })));
      res.json({ feeds: [dskFeed(apiKey), ...feeds] });
    } catch (err) {
      logger.error(`[feeds] list failed: ${err.message}`);
      res.status(500).json({ error: 'Could not list feeds' });
    }
  });

  router.post('/', async (req, res) => {
    const apiKey = req.session.apiKey;
    const parsed = validateFeedInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const v = { ...parsed.value, feedKey: parsed.value.feedKey ?? generateFeedKey() };
    const problem = await checkReferences(apiKey, v);
    if (problem) return res.status(problem.status).json({ error: problem.error });
    try {
      const feed = await createFeed(db, apiKey, randomUUID(), v);
      res.status(201).json(await present(feed, { primaryId: await getPrimaryFeedId(db, apiKey), apiKey }));
    } catch (err) {
      // The unique index on feed_key is the last word if two creates race.
      if (/unique/i.test(err.message) || err.code === 'P2002') return res.status(409).json({ error: `feedKey '${v.feedKey}' is already in use` });
      logger.error(`[feeds] create failed: ${err.message}`);
      res.status(500).json({ error: 'Could not create feed' });
    }
  });

  router.patch('/:id', refuseManaged, async (req, res) => {
    const apiKey = req.session.apiKey;
    const existing = await getFeed(db, apiKey, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Feed not found' });
    const parsed = validateFeedInput(req.body, { partial: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const v = parsed.value;
    if (v.feedKey === existing.feedKey) delete v.feedKey;
    const primaryId = await getPrimaryFeedId(db, apiKey);
    const isPrimary = existing.id === primaryId;
    if (isPrimary && v.transport && v.transport !== 'rtmp') {
      return res.status(400).json({ error: 'The main feed is published over rtmp' });
    }
    const problem = await checkReferences(apiKey, v, { exceptFeedId: existing.id });
    if (problem) return res.status(problem.status).json({ error: problem.error });
    try {
      const feed = await updateFeed(db, apiKey, existing.id, v);
      if (isPrimary && v.feedKey) await syncIngestStreamKey(db, apiKey, v.feedKey);
      res.json(await present(feed, { primaryId, apiKey }));
    } catch (err) {
      if (/unique/i.test(err.message) || err.code === 'P2002') return res.status(409).json({ error: 'feedKey is already in use' });
      logger.error(`[feeds] update failed: ${err.message}`);
      res.status(500).json({ error: 'Could not update feed' });
    }
  });

  router.post('/:id/primary', refuseManaged, async (req, res) => {
    const apiKey = req.session.apiKey;
    const feed = await getFeed(db, apiKey, req.params.id);
    if (!feed) return res.status(404).json({ error: 'Feed not found' });
    if (feed.transport !== 'rtmp') return res.status(400).json({ error: 'Only an rtmp feed can be the main feed' });
    try {
      await setPrimaryFeed(db, apiKey, feed.id);
      await syncIngestStreamKey(db, apiKey, feed.feedKey);
      res.json(await present(feed, { primaryId: feed.id, apiKey }));
    } catch (err) {
      logger.error(`[feeds] set primary failed: ${err.message}`);
      res.status(500).json({ error: 'Could not set the main feed' });
    }
  });

  router.delete('/:id', refuseManaged, async (req, res) => {
    if (req.params.id === await getPrimaryFeedId(db, req.session.apiKey)) {
      return res.status(409).json({ error: 'This is the main feed; make another feed the main one before deleting it' });
    }
    const ok = await deleteFeed(db, req.session.apiKey, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Feed not found' });
    res.status(204).end();
  });

  return router;
}
