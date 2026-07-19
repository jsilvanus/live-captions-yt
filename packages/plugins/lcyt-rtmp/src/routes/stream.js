import { Router } from 'express';
import { isRelayAllowed, isRelayActive, setRelayActive, getRelays, getRelaySlot, upsertRelay, deleteRelaySlot, deleteAllRelays, getRtmpStreamStats, getKey, resolveRelaySourceCameraKey } from '../db.js';
import logger from 'lcyt/logger';

/**
 * Factory for the /stream router.
 *
 * Authenticated (JWT Bearer) CRUD for per-key RTMP relay configuration.
 * One incoming stream fans out to an arbitrary number of target slots — no
 * cap is enforced (plan_ingest_feeds.md §1b; a future per-team quota is an
 * explicit non-goal of that plan, not built here).
 * The API key must have relay_allowed = true.
 *
 * POST   /stream              — create/replace a relay slot (body: { slot?, targetUrl, targetName?, captionMode?, sourceCameraId? })
 * GET    /stream              — get all configured slots + running status per slot
 * GET    /stream/history      — per-stream RTMP usage history for this key
 * PUT    /stream/:slot        — update a specific slot
 * DELETE /stream/:slot        — stop ffmpeg for slot and remove its config
 * DELETE /stream              — stop all slots, drop nginx publisher, remove all configs
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @returns {Router}
 */
export function createStreamRouter(db, auth, relayManager, allowedRtmpDomains) {
  const router = Router();

  // Build domain allowlist. null = wildcard (all domains allowed).
  const rtmpDomainList = (!allowedRtmpDomains || allowedRtmpDomains === '*')
    ? null
    : allowedRtmpDomains.split(',').map(d => d.trim()).filter(Boolean);

  // Apply auth + domain check to every route in this router.
  router.use(auth);
  router.use(function requireRtmpDomain(req, res, next) {
    if (!rtmpDomainList) return next();
    const domain = req.session?.domain;
    if (!domain || !rtmpDomainList.includes(domain)) {
      return res.status(403).json({ error: 'RTMP relay not available for this domain' });
    }
    next();
  });

  // Middleware: check relay_allowed for this API key
  function requireRelayAllowed(req, res, next) {
    const apiKey = req.session?.apiKey;
    if (!apiKey || !isRelayAllowed(db, apiKey)) {
      return res.status(403).json({ error: 'RTMP relay not enabled for this API key' });
    }
    next();
  }

  function validateBody(req, res) {
    const { targetUrl, targetName, captionMode, recordOnStart, recordOnButton, scale, fps, videoBitrate, audioBitrate, sourceView, sourceCameraId } = req.body || {};
    if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith('rtmp')) {
      res.status(400).json({ error: 'targetUrl must be a valid rtmp:// or rtmps:// URL' });
      return null;
    }
    const validModes = ['http', 'cea708'];
    const resolvedMode = validModes.includes(captionMode) ? captionMode : 'http';

    // Which rendition this slot forwards (plan_vertical_crop.md): the raw
    // program feed (default) or the {key}-crop vertical rendition. Ignored
    // when sourceCameraId is set (plan_ingest_feeds.md §1b/§2c).
    let resolvedSourceView = 'program';
    if (sourceView !== undefined && sourceView !== null && sourceView !== '') {
      if (sourceView !== 'program' && sourceView !== 'crop') {
        res.status(400).json({ error: "sourceView must be 'program' or 'crop'" });
        return null;
      }
      resolvedSourceView = sourceView;
    }

    // Optional named-feed source: a prod_cameras.id with a real camera_key
    // (plan_ingest_feeds.md §1b). Takes priority over sourceView when set.
    let resolvedSourceCameraId = null;
    if (sourceCameraId !== undefined && sourceCameraId !== null && sourceCameraId !== '') {
      if (typeof sourceCameraId !== 'string') {
        res.status(400).json({ error: 'sourceCameraId must be a string camera id' });
        return null;
      }
      if (!resolveRelaySourceCameraKey(db, sourceCameraId, req.session.apiKey)) {
        // Same 400 whether the camera doesn't exist, has no camera_key, or
        // is owned by a different project — doesn't confirm a foreign
        // camera's existence to a caller who doesn't own it.
        res.status(400).json({ error: `Unknown or feed-less camera '${sourceCameraId}'` });
        return null;
      }
      resolvedSourceCameraId = sourceCameraId;
    }

    // Validate optional per-slot transcode options
    let resolvedScale = null;
    if (scale !== undefined && scale !== null && scale !== '') {
      if (typeof scale !== 'string' || !/^\d+[x:]\d+$/.test(scale)) {
        res.status(400).json({ error: 'scale must be a string like "1280x720" or "1280:720"' });
        return null;
      }
      resolvedScale = scale.replace(':', 'x'); // normalise to WxH
    }
    let resolvedFps = null;
    if (fps !== undefined && fps !== null && fps !== '') {
      const n = Number(fps);
      if (!Number.isInteger(n) || n < 1 || n > 120) {
        res.status(400).json({ error: 'fps must be an integer between 1 and 120' });
        return null;
      }
      resolvedFps = n;
    }
    const resolvedVideoBitrate = (typeof videoBitrate === 'string' && videoBitrate.trim()) ? videoBitrate.trim() : null;
    const resolvedAudioBitrate = (typeof audioBitrate === 'string' && audioBitrate.trim()) ? audioBitrate.trim() : null;
    const resolvedRecordOnStart = typeof recordOnStart === 'boolean' ? recordOnStart : false;
    const resolvedRecordOnButton = typeof recordOnButton === 'boolean' ? recordOnButton : false;

    return {
      targetUrl:    targetUrl.trim(),
      targetName:   (typeof targetName === 'string' && targetName.trim()) ? targetName.trim() : null,
      captionMode:  resolvedMode,
      recordOnStart: resolvedRecordOnStart,
      recordOnButton: resolvedRecordOnButton,
      scale:        resolvedScale,
      fps:          resolvedFps,
      videoBitrate: resolvedVideoBitrate,
      audioBitrate: resolvedAudioBitrate,
      sourceView:   resolvedSourceView,
      sourceCameraId: resolvedSourceCameraId,
    };
  }

  // No upper bound — plan_ingest_feeds.md §1b removes the earlier 4-slot cap.
  function parseSlot(raw, res) {
    const slot = Number(raw);
    if (!Number.isInteger(slot) || slot < 1) {
      res.status(400).json({ error: 'slot must be a positive integer' });
      return null;
    }
    return slot;
  }

  // POST /stream — create or replace a relay slot
  router.post('/', requireRelayAllowed, (req, res) => {
    const fields = validateBody(req, res);
    if (!fields) return;
    const existing = getRelays(db, req.session.apiKey);

    let slot;
    if (req.body?.slot === undefined || req.body?.slot === null || req.body?.slot === '') {
      // No slot given: append as a new target (max existing slot + 1), so
      // clients don't need to track slot numbers by hand.
      slot = existing.reduce((max, r) => Math.max(max, r.slot), 0) + 1;
    } else {
      slot = parseSlot(String(req.body.slot), res);
      if (slot === null) return;
    }

    try {
      const relay = upsertRelay(db, req.session.apiKey, slot, fields.targetUrl, {
        targetName:    fields.targetName,
        captionMode:   fields.captionMode,
        recordOnStart: fields.recordOnStart,
        recordOnButton: fields.recordOnButton,
        scale:         fields.scale,
        fps:           fields.fps,
        videoBitrate:  fields.videoBitrate,
        audioBitrate:  fields.audioBitrate,
        sourceView:    fields.sourceView,
        sourceCameraId: fields.sourceCameraId,
      });
      return res.status(201).json({ ok: true, relay });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // GET /stream — get all slots + running status per slot + relay active state
  router.get('/', requireRelayAllowed, (req, res) => {
    const relays = getRelays(db, req.session.apiKey);
    const runningSlots = relayManager.runningSlots(req.session.apiKey);
    const active = isRelayActive(db, req.session.apiKey);
    return res.status(200).json({ relays, runningSlots, active });
  });

  // GET /stream/history — per-stream usage history for this key
  router.get('/history', requireRelayAllowed, (req, res) => {
    const stats = getRtmpStreamStats(db, req.session.apiKey);
    return res.status(200).json({ streams: stats });
  });

  // PUT /stream/active — toggle the relay on/off for this key.
  // When activated (active=true):
  //   - Sets relay_active=1 in the DB.
  //   - If nginx is currently publishing (on_publish was received), immediately
  //     starts fan-out for all configured slots.
  // When deactivated (active=false):
  //   - Sets relay_active=0 in the DB.
  //   - Stops all running ffmpeg fan-out processes (does not drop the nginx publisher).
  router.put('/active', requireRelayAllowed, async (req, res) => {
    const { active } = req.body || {};
    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'active must be a boolean' });
    }
    const apiKey = req.session.apiKey;
    setRelayActive(db, apiKey, active);

    if (active) {
      // If nginx is currently publishing a stream, start fan-out immediately
      if (relayManager.isPublishing(apiKey)) {
        const relays = getRelays(db, apiKey);
        if (relays.length > 0) {
          try {
            const keyRow = getKey(db, apiKey);
            const cea708DelayMs = keyRow?.cea708_delay_ms ?? 0;
            await relayManager.startAll(apiKey, relays, { cea708DelayMs });
          } catch (err) {
            logger.warn(`[stream] Failed to start fan-out on relay activate: ${err.message}`);
          }
        }
      }
    } else {
      // Deactivate: stop all running ffmpeg processes.
      // The nginx publisher keeps the incoming stream alive (not dropped).
      try {
        await relayManager.stopKey(apiKey);
      } catch (err) {
        logger.warn(`[stream] Failed to stop relay on deactivate: ${err.message}`);
      }
    }

    return res.status(200).json({ ok: true, active });
  });

  // PUT /stream/:slot — update a specific slot
  router.put('/:slot', requireRelayAllowed, (req, res) => {
    const slot = parseSlot(req.params.slot, res);
    if (slot === null) return;

    const existing = getRelaySlot(db, req.session.apiKey, slot);
    if (!existing) {
      return res.status(404).json({ error: `Slot ${slot} not configured — use POST /stream to create it` });
    }
    const fields = validateBody(req, res);
    if (!fields) return;
    try {
      const relay = upsertRelay(db, req.session.apiKey, slot, fields.targetUrl, {
        targetName:    fields.targetName,
        captionMode:   fields.captionMode,
        recordOnStart: fields.recordOnStart,
        recordOnButton: fields.recordOnButton,
        scale:         fields.scale,
        fps:           fields.fps,
        videoBitrate:  fields.videoBitrate,
        audioBitrate:  fields.audioBitrate,
        sourceView:    fields.sourceView,
        sourceCameraId: fields.sourceCameraId,
      });
      return res.status(200).json({ ok: true, relay });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // DELETE /stream/:slot — remove slot config and restart relay with remaining targets
  router.delete('/:slot', requireRelayAllowed, async (req, res) => {
    const slot = parseSlot(req.params.slot, res);
    if (slot === null) return;
    const apiKey = req.session.apiKey;

    // Remove from DB first so the restart picks up the updated target list.
    const deleted = deleteRelaySlot(db, apiKey, slot);

    if (relayManager.isRunning(apiKey)) {
      const remaining = getRelays(db, apiKey);
      if (remaining.length > 0) {
        // Restart the single ffmpeg process with the remaining tee targets.
        try {
          const keyRow = getKey(db, apiKey);
          const cea708DelayMs = keyRow?.cea708_delay_ms ?? 0;
          await relayManager.start(apiKey, remaining, { cea708DelayMs });
        } catch (err) {
          logger.warn(`[stream] Failed to restart relay after slot ${slot} removal: ${err.message}`);
        }
      } else {
        // No targets left — stop the process entirely.
        try {
          await relayManager.stop(apiKey);
        } catch (err) {
          logger.warn(`[stream] Failed to stop relay after removing last slot: ${err.message}`);
        }
      }
    }

    return res.status(200).json({ ok: true, slot, deleted });
  });

  // DELETE /stream — stop all slots, drop publisher from nginx, delete all configs
  router.delete('/', requireRelayAllowed, async (req, res) => {
    const apiKey = req.session.apiKey;
    try {
      // Drop publisher from nginx first — this kills the incoming stream,
      // causing all ffmpeg processes to receive EOF and exit naturally.
      await relayManager.dropPublisher(apiKey);
      // Also stop any remaining ffmpeg procs (in case control API is unavailable)
      await relayManager.stopKey(apiKey);
    } catch (err) {
      logger.warn(`[stream] stop all / drop publisher failed: ${err.message}`);
    }
    const count = deleteAllRelays(db, apiKey);
    return res.status(200).json({ ok: true, deleted: count });
  });

  return router;
}