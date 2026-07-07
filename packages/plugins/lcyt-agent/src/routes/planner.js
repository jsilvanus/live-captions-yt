/**
 * Planner Assistant (plan_ai_roles_framework.md's Planner role) — chat
 * trigger, no tools. Formally absorbs the already-implemented
 * generateRundown/editRundown capability, giving it a real
 * project_ai_role_configs row so systemPromptOverride and model/provider
 * are project-configurable instead of baked into AgentEngine's call sites.
 *
 *   POST /roles/planner/assist
 *     Body: { currentPlan?, goal, templateId? } → { ok, content }
 *     currentPlan omitted/empty → generate from scratch (optionally seeded
 *     from AgentEngine.RUNDOWN_TEMPLATE_LIBRARY[templateId]); currentPlan
 *     present → edit existing content per goal.
 *
 * Supersedes and replaces POST /agent/generate-rundown / POST /agent/edit-rundown
 * (removed from routes/agent.js) — kept as one merged route rather than three
 * doing the same job, per this repo's no-back-compat-burden convention.
 *
 * Needs none of the start/stop/SSE machinery Tracker/Describer/the
 * tool-bearing roles get, since Planner has no continuous loop and never
 * touches tools — just this route plus the standard GET/PUT
 * /roles/planner/config (already generic in routes/roles.js).
 */

import { Router } from 'express';
import { getRoleConfig } from '../ai-roles.js';
import { getProvider } from '../provider-registry.js';
import { resolveRoleProviderSettings } from '../agentic-turn.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — session JWT middleware
 * @param {import('../agent-engine.js').AgentEngine} agent
 * @returns {import('express').Router}
 */
export function createPlannerRouter(db, auth, agent) {
  const router = Router();
  router.use(auth);

  router.post('/assist', async (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });

    const { currentPlan, goal, templateId } = req.body || {};
    if (typeof goal !== 'string' || !goal.trim()) return res.status(400).json({ error: 'goal is required' });

    const config = getRoleConfig(db, apiKey, 'planner');
    if (!config.enabled) return res.status(503).json({ error: 'Role is not enabled for this project' });

    const providerRow = config.providerId ? getProvider(db, config.providerId) : null;
    const apiSettings = resolveRoleProviderSettings(providerRow, config.modelName);
    if (!apiSettings) return res.status(503).json({ error: 'AI provider not configured or unsupported (bridge-relayed and deer providers are not yet supported for agentic_chat)' });

    const opts = {
      systemPromptOverride: config.harnessConfig.systemPromptOverride,
      templateId: templateId || config.harnessConfig.defaultTemplateId,
    };

    const content = currentPlan
      ? await agent.editRundown(apiSettings, currentPlan, goal, opts)
      : await agent.generateRundown(apiSettings, goal, opts);

    res.json({ ok: true, content });
  });

  return router;
}
