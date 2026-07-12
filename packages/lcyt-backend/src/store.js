import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { EventBus } from 'lcyt/event-bus';
import { saveSession, deleteSession, loadSession, incSessionSequence, listSessions } from './db.js';

const DEFAULT_SESSION_TTL = Number(process.env.SESSION_TTL) || 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_CLEANUP_INTERVAL = Number(process.env.CLEANUP_INTERVAL) || 5 * 60 * 1000; // 5 minutes

// Sentinel date used when a rehydrated session has no timing information at all,
// ensuring it is eligible for immediate cleanup on the next sweep rather than
// being granted a fresh TTL window.
const EPOCH = new Date(0);

/**
 * Generate a deterministic session ID from the composite key.
 * SHA-256 hash of "apiKey:streamKey:domain", truncated to 16 hex chars.
 * This avoids embedding the raw API key in JWT payloads.
 *
 * @param {string} apiKey
 * @param {string} streamKey
 * @param {string} domain
 * @returns {string} 16-character hex string
 */
export function makeSessionId(apiKey, streamKey, domain) {
  return createHash('sha256')
    .update(`${apiKey}:${streamKey}:${domain}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * In-memory session store backed by a Map.
 * Each session holds a YoutubeLiveCaptionSender instance plus metadata.
 * A periodic cleanup sweep removes idle sessions and calls sender.end().
 */
export class SessionStore {
  /**
   * @param {{ sessionTtl?: number, cleanupInterval?: number }} [options]
   */
  constructor({ sessionTtl = DEFAULT_SESSION_TTL, cleanupInterval = DEFAULT_CLEANUP_INTERVAL, db = null, eventBus = null } = {}) {
    /** @type {Map<string, object>} */
    this._sessions = new Map();
    this._sessionTtl = sessionTtl;
    this._cleanupInterval = cleanupInterval;
    this._timer = null;
    this.db = db;
    /** @type {import('lcyt/event-bus').EventBus} Shared pub/sub bus; every
     *  session's emitter is mirrored onto it (see _bridgeEmitterToBus). A
     *  private bus is created when none is injected (keeps isolated tests
     *  self-contained), mirroring the DskBus/VariablesBus/RolesBus pattern. */
    this.eventBus = eventBus ?? new EventBus();
    /** @type {((session: object, reason: string) => void)|null} */
    this.onSessionEnd = null;
    this._startCleanup();
  }

  /**
   * Mirror a session's per-session EventEmitter onto the shared project bus.
   *
   * The emitter stays the plugins' in-process fan-in (captions/mic/stats emit on
   * it, and the cue engine listens on its generic `event` channel for music
   * cues); this bridge republishes each event onto the bus keyed by the project
   * (apiKey), carrying `sessionId` as envelope meta (not in `data`, so the wire
   * shape a legacy /events client sees is unchanged). This is what lets the
   * unified /events/stream endpoint, in-process listeners, and the audit log see
   * caption/mic/close/plugin events without touching any emit site.
   * @param {object} session
   */
  _bridgeEmitterToBus(session) {
    const bus = this.eventBus;
    if (!bus) return;
    const { emitter, apiKey, sessionId } = session;
    const meta = { sessionId };
    emitter.on('caption_result', (data) => bus.publish(apiKey, 'caption.sent', data, meta));
    emitter.on('caption_error', (data) => bus.publish(apiKey, 'caption.error', data, meta));
    emitter.on('mic_state', (data) => bus.publish(apiKey, 'session.mic_state', data, meta));
    // Both historical spellings map to one canonical topic. This fixes the
    // latent mismatch where store.js emits `session:closed` (colon) but
    // stats.js's GDPR-erasure path emits `session_closed` (underscore): both
    // now notify the /events stream.
    const onClosed = () => bus.publish(apiKey, 'session.closed', {}, meta);
    emitter.on('session:closed', onClosed);
    emitter.on('session_closed', onClosed);
    // Generic plugin events `{ type, data }` (cue_fired, sound_label, bpm_update…)
    // become `plugin.<type>` on the bus; the /events client still receives the
    // bare `<type>` event name carrying the original data.
    emitter.on('event', (payload) => {
      if (!payload?.type) return;
      bus.publish(apiKey, `plugin.${payload.type}`, payload.data ?? payload, meta);
    });
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create and store a new session.
   *
  * @param {object} params
   * @param {string} params.apiKey
   * @param {string} params.streamKey
   * @param {string} params.domain
   * @param {string} params.jwt - Signed JWT for this session
   * @param {number} [params.sequence=0]
   * @param {number} [params.syncOffset=0]
  * @param {object} [params.sender] - YoutubeLiveCaptionSender instance (optional; rehydrated sessions may have no sender)
   * @returns {object} The created session object
   */
  create({ apiKey, streamKey, domain, jwt, sequence = 0, syncOffset = 0, sender, extraTargets = [] }) {
    // Normalise streamKey: treat null/undefined/'' consistently so session IDs are stable
    // across target-array mode (no streamKey) and legacy single-target mode.
    const sessionId = makeSessionId(apiKey, streamKey || '', domain);
    const now = new Date();
    const session = {
      sessionId,
      apiKey,
      streamKey,
      domain,
      jwt,
      sequence,
      syncOffset,
      sender: sender ?? null,
      extraTargets,
      startedAt: Date.now(),
      createdAt: now,
      lastActivityAt: now,
      captionsSent: 0,
      captionsFailed: 0,
      emitter: new EventEmitter(),
      _sendQueue: Promise.resolve(),
    };
    this._bridgeEmitterToBus(session);
    this._sessions.set(sessionId, session);
    if (this.db) {
      try {
        saveSession(this.db, {
          sessionId: session.sessionId,
          apiKey: session.apiKey,
          streamKey: session.streamKey,
          domain: session.domain,
          sequence: session.sequence,
          startedAt: new Date(session.startedAt).toISOString(),
          lastActivity: new Date(session.lastActivityAt).toISOString(),
          syncOffset: session.syncOffset,
          micHolder: null,
          data: {}
        });
      } catch (e) {
        // Don't fail session create if DB persist fails; log upstream instead
      }
    }
    return session;
  }

  /**
   * Rehydrate persisted sessions from the DB into the in-memory store.
   * This creates session entries without active `sender` instances; clients
   * that reconnect should resume using the same `sessionId` so sequence
   * continuity is preserved.
   */
  rehydrate() {
    if (!this.db) return;
    try {
      const rows = listSessions(this.db);
      for (const r of rows) {
        // Skip if already in memory
        if (this._sessions.has(r.sessionId)) continue;
        const session = this.create({
          apiKey: r.apiKey,
          streamKey: r.streamKey,
          domain: r.domain,
          jwt: null,
          sequence: r.sequence || 0,
          syncOffset: r.syncOffset || 0,
          sender: null,
        });
        // Restore timestamps
        try { session.startedAt = r.startedAt ? Date.parse(r.startedAt) : Date.now(); } catch(_) { session.startedAt = Date.now(); }
        // Use lastActivity if available; fall back to startedAt so that old sessions
        // that never received any caption are cleaned up based on their start time
        // rather than being granted a fresh TTL window on every server restart.
        if (r.lastActivity) {
          session.lastActivityAt = new Date(r.lastActivity);
        } else if (r.startedAt) {
          session.lastActivityAt = new Date(r.startedAt);
        } else {
          // No timing information available: mark immediately eligible for cleanup
          session.lastActivityAt = EPOCH;
        }
        // restore any saved data if present
        if (r.data) session.data = r.data;
      }
    } catch (e) {
      // Best-effort: do not crash startup on DB read errors
    }
  }

  /**
   * Retrieve a session by ID.
   * @param {string} sessionId
   * @returns {object|undefined}
   */
  get(sessionId) {
    return this._sessions.get(sessionId);
  }

  /**
   * Check whether a session exists.
   * @param {string} sessionId
   * @returns {boolean}
   */
  has(sessionId) {
    return this._sessions.has(sessionId);
  }

  /**
   * Get the first session whose apiKey matches the given key.
   * Used by plugin processors (cue, music) that receive captions by apiKey
   * and need to emit SSE events on the session emitter.
   * @param {string} apiKey
   * @returns {object|undefined}
   */
  getByApiKey(apiKey) {
    for (const session of this._sessions.values()) {
      if (session.apiKey === apiKey) return session;
    }
    return undefined;
  }

  /**
   * Get all sessions whose domain matches the given origin.
   * @param {string} domain
   * @returns {object[]}
   */
  getByDomain(domain) {
    return [...this._sessions.values()].filter(s => s.domain === domain);
  }

  /**
   * Remove a session and return it.
   * @param {string} sessionId
   * @returns {object|undefined} The removed session, or undefined if not found
   */
  remove(sessionId) {
    const session = this._sessions.get(sessionId);
    if (session) {
      session.emitter.emit('session:closed');
      session.emitter.removeAllListeners();
      this._sessions.delete(sessionId);
      if (this.db) {
        try { deleteSession(this.db, sessionId); } catch(_) {}
      }
      // Clean up secondary YouTube senders
      for (const target of (session.extraTargets || [])) {
        if (target.type === 'youtube' && target.sender) {
          Promise.resolve(target.sender.end()).catch(() => {});
        }
      }
    }
    return session;
  }

  /**
   * Return an iterable of all sessions.
   * @returns {IterableIterator<object>}
   */
  all() {
    return this._sessions.values();
  }

  /**
   * Update lastActivityAt for a session.
   * @param {string} sessionId
   */
  touch(sessionId) {
    const session = this._sessions.get(sessionId);
    if (session) session.lastActivityAt = new Date();
    if (session && this.db) {
      try {
        saveSession(this.db, {
          sessionId: session.sessionId,
          sequence: session.sequence,
          lastActivity: new Date(session.lastActivityAt).toISOString(),
          syncOffset: session.syncOffset,
        });
      } catch (_) {}
    }
  }

  /**
   * Get the next sequence number for a session, using the DB for atomic increments when available.
   * @param {string} sessionId
   * @returns {number}
   */
  nextSequence(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    if (this.db) {
      try {
        const next = incSessionSequence(this.db, sessionId);
        if (typeof next === 'number') {
          session.sequence = next;
          return next;
        }
      } catch (_) {
        // fall back to in-memory
      }
    }
    // In-memory fallback (not atomic across processes)
    session.sequence = (session.sequence || 0) + 1;
    if (this.db) {
      try {
        saveSession(this.db, { sessionId: session.sessionId, sequence: session.sequence });
      } catch (_) {}
    }
    return session.sequence;
  }

  /**
   * Return the number of active sessions.
   * @returns {number}
   */
  size() {
    return this._sessions.size;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  _startCleanup() {
    if (this._cleanupInterval <= 0) return;
    this._timer = setInterval(() => this._sweep(), this._cleanupInterval);
    // Allow the process to exit even if the timer is running
    if (this._timer.unref) this._timer.unref();
  }

  async _sweep() {
    const cutoff = Date.now() - this._sessionTtl;
    for (const [sessionId, session] of this._sessions) {
      if (session.lastActivityAt.getTime() < cutoff) {
        this.onSessionEnd?.(session, 'ttl');
        session.emitter.emit('session:closed');
        session.emitter.removeAllListeners();
        this._sessions.delete(sessionId);
        if (this.db) {
          try { deleteSession(this.db, sessionId); } catch (_) {}
        }
        if (session.sender) {
          try {
            session.sender.end();
          } catch {
            // Best-effort cleanup
          }
        }
        // Clean up secondary YouTube senders
        for (const target of (session.extraTargets || [])) {
          if (target.type === 'youtube' && target.sender) {
            try {
              target.sender.end();
            } catch {
              // Best-effort cleanup
            }
          }
        }
      }
    }
  }

  /**
   * Stop the periodic cleanup timer.
   * Call this during graceful shutdown before closing the server.
   */
  stopCleanup() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
