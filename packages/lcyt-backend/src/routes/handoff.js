import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getHandoff, listHandoffs } from '../db/handoffs.js';

function apiBase(req, service) {
  const configured = service.publicUrl();
  return `${configured || `${req.protocol}://${req.get('host')}`}${configured ? '/api/v1' : req.baseUrl.replace(/\/handoff$/, '')}`;
}

function present(handoff, req, service) {
  const { manifest, ...rest } = handoff;
  return { ...rest, ...(manifest ? { manifest: service.servedManifest(handoff, apiBase(req, service)) } : {}) };
}

/**
 * Handoff of finished broadcasts to an editor.
 *   POST /handoff              { broadcastId | groupId }  start building (202)
 *   GET  /handoff              list (?broadcastId=)
 *   GET  /handoff/:id          state and manifest
 *   POST /handoff/:id/send     tell Saarnavideo to import it
 *   GET  /handoff/:id/manifest.json?token=   manifest for the importer
 *   GET  /handoff/:id/files/:name?token=     media, captions, DSK events
 */
export function createHandoffRouter(auth, db, service) {
  const router = Router();
  router.use(rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false }));

  router.post('/', auth, async (req, res) => {
    const { broadcastId = null, groupId = null } = req.body || {};
    if (!broadcastId && !groupId) return res.status(400).json({ error: 'broadcastId or groupId is required' });
    try {
      const { gid } = await service.check(req.session.apiKey, { broadcastId, groupId });
      service.build(req.session.apiKey, { groupId: gid }).catch(() => { /* state is on the handoff row */ });
      res.status(202).json({ ok: true, id: gid, status: 'building' });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.get('/', auth, async (req, res) => {
    const items = await listHandoffs(db, req.session.apiKey, { broadcastId: req.query.broadcastId || undefined });
    res.json({ handoffs: items.map((h) => present(h, req, service)) });
  });

  router.get('/:id', auth, async (req, res) => {
    const handoff = await getHandoff(db, req.session.apiKey, req.params.id);
    if (!handoff) return res.status(404).json({ error: 'Handoff not found' });
    res.json({ handoff: present(handoff, req, service) });
  });

  router.post('/:id/send', auth, async (req, res) => {
    try {
      const handoff = await service.send(req.session.apiKey, req.params.id);
      res.json({ ok: true, handoff: present(handoff, req, service) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // The importer has no login: a signed, expiring token in the URL covers this handoff only.
  async function tokenGuard(req, res) {
    if (!service.verifyToken(req.params.id, req.query.token)) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return null;
    }
    const handoff = await service.getHandoffById(req.params.id);
    if (!handoff || !handoff.manifest) {
      res.status(404).json({ error: 'Handoff not found' });
      return null;
    }
    return handoff;
  }

  router.get('/:id/manifest.json', async (req, res) => {
    const handoff = await tokenGuard(req, res);
    if (!handoff) return;
    res.set('Cache-Control', 'private, no-store');
    res.json(service.servedManifest(handoff, apiBase(req, service), String(req.query.token)));
  });

  router.get('/:id/files/:name', async (req, res) => {
    const handoff = await tokenGuard(req, res);
    if (!handoff) return;
    const redirect = await service.redirectUrl(handoff.id, req.params.name);
    if (redirect) {
      res.set('Cache-Control', 'private, no-store');
      return res.redirect(302, redirect);
    }
    const opened = await service.openFile(handoff.id, req.params.name);
    if (!opened) return res.status(404).json({ error: 'File not found' });
    res.set('Content-Type', opened.contentType);
    if (opened.size != null) res.set('Content-Length', String(opened.size));
    res.set('Cache-Control', 'private, no-store');
    opened.stream.pipe(res);
  });

  return router;
}
