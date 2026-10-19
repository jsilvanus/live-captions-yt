/**
 * /feeds — the named incoming feeds of a project (Feeds card; plan feeds-and-devices-plan-2026-10-19).
 *
 *   GET    /feeds        { feeds: [...] }  the project's feeds, with live status and ingest URL, led by the two
 *                        managed feeds (id 'managed:video' and 'managed:dsk'). Those are views over the project's
 *                        ingest stream key and DSK path, not rows: their key changes only through
 *                        POST /ingestion/config/rotate and they cannot be edited or deleted here.
 *   POST   /feeds        { name, kind?, transport?, label?, feedKey?, deviceType?, deviceId? } → 201 feed
 *   PATCH  /feeds/:id    any of the same fields
 *   DELETE /feeds/:id
 *
 * Session Bearer auth; writes are Setup tier (plan_project_roles.md). `live` is true/false from MediaMTX, or null
 * when no MediaMTX API is configured or it cannot be reached.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import logger from 'lcyt/logger';
import { getKey } from '../db.js';
import {
  listFeeds, getFeed, createFeed, updateFeed, deleteFeed, validateFeedInput, generateFeedKey,
  deviceExists, isFeedKeyFree,
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

  async function present(feed) {
    const live = await isLive(feed.feedKey);
    const mediamtx = relayManager.mediamtx;
    return {
      ...feed,
      managed: false,
      live,
      ingestUrl: feed.transport === 'rtmp' ? rtmpUrl(FEED_APP, feed.feedKey, settings) : null,
      whipUrl: feed.transport === 'whip' && mediamtx?.webrtcBaseUrl
        ? `${mediamtx.webrtcBaseUrl}/${encodeURIComponent(feed.feedKey)}/whip`
        : null,
    };
  }

  async function managedFeeds(apiKey) {
    const keyRow = await getKey(db, apiKey) || {};
    const videoApp = settings ? (settings.get('media.rtmp_application') || settings.get('media.rtmp_app')) : (process.env.RTMP_APPLICATION || process.env.RTMP_APP || 'stream');
    const dskApp = settings ? settings.get('graphics.dsk_rtmp_app') : (process.env.DSK_RTMP_APP || 'dsk');
    const videoKey = keyRow.ingest_stream_key || apiKey;
    const base = { managed: true, transport: 'rtmp', deviceType: null, deviceId: null, sortOrder: -1, createdAt: null, whipUrl: null };
    return [
      {
        ...base, id: 'managed:video', name: 'Main video', kind: 'generic', label: 'main',
        feedKey: videoKey, ingestUrl: rtmpUrl(videoApp, videoKey, settings), live: relayManager.isPublishing(apiKey),
      },
      {
        ...base, id: 'managed:dsk', name: 'DSK', kind: 'dsk', label: 'dsk',
        // The DSK path is named after the API key (see GET /ingestion/config); no publish tracking exists, so live is unknown.
        feedKey: apiKey, ingestUrl: rtmpUrl(dskApp, apiKey, settings), live: null,
      },
    ];
  }

  const refuseManaged = (req, res, next) => {
    if (String(req.params.id).startsWith('managed:')) {
      return res.status(400).json({ error: 'Managed feeds follow the project ingest key; rotate it with POST /ingestion/config/rotate' });
    }
    next();
  };

  /** Shared checks of a validated body against the database. Returns an error response body or null. */
  async function checkReferences(apiKey, v, { exceptFeedId = null } = {}) {
    if (v.deviceType && !(await deviceExists(db, apiKey, v.deviceType, v.deviceId))) {
      return { status: 400, error: `${v.deviceType} '${v.deviceId}' not found in this project` };
    }
    if (v.feedKey !== undefined) {
      const linkedCameraId = v.deviceType === 'camera' ? v.deviceId : null;
      if (!(await isFeedKeyFree(db, apiKey, v.feedKey, { exceptFeedId, linkedCameraId }))) {
        return { status: 409, error: `feedKey '${v.feedKey}' is already in use` };
      }
    }
    return null;
  }

  router.get('/', async (req, res) => {
    const apiKey = req.session.apiKey;
    try {
      const rows = await listFeeds(db, apiKey);
      const feeds = await Promise.all(rows.map(present));
      res.json({ feeds: [...(await managedFeeds(apiKey)), ...feeds] });
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
      res.status(201).json(await present(feed));
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
    const problem = await checkReferences(apiKey, v, { exceptFeedId: existing.id });
    if (problem) return res.status(problem.status).json({ error: problem.error });
    try {
      const feed = await updateFeed(db, apiKey, existing.id, v);
      res.json(await present(feed));
    } catch (err) {
      if (/unique/i.test(err.message) || err.code === 'P2002') return res.status(409).json({ error: 'feedKey is already in use' });
      logger.error(`[feeds] update failed: ${err.message}`);
      res.status(500).json({ error: 'Could not update feed' });
    }
  });

  router.delete('/:id', refuseManaged, async (req, res) => {
    const ok = await deleteFeed(db, req.session.apiKey, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Feed not found' });
    res.status(204).end();
  });

  return router;
}
