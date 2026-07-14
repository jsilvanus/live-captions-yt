import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import logger from 'lcyt/logger';
import { YoutubeLiveCaptionSender } from 'lcyt';
import { validateApiKey, writeSessionStat, writeAuthEvent, incrementDomainHourlySessionStart, incrementDomainHourlySessionEnd, saveSession, getKeySequence, updateKeySequence, resetKeySequence, isGraphicsEnabled, getCaptionTargets, bindSessionStart, autoCreateForSession, completeBroadcast, getBroadcast } from '../db.js';
import { makeSessionId } from '../store.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { isAllowedDomain } from '../lib/allowed-domains.js';
import { startVideoRecording, finishVideoRecording, getVideoStorageDir } from '../db/videos.js';
import { isS3Enabled } from '../storage/s3.js';
import { getRelays as getRelaySlots } from 'lcyt-rtmp/src/db/relay.js';

/**
 * Validate and build the extraTargets array from the client-supplied targets list.
 * Returns { ok: true, extraTargets } or { ok: false, error }.
 *
 * Each enabled YouTube target gets a new YoutubeLiveCaptionSender started.
 * Each enabled generic target is stored with its parsed headers object.
 *
 * When `targets` is `undefined` (the field was omitted entirely, as opposed to
 * an explicit empty array) and `db`/`apiKey` are supplied, the project's saved
 * caption-target defaults are loaded and used instead — this lets a thin client
 * start a session with just `{ apiKey, domain }` and still get its configured
 * delivery targets. An explicit array (including `[]`) is always used as-is.
 *
 * @param {Array|undefined} targets  Raw array from POST/PATCH /live body
 * @param {{ db?: import('better-sqlite3').Database, apiKey?: string }} [opts]
 * @returns {{ ok: boolean, extraTargets?: Array, error?: string }}
 */
async function buildExtraTargets(targets, { db, apiKey } = {}) {
  if (targets === undefined) {
    targets = (db && apiKey)
      ? getCaptionTargets(db, apiKey)
        .filter(t => t.enabled)
        .map(t => ({ id: t.id, type: t.type, streamKey: t.streamKey, url: t.url, headers: t.headers, viewerKey: t.viewerKey, noBatch: t.noBatch }))
      : [];
  }
  if (!Array.isArray(targets) || targets.length === 0) return { ok: true, extraTargets: [] };

  const extraTargets = [];
  for (const target of targets) {
    if (!target || !['youtube', 'generic', 'viewer'].includes(target.type)) {
      return { ok: false, error: `Invalid target type: ${target?.type}` };
    }

    if (target.type === 'youtube') {
      if (!target.streamKey || typeof target.streamKey !== 'string') continue;
      const sender = new YoutubeLiveCaptionSender({ streamKey: target.streamKey.trim() });
      try { sender.start(); } catch (err) {
        logger.warn(`[live] Failed to start extra YouTube target ${target.id}: ${err?.message}`);
      }
      extraTargets.push({ id: target.id, type: 'youtube', sender });

    } else if (target.type === 'generic') {
      if (!target.url || typeof target.url !== 'string') {
        return { ok: false, error: 'Generic target requires a url field' };
      }
      try {
        const u = new URL(target.url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
          return { ok: false, error: `Generic target URL must use http or https: ${target.url}` };
        }
      } catch {
        return { ok: false, error: `Invalid generic target URL: ${target.url}` };
      }
      // headers arrive pre-parsed as an object (the client JSON.parse'd the textarea string)
      const headers = (target.headers && typeof target.headers === 'object' && !Array.isArray(target.headers))
        ? target.headers
        : {};
      extraTargets.push({ id: target.id, type: 'generic', url: target.url, headers });

    } else if (target.type === 'viewer') {
      if (!target.viewerKey || typeof target.viewerKey !== 'string') {
        return { ok: false, error: 'Viewer target requires a viewerKey field' };
      }
      if (!/^[a-zA-Z0-9_-]{3,}$/.test(target.viewerKey)) {
        return { ok: false, error: `Invalid viewerKey "${target.viewerKey}": must be at least 3 characters (letters, digits, hyphens, underscores)` };
      }
      extraTargets.push({ id: target.id, type: 'viewer', viewerKey: target.viewerKey });
    }
  }
  return { ok: true, extraTargets };
}

async function configureMediaMtxRecording(mediamtxClient, { pathName, videoDir, enabled }) {
  if (!mediamtxClient || !pathName) return;
  const config = enabled
    ? {
        record: 'yes',
        recordFormat: 'fmp4',
        recordPath: videoDir,
        recordSegmentDuration: '4s',
        recordDeleteAfter: 0,
      }
    : { record: 'no' };

  try {
    try {
      await mediamtxClient.addPath(pathName, { source: 'publisher' });
    } catch (err) {
      if (err?.statusCode && [400, 404, 409, 422].includes(err.statusCode)) {
        // Path already exists or is not yet configured; continue to patch it.
      } else {
        throw err;
      }
    }
    await mediamtxClient.patchPath(pathName, config);
  } catch (err) {
    logger.warn(`[videos] MediaMTX recording ${enabled ? 'start' : 'stop'} failed for ${pathName}: ${err?.message}`);
  }
}

async function startSessionRecording(db, session, { mediamtxClient }) {
  if (!session?.apiKey) return { ok: false, status: 400, error: 'apiKey missing' };
  if (session.recordingVideoId) {
    return { ok: true, active: true };
  }
  const videoResult = startVideoRecording(db, session.apiKey, {
    broadcastId: session.broadcastId || null,
    title: 'Recorded broadcast',
    startedAt: new Date().toISOString(),
    storageType: isS3Enabled() ? 's3' : 'local',
  });
  if (!videoResult.ok) return videoResult;
  session.recordingVideoId = videoResult.video.id;
  const recordingPathName = session.streamKey || session.apiKey;
  const recordingVideoDir = getVideoStorageDir(session.apiKey, videoResult.video.id);
  await configureMediaMtxRecording(mediamtxClient, {
    pathName: recordingPathName,
    videoDir: recordingVideoDir,
    enabled: true,
  });
  return { ok: true, active: true, video: videoResult.video };
}

async function stopSessionRecording(db, session, { mediamtxClient }) {
  if (!session?.recordingVideoId) {
    return { ok: true, active: false };
  }
  const recordingVideoId = session.recordingVideoId;
  const endedAt = new Date().toISOString();
  const startedAtMs = Number.isFinite(Number(session.startedAt))
    ? Number(session.startedAt)
    : Date.parse(session.startedAt || new Date().toISOString());
  finishVideoRecording(db, session.apiKey, recordingVideoId, {
    endedAt,
    durationMs: Math.max(0, Date.now() - startedAtMs),
  });
  await configureMediaMtxRecording(mediamtxClient, {
    pathName: session.streamKey || session.apiKey,
    videoDir: getVideoStorageDir(session.apiKey, recordingVideoId),
    enabled: false,
  });
  session.recordingVideoId = null;
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
export function createLiveRouter(db, store, jwtSecret, { mediamtxClient = null } = {}) {
  const router = Router();
  const auth = createAuthMiddleware(jwtSecret);
  const recordingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // POST /live — Register session
  router.post('/', async (req, res) => {
    const { apiKey, streamKey, domain, sequence: startSeqRaw, targets, broadcastId, recordEnabled: broadcastRecordEnabled } = req.body || {};

    // Validate required fields (streamKey is optional — targets array supersedes it)
    if (!apiKey || !domain) {
      return res.status(400).json({ error: 'apiKey and domain are required' });
    }

    // Check domain allowlist
    if (!isAllowedDomain(domain)) {
      writeAuthEvent(db, { apiKey, eventType: 'domain_not_allowed', domain });
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    // Validate API key against SQLite
    const validation = validateApiKey(db, apiKey);
    if (!validation.valid) {
      writeAuthEvent(db, { apiKey, eventType: validation.reason, domain });
      const status = validation.reason === 'expired' ? 401 : 401;
      return res.status(status).json({ error: `API key ${validation.reason}` });
    }

    // Generate deterministic session ID. streamKey defaults to '' for sessions
    // that use only the targets array (no primary stream key).
    const sessionId = makeSessionId(apiKey, streamKey || '', domain);

    // Idempotent: if session already exists, return existing JWT. If session
    // was rehydrated (no in-memory sender) and has no JWT, generate a fresh
    // token so the client can obtain a usable Bearer token and open SSE.
    if (store.has(sessionId)) {
      const existing = store.get(sessionId);

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
        for (const t of (existing.extraTargets || [])) {
          if (t.type === 'youtube' && t.sender) {
            Promise.resolve(t.sender.end()).catch(() => {});
          }
        }
        existing.extraTargets = targetsResult.extraTargets;
      }

      // Recreate primary sender for rehydrated sessions that have no active sender,
      // but only when a streamKey is available (target-array sessions have no primary sender).
      if (!existing.sender && streamKey) {
        const keySeq = getKeySequence(db, apiKey);
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
        const sessionTtlMs = Number(process.env.SESSION_TTL) || 2 * 60 * 60 * 1000;
        const newToken = jwt.sign({ sessionId, apiKey }, jwtSecret, { expiresIn: Math.floor(sessionTtlMs / 1000) });
        existing.jwt = newToken;
        // Persist updated metadata so future rehydrates have consistent state
        try {
          saveSession(db, {
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
        graphicsEnabled: isGraphicsEnabled(db, apiKey),
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
    const keySeq = getKeySequence(db, apiKey);
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
      const bind = bindSessionStart(db, apiKey, broadcastId, { recordEnabled: broadcastRecordEnabled });
      if (!bind.ok) return res.status(bind.status || 400).json({ error: bind.error });
      boundBroadcastId = broadcastId;
    } else {
      boundBroadcastId = autoCreateForSession(db, apiKey, { recordEnabled: broadcastRecordEnabled }).id;
    }

    const broadcast = boundBroadcastId ? getBroadcast(db, apiKey, boundBroadcastId) : null;
    const relaySlots = getRelaySlots(db, apiKey);
    const shouldRecord = Boolean(broadcastRecordEnabled) || Boolean(broadcast?.recordEnabled) || relaySlots.some(slot => slot.recordOnStart);
    if (shouldRecord) {
      const videoResult = startVideoRecording(db, apiKey, {
        broadcastId: boundBroadcastId,
        title: broadcast?.title || 'Recorded broadcast',
        startedAt: new Date().toISOString(),
        storageType: isS3Enabled() ? 's3' : 'local',
      });
      if (videoResult.ok) {
        recordingVideo = videoResult.video;
        const recordingPathName = streamKey || apiKey;
        const recordingVideoDir = getVideoStorageDir(apiKey, recordingVideo.id);
        await configureMediaMtxRecording(mediamtxClient, {
          pathName: recordingPathName,
          videoDir: recordingVideoDir,
          enabled: true,
        });
      }
    }

    // Sign JWT — omit streamKey and domain from payload (sensitive; not needed by route handlers)
    const sessionTtlMs = Number(process.env.SESSION_TTL) || 2 * 60 * 60 * 1000;
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

    incrementDomainHourlySessionStart(db, domain, store.size());

    res.setHeader('Access-Control-Allow-Origin', domain);
    return res.status(200).json({
      token,
      sessionId,
      sequence: session.sequence,
      syncOffset: session.syncOffset,
      startedAt: session.startedAt,
      broadcastId: boundBroadcastId,
      graphicsEnabled: isGraphicsEnabled(db, apiKey),
    });
  });

  // POST /live/recording — Start/stop recording for this session.
  router.post('/recording', recordingLimiter, auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);
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
    const relaySlots = getRelaySlots(db, session.apiKey);
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
      const result = await startSessionRecording(db, session, { mediamtxClient });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Failed to start recording' });
      return res.status(200).json({ ok: true, recording: true });
    }
    const result = await stopSessionRecording(db, session, { mediamtxClient });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Failed to stop recording' });
    return res.status(200).json({ ok: true, recording: false });
  });

  // GET /live — Session status
  router.get('/', auth, (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);

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
    const session = store.get(sessionId);

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
      // Persist to per-API-key store; seq=0 is an explicit reset (clears last_caption_at)
      if (db) {
        try {
          if (seq === 0) {
            resetKeySequence(db, session.apiKey);
          } else {
            updateKeySequence(db, session.apiKey, seq);
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
      store.touch(sessionId);
    }

    // Echo CORS allow-origin for clients that expect it (domain comes from the JWT)
    if (session.domain) res.setHeader('Access-Control-Allow-Origin', session.domain);

    return res.status(200).json({ sequence: session.sequence, targetsCount: session.extraTargets?.length ?? 0 });
  });

  // DELETE /live — Remove session
  router.delete('/', auth, async (req, res) => {
    const { sessionId } = req.session;
    const session = store.get(sessionId);

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
      writeSessionStat(db, {
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
          finishVideoRecording(db, removed.apiKey, removed.recordingVideoId, {
            endedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
          });
          await configureMediaMtxRecording(mediamtxClient, {
            pathName: removed.streamKey || removed.apiKey,
            videoDir: getVideoStorageDir(removed.apiKey, removed.recordingVideoId),
            enabled: false,
          });
        } catch (err) {
          logger.warn(`[videos] finishVideoRecording failed (videoId=${removed.recordingVideoId})`, err);
        }
      }
      // Transition the bound broadcast to completed (plan/broadcasts).
      if (removed.broadcastId) {
        try {
          completeBroadcast(db, removed.broadcastId, {
            youtubeVideoIds: removed.youtubeVideoIds,
            endedAt,
          });
        } catch (err) {
          logger.warn(`[broadcasts] completeBroadcast failed (broadcastId=${removed.broadcastId})`, err);
        }
      }
      incrementDomainHourlySessionEnd(db, removed.domain, durationMs);
    }
    return res.status(200).json({ removed: true, sessionId });
  });

  return router;
}
