/**
 * POST /internal/cluster/call: the receiving end of a forwarded relay/crop/STT call
 * (cluster/ownership.js `forward`). Mounted only in shared mode.
 *
 * The caller proves it is another instance with a Bearer HMAC of JWT_SECRET. The call runs on the
 * ownership wrapper's `__invokeLocal`, which never forwards again, and only for the methods the
 * wrapper lists (claiming, routed, marks, reads). This path is not part of the public API: keep it
 * off the reverse proxy and reachable only on the internal network (`INSTANCE_URL`).
 */

import { Router } from 'express';
import express from 'express';
import { verifyClusterToken } from '../cluster/ownership.js';

/**
 * @param {{ secret: string, owned: Record<string, { __invokeLocal: (method: string, args: any[]) => Promise<any> }>, log?: { warn?: Function } }} deps
 */
export function createClusterInternalRouter({ secret, owned, log = console }) {
  const router = Router();
  router.use(express.json({ limit: '256kb' }));

  router.post('/call', async (req, res) => {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!verifyClusterToken(secret, bearer)) {
      return res.status(401).json({ ok: false, error: { message: 'unauthorized', code: 'UNAUTHORIZED' } });
    }
    const { kind, method, args } = req.body || {};
    // Own keys only: `owned['constructor']` would otherwise find Object's constructor.
    const target = typeof kind === 'string' && Object.hasOwn(owned, kind) ? owned[kind] : null;
    if (typeof target?.__invokeLocal !== 'function' || typeof method !== 'string' || !Array.isArray(args)) {
      return res.status(400).json({ ok: false, error: { message: 'bad request', code: 'BAD_REQUEST' } });
    }
    try {
      const result = await target.__invokeLocal(method, args);
      return res.json({ ok: true, result: result === undefined ? null : result });
    } catch (err) {
      const status = err.code === 'METHOD_NOT_ALLOWED' ? 400 : err.code === 'NOT_OWNER' ? 409 : 500;
      if (status === 500) (log.warn || log.log || (() => {})).call(log, `[cluster] forwarded ${kind}.${method} failed: ${err.message}`);
      return res.status(status).json({ ok: false, error: { message: err.message, code: err.code || 'CALL_FAILED' } });
    }
  });

  return router;
}
