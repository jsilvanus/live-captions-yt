import { Router } from 'express';
import { isRelayAllowed, isRelayActive, setRelayActive, getRelays, getRelaySlot, upsertRelay, deleteRelaySlot, deleteAllRelays, getRtmpStreamStats } from '../db.js';

const MAX_RELAY_SLOTS = 4;

/**
 * Factory for the /stream router.
 *
 * Authenticated (JWT Bearer) CRUD for per-key RTMP relay configuration.
 * One incoming stream fans out to up to 4 target slots.
 * The API key must have relay_allowed = true.
 *
 * POST   /stream              — create/replace a relay slot (body: { slot?, targetUrl, targetName?, captionMode? })
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
export function createStreamRouter(db, auth, relayManager) {
  const router = Router();

  // Middleware: check relay_allowed for this API key
  function requireRelayAllowed(req, res, next) {
    const apiKey = req.session?.apiKey;
    if (!apiKey || !isRelayAllowed(db, apiKey)) {
      return res.status(403).json({ error: 'RTMP relay not enabled for this API key' });
    }
    next();
  }

  function validateBody(req, res) {
    const { targetUrl, targetName, captionMode } = req.body || {};
    if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith('rtmp')) {
      res.status(400).json({ error: 'targetUrl must be a valid rtmp:// or rtmps:// URL' });
      return null;
    }
    const validModes = ['http'];
    const resolvedMode = validModes.includes(captionMode) ? captionMode : 'http';
    return {
      targetUrl:   targetUrl.trim(),
      targetName:  (typeof targetName === 'string' && targetName.trim()) ? targetName.trim() : null,
      captionMode: resolvedMode,
    };
  }

  function parseSlot(raw, res) {
    const slot = Number(raw);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_RELAY_SLOTS) {
      res.status(400).json({ error: `slot must be an integer between 1 and ${MAX_RELAY_SLOTS}` });
      return null;
    }
    return slot;
  }

  // POST /stream — create or replace a relay slot
  router.post('/', auth, requireRelayAllowed, (req, res) => {
    const fields = validateBody(req, res);
    if (!fields) return;
    const slotRaw = req.body?.slot ?? 1;
    const slot = parseSlot(String(slotRaw), res);
    if (slot === null) return;

    // Check max slots: don't allow more than MAX_RELAY_SLOTS distinct slots
    const existing = getRelays(db, req.session.apiKey);
    const isNewSlot = !existing.find(r => r.slot === slot);
    if (isNewSlot && existing.length >= MAX_RELAY_SLOTS) {
      return res.status(400).json({ error: `Maximum of ${MAX_RELAY_SLOTS} relay targets per key` });
    }

    try {
      const relay = upsertRelay(db, req.session.apiKey, slot, fields.targetUrl, {
        targetName:  fields.targetName,
        captionMode: fields.captionMode,
      });
      return res.status(201).json({ ok: true, relay });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // GET /stream — get all slots + running status per slot + relay active state
  router.get('/', auth, requireRelayAllowed, (req, res) => {
    const relays = getRelays(db, req.session.apiKey);
    const runningSlots = relayManager.runningSlots(req.session.apiKey);
    const active = isRelayActive(db, req.session.apiKey);
    return res.status(200).json({ relays, runningSlots, active });
  });

  // GET /stream/history — per-stream usage history for this key
  router.get('/history', auth, requireRelayAllowed, (req, res) => {
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
  router.put('/active', auth, requireRelayAllowed, async (req, res) => {
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
            await relayManager.startAll(apiKey, relays);
          } catch (err) {
            console.warn(`[stream] Failed to start fan-out on relay activate: ${err.message}`);
          }
        }
      }
    } else {
      // Deactivate: stop all running ffmpeg processes.
      // The nginx publisher keeps the incoming stream alive (not dropped).
      try {
        await relayManager.stopKey(apiKey);
      } catch (err) {
        console.warn(`[stream] Failed to stop relay on deactivate: ${err.message}`);
      }
    }

    return res.status(200).json({ ok: true, active });
  });

  // PUT /stream/:slot — update a specific slot
  router.put('/:slot', auth, requireRelayAllowed, (req, res) => {
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
        targetName:  fields.targetName,
        captionMode: fields.captionMode,
      });
      return res.status(200).json({ ok: true, relay });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // DELETE /stream/:slot — remove slot config and restart relay with remaining targets
  router.delete('/:slot', auth, requireRelayAllowed, async (req, res) => {
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
          await relayManager.start(apiKey, remaining);
        } catch (err) {
          console.warn(`[stream] Failed to restart relay after slot ${slot} removal: ${err.message}`);
        }
      } else {
        // No targets left — stop the process entirely.
        try {
          await relayManager.stop(apiKey);
        } catch (err) {
          console.warn(`[stream] Failed to stop relay after removing last slot: ${err.message}`);
        }
      }
    }

    return res.status(200).json({ ok: true, slot, deleted });
  });

  // DELETE /stream — stop all slots, drop publisher from nginx, delete all configs
  router.delete('/', auth, requireRelayAllowed, async (req, res) => {
    const apiKey = req.session.apiKey;
    try {
      // Drop publisher from nginx first — this kills the incoming stream,
      // causing all ffmpeg processes to receive EOF and exit naturally.
      await relayManager.dropPublisher(apiKey);
      // Also stop any remaining ffmpeg procs (in case control API is unavailable)
      await relayManager.stopKey(apiKey);
    } catch (err) {
      console.warn(`[stream] stop all / drop publisher failed: ${err.message}`);
    }
    const count = deleteAllRelays(db, apiKey);
    return res.status(200).json({ ok: true, deleted: count });
  });

  return router;
}
