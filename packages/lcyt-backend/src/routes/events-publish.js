/**
 * External event publishing (Phase 3 — plan_unified_external_control.md).
 *
 * POST /events — publish events to the bus from external sources, fenced to
 * the `external.*` namespace. Internal domains (caption, cue, dsk, session,
 * role, variable, stt, bridge, operator, mcp, target, translation) can only
 * be published by internal code.
 *
 * Auth: `events:write` scope required. Topic patterns from the token's scopes
 * are checked via `tokenAllowsTopic` so a token scoped `events:write,external.trigger`
 * can only publish `external.trigger`, not `external.alert`.
 *
 * Envelope is stamped with `source: 'external'` and the `tokenId` for provenance.
 * Size-limited (max 4KB payload) and rate-limited (60 events/min per token).
 * Always audited via the bus audit tap.
 */

import { Router } from 'express';
import { tokenAllowsTopic } from '../db/mcp-tokens.js';

// --- Internal topic domains that external publishers cannot write to ---
const INTERNAL_DOMAINS = new Set([
  'caption', 'cue', 'dsk', 'session', 'role', 'variable', 'stt',
  'bridge', 'operator', 'mcp', 'target', 'translation', 'music',
]);

const MAX_PAYLOAD_BYTES = 4096;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_EVENTS = 60;

/**
 * Is a topic in the `external.*` namespace (or a bare `external`)?
 */
function isExternalTopic(topic) {
  if (typeof topic !== 'string') return false;
  return topic === 'external' || topic.startsWith('external.');
}

/**
 * Is a topic in an internal (reserved) domain?
 */
function isInternalTopic(topic) {
  if (typeof topic !== 'string') return true;
  const domain = topic.split('.')[0];
  return INTERNAL_DOMAINS.has(domain);
}

// Simple per-token rate limiter
class EventRateLimiter {
  constructor() {
    this._windows = new Map();
  }

  check(tokenId) {
    const now = Date.now();
    let entry = this._windows.get(tokenId);
    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
      entry = { count: 0, windowStart: now };
      this._windows.set(tokenId, entry);
    }
    entry.count++;
    return entry.count <= RATE_MAX_EVENTS;
  }
}

/**
 * Create the external events publishing router.
 *
 * @param {import('lcyt/event-bus').EventBus} eventBus
 * @returns {Router}
 */
export function createEventsPublishRouter(eventBus) {
  const router = Router();
  const rateLimiter = new EventRateLimiter();

  router.post('/', (req, res) => {
    const projectId = req.auth?.projectId;
    if (!projectId) return res.status(401).json({ error: 'Not authorized' });

    const tokenId = req.auth?.tokenId || null;
    const scopes = req.auth?.scopes || null;

    // Validate body
    const { topic, data } = req.body || {};

    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "topic" field' });
    }

    // Fence: only external.* topics allowed
    if (!isExternalTopic(topic)) {
      if (isInternalTopic(topic)) {
        return res.status(403).json({
          error: `Cannot publish to internal topic domain: "${topic.split('.')[0]}". Only "external.*" topics are allowed.`,
        });
      }
      return res.status(403).json({
        error: `Topic must be in the "external.*" namespace. Got: "${topic}"`,
      });
    }

    // Topic scope check (e.g. token scoped to `external.trigger` can't publish `external.alert`)
    if (scopes && scopes.length > 0 && !tokenAllowsTopic(scopes, topic)) {
      return res.status(403).json({ error: `Token not authorized for topic: "${topic}"` });
    }

    // Size limit — measured in actual bytes, not UTF-16 code units, so the
    // 4KB limit is enforced correctly for multi-byte payloads.
    const payloadSize = Buffer.byteLength(JSON.stringify(data ?? null), 'utf8');
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: `Payload exceeds ${MAX_PAYLOAD_BYTES} byte limit` });
    }

    // Rate limit — every authenticated caller is bounded, keyed by tokenId
    // when present (external tokens) or projectId otherwise (session/user/
    // device JWTs, which carry no tokenId).
    if (!rateLimiter.check(tokenId ?? projectId)) {
      return res.status(429).json({ error: 'Rate limit exceeded (60 events/min)', retryAfter: 60 });
    }

    // Publish with provenance metadata
    eventBus.publish(projectId, topic, data ?? null, {
      source: 'external',
      tokenId,
    });

    return res.status(202).json({ ok: true, topic, ts: Date.now() });
  });

  return router;
}
