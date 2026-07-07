/**
 * Production Assistant routes (plan/ai_roles_framework, Runtime Shape 2).
 *
 *   POST /roles/assistant/prompt              — one-off human nudge into Assistant's context
 *   GET  /roles/assistant/suggestions         — pending suggestions (confirm mode)
 *   POST /roles/assistant/suggestions/:id/confirm | /reject
 *   GET  /roles/assistant/events              — SSE: assistant_suggestion, assistant_action
 */

import { Router } from 'express';
import { getRole, getRoleConfig, effectiveMode } from '../ai-roles.js';
import { getProvider } from '../provider-registry.js';
import { resolveRoleProviderSettings } from '../agentic-turn.js';
import { resolveToolAllowlist } from './roles-chat.js';

const DEFAULT_SYSTEM_PROMPT = 'You are the Production Assistant for a live-broadcast platform. Given recent tracker/describer/STT/user context, decide whether a camera preset or mixer source switch is warranted right now. Only propose a device change when the context clearly calls for it — otherwise reply with no tool call.';

/**
 * Build a system prompt including a fresh list of the project's cameras and
 * mixers, so the LLM always references real, current device ids/names.
 * @param {{ listCameras?: Function, listMixers?: Function, registry?: object, db: object }} production
 */
function buildSystemPrompt(harnessConfig, production) {
  const base = harnessConfig.systemPromptOverride || DEFAULT_SYSTEM_PROMPT;
  if (!production?.listCameras || !production?.listMixers) return base;
  const cameras = production.listCameras(production.db);
  const mixers = production.listMixers(production.db, production.registry);
  const deviceList = [
    'Cameras:',
    ...cameras.map((c) => `- id=${c.id} name="${c.name}"`),
    'Mixers:',
    ...mixers.map((m) => `- id=${m.id} name="${m.name}" activeSource=${m.activeSource ?? 'unknown'}`),
  ].join('\n');
  return `${base}\n\n${deviceList}`;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {{ tools: Array, callTool: Function }} toolsContext
 * @param {import('../production-assistant.js').ProductionAssistantManager} manager
 * @param {import('../roles-bus.js').RolesBus} rolesBus
 * @param {import('../agent-engine.js').AgentEngine} agent
 * @param {{ listCameras?, listMixers?, registry?, db? }} [production]
 * @returns {import('express').Router}
 */
export function createProductionAssistantRouter(db, auth, toolsContext, manager, rolesBus, agent, production) {
  const router = Router();
  router.use(auth);

  function loadConfigOr503(req, res) {
    const apiKey = req.session?.apiKey;
    if (!apiKey) { res.status(401).json({ error: 'No API key in session' }); return null; }
    const role = getRole(db, 'assistant');
    const config = getRoleConfig(db, apiKey, 'assistant');
    if (!config.enabled) { res.status(503).json({ error: 'Role is not enabled for this project' }); return null; }
    const providerRow = config.providerId ? getProvider(db, config.providerId) : null;
    const apiSettings = resolveRoleProviderSettings(providerRow, config.modelName);
    if (!apiSettings) { res.status(503).json({ error: 'AI provider not configured or unsupported' }); return null; }
    return { apiKey, role, config, apiSettings };
  }

  router.post('/prompt', async (req, res) => {
    const loaded = loadConfigOr503(req, res);
    if (!loaded) return;
    const { apiKey, role, config, apiSettings } = loaded;
    const { text } = req.body || {};

    const tools = resolveToolAllowlist(role, config.harnessConfig, toolsContext.tools);
    const systemPrompt = buildSystemPrompt(config.harnessConfig, production ? { ...production, db } : null);
    const mode = effectiveMode(config.harnessConfig);

    const result = await manager.runTrigger({
      apiKey, triggerText: text, agent, apiSettings, systemPrompt, tools,
      callTool: toolsContext.callTool, mode, cooldownMs: config.harnessConfig.cooldownMs,
    });
    if (!result.ok) return res.status(503).json(result);
    res.json(result);
  });

  router.get('/suggestions', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    res.json({ ok: true, suggestions: manager.listSuggestions(apiKey) });
  });

  router.post('/suggestions/:id/confirm', async (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const result = await manager.confirmSuggestion(apiKey, req.params.id, toolsContext.callTool);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  router.post('/suggestions/:id/reject', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const removed = manager.rejectSuggestion(apiKey, req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Suggestion not found' });
    res.json({ ok: true });
  });

  router.get('/events', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('event: connected\ndata: {}\n\n');
    rolesBus.addSubscriber(apiKey, 'assistant', res);
    req.on('close', () => rolesBus.removeSubscriber(apiKey, 'assistant', res));
  });

  return router;
}
