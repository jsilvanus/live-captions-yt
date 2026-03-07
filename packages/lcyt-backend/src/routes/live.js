import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { YoutubeLiveCaptionSender } from 'lcyt';
import { validateApiKey, writeSessionStat, writeAuthEvent, incrementDomainHourlySessionStart, incrementDomainHourlySessionEnd, saveSession, getKeySequence, updateKeySequence, resetKeySequence } from '../db.js';
import { makeSessionId } from '../store.js';
import { createAuthMiddleware } from '../middleware/auth.js';

// NOTE: http://localhost:5173 is included for the Vite dev server — remove it in production.
const DEFAULT_ALLOWED_DOMAINS = 'https://lcyt.fi,https://www.lcyt.fi,http://localhost:5173';

/**
 * Check whether a domain is permitted to register sessions.
 * Reads ALLOWED_DOMAINS env var (comma-separated list, or "*" for all).
 * Defaults to "lcyt.fi,www.lcyt.fi" when not set.
 * @param {string} domain
 * @returns {boolean}
 */
function isAllowedDomain(domain) {
  const raw = process.env.ALLOWED_DOMAINS ?? DEFAULT_ALLOWED_DOMAINS;
  if (raw === '*') return true;
  return raw.split(',').map(d => d.trim()).includes(domain);
}

/**
 * Validate and build the extraTargets array from the client-supplied targets list.
 * Returns { ok: true, extraTargets } or { ok: false, error }.
 *
 * Each enabled YouTube target gets a new YoutubeLiveCaptionSender started.
 * Each enabled generic target is stored with its parsed headers object.
 *
 * @param {Array} targets  Raw array from POST /live body
 * @returns {{ ok: boolean, extraTargets?: Array, error?: string }}
 */
async function buildExtraTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return { ok: true, extraTargets: [] };

  const extraTargets = [];
  for (const target of targets) {
    if (!target || !['youtube', 'generic'].includes(target.type)) {
      return { ok: false, error: `Invalid target type: ${target?.type}` };
    }

    if (target.type === 'youtube') {
      if (!target.streamKey || typeof target.streamKey !== 'string') continue;
      const sender = new YoutubeLiveCaptionSender({ streamKey: target.streamKey.trim() });
      try { sender.start(); } catch (err) {
        console.warn(`[live] Failed to start extra YouTube target ${target.id}: ${err?.message}`);
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
    }
  }
  return { ok: true, extraTargets };
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
 * @returns {Router}
 */
export function createLiveRouter(db, store, jwtSecret) {
  const router = Router();
  const auth = createAuthMiddleware(jwtSecret);

  // POST /live — Register session
  router.post('/', async (req, res) => {
    const { apiKey, streamKey, domain, sequence: startSeqRaw, targets } = req.body || {};

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

    // Build extra targets (validates URLs, creates secondary YouTube senders)
    const targetsResult = await buildExtraTargets(targets);
    if (!targetsResult.ok) {
      return res.status(400).json({ error: targetsResult.error });
    }
    const extraTargets = targetsResult.extraTargets;

    // Generate deterministic session ID. streamKey defaults to '' for sessions
    // that use only the targets array (no primary stream key).
    const sessionId = makeSessionId(apiKey, streamKey || '', domain);

    // Idempotent: if session already exists, return existing JWT. If session
    // was rehydrated (no in-memory sender) and has no JWT, generate a fresh
    // token so the client can obtain a usable Bearer token and open SSE.
    if (store.has(sessionId)) {
      const existing = store.get(sessionId);

      // Update extra targets: clean up old secondary senders first
      for (const t of (existing.extraTargets || [])) {
        if (t.type === 'youtube' && t.sender) {
          Promise.resolve(t.sender.end()).catch(() => {});
        }
      }
      existing.extraTargets = extraTargets;

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
        startedAt: existing.startedAt
      });
    }

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

    incrementDomainHourlySessionStart(db, domain, store.size());

    res.setHeader('Access-Control-Allow-Origin', domain);
    return res.status(200).json({
      token,
      sessionId,
      sequence: session.sequence,
      syncOffset: session.syncOffset,
      startedAt: session.startedAt
    });
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
            console.warn(`[live] Failed to end extra YouTube target ${t.id} during PATCH: ${err?.message}`);
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

    try {
      await session.sender.end();
    } catch {
      // Best-effort cleanup
    }

    const removed = store.remove(sessionId);
    if (removed) {
      const durationMs = Date.now() - removed.startedAt;
      writeSessionStat(db, {
        sessionId: removed.sessionId,
        apiKey: removed.apiKey,
        domain: removed.domain,
        startedAt: new Date(removed.startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs,
        captionsSent: removed.captionsSent,
        captionsFailed: removed.captionsFailed,
        finalSequence: removed.sequence,
        endedBy: 'client',
      });
      incrementDomainHourlySessionEnd(db, removed.domain, durationMs);
    }
    return res.status(200).json({ removed: true, sessionId });
  });

  return router;
}
