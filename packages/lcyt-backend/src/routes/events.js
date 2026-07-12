import { Router } from 'express';
import { extractSseToken, verifySessionToken } from '../middleware/auth.js';

/**
 * Factory for the /events SSE router.
 *
 * GET /events — Subscribe to real-time caption delivery results for a session.
 * The browser's EventSource API cannot set custom headers, so the JWT token
 * is accepted via the Authorization header OR a `?token=` query parameter.
 *
 * Events pushed on this stream:
 *   connected      — fired once on subscribe: { sessionId }
 *   caption_result — YouTube accepted:  { requestId, sequence, statusCode, serverTimestamp, [count] }
 *   caption_error  — YouTube rejected:  { requestId, error, statusCode, [sequence] }
 *   mic_state      — soft mic lock changed: { holder: clientId | null }
 *   session_closed — session was torn down server-side
 *   <plugin type>  — forwarded plugin events (cue_fired, sound_label, bpm_update, …)
 *
 * Delivery is via the shared EventBus: the per-session emitter is mirrored onto
 * the project bus by SessionStore._bridgeEmitterToBus, and this route subscribes
 * in-process filtered to its own sessionId. The client-facing event names and
 * payloads are unchanged from the previous emitter-only implementation.
 *
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @returns {Router}
 */
export function createEventsRouter(store, jwtSecret) {
  const router = Router();

  router.get('/', (req, res) => {
    const token = extractSseToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const payload = verifySessionToken(token, jwtSecret);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { sessionId } = payload;
    const session = store.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // SSE headers — disable buffering on proxies
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx
    res.flushHeaders();

    function send(event, data) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    // Confirm subscription is live; include current mic holder so latecomers sync immediately
    send('connected', { sessionId, micHolder: session.micHolder ?? null });

    // Heartbeat every 25 s to keep long-lived SSE connections alive through proxies
    // (nginx proxy_read_timeout defaults to 60 s; without this the connection drops
    // during quiet periods with no captions, causing ERR_INCOMPLETE_CHUNKED_ENCODING)
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
    }, 25000);

    // Consume this session's events from the shared bus (the session emitter is
    // mirrored onto it by SessionStore._bridgeEmitterToBus). One in-process
    // subscription filtered to our sessionId replaces the five per-connection
    // emitter listeners; the client-facing event names and payloads are exactly
    // as before. `plugin.<type>` topics (cue_fired, sound_label, bpm_update, …)
    // re-emit under the bare `<type>` so the frontend EventSource keeps working
    // with es.addEventListener('cue_fired', …).
    const unsubscribe = session.emitter && store.eventBus
      ? store.eventBus.subscribe(
          session.apiKey,
          ['caption.sent', 'caption.error', 'session.mic_state', 'session.closed', 'plugin.*'],
          (env) => {
            if (env.sessionId !== sessionId) return;
            switch (env.topic) {
              case 'caption.sent': return send('caption_result', env.data);
              case 'caption.error': return send('caption_error', env.data);
              case 'session.mic_state': return send('mic_state', env.data);
              case 'session.closed':
                send('session_closed', {});
                res.end();
                return cleanup();
              default:
                if (env.topic.startsWith('plugin.')) send(env.topic.slice('plugin.'.length), env.data);
            }
          },
        )
      : () => {};

    function cleanup() {
      clearInterval(heartbeat);
      unsubscribe();
    }

    // Client closed the connection
    req.on('close', cleanup);
  });

  return router;
}
