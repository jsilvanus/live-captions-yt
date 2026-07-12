import { Router } from 'express';
import { tokenAllowsTopic } from '../db/mcp-tokens.js';

/**
 * Factory for the unified event-stream router.
 *
 * GET /events/stream — one SSE connection carrying every event on the caller's
 * project, topic-filtered. This is the unified authenticated surface over the
 * shared EventBus.
 *
 * Unlike those endpoints, this one emits the full canonical envelope
 * `{ topic, projectId, ts, data, … }` under the topic name, so an external
 * consumer can tell events apart on one connection.
 *
 * Auth is the project-access middleware (session/user/project/device JWT, or a
 * scoped external `lcytmcp_` token) mounted with `requiredScope: 'events:read'`.
 * For scoped external tokens, each delivered topic is additionally filtered
 * through `tokenAllowsTopic` so a token scoped `events:read`,`dsk.*` only ever
 * sees `dsk.*` events. JWT project members and unscoped tokens get everything.
 *
 * Query:
 *   ?topics=dsk.*,cue.fired,variable.updated  — comma-separated topic patterns
 *   (exact, `<domain>.*` wildcard, or `*`). Omitted → all topics.
 *   ?flat=1                                   — emit all envelopes as
 *   `event: message` so browser EventSource can consume dynamic topic names
 *   through `onmessage`.
 *
 * @param {import('lcyt/event-bus').EventBus} eventBus
 * @returns {Router}
 */
export function createEventsStreamRouter(eventBus) {
  const router = Router();

  router.get('/', (req, res) => {
    const projectId = req.auth?.projectId;
    if (!projectId) return res.status(401).json({ error: 'Not authorized for this project' });

    const topics = parseTopics(req.query?.topics);
    const flat = req.query?.flat === '1';

    // Scoped external tokens are narrowed per-event so topic scoping holds even
    // when ?topics is omitted (topics=null means "all", which must still be
    // filtered down to what the token permits). JWT members / unscoped tokens
    // have no per-event filter.
    const scopes = req.auth?.kind === 'external' ? req.auth.scopes : null;
    const filter = scopes && scopes.length
      ? (env) => tokenAllowsTopic(scopes, env.topic)
      : null;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    const connectedPayload = { projectId, topics: topics ?? '*' };
    if (req.auth?.sessionId) connectedPayload.sessionId = req.auth.sessionId;
    res.write(`event: connected\ndata: ${JSON.stringify(connectedPayload)}\n\n`);

    const unsubscribe = eventBus.subscribeSse(projectId, topics, res, {
      filter,
      rename: flat ? () => 'message' : null,
    });

    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
    }, 25000);

    function cleanup() {
      clearInterval(heartbeat);
      unsubscribe();
    }

    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  return router;
}

/**
 * Parse `?topics=a,b.*` into a trimmed pattern array, or null (all topics) when
 * absent/blank.
 * @param {unknown} raw
 * @returns {string[]|null}
 */
function parseTopics(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const list = raw.split(',').map((t) => t.trim()).filter(Boolean);
  return list.length ? list : null;
}
