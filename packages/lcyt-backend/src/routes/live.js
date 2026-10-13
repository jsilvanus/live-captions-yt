import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import logger from 'lcyt/logger';
import { YoutubeLiveCaptionSender } from 'lcyt';
import { setSessionSequence, validateApiKey, writeSessionStat, writeAuthEvent, incrementDomainHourlySessionStart, incrementDomainHourlySessionEnd, saveSession, getKeySequence, updateKeySequence, resetKeySequence, isGraphicsEnabled, getCaptionTargets, bindSessionStart, autoCreateForSession, completeBroadcast, getBroadcast, armOnGoLive, disarmOnEnd, loadSession } from '../db.js';
import { makeSessionId } from '../store.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { isAllowedDomain } from '../lib/allowed-domains.js';
import { startVideoRecording, finishVideoRecording } from '../db/videos.js';
import { configureMediaMtxRecording, finalizeVideoRecording } from '../recording/recorder.js';
import { getMetricsInstance } from '../metrics/index.js';
import { buildExtraTargets } from '../session-targets.js';

/**
 * Relay-slot lookup used only for the `recordOnStart` check (plan/broadcasts).
 * Must never make session start or the recording-toggle route fail just
 * because the RTMP plugin's tables aren't present — e.g. RTMP_RELAY_ACTIVE
 * was never enabled on this deployment, or a test harness builds this router
 * without also running `initRtmpControl`/`runMigrations`. A synchronous throw
 * here (uncaught) previously became an unhandled rejection in the async route
 * handler — Express 4 never awaits the handler, so no response was ever sent
 * and the client's request hung indefinitely instead of erroring.
 */
async function safeGetRelaySlots(db, apiKey) {
  try {
    // Prisma, not lcyt-rtmp's getRelays(): that helper runs synchronous SQL on the legacy SQLite handle.
    const rows = await db.rtmp_relays.findMany({ where: { api_key: apiKey }, orderBy: { slot: 'asc' } });
    return rows.map(r => ({
      slot: r.slot,
      recordOnStart: r.record_on_start === 1,
      recordOnButton: r.record_on_button === 1,
    }));
  } catch (err) {
    logger.warn(`[live] getRelaySlots failed for ${apiKey}: ${err?.message}`);
    return [];
  }
}

// MediaMTX may still be flushing the final segment right after the record:false patch is
// acknowledged; finalize waits for the files to settle, builds the HLS VOD and uploads it.
function scheduleRecordingStorageSync(db, apiKey, videoId, delayMs = 3000, recordingsStore = null) {
  setTimeout(() => {
    finalizeVideoRecording(db, apiKey, videoId, { recordingsStore }).catch((err) => {
      logger.warn(`[videos] recording finalize failed (videoId=${videoId}): ${err?.message}`);
    });
  }, delayMs).unref?.();
}

async function startSessionRecording(db, session, { mediamtxClient, recordingsStore = null }) {
  if (!session?.apiKey) return { ok: false, status: 400, error: 'apiKey missing' };
  if (session.recordingVideoId) {
    return { ok: true, active: true };
  }
  const videoResult = await startVideoRecording(db, session.apiKey, {
    broadcastId: session.broadcastId || null,
    title: 'Recorded broadcast',
    startedAt: new Date().toISOString(),
    storageType: recordingsStore?.type === 's3' ? 's3' : 'local',
  });
  if (!videoResult.ok) return videoResult;
  session.recordingVideoId = videoResult.video.id;
  const keyRow = await db.api_keys.findUnique({ where: { key: session.apiKey }, select: { ingest_stream_key: true } });
  const recordingPathName = keyRow?.ingest_stream_key || session.apiKey;
  await configureMediaMtxRecording(mediamtxClient, {
    pathName: recordingPathName,
    apiKey: session.apiKey, videoId: videoResult.video.id,
    enabled: true,
  });
  return { ok: true, active: true, video: videoResult.video };
}

async function stopSessionRecording(db, session, { mediamtxClient, recordingsStore = null }, recordingUploadDelayMs = 3000) {
  if (!session?.recordingVideoId) {
    return { ok: true, active: false };
  }
  const recordingVideoId = session.recordingVideoId;
  const endedAt = new Date().toISOString();
  const startedAtMs = Number.isFinite(Number(session.startedAt))
    ? Number(session.startedAt)
    : Date.parse(session.startedAt || new Date().toISOString());
  await finishVideoRecording(db, session.apiKey, recordingVideoId, {
    status: 'processing',
    endedAt,
    durationMs: Math.max(0, Date.now() - startedAtMs),
  });
  const keyRow = await db.api_keys.findUnique({ where: { key: session.apiKey }, select: { ingest_stream_key: true } });
  const recordingPathName = keyRow?.ingest_stream_key || session.apiKey;
  await configureMediaMtxRecording(mediamtxClient, {
    pathName: recordingPathName,
    apiKey: session.apiKey, videoId: recordingVideoId,
    enabled: false,
  });
  session.recordingVideoId = null;
  scheduleRecordingStorageSync(db, session.apiKey, recordingVideoId, recordingUploadDelayMs, recordingsStore);
  return { ok: true, active: false };
}

/**
 * Factory for the /live router.
 *
 * POST   /live  — Register a new session (or return existing JWT, idempotent)
 * GET    /live  — Get current session status (sequence + syncOffset)
 * DELETE /live  — Tear down session and clean up sender
 * PATCH  /live  — Update session fields (e.g. sequence)
 * 
 * @param {import('better-sqlite3').Database} db
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @param {{ mediamtxClient?: object | null }} [opts]
 * @returns {Router}
 */
export function createLiveRouter(db, store, jwtSecret, { mediamtxClient = null, recordingsStore = null, settings = null } = {}) {
  const router = Router();
  const auth = createAuthMiddleware(jwtSecret);
  const recordingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const recordingUploadDelayMs = settings ? settings.get('retention.recording_upload_delay_ms') : (Number(process.env.RECORDING_UPLOAD_DELAY_MS) || 3000);

  // POST /live — Register session
  router.post('/', async (req, res) => {
    const { apiKey, streamKey, domain, sequence: startSeqRaw, targets, broadcastId, recordEnabled: broadcastRecordEnabled } = req.body || {};

    // Validate required fields (streamKey is optional — targets array supersedes it)
    if (!apiKey || !domain) {
      return res.status(400).json({ error: 'apiKey and domain are required' });
    }

    // Check domain allowlist
    if (!isAllowedDomain(domain)) {
      await writeAuthEvent(db, { apiKey, eventType: 'domain_not_allowed', domain });
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    // Validate API key against SQLite
    const validation = await validateApiKey(db, apiKey);
    if (!validation.valid) {
      await writeAuthEvent(db, { apiKey, eventType: validation.reason, domain });
      const status = validation.reason === 'expired' ? 401 : 401;
      return res.status(status).json({ error: `API key ${validation.reason}` });
    }

    // Generate deterministic session ID. streamKey defaults to '' for sessions
    // that use only the targets array (no primary stream key).
    // When reconnecting without streamKey, we need to check the database for
    // the original streamKey to ensure consistent session ID.
    let effectiveStreamKey = streamKey || '';
    let sessionId = makeSessionId(apiKey, effectiveStreamKey, domain);
    
    // If session not found in memory and no streamKey was provided,
    // try loading from database with the default empty streamKey first
    if (!(await store.getOrLoad(sessionId)) && !streamKey) {
      try {
        const dbSession = await loadSession(db, sessionId);
        if (dbSession && dbSession.streamKey) {
          effectiveStreamKey = dbSession.streamKey;
          sessionId = makeSessionId(apiKey, effectiveStreamKey, domain);
        }
      } catch (_) {
        // DB lookup failed or session doesn't exist, continue with empty streamKey
      }
    }

    // Idempotent: if session already exists, return existing JWT. If session
    // was rehydrated (no in-memory sender) and has no JWT, generate a fresh
    // token so the client can obtain a usable Bearer token and open SSE.
    const existing = await store.getOrLoad(sessionId);
    if (existing) {

      // Only touch the running session's targets when the caller explicitly
      // supplied a `targets` field (including an explicit empty array) —
      // omitting it entirely on a reconnect must not wipe the session's
      // already-configured targets (see buildExtraTargets()'s docstring).
      if (targets !== undefined) {
        const targetsResult = await buildExtraTargets(targets);
        if (!targetsResult.ok) {
          return res.status(400).json({ error: targetsResult.error });
        }
        // Clean up old secondary senders first
        const cleanupPromises = [];
        for (const t of (existing.extraTargets || [])) {
          if (t.type === 'youtube' && t.sender) {
            cleanupPromises.push(Promise.resolve(t.sender.end()).catch(() => {}));
          }
        }
        if (cleanupPromises.length > 0) {
          await Promise.all(cleanupPromises);
        }
        existing.extraTargets = targetsResult.extraTargets;
        existing.rawTargets = targetsResult.rawTargets;
        store.saveRuntimeData(existing);
      }

      // Recreate primary sender for rehydrated sessions that have no active sender,
      // but only when a streamKey is available (target-array sessions have no primary sender).
      if (!existing.sender && streamKey) {
        const keySeq = await getKeySequence(db, apiKey);
        const newSender = new YoutubeLiveCaptionSender({ streamKey, sequence: keySeq });
        try {
          newSender.start();
          existing.sender = newSender;
        } catch (err) {
          // start() failed — do not attach a half-initialised sender; proceed without
        }
      }

      // Re-issue JWT when missing (e.g. after server restart + rehydrate)
      if (!existing.jwt) {
        const sessionTtlMs = settings ? settings.get('retention.session_ttl') : (Number(process.env.SESSION_TTL) || 2 * 60 * 60 * 1000);
        const newToken = jwt.sign({ sessionId, apiKey }, jwtSecret, { expiresIn: Math.floor(sessionTtlMs / 1000) });
        existing.jwt = newToken;
        // Persist updated metadata so future rehydrates have consistent state
        try {
          await saveSession(db, {
            sessionId: existing.sessionId || sessionId,
            apiKey: existing.apiKey || apiKey,
            streamKey: existing.streamKey ?? streamKey ?? null,
            domain: existing.domain || domain,
            sequence: existing.sequence || 0,
            startedAt: existing.startedAt || new Date().toISOString(),
            lastActivity: existing.lastActivity || new Date().toISOString(),
            syncOffset: existing.syncOffset || 0,
            data: existing.data || null
          });
        } catch (err) {
          // persist failure is non-fatal; proceed with in-memory token
        }
      }

      store.touch(sessionId);
      res.setHeader('Access-Control-Allow-Origin', domain);
      return res.status(200).json({
        token: existing.jwt,
        sessionId,
        sequence: existing.sequence,
        syncOffset: existing.syncOffset,
        startedAt: existing.startedAt,
        graphicsEnabled: await isGraphicsEnabled(db, apiKey),
      });
    }

    // Build extra targets (validates URLs, creates secondary YouTube senders).
    // Omitting `targets` entirely loads the project's saved caption-target
    // defaults, so a thin client can start a session with just { apiKey, domain }.
    const targetsResult = await buildExtraTargets(targets, { db, apiKey });
    if (!targetsResult.ok) {
      return res.status(400).json({ error: targetsResult.error });
    }
    const extraTargets = targetsResult.extraTargets;

    // Create primary sender when a streamKey is provided.
    // When operating in target-array mode (no streamKey), sender remains null
    // and all caption delivery uses the extraTargets array.
    const keySeq = await getKeySequence(db, apiKey);
    const initialSeq = startSeqRaw !== undefined ? Number(startSeqRaw) : keySeq;
    let sender = null;
    let syncOffset = 0;

    if (streamKey) {
      sender = new YoutubeLiveCaptionSender({ streamKey, sequence: initialSeq });
      sender.start();
      // Initial sync — best-effort
      try {
        const syncResult = await sender.sync();
        syncOffset = syncResult.syncOffset;
      } catch {
        // Not fatal — proceed without sync
      }
    }

    // Bind this session to a broadcast (plan/broadcasts). An explicit broadcastId
    // binds an existing broadcast (rejected if it already has a live session);
    // omitting it auto-creates a fresh `live` broadcast so every session always
    // has exactly one and produced content attaches back to it.
    let boundBroadcastId = null;
    let recordingVideo = null;
    if (broadcastId) {
      const bind = await bindSessionStart(db, apiKey, broadcastId, { recordEnabled: broadcastRecordEnabled });
      if (!bind.ok) return res.status(bind.status || 400).json({ error: bind.error });
      boundBroadcastId = broadcastId;
    } else {
      boundBroadcastId = (await autoCreateForSession(db, apiKey, { recordEnabled: broadcastRecordEnabled })).id;
    }
    // Going live arms production (plan_backend_actions.md); the operator can override.
    await armOnGoLive(db, store.eventBus, apiKey, boundBroadcastId);

    const broadcast = boundBroadcastId ? await getBroadcast(db, apiKey, boundBroadcastId) : null;
    const relaySlots = await safeGetRelaySlots(db, apiKey);
    const shouldRecord = Boolean(broadcastRecordEnabled) || Boolean(broadcast?.recordEnabled) || relaySlots.some(slot => slot.recordOnStart);
    if (shouldRecord) {
      const videoResult = await startVideoRecording(db, apiKey, {
        broadcastId: boundBroadcastId,
        title: broadcast?.title || 'Recorded broadcast',
        startedAt: new Date().toISOString(),
        storageType: recordingsStore?.type === 's3' ? 's3' : 'local',
      });
      if (videoResult.ok) {
        recordingVideo = videoResult.video;
        const keyRow = await db.api_keys.findUnique({ where: { key: apiKey }, select: { ingest_stream_key: true } });
        const recordingPathName = keyRow?.ingest_stream_key || apiKey;
        await configureMediaMtxRecording(mediamtxClient, {
          pathName: recordingPathName,
          apiKey, videoId: recordingVideo.id,
          enabled: true,
        });
      }
    }

    // Sign JWT — omit streamKey and domain from payload (sensitive; not needed by route handlers)
    const sessionTtlMs = settings ? settings.get('retention.session_ttl') : (Number(process.env.SESSION_TTL) || 2 * 60 * 60 * 1000);
    const token = jwt.sign({ sessionId, apiKey }, jwtSecret, { expiresIn: Math.floor(sessionTtlMs / 1000) });

    // Store session
    const session = store.create({
      apiKey,
      streamKey: streamKey || null,
      domain,
      jwt: token,
      sequence: sender ? sender.sequence : initialSeq,
      syncOffset,
      sender,
      extraTargets,
    });
    session.broadcastId = boundBroadcastId;
    session.recordingVideoId = recordingVideo?.id ?? null;
    // What another instance needs to rebuild this session (see SessionStore.getOrLoad).
    session.rawTargets = targetsResult.rawTargets;
    store.saveRuntimeData(session);

    await incrementDomainHourlySessionStart(db, domain, store.size());
    // sessions.count / sessions.seconds are tallied by the bus tap on
    // session.closed; only the concurrency peak needs a start-path hook.
    getMetricsInstance()?.max('sessions.peak_concurrent', store.size(), { project: apiKey });

    res.setHeader('Access-Control-Allow-Origin', domain);
    return res.status(200).json({
      token,
      sessionId,
      sequence: session.sequence,
      syncOffset: session.syncOffset,
      startedAt: session.startedAt,
      broadcastId: boundBroadcastId,
      graphicsEnabled: await isGraphicsEnabled(db, apiKey),
    });
  });

  // POST /live/recording — Start/stop recording for this session.
  router.post('/recording', recordingLimiter, auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = await store.getOrLoad(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const { enabled, slot } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    const slotNumber = slot === undefined ? undefined : Number(slot);
    if (slot !== undefined && (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 4)) {
      return res.status(400).json({ error: 'slot must be an integer between 1 and 4' });
    }
    const relaySlots = await safeGetRelaySlots(db, session.apiKey);
    const matchingSlot = slotNumber === undefined
      ? relaySlots.find(item => item.recordOnButton)
      : relaySlots.find(item => item.slot === slotNumber);
    if (!matchingSlot) {
      return res.status(400).json({ error: 'No relay slot is configured for manual recording' });
    }
    if (!matchingSlot.recordOnButton) {
      return res.status(400).json({ error: 'This relay slot is not configured for manual recording' });
    }
    if (enabled) {
      const result = await startSessionRecording(db, session, { mediamtxClient, recordingsStore });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Failed to start recording' });
      store.saveRuntimeData(session);
      return res.status(200).json({ ok: true, recording: true });
    }
    const result = await stopSessionRecording(db, session, { mediamtxClient, recordingsStore }, recordingUploadDelayMs);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Failed to stop recording' });
    store.saveRuntimeData(session);
    return res.status(200).json({ ok: true, recording: false });
  });

  // GET /live — Session status
  router.get('/', auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = await store.getOrLoad(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    store.touch(sessionId);
    return res.status(200).json({
      sequence: session.sequence,
      syncOffset: session.syncOffset
    });
  });

  // PATCH /live — Update session fields (e.g. sequence, targets)
  router.patch('/', auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = await store.getOrLoad(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { sequence, targets } = req.body || {};

    if (sequence !== undefined) {
      const seq = Number(sequence);
      if (!Number.isFinite(seq) || seq < 0) {
        return res.status(400).json({ error: 'sequence must be a non-negative number' });
      }
      try {
        if (typeof session.sender?.setSequence === 'function') {
          session.sender.setSequence(seq);
        }
      } catch (err) {
        // Ignore sender errors but continue to update session value
      }
      session.sequence = seq;
      // An explicit set may lower the stored value (touch() only ever raises it).
      try { await setSessionSequence(db, sessionId, seq); } catch (_) {}
      // Persist to per-API-key store; seq=0 is an explicit reset (clears last_caption_at)
      if (db) {
        try {
          if (seq === 0) {
            await resetKeySequence(db, session.apiKey);
          } else {
            await updateKeySequence(db, session.apiKey, seq);
          }
        } catch (_) {}
      }
      store.touch(sessionId);
    }

    if (targets !== undefined) {
      // Validate and build the new extra targets
      const result = await buildExtraTargets(targets);
      if (!result.ok) {
        if (session.domain) res.setHeader('Access-Control-Allow-Origin', session.domain);
        return res.status(400).json({ error: result.error });
      }
      // Clean up old secondary YouTube senders before replacing
      for (const t of (session.extraTargets || [])) {
        if (t.type === 'youtube' && t.sender) {
          t.sender.end().catch(err => {
            logger.warn(`[live] Failed to end extra YouTube target ${t.id} during PATCH: ${err?.message}`);
          });
        }
      }
      session.extraTargets = result.extraTargets;
      session.rawTargets = result.rawTargets;
      store.saveRuntimeData(session);
      store.touch(sessionId);
    }

    // Echo CORS allow-origin for clients that expect it (domain comes from the JWT)
    if (session.domain) res.setHeader('Access-Control-Allow-Origin', session.domain);

    return res.status(200).json({ sequence: session.sequence, targetsCount: session.extraTargets?.length ?? 0 });
  });

  // DELETE /live — Remove session
  router.delete('/', auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = await store.getOrLoad(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Clean up primary sender (null in target-array mode — safe with optional chaining)
    try {
      await session.sender?.end();
    } catch {
      // Best-effort cleanup
    }

    // Clean up extra YouTube target senders
    for (const t of (session.extraTargets || [])) {
      if (t.type === 'youtube' && t.sender) {
        t.sender.end();
      }
    }

    const removed = store.remove(sessionId);
    if (removed) {
      const durationMs = Date.now() - removed.startedAt;
      const endedAt = new Date().toISOString();
      await writeSessionStat(db, {
        sessionId: removed.sessionId,
        apiKey: removed.apiKey,
        domain: removed.domain,
        startedAt: new Date(removed.startedAt).toISOString(),
        endedAt,
        durationMs,
        captionsSent: removed.captionsSent,
        captionsFailed: removed.captionsFailed,
        finalSequence: removed.sequence,
        endedBy: 'client',
        broadcastId: removed.broadcastId ?? null,
      });
      if (removed.recordingVideoId) {
        try {
          const startedAtMs = Number.isFinite(Number(removed.startedAt))
            ? Number(removed.startedAt)
            : Date.parse(removed.startedAt);
          await finishVideoRecording(db, removed.apiKey, removed.recordingVideoId, {
            status: 'processing',
            endedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
          });
          const keyRow = await db.api_keys.findUnique({ where: { key: removed.apiKey }, select: { ingest_stream_key: true } });
          const recordingPathName = keyRow?.ingest_stream_key || removed.apiKey;
          await configureMediaMtxRecording(mediamtxClient, {
            pathName: recordingPathName,
            apiKey: removed.apiKey, videoId: removed.recordingVideoId,
            enabled: false,
          });
          scheduleRecordingStorageSync(db, removed.apiKey, removed.recordingVideoId, recordingUploadDelayMs, recordingsStore);
        } catch (err) {
          logger.warn(`[videos] finishVideoRecording failed (videoId=${removed.recordingVideoId})`, err);
        }
      }
      // Transition the bound broadcast to completed (plan/broadcasts).
      if (removed.broadcastId) {
        try {
          await disarmOnEnd(db, store.eventBus, removed.apiKey, removed.broadcastId);
          await completeBroadcast(db, removed.broadcastId, {
            youtubeVideoIds: removed.youtubeVideoIds,
            endedAt,
          });
        } catch (err) {
          logger.warn(`[broadcasts] completeBroadcast failed (broadcastId=${removed.broadcastId})`, err);
        }
      }
      await incrementDomainHourlySessionEnd(db, removed.domain, durationMs);
    }
    return res.status(200).json({ removed: true, sessionId });
  });

  return router;
}
