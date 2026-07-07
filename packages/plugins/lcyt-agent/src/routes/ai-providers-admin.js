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
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} adminAuth
 * @param {{ bridgeManager?: object }} [deps]
 * @returns {import('express').Router}
 */
export function createAdminAiProvidersRouter(db, adminAuth, deps = {}) {
  const router = Router();
  router.use(adminAuth);

  /** Loads a site-scope provider or 404s. */
  function loadProvider(req, res) {
    const provider = getProvider(db, req.params.id);
    if (!provider || provider.scope !== 'site') {
      res.status(404).json({ error: 'Provider not found' });
      return null;
    }
    return provider;
  }

  router.get('/', (req, res) => {
    res.json({ ok: true, providers: listSiteProviders(db) });
  });

  router.post('/', (req, res) => {
    const input = { ...req.body, scope: 'site' };
    const err = validateProviderInput(input);
    if (err) return res.status(400).json({ error: err });
    const provider = createProvider(db, input);
    res.status(201).json({ ok: true, provider });
  });

  router.put('/:id', (req, res) => {
    if (!loadProvider(req, res)) return;
    const err = validateProviderInput(req.body, { partial: true });
    if (err) return res.status(400).json({ error: err });
    const provider = updateProvider(db, req.params.id, req.body);
    res.json({ ok: true, provider });
  });

  router.delete('/:id', (req, res) => {
    if (!loadProvider(req, res)) return;
    deleteProvider(db, req.params.id);
    res.json({ ok: true });
  });

  router.post('/:id/discover', async (req, res) => {
    const provider = loadProvider(req, res);
    if (!provider) return;
    const result = await discoverProvider(db, provider, deps);
    res.status(result.ok ? 200 : 502).json({
      ...result,
      provider: maskProvider(getProvider(db, provider.id)),
      models: listProviderModels(db, provider.id),
    });
  });

  router.get('/:id/models', (req, res) => {
    if (!loadProvider(req, res)) return;
    res.json({ ok: true, models: listProviderModels(db, req.params.id) });
  });

  router.post('/:id/models', (req, res) => {
    const provider = loadProvider(req, res);
    if (!provider) return;
    if (provider.kind !== 'ollama') {
      return res.status(400).json({ error: 'Model catalog only applies to ollama providers' });
    }
    const { modelName, capabilities } = req.body || {};
    if (typeof modelName !== 'string' || !modelName.trim()) {
      return res.status(400).json({ error: 'modelName is required' });
    }
    const model = addManualModel(db, provider.id, { modelName: modelName.trim(), capabilities: Array.isArray(capabilities) ? capabilities : [] });
    if (!model) return res.status(409).json({ error: 'Model already exists for this provider' });
    res.status(201).json({ ok: true, model });
  });

  router.put('/:id/models/:modelId', (req, res) => {
    if (!loadProvider(req, res)) return;
    const { capabilities, enabled } = req.body || {};
    const model = updateModel(db, req.params.id, Number(req.params.modelId), { capabilities, enabled });
    if (!model) return res.status(404).json({ error: 'Model not found' });
    res.json({ ok: true, model });
  });

  router.delete('/:id/models/:modelId', (req, res) => {
    if (!loadProvider(req, res)) return;
    const deleted = deleteModel(db, req.params.id, Number(req.params.modelId));
    if (!deleted) return res.status(404).json({ error: 'Model not found' });
    res.json({ ok: true });
  });

  router.get('/:id/grants', (req, res) => {
    if (!loadProvider(req, res)) return;
    res.json({ ok: true, grants: listGrants(db, req.params.id) });
  });

  router.put('/:id/grants/:apiKey', (req, res) => {
    if (!loadProvider(req, res)) return;
    const enabled = req.body?.enabled !== false;
    setGrant(db, req.params.id, req.params.apiKey, enabled);
    res.json({ ok: true });
  });

  return router;
}
