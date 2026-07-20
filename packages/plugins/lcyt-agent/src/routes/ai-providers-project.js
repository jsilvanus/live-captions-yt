/**
 * Project-level AI provider registry routes (plan/ai_model_registry).
 * Mounted at /ai/providers, behind session JWT auth.
 *
 *   GET    /              — providers visible to this project:
 *                           granted site-scope + own project-scope (masked)
 *   POST   /              — create a project-scope provider (e.g. the
 *                           project's own bridge-relayed Ollama)
 *   PUT    /:id           — only own project-scope providers; a merely-granted
 *                           site provider is read-only here
 *   DELETE /:id           — only own project-scope providers
 *   POST   /:id/discover  — works for either scope, subject to visibility
 *   GET    /:id/models    — subject to visibility
 */

import { Router } from 'express';
import {
  createProvider, updateProvider, deleteProvider, getProvider,
  maskProvider, listVisibleProviders, isProviderVisible, validateProviderInput,
  listProviderModels,
} from '../provider-registry.js';
import { discoverProvider } from '../discovery.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — session JWT middleware
 * @param {{ bridgeManager?: object, isExplicitProjectAdmin?: (apiKey: string, userId: number) => boolean }} [deps]
 * @returns {import('express').Router}
 */
export function createProjectAiProvidersRouter(db, auth, deps = {}) {
  const router = Router();
  router.use(auth);

  router.use((req, res, next) => {
    if (!req.session?.apiKey) return res.status(401).json({ error: 'No API key in session' });
    next();
  });

  /**
   * Adding/editing/removing a project AI provider means storing a real
   * credential (an API key, or a bridge-relayed endpoint) — a Setup-tier
   * action, so org-baseline access (granted automatically to any org member
   * via the shared project-access middleware) is not enough; it requires an
   * explicit project_members owner/admin row for the authenticated user.
   * lcyt-agent has no direct access to lcyt-backend's project_members table
   * (plugin boundary), so this check is injected from the composition root.
   * GET/discover/models stay reachable to anyone who already passed the
   * broader project-access gate.
   */
  function requireExplicitAdmin(req, res, next) {
    if (typeof deps.isExplicitProjectAdmin !== 'function') {
      return res.status(403).json({ error: 'Explicit project owner/admin access required' });
    }
    if (!req.user?.userId || !deps.isExplicitProjectAdmin(req.session.apiKey, req.user.userId)) {
      return res.status(403).json({ error: 'Explicit project owner/admin access required' });
    }
    next();
  }

  /** Loads a provider visible to this project or 404s. */
  function loadVisible(req, res) {
    const provider = getProvider(db, req.params.id);
    if (!provider || !isProviderVisible(db, provider, req.session.apiKey)) {
      res.status(404).json({ error: 'Provider not found' });
      return null;
    }
    return provider;
  }

  /** Loads a provider this project owns (project-scope) or 404s/403s. */
  function loadOwned(req, res) {
    const provider = getProvider(db, req.params.id);
    if (!provider || !isProviderVisible(db, provider, req.session.apiKey)) {
      res.status(404).json({ error: 'Provider not found' });
      return null;
    }
    if (provider.scope !== 'project' || provider.owner_api_key !== req.session.apiKey) {
      res.status(403).json({ error: 'Granted site providers are read-only for projects' });
      return null;
    }
    return provider;
  }

  router.get('/', (req, res) => {
    res.json({ ok: true, providers: listVisibleProviders(db, req.session.apiKey) });
  });

  router.post('/', requireExplicitAdmin, (req, res) => {
    const input = { ...req.body, scope: 'project', ownerApiKey: req.session.apiKey };
    const err = validateProviderInput(input);
    if (err) return res.status(400).json({ error: err });
    const provider = createProvider(db, input);
    res.status(201).json({ ok: true, provider });
  });

  router.put('/:id', requireExplicitAdmin, (req, res) => {
    if (!loadOwned(req, res)) return;
    const err = validateProviderInput(req.body, { partial: true });
    if (err) return res.status(400).json({ error: err });
    const provider = updateProvider(db, req.params.id, req.body);
    res.json({ ok: true, provider });
  });

  router.delete('/:id', requireExplicitAdmin, (req, res) => {
    if (!loadOwned(req, res)) return;
    deleteProvider(db, req.params.id);
    res.json({ ok: true });
  });

  router.post('/:id/discover', async (req, res) => {
    const provider = loadVisible(req, res);
    if (!provider) return;
    const result = await discoverProvider(db, provider, deps);
    res.status(result.ok ? 200 : 502).json({
      ...result,
      provider: maskProvider(getProvider(db, provider.id)),
      models: listProviderModels(db, provider.id),
    });
  });

  router.get('/:id/models', (req, res) => {
    if (!loadVisible(req, res)) return;
    res.json({ ok: true, models: listProviderModels(db, req.params.id) });
  });

  return router;
}
