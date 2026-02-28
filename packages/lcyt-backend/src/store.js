import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const DEFAULT_SESSION_TTL = Number(process.env.SESSION_TTL) || 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_CLEANUP_INTERVAL = Number(process.env.CLEANUP_INTERVAL) || 5 * 60 * 1000; // 5 minutes

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
  constructor({ sessionTtl = DEFAULT_SESSION_TTL, cleanupInterval = DEFAULT_CLEANUP_INTERVAL } = {}) {
    /** @type {Map<string, object>} */
    this._sessions = new Map();
    this._sessionTtl = sessionTtl;
    this._cleanupInterval = cleanupInterval;
    this._timer = null;
    /** @type {((session: object, reason: string) => void)|null} */
    this.onSessionEnd = null;
    this._startCleanup();
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
   * @param {object} params.sender - YoutubeLiveCaptionSender instance
   * @returns {object} The created session object
   */
  create({ apiKey, streamKey, domain, jwt, sequence = 0, syncOffset = 0, sender }) {
    const sessionId = makeSessionId(apiKey, streamKey, domain);
    const now = new Date();
    const session = {
      sessionId,
      apiKey,
      streamKey,
      domain,
      jwt,
      sequence,
      syncOffset,
      sender,
      startedAt: Date.now(),
      createdAt: now,
      lastActivityAt: now,
      captionsSent: 0,
      captionsFailed: 0,
      emitter: new EventEmitter(),
      _sendQueue: Promise.resolve(),
    };
    this._sessions.set(sessionId, session);
    return session;
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
        try {
          await session.sender.end();
        } catch {
          // Best-effort cleanup
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
