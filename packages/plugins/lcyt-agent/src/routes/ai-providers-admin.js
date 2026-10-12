/**
 * Site-level AI provider registry routes (plan/ai_model_registry).
 * Mounted at /admin/ai-providers, behind createAdminMiddleware — mirrors
 * /admin/connector-network-rules.
 *
 *   GET    /                       — list all site-scope providers (masked)
 *   POST   /                       — create a site-scope provider
 *   PUT    /:id                    — update
 *   DELETE /:id                    — delete
 *   POST   /:id/discover           — run discovery now, return the model list
 *   GET    /:id/models             — list catalog
 *   POST   /:id/models             — manually add a model (ollama only)
 *   PUT    /:id/models/:modelId    — edit capabilities / toggle enabled
 *   DELETE /:id/models/:modelId    — delete a model row
 *   GET    /:id/grants             — which projects have this provider granted
 *   PUT    /:id/grants/:apiKey     — { enabled } grant/revoke for a project
 */

import { Router } from 'express';
import {
  createProvider, updateProvider, deleteProvider, getProvider,
  maskProvider, listSiteProviders, validateProviderInput,
  setGrant, listGrants,
  listProviderModels, addManualModel, updateModel, deleteModel,
} from '../provider-registry.js';
import { discoverProvider } from '../discovery.js';

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {import('express').RequestHandler} adminAuth
 * @param {{ bridgeManager?: object }} [deps]
 * @returns {import('express').Router}
 */
export function createAdminAiProvidersRouter(db, adminAuth, deps = {}) {
  const router = Router();
  router.use(adminAuth);

  /** Loads a site-scope provider or 404s. */
  async function loadProvider(req, res) {
    const provider = await getProvider(db, req.params.id);
    if (!provider || provider.scope !== 'site') {
      res.status(404).json({ error: 'Provider not found' });
      return null;
    }
    return provider;
  }

  router.get('/', async (req, res) => {
    res.json({ ok: true, providers: await listSiteProviders(db) });
  });

  router.post('/', async (req, res) => {
    const input = { ...req.body, scope: 'site' };
    const err = validateProviderInput(input);
    if (err) return res.status(400).json({ error: err });
    const provider = await createProvider(db, input);
    res.status(201).json({ ok: true, provider });
  });

  router.put('/:id', async (req, res) => {
    if (!await loadProvider(req, res)) return;
    const err = validateProviderInput(req.body, { partial: true });
    if (err) return res.status(400).json({ error: err });
    const provider = await updateProvider(db, req.params.id, req.body);
    res.json({ ok: true, provider });
  });

  router.delete('/:id', async (req, res) => {
    if (!await loadProvider(req, res)) return;
    await deleteProvider(db, req.params.id);
    res.json({ ok: true });
  });

  router.post('/:id/discover', async (req, res) => {
    const provider = await loadProvider(req, res);
    if (!provider) return;
    const result = await discoverProvider(db, provider, deps);
    res.status(result.ok ? 200 : 502).json({
      ...result,
      provider: maskProvider(await getProvider(db, provider.id)),
      models: await listProviderModels(db, provider.id),
    });
  });

  router.get('/:id/models', async (req, res) => {
    if (!await loadProvider(req, res)) return;
    res.json({ ok: true, models: await listProviderModels(db, req.params.id) });
  });

  router.post('/:id/models', async (req, res) => {
    const provider = await loadProvider(req, res);
    if (!provider) return;
    if (provider.kind !== 'ollama') {
      return res.status(400).json({ error: 'Model catalog only applies to ollama providers' });
    }
    const { modelName, capabilities } = req.body || {};
    if (typeof modelName !== 'string' || !modelName.trim()) {
      return res.status(400).json({ error: 'modelName is required' });
    }
    const model = await addManualModel(db, provider.id, { modelName: modelName.trim(), capabilities: Array.isArray(capabilities) ? capabilities : [] });
    if (!model) return res.status(409).json({ error: 'Model already exists for this provider' });
    res.status(201).json({ ok: true, model });
  });

  router.put('/:id/models/:modelId', async (req, res) => {
    if (!await loadProvider(req, res)) return;
    const { capabilities, enabled } = req.body || {};
    const model = await updateModel(db, req.params.id, Number(req.params.modelId), { capabilities, enabled });
    if (!model) return res.status(404).json({ error: 'Model not found' });
    res.json({ ok: true, model });
  });

  router.delete('/:id/models/:modelId', async (req, res) => {
    if (!await loadProvider(req, res)) return;
    const deleted = await deleteModel(db, req.params.id, Number(req.params.modelId));
    if (!deleted) return res.status(404).json({ error: 'Model not found' });
    res.json({ ok: true });
  });

  router.get('/:id/grants', async (req, res) => {
    if (!await loadProvider(req, res)) return;
    res.json({ ok: true, grants: await listGrants(db, req.params.id) });
  });

  router.put('/:id/grants/:apiKey', async (req, res) => {
    if (!await loadProvider(req, res)) return;
    const enabled = req.body?.enabled !== false;
    await setGrant(db, req.params.id, req.params.apiKey, enabled);
    res.json({ ok: true });
  });

  return router;
}
