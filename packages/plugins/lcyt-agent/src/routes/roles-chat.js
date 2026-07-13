/**
 * Chat-driven-dialog agentic_chat roles (plan/ai_roles_framework, Runtime
 * Shape 2): Setup Assistant, Asset Control Assistant, Graphics Editor
 * Assistant. Planner is excluded here — it never calls tools and gets its
 * own `/roles/planner/assist` route.
 *
 *   POST /roles/:roleCode/message  { text, conversationId? }
 *     — runs one shared-turn-loop exchange against the role's tool allowlist
 *
 * The turn itself runs synchronously inside the POST handler (this repo's
 * chat-completion calls are non-streaming, matching AgentEngine's existing
 * _callChatCompletion) — SSE events are emitted as the turn progresses for
 * any active subscriber, and the POST response also carries the final
 * result directly, so a client doesn't have to subscribe to receive a reply.
 */

import { Router } from 'express';
import { getRole, getRoleConfig, effectiveMode } from '../ai-roles.js';
import { getProvider } from '../provider-registry.js';
import { runAgenticTurn, makeDialogShouldExecute, resolveRoleProviderSettings } from '../agentic-turn.js';

const CHAT_DIALOG_ROLES = new Set(['setup_assistant', 'asset_control_assistant', 'dsk_designer']);

const SYSTEM_PROMPTS = {
  setup_assistant: 'You are the Setup Assistant for a live-captioning broadcast platform. Help the operator configure caption delivery targets, cameras, and mixers by calling the available tools. Prefer listing current state before making changes.',
  asset_control_assistant: 'You are the Asset Control Assistant. Help the operator manage uploaded DSK overlay image assets by calling the available tools.',
  dsk_designer: 'You are the Graphics Editor Assistant. Generate, edit, and suggest styles for DSK overlay templates from natural-language instructions by calling the available tools.',
};

/**
 * Filter a role's full tool set down to its configured allowlist (a subset
 * of the role's available_tools), or the full set when unconfigured.
 */
function resolveToolAllowlist(role, harnessConfig, allTools) {
  const allowedNames = new Set(
    Array.isArray(harnessConfig.toolAllowlist) && harnessConfig.toolAllowlist.length > 0
      ? harnessConfig.toolAllowlist
      : role.availableTools,
  );
  return allTools.filter((t) => allowedNames.has(t.name));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — session JWT middleware
 * @param {{ tools: Array, callTool: Function }} toolsContext — from lcyt-tools' registry (or its in-process MCP bridge, wrapped)
 * @param {import('../roles-bus.js').RolesBus} rolesBus
 * @returns {import('express').Router}
 */
export function createRolesChatRouter(db, auth, toolsContext, rolesBus, bridgeManager = null) {
  const router = Router();
  router.use(auth);

  router.post('/:roleCode/message', async (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });

    const { roleCode } = req.params;
    if (!CHAT_DIALOG_ROLES.has(roleCode)) return res.status(404).json({ error: 'Unknown role' });

    const role = getRole(db, roleCode);
    if (!role) return res.status(404).json({ error: 'Unknown role' });

    const { text, conversationId } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });

    const config = getRoleConfig(db, apiKey, roleCode);
    if (!config.enabled) return res.status(503).json({ error: 'Role is not enabled for this project' });

    const providerRow = config.providerId ? getProvider(db, config.providerId) : null;
    const apiSettings = resolveRoleProviderSettings(providerRow, config.modelName, { bridgeManager });
    if (!apiSettings) return res.status(503).json({ error: 'AI provider not configured or unsupported' });

    const tools = resolveToolAllowlist(role, config.harnessConfig, toolsContext.tools);
    const mode = effectiveMode(config.harnessConfig);
    const systemPrompt = config.harnessConfig.systemPromptOverride || SYSTEM_PROMPTS[roleCode];

    const emit = (event, data) => rolesBus.emit(apiKey, roleCode, event, { conversationId, ...data });

    const result = await runAgenticTurn({
      apiSettings,
      systemPrompt,
      messages: [{ role: 'user', content: text }],
      tools,
      apiKey,
      shouldExecute: makeDialogShouldExecute(mode),
      callTool: async (name, args, ctx) => {
        emit('tool_call_started', { name, args });
        const toolResult = await toolsContext.callTool(name, args, ctx);
        emit('tool_call_result', { name, args, result: toolResult });
        return toolResult;
      },
    });

    if (result.error) {
      return res.status(503).json({ ok: false, error: result.error });
    }

    if (result.pendingActions.length > 0) {
      emit('staged_action', { reply: result.reply, pendingActions: result.pendingActions, mode });
      return res.json({ ok: true, reply: result.reply, pendingActions: result.pendingActions, toolCalls: result.toolCalls });
    }

    emit('reply', { reply: result.reply });
    return res.json({ ok: true, reply: result.reply, pendingActions: [], toolCalls: result.toolCalls });
  });

  return router;
}

export { CHAT_DIALOG_ROLES, resolveToolAllowlist };
