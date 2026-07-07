import { Router } from 'express';
import { createMcpToken, listMcpTokens, updateMcpToken, revokeMcpToken } from '../ai-models.js';

function resolveApiKey(req) {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const bodyKey = req.body?.apiKey || req.body?.api_key;
  if (typeof bodyKey === 'string' && bodyKey.trim()) return bodyKey.trim();
  const queryKey = req.query?.apiKey || req.query?.api_key;
  if (typeof queryKey === 'string' && queryKey.trim()) return queryKey.trim();
  return null;
}

export function createMcpTokensRouter(db, auth) {
  const router = Router();

  router.use(auth);

  router.get('/', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });
    return res.json({ tokens: listMcpTokens(db, apiKey) });
  });

  router.post('/', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });

    try {
      const created = createMcpToken(db, apiKey, {
        label: req.body?.label,
        active: req.body?.active,
        createdByName: req.body?.createdByName || req.body?.created_by_name,
        createdByEmail: req.user?.email,
        createdByUserId: req.user?.userId ?? null,
      });
      return res.status(201).json(created);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  router.patch('/:id', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const updated = updateMcpToken(db, apiKey, id, {
      label: req.body?.label,
      active: req.body?.active,
      createdByName: req.body?.createdByName || req.body?.created_by_name,
    });

    if (!updated) return res.status(404).json({ error: 'Token not found' });
    return res.json({ token: updated });
  });

  router.delete('/:id', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const revoked = revokeMcpToken(db, apiKey, id);
    if (!revoked) return res.status(404).json({ error: 'Token not found' });
    return res.json({ ok: true });
  });

  return router;
}
