/**
 * Per-broadcast platform actions.
 *
 *   POST /broadcasts/:id/platforms/:platform/schedule
 *   POST /broadcasts/:id/platforms/:platform/thumbnail
 *   POST /broadcasts/:id/platforms/:platform/go-live
 *   POST /broadcasts/:id/platforms/:platform/end
 *   GET  /broadcasts/:id/platforms/:platform/stats[?history=1]
 *   GET  /broadcasts/:id/platforms
 *
 * This router is mounted by the plugin, but it never imports lcyt-backend's
 * db/* modules — a plugin cannot depend on the backend that depends on it. All
 * broadcast and caption-target access goes through the injected
 * `broadcastsApi` / `captionTargetsApi` interfaces instead.
 *
 * Every route takes an optional `credentialId`. With multi-channel support
 * (resolved decision #1) the implicit path only resolves when a project has
 * exactly one live account for the platform; otherwise the caller must name
 * one and gets the candidate list back to build a picker from.
 */
import { Router } from 'express';
import logger from 'lcyt/logger';
import {
  getLink, listLinks, upsertLink, updateLink, formatLink,
  insertStats, getLatestStats, listStats, formatStats,
  peakConcurrentFromSnapshots, STATS_LIVE_SNAPSHOT, STATS_POST_SUMMARY,
} from '../db.js';
import { requireApiKey, requireAdapter, resolveCredential, respondToPlatformError } from './helpers.js';

/** Thumbnails: what YouTube accepts, and a sane ceiling (its own limit is 2 MB). */
const THUMBNAIL_MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {object} deps
 * @param {(platform: string) => object|null} [deps.getAdapter]
 * @param {(credentialId: string) => Promise<string>} deps.getAccessToken
 * @param {{ getBroadcast: Function, updateBroadcast: Function }} deps.broadcastsApi
 * @param {{ list: Function, create: Function, update: Function }} [deps.captionTargetsApi]
 * @param {(apiKey: string, broadcastId: string) => Promise<object>} [deps.startSession]
 * @param {{ publish: Function }} [deps.eventBus]
 */
export function createBroadcastPlatformsRouter(db, auth, deps) {
  const {
    getAdapter, getAccessToken, broadcastsApi,
    captionTargetsApi = null, startSession = null, eventBus = null,
  } = deps;
  const router = Router({ mergeParams: true });
  const resolveAdapter = (req, res) => requireAdapter(req, res, getAdapter);

  /**
   * Common prelude: authenticate, resolve the platform adapter, confirm the
   * broadcast belongs to this project, and pick a credential.
   * @returns {Promise<null|{apiKey, adapter, broadcast, credential, accessToken}>}
   */
  async function prepare(req, res, { requireToken = true } = {}) {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return null;
    const adapter = resolveAdapter(req, res);
    if (!adapter) return null;

    const broadcast = broadcastsApi.getBroadcast(db, apiKey, req.params.id);
    if (!broadcast) {
      res.status(404).json({ error: 'Broadcast not found' });
      return null;
    }

    const credential = resolveCredential(req, res, db, apiKey, adapter.platform);
    if (!credential) return null;

    if (!requireToken) return { apiKey, adapter, broadcast, credential, accessToken: null };

    try {
      const accessToken = await getAccessToken(credential.id);
      return { apiKey, adapter, broadcast, credential, accessToken };
    } catch (err) {
      respondToPlatformError(res, err, 'Could not obtain a platform access token');
      return null;
    }
  }

  // ── List this broadcast's platform links ───────────────────────────────
  router.get('/', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const broadcast = broadcastsApi.getBroadcast(db, apiKey, req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });
    res.json({ links: listLinks(db, req.params.id).map(formatLink) });
  });

  // ── Schedule (create or update the external broadcast) ─────────────────
  router.post('/:platform/schedule', auth, async (req, res) => {
    const ctx = await prepare(req, res);
    if (!ctx) return;
    const { apiKey, adapter, broadcast, credential, accessToken } = ctx;

    const title = req.body?.title ?? broadcast.title;
    const description = req.body?.description ?? broadcast.description ?? '';
    const scheduledStart = req.body?.scheduledStart ?? broadcast.scheduledStart;
    // Visibility comes from the broadcast row (which defaults to 'unlisted'),
    // with a per-request override for callers that want to set it in the same
    // action as scheduling.
    const privacyStatus = req.body?.privacyStatus ?? broadcast.privacyStatus;
    if (!scheduledStart) {
      return res.status(400).json({
        error: 'This broadcast has no scheduled start time — set one before scheduling it on a platform',
      });
    }

    const existing = getLink(db, broadcast.id, adapter.platform);

    try {
      let link;
      if (existing) {
        // Already scheduled externally — update in place rather than creating a
        // second external broadcast for the same LCYT one.
        await adapter.updateSchedule(accessToken, existing.external_broadcast_id, {
          title, description, scheduledStart, privacyStatus,
        });
        link = upsertLink(db, {
          broadcastId: broadcast.id,
          platform: adapter.platform,
          credentialId: credential.id,
          externalBroadcastId: existing.external_broadcast_id,
          externalStreamId: existing.external_stream_id,
        });
      } else {
        const created = await adapter.createScheduled(accessToken, { title, description, scheduledStart, privacyStatus });
        link = upsertLink(db, {
          broadcastId: broadcast.id,
          platform: adapter.platform,
          credentialId: credential.id,
          externalBroadcastId: created.externalBroadcastId,
          externalStreamId: created.externalStreamId,
          lastStatus: 'ready',
        });
        // Mirror onto the legacy column. It is not dead: db/broadcasts.js
        // surfaces it as youtubeBroadcastId through formatRow(), and the
        // broadcasts routes accept it on create and update.
        if (adapter.platform === 'youtube') {
          try {
            broadcastsApi.updateBroadcast(db, apiKey, broadcast.id, {
              youtubeBroadcastId: created.externalBroadcastId,
            });
          } catch (err) {
            // A mirroring failure must not fail the schedule itself — the
            // authoritative record is broadcast_platform_links.
            logger.warn(`[platforms] could not mirror youtube_broadcast_id: ${err.message}`);
          }
        }
      }

      const streamKeyResult = await maybeBindStreamKey(req, {
        apiKey, adapter, accessToken, link,
      });

      res.json({
        link: formatLink(getLink(db, broadcast.id, adapter.platform)),
        captionTarget: streamKeyResult,
      });
    } catch (err) {
      if (existing) updateLink(db, existing.id, { lastSyncError: err.message });
      respondToPlatformError(res, err, 'Could not schedule the broadcast');
    }
  });

  /**
   * Fetch the real CDN stream key and offer it to the project's caption
   * targets — closing the gap the plan identified, where `getLiveStream()`
   * already knew how to read a stream key but nothing ever wrote it into
   * `caption_targets`.
   *
   * Never overwrites a manually-entered key silently: an existing youtube
   * target is only updated when the caller explicitly passes
   * `bindStreamKey: true`.
   */
  async function maybeBindStreamKey(req, { apiKey, adapter, accessToken, link }) {
    if (!captionTargetsApi || !link?.external_stream_id) return null;
    if (typeof adapter.getStreamKey !== 'function') return null;

    let streamKey;
    try {
      ({ streamKey } = await adapter.getStreamKey(accessToken, link.external_stream_id));
    } catch (err) {
      logger.warn(`[platforms] could not read stream key: ${err.message}`);
      return { bound: false, reason: 'lookup_failed' };
    }
    if (!streamKey) return { bound: false, reason: 'no_stream_key' };

    const existingTarget = (captionTargetsApi.list(db, apiKey) || [])
      .find(t => t.type === 'youtube');

    if (!existingTarget) {
      const result = captionTargetsApi.create(db, apiKey, { type: 'youtube', streamKey, enabled: true });
      return result?.ok
        ? { bound: true, created: true, targetId: result.target.id }
        : { bound: false, reason: result?.error || 'create_failed' };
    }

    if (req.body?.bindStreamKey !== true) {
      // Say what we *would* do, so the UI can offer a one-click confirm rather
      // than silently clobbering a key the operator pasted in by hand.
      return { bound: false, reason: 'existing_target', targetId: existingTarget.id, available: true };
    }

    const result = captionTargetsApi.update(db, apiKey, existingTarget.id, { streamKey });
    return result?.ok
      ? { bound: true, created: false, targetId: existingTarget.id }
      : { bound: false, reason: result?.error || 'update_failed' };
  }

  // ── Thumbnail ──────────────────────────────────────────────────────────
  // base64 in a JSON body, matching routes/icons.js. lcyt-backend has no
  // multipart handling anywhere, and this plan is not the place to introduce
  // a multer dependency for one endpoint.
  router.post('/:platform/thumbnail', auth, async (req, res) => {
    const ctx = await prepare(req, res);
    if (!ctx) return;
    const { adapter, broadcast, accessToken } = ctx;

    const link = getLink(db, broadcast.id, adapter.platform);
    if (!link) {
      return res.status(409).json({
        error: `Schedule this broadcast on ${adapter.platform} before setting a thumbnail`,
        code: 'not_linked',
      });
    }

    const { data, mimeType } = req.body || {};
    if (!data || !mimeType) {
      return res.status(400).json({ error: 'data (base64) and mimeType are required' });
    }
    if (!THUMBNAIL_MIME_TYPES.has(mimeType)) {
      return res.status(400).json({ error: 'mimeType must be image/png or image/jpeg' });
    }

    // Buffer.from() is lenient with base64 — it silently drops invalid
    // characters rather than throwing, so a try/catch here would be dead code
    // and garbage would reach the provider as a short buffer. Validate the
    // encoding explicitly instead.
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.replace(/\s/g, ''))) {
      return res.status(400).json({ error: 'data is not valid base64' });
    }
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) return res.status(400).json({ error: 'Thumbnail image is empty' });
    if (buf.length > THUMBNAIL_MAX_BYTES) {
      return res.status(413).json({ error: `Thumbnail must be ${THUMBNAIL_MAX_BYTES / 1024 / 1024} MB or smaller` });
    }

    try {
      const { thumbnailUrl } = await adapter.setThumbnail(accessToken, link.external_broadcast_id, buf, mimeType);
      updateLink(db, link.id, { thumbnailUrl });
      res.json({ thumbnailUrl });
    } catch (err) {
      updateLink(db, link.id, { lastSyncError: err.message });
      respondToPlatformError(res, err, 'Could not set the thumbnail');
    }
  });

  // ── Go live ────────────────────────────────────────────────────────────
  router.post('/:platform/go-live', auth, async (req, res) => {
    const ctx = await prepare(req, res);
    if (!ctx) return;
    const { apiKey, adapter, broadcast, accessToken } = ctx;

    const link = getLink(db, broadcast.id, adapter.platform);
    if (!link) {
      return res.status(409).json({
        error: `Schedule this broadcast on ${adapter.platform} first`,
        code: 'not_linked',
      });
    }

    let status;
    try {
      ({ status } = await adapter.transition(accessToken, link.external_broadcast_id, 'live'));
      updateLink(db, link.id, { lastStatus: 'live', lastSyncError: null });
    } catch (err) {
      updateLink(db, link.id, { lastSyncError: err.message });
      return respondToPlatformError(res, err, 'Could not go live');
    }

    // Two calls under the hood, not a merged endpoint — "go live on YouTube"
    // and "start captioning" stay separable, exactly as the plan specifies.
    //
    // The transition has already succeeded and cannot be undone, so a failure
    // here is reported as partial success rather than rolled back: the
    // broadcast IS live on the platform, just without captions yet. Silently
    // 500ing would leave the operator believing nothing happened.
    let session = null;
    let sessionError = null;
    if (startSession) {
      try {
        session = await startSession(apiKey, broadcast.id);
      } catch (err) {
        sessionError = err.message;
        logger.warn(`[platforms] went live on ${adapter.platform} but the caption session failed to start: ${err.message}`);
      }
    }

    if (eventBus) {
      eventBus.publish(apiKey, 'platform.status_changed', {
        broadcastId: broadcast.id, platform: adapter.platform, status: 'live',
      });
    }

    res.json({
      status,
      // Only asserted when a session hook is actually wired. In the default
      // deployment the frontend makes the second call itself (POST /live) —
      // "one action from the UI, two calls under the hood" — so claiming
      // `captionSessionStarted: false` here would be reporting a failure that
      // never happened.
      ...(startSession ? { captionSessionStarted: !!session && !sessionError } : {}),
      ...(sessionError ? {
        partial: true,
        warning: `The broadcast is live on ${adapter.platform}, but the caption session did not start: ${sessionError}`,
      } : {}),
    });
  });

  // ── End ────────────────────────────────────────────────────────────────
  router.post('/:platform/end', auth, async (req, res) => {
    const ctx = await prepare(req, res);
    if (!ctx) return;
    const { apiKey, adapter, broadcast, accessToken } = ctx;

    const link = getLink(db, broadcast.id, adapter.platform);
    if (!link) return res.status(409).json({ error: 'This broadcast is not linked to a platform', code: 'not_linked' });

    let status;
    try {
      ({ status } = await adapter.transition(accessToken, link.external_broadcast_id, 'complete'));
      updateLink(db, link.id, { lastStatus: 'complete', lastSyncError: null });
    } catch (err) {
      updateLink(db, link.id, { lastSyncError: err.message });
      return respondToPlatformError(res, err, 'Could not end the broadcast');
    }

    const summary = await captureSummary({ adapter, accessToken, link, broadcastId: broadcast.id });

    if (eventBus) {
      eventBus.publish(apiKey, 'platform.status_changed', {
        broadcastId: broadcast.id, platform: adapter.platform, status: 'complete',
      });
    }

    res.json({ status, summary });
  });

  /**
   * One-shot post-broadcast summary.
   *
   * Peak concurrent comes from the live snapshots this plugin recorded itself —
   * YouTube Analytics exposes no peak-concurrent metric at all. Analytics is
   * also batch-processed, so a summary fetched seconds after the stream ends
   * can legitimately come back zeroed; the row is still written so the UI has
   * something, and re-fetching later gives better numbers.
   */
  async function captureSummary({ adapter, accessToken, link, broadcastId }) {
    const peak = peakConcurrentFromSnapshots(db, broadcastId, link.platform);
    try {
      const stats = await adapter.getPostBroadcastStats(accessToken, link.external_broadcast_id);
      insertStats(db, {
        broadcastId,
        platform: link.platform,
        kind: STATS_POST_SUMMARY,
        views: stats.views,
        averageWatchTimeSec: stats.averageWatchTimeSec,
        peakConcurrentViewers: stats.peakConcurrentViewers ?? peak,
      });
      return formatStats(getLatestStats(db, broadcastId, link.platform, STATS_POST_SUMMARY));
    } catch (err) {
      // Ending the broadcast succeeded; the summary is a bonus. Record what we
      // do know rather than losing the peak we already measured.
      logger.warn(`[platforms] post-broadcast stats unavailable for ${broadcastId}: ${err.message}`);
      insertStats(db, {
        broadcastId, platform: link.platform, kind: STATS_POST_SUMMARY, peakConcurrentViewers: peak,
      });
      return formatStats(getLatestStats(db, broadcastId, link.platform, STATS_POST_SUMMARY));
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────
  router.get('/:platform/stats', auth, (req, res) => {
    const apiKey = requireApiKey(req, res);
    if (!apiKey) return;
    const adapter = resolveAdapter(req, res);
    if (!adapter) return;

    const broadcast = broadcastsApi.getBroadcast(db, apiKey, req.params.id);
    if (!broadcast) return res.status(404).json({ error: 'Broadcast not found' });

    const platform = adapter.platform;
    const payload = {
      latest: formatStats(getLatestStats(db, broadcast.id, platform, STATS_LIVE_SNAPSHOT)),
      summary: formatStats(getLatestStats(db, broadcast.id, platform, STATS_POST_SUMMARY)),
      peakConcurrentViewers: peakConcurrentFromSnapshots(db, broadcast.id, platform),
    };

    // Tier 3 — the historical trend needs no extra table; it is this query.
    if (req.query.history === '1') {
      payload.history = listStats(db, broadcast.id, platform, { kind: STATS_LIVE_SNAPSHOT }).map(formatStats);
    }

    res.json(payload);
  });

  return router;
}
