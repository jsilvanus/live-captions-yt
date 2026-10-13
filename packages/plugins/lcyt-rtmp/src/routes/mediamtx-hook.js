/**
 * MediaMTX path-ready hook: `POST /internal/mediamtx/path`.
 *
 * MediaMTX runs `runOnReady` / `runOnNotReady` (docker/mediamtx.yml) with a small curl that posts
 * the path name and whether it is ready. The receiving instance passes it to the relay manager's
 * FanoutSupervisor so a relay starts the moment the publisher is up (`mediamtx.fanout_mode=runner`).
 * Not a public route: keep it off the reverse proxy; the shared secret (`mediamtx.hook_secret`,
 * MEDIAMTX_HOOK_SECRET) is checked in constant time and the route is closed while it is unset.
 * A missed call is harmless: the supervisor also polls the MediaMTX API.
 */

import { Router, urlencoded, json } from 'express';
import { timingSafeEqual } from 'node:crypto';

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * @param {{ relayManager: { fanoutPathEvent: (path: string, ready: boolean) => Promise<boolean> }, settings?: { get: (k: string) => any }|null }} deps
 */
export function createMediaMtxHookRouter({ relayManager, settings = null } = {}) {
  const router = Router();
  router.use(urlencoded({ extended: false, limit: '4kb' }), json({ limit: '4kb' }));

  router.post('/path', async (req, res) => {
    const secret = settings ? settings.get('mediamtx.hook_secret') : process.env.MEDIAMTX_HOOK_SECRET;
    const given = req.get('x-lcyt-hook-secret') || '';
    if (!secret || !sameSecret(secret, given)) return res.status(401).json({ ok: false });
    const path = req.body?.path;
    if (typeof path !== 'string' || !/^[A-Za-z0-9_\-\/.]{1,200}$/.test(path)) return res.status(400).json({ ok: false });
    const ready = ['1', 'true', 'yes'].includes(String(req.body?.ready).toLowerCase());
    const handled = await relayManager.fanoutPathEvent(path, ready).catch(() => false);
    return res.json({ ok: true, handled });
  });

  return router;
}
