import { Router } from 'express';
import jwt from 'jsonwebtoken';

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
 *
 * @param {import('../store.js').SessionStore} store
 * @param {string} jwtSecret
 * @returns {Router}
 */
export function createEventsRouter(store, jwtSecret) {
  const router = Router();

  router.get('/', (req, res) => {
    // Accept token via Authorization header or ?token= query param
    // (EventSource doesn't support custom headers)
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch {
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

    function onResult(data) { send('caption_result', data); }
    function onError(data) { send('caption_error', data); }
    function onMicState(data) { send('mic_state', data); }
    function onClosed() {
      send('session_closed', {});
      res.end();
      cleanup();
    }

    // Heartbeat every 25 s to keep long-lived SSE connections alive through proxies
    // (nginx proxy_read_timeout defaults to 60 s; without this the connection drops
    // during quiet periods with no captions, causing ERR_INCOMPLETE_CHUNKED_ENCODING)
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
    }, 25000);

    // Forward plugin events (cue_fired, sound_label, bpm_update, etc.) to the
    // SSE stream.  Plugin processors emit on the session emitter as:
    //   session.emitter.emit('event', { type: 'cue_fired', data: { ... } })
    // We forward them as named SSE events so the frontend EventSource can
    // subscribe with es.addEventListener('cue_fired', ...).
    function onPluginEvent(payload) {
      if (payload?.type) {
        send(payload.type, payload.data ?? payload);
      }
    }

    function cleanup() {
      clearInterval(heartbeat);
      session.emitter.off('caption_result', onResult);
      session.emitter.off('caption_error', onError);
      session.emitter.off('mic_state', onMicState);
      session.emitter.off('event', onPluginEvent);
      session.emitter.off('session:closed', onClosed);
    }

    session.emitter.on('caption_result', onResult);
    session.emitter.on('caption_error', onError);
    session.emitter.on('mic_state', onMicState);
    session.emitter.on('event', onPluginEvent);
    session.emitter.once('session:closed', onClosed);

    // Client closed the connection
    req.on('close', cleanup);
  });

  return router;
}
