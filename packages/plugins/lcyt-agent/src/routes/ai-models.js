import { Router } from 'express';
import { listAiModelConfigs, setAiModelConfig, deleteAiModelConfig } from '../ai-models.js';

function resolveApiKey(req) {
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const bodyKey = req.body?.apiKey || req.body?.api_key;
  if (typeof bodyKey === 'string' && bodyKey.trim()) return bodyKey.trim();
  const queryKey = req.query?.apiKey || req.query?.api_key;
  if (typeof queryKey === 'string' && queryKey.trim()) return queryKey.trim();
  return null;
}

export function createAiModelsRouter(db, auth) {
  const router = Router();

  router.use(auth);

  router.get('/', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });
    return res.json({ models: listAiModelConfigs(db, apiKey) });
  });

  router.post('/', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });

    const model = setAiModelConfig(db, apiKey, {
      roleCode: req.body?.roleCode || req.body?.role_code || 'assistant',
      provider: req.body?.provider,
      modelName: req.body?.modelName || req.body?.model_name,
      apiUrl: req.body?.apiUrl || req.body?.api_url,
      apiKey: req.body?.apiKeyValue || req.body?.api_key_value || req.body?.apiKey || req.body?.api_key,
      enabled: req.body?.enabled,
    });

    return res.status(201).json({ model });
  });

  router.patch('/:id', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const existing = db.prepare('SELECT id FROM ai_model_configs WHERE api_key = ? AND id = ?').get(apiKey, id);
    if (!existing) return res.status(404).json({ error: 'Model not found' });

    const updated = setAiModelConfig(db, apiKey, {
      roleCode: req.body?.roleCode || req.body?.role_code,
      provider: req.body?.provider,
      modelName: req.body?.modelName || req.body?.model_name,
      apiUrl: req.body?.apiUrl || req.body?.api_url,
      apiKey: req.body?.apiKeyValue || req.body?.api_key_value || req.body?.apiKey || req.body?.api_key,
      enabled: req.body?.enabled,
    });

    return res.json({ model: updated });
  });

  router.delete('/:id', (req, res) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'x-api-key header or apiKey body field is required' });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const deleted = deleteAiModelConfig(db, apiKey, id);
    if (!deleted) return res.status(404).json({ error: 'Model not found' });
    return res.json({ ok: true });
  });

  return router;
}
