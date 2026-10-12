import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { EventBus } from 'lcyt/event-bus';
import { saveSession, deleteSession, loadSession, incSessionSequence, listSessions, touchSessionRow, raiseSessionSequence, setSessionData, setSessionMicHolder, deleteSessionIfIdle, sessionDomainExists } from './db.js';

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
  constructor({ sessionTtl = DEFAULT_SESSION_TTL, cleanupInterval = DEFAULT_CLEANUP_INTERVAL, db = null, eventBus = null, cluster = null, restore = null, sendLock = null } = {}) {
    /** @type {Map<string, object>} */
    this._sessions = new Map();
    this._sessionTtl = sessionTtl;
    this._cleanupInterval = cleanupInterval;
    this._timer = null;
    this.db = db;
    /** Serialised write-behind queue for session rows (create/touch/remove stay synchronous). */
    this._writes = Promise.resolve();
    /** @type {import('lcyt/event-bus').EventBus} Shared pub/sub bus; every
     *  session's emitter is mirrored onto it (see _bridgeEmitterToBus). A
     *  private bus is created when none is injected (keeps isolated tests
     *  self-contained), mirroring the DskBus/VariablesBus/RolesBus pattern. */
    this.eventBus = eventBus ?? new EventBus();
    /** @type {((session: object, reason: string) => void)|null} */
    this.onSessionEnd = null;
    /** Multi-instance: leases + shared flag from src/cluster (null = single process). */
    this.cluster = cluster;
    /** Shared mode send coordination: 'atomic' (default) reserves each sequence number with one conditional
     *  database write; 'lease' serialises whole sends across instances with a lease (CLUSTER_SEND_LOCK=lease). */
    this.sendLock = (sendLock || process.env.CLUSTER_SEND_LOCK || 'atomic') === 'lease' ? 'lease' : 'atomic';
    /** @type {((session: object) => Promise<void>)|null} Rebuilds senders/targets of a session loaded from the DB. */
    this._restore = restore;
    /** @type {Map<string, Promise<object|undefined>>} in-flight getOrLoad() calls, one per session id */
    this._loading = new Map();
    this._startCleanup();
    this._followOtherInstances();
  }

  /** True when several backend instances share the database (PostgreSQL). */
  get shared() {
    return Boolean(this.cluster?.shared);
  }

  /**
   * Keep this instance's in-memory copies in step with changes made on other instances.
   * A session another instance ended is dropped here without ending it again; a mic holder
   * changed elsewhere is mirrored.
   */
  _followOtherInstances() {
    this.eventBus.onRemote?.((env) => {
      if (!env.sessionId) return;
      if (env.topic === 'session.closed') this._dropLocal(env.sessionId);
      else if (env.topic === 'session.mic_state') {
        const session = this._sessions.get(env.sessionId);
        if (session) session.micHolder = env.data?.holder ?? null;
      }
    });
  }

  /** Forget a session that ended on another instance: stop its senders, no events, no DB writes. */
  _dropLocal(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    this._sessions.delete(sessionId);
    session.emitter.removeAllListeners();
    try { session.sender?.end?.(); } catch {}
    for (const target of (session.extraTargets || [])) {
      if (target.type === 'youtube' && target.sender) {
        try { Promise.resolve(target.sender.end()).catch(() => {}); } catch {}
      }
    }
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
    const onClosed = () => bus.publish(apiKey, 'session.closed', {
      durationMs: Math.max(0, Date.now() - (session.startedAt || Date.now())),
    }, meta);
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
  create({ apiKey, streamKey, domain, jwt, sequence = 0, syncOffset = 0, sender, extraTargets = [], persist = true }) {
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
    // Persistence is write-behind: a DB failure never fails session create.
    // A session being loaded back from its own row (persist: false) must not rewrite that row.
    if (persist) this._persist(async () => await saveSession(this.db, {
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
    }));
    // Plugin hook (lcyt-cues' createSoundCueListener/createTrackerCueListener
    // monkey-patch this to attach per-session listeners — without this call
    // neither ever attaches to a session created after server startup, so
    // sound/tracker cue rules would silently never fire for a real session.
    this.onNewSession?.(session);
    return session;
  }

  /**
   * Rehydrate persisted sessions from the DB into the in-memory store.
   * This creates session entries without active `sender` instances; clients
   * that reconnect should resume using the same `sessionId` so sequence
   * continuity is preserved.
   */
  async rehydrate() {
    if (!this.db) return;
    try {
      const rows = await listSessions(this.db);
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
          persist: false,
        });
        this._applyRow(session, r);
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

  /** Copy what a persisted row knows onto a freshly created in-memory session. */
  _applyRow(session, r) {
    if (r.micHolder) session.micHolder = r.micHolder;
    const data = r.data && typeof r.data === 'object' ? r.data : null;
    if (data) {
      if (Array.isArray(data.targets)) session.rawTargets = data.targets;
      if (data.broadcastId) session.broadcastId = data.broadcastId;
      if (data.recordingVideoId) session.recordingVideoId = data.recordingVideoId;
    }
    // Sessions written by this version carry their targets; only those can be rebuilt.
    session._needsRestore = Boolean(session.rawTargets) || Boolean(session.streamKey);
  }

  /**
   * Like `get()`, but also finds a session that another instance created: it is loaded from the
   * database, given a fresh emitter (so plugin listeners attach here), and its senders and targets
   * are rebuilt from the stored target list. Sessions that were rehydrated at start-up are
   * restored the same way on first use. Without a database this is `get()`.
   * @param {string} sessionId
   * @returns {Promise<object|undefined>}
   */
  async getOrLoad(sessionId) {
    let session = this._sessions.get(sessionId);
    if (!session && this.db) {
      let pending = this._loading.get(sessionId);
      if (!pending) {
        pending = this._loadFromDb(sessionId).finally(() => this._loading.delete(sessionId));
        this._loading.set(sessionId, pending);
      }
      session = await pending;
    }
    if (session?._needsRestore && this._restore) await this._restoreRuntime(session);
    return session;
  }

  async _loadFromDb(sessionId) {
    let row;
    try { row = await loadSession(this.db, sessionId); } catch { return undefined; }
    if (!row) return undefined;
    const existing = this._sessions.get(sessionId);
    if (existing) return existing; // another caller finished first
    const session = this.create({
      apiKey: row.apiKey, streamKey: row.streamKey, domain: row.domain, jwt: null,
      sequence: row.sequence || 0, syncOffset: row.syncOffset || 0, sender: null, persist: false,
    });
    session.startedAt = row.startedAt ? (Date.parse(row.startedAt) || Date.now()) : Date.now();
    session.lastActivityAt = row.lastActivity ? new Date(row.lastActivity) : new Date(session.startedAt);
    this._applyRow(session, row);
    return session;
  }

  async _restoreRuntime(session) {
    if (!session._restoring) {
      session._restoring = (async () => {
        try { await this._restore(session); } catch { /* the route reports "no targets" as before */ }
        session._needsRestore = false;
      })().finally(() => { session._restoring = null; });
    }
    await session._restoring;
  }

  /** Persist the soft mic lock holder so other instances see it. */
  saveMicHolder(session) {
    this._persist(async () => await setSessionMicHolder(this.db, session.sessionId, session.micHolder ?? null));
  }

  /** Persist what another instance needs to rebuild this session (targets, broadcast, recording). */
  saveRuntimeData(session) {
    this._persist(async () => await setSessionData(this.db, session.sessionId, {
      targets: session.rawTargets ?? [],
      broadcastId: session.broadcastId ?? null,
      recordingVideoId: session.recordingVideoId ?? null,
    }));
  }

  /**
   * Is a browser origin the domain of any session, on this or (shared mode) another instance?
   * @param {string} origin
   * @returns {Promise<boolean>}
   */
  async domainKnown(origin) {
    if (this.getByDomain(origin).length > 0) return true;
    if (!this.shared || !this.db) return false;
    try { return await sessionDomainExists(this.db, origin); } catch { return false; }
  }

  /**
   * Run `fn` (a caption send) as the only sender of this session across all instances.
   * Single instance: just `fn()`; the per-session send queue already serialises. Shared mode with
   * `CLUSTER_SEND_LOCK=atomic` (default): reserve the sequence number atomically, no lease. With `lease`:
   * take the `session-send:<id>` lease (retrying briefly), then bring the sequence up to what the
   * other instances already used, so numbers keep rising however requests are spread.
   * @template T
   * @param {object} session
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async runExclusive(session, fn) {
    const leases = this.cluster?.leases;
    if (!this.shared || !leases?.enforce || !this.db) return fn();
    if (this.sendLock === 'atomic') {
      await this.reserveSequence(session);
      return fn();
    }
    const name = `session-send:${session.sessionId}`;
    const deadline = Date.now() + 8000;
    while (!(await leases.acquire(name, 15_000))) {
      if (Date.now() > deadline) throw Object.assign(new Error('Session is busy on another instance'), { statusCode: 503 });
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
    }
    try {
      await this.syncSequenceFromDb(session);
      return await fn();
    } finally {
      await leases.release(name).catch(() => {});
    }
  }

  /**
   * Take the next sequence number for one send with a single atomic increment of the stored counter,
   * so two instances never use the same number and no lease is needed. The number is put on the
   * session and on every YouTube sender; each sender then advances itself as usual. Delivery order
   * between instances serving the same session at the same instant is best effort (route a session
   * to one instance to avoid it, see docs/DEPLOY.md).
   */
  async reserveSequence(session) {
    const next = await incSessionSequence(this.db, session.sessionId);
    if (next == null) return; // row gone (session ended elsewhere): keep the local counter
    const used = next - 1; // stored value is the next free number
    session.sequence = used;
    if (session.sender && typeof session.sender.sequence === 'number') session.sender.sequence = used;
    for (const t of (session.extraTargets || [])) {
      if (t.type === 'youtube' && t.sender && typeof t.sender.sequence === 'number') t.sender.sequence = used;
    }
  }

  /** Raise this session's sequence (and its senders') to the highest value any instance stored. */
  async syncSequenceFromDb(session) {
    const row = await loadSession(this.db, session.sessionId);
    if (!row) return;
    if (row.sequence > (session.sequence || 0)) session.sequence = row.sequence;
    this.liftSenders(session);
  }

  /** Make every YouTube sender's counter at least the session sequence (never lowers one). */
  liftSenders(session) {
    const n = session.sequence || 0;
    if (session.sender && typeof session.sender.sequence === 'number' && session.sender.sequence < n) session.sender.sequence = n;
    for (const t of (session.extraTargets || [])) {
      if (t.type === 'youtube' && t.sender && typeof t.sender.sequence === 'number' && t.sender.sequence < n) t.sender.sequence = n;
    }
  }

  /** Store the highest sequence in use (session counter and sender counters) without ever lowering the stored one. */
  persistSequence(session) {
    let n = session.sequence || 0;
    if (typeof session.sender?.sequence === 'number') n = Math.max(n, session.sender.sequence);
    for (const t of (session.extraTargets || [])) {
      if (typeof t.sender?.sequence === 'number') n = Math.max(n, t.sender.sequence);
    }
    session.sequence = n;
    this._persist(async () => { await raiseSessionSequence(this.db, session.sessionId, n); });
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
      this._persist(async () => await deleteSession(this.db, sessionId));
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
   * Return an iterable of all [sessionId, session] pairs.
   * @returns {IterableIterator<[string, object]>}
   */
  entries() {
    return this._sessions.entries();
  }

  /**
   * Update lastActivityAt for a session.
   * @param {string} sessionId
   */
  touch(sessionId) {
    const session = this._sessions.get(sessionId);
    if (session) session.lastActivityAt = new Date();
    if (session) {
      // Only activity (and a sequence that moved forward) is written, never the whole row: another
      // instance may have changed the mic holder, data or a higher sequence in the meantime.
      this._persist(async () => {
        await touchSessionRow(this.db, session.sessionId, new Date(session.lastActivityAt).toISOString());
        if (session.sequence) await raiseSessionSequence(this.db, session.sessionId, session.sequence);
      });
    }
  }

  /**
   * Get the next sequence number for a session, using the DB for atomic increments when available.
   * @param {string} sessionId
   * @returns {number}
   */
  async nextSequence(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    if (this.db) {
      try {
        const next = await incSessionSequence(this.db, sessionId);
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
    this._persist(async () => await saveSession(this.db, { sessionId: session.sessionId, sequence: session.sequence }));
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

  _persist(fn) {
    if (!this.db) return;
    this._writes = this._writes.then(fn).catch(() => {});
  }

  /** Resolves when every queued session write has been attempted (tests, shutdown). */
  flush() {
    return this._writes;
  }

  async _sweep() {
    const cutoff = Date.now() - this._sessionTtl;
    for (const [sessionId, session] of this._sessions) {
      if (session.lastActivityAt.getTime() < cutoff) {
        if (this.shared && this.db) {
          // Another instance may have been serving this session: the database row is the truth.
          // Only the instance that wins the conditional delete ends it.
          let row;
          try { row = await loadSession(this.db, sessionId); } catch { continue; }
          if (!row) { this._dropLocal(sessionId); continue; }
          const seen = row.lastActivity ? Date.parse(row.lastActivity) : 0;
          if (seen >= cutoff) { session.lastActivityAt = new Date(seen); continue; }
          let deleted = 0;
          try { deleted = await deleteSessionIfIdle(this.db, sessionId, new Date(cutoff).toISOString()); } catch { continue; }
          if (!deleted) continue;
        }
        this.onSessionEnd?.(session, 'ttl');
        session.emitter.emit('session:closed');
        session.emitter.removeAllListeners();
        this._sessions.delete(sessionId);
        this._persist(async () => await deleteSession(this.db, sessionId));
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
    if (this.shared && this.db && this.cluster?.leases) {
      // Rows nobody holds in memory (the instance that served them died) would otherwise stay forever.
      const iso = new Date(cutoff).toISOString();
      // After the loop, so a session held in memory is ended properly (event, statistics) before its row goes.
      await this.cluster.leases.withLease('session-orphan-sweep', 60_000, async () => {
        await this.db.sessions.deleteMany({ where: { last_activity: { lt: iso } } });
      }).catch(() => {});
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
