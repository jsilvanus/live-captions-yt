/**
 * Shared agentic_chat turn loop (plan/ai_roles_framework, Runtime Shape 2).
 *
 * One small, hand-rolled tool-calling loop reused by every agentic_chat role
 * (Setup/Asset Control/Graphics Editor Assistant, Production Assistant) —
 * deliberately not an agent-framework dependency (LangChain, Vercel AI SDK,
 * etc.): lcyt-agent is provider-agnostic by design, and every one of those
 * frameworks assumes one vendor's API shape or adds a dependency for what is,
 * in practice, not much code once the wire format isn't being invented too.
 *
 * Uses the standard OpenAI-compatible `tools`/`tool_calls` wire format —
 * Ollama's /v1/chat/completions-compatible endpoint speaks the same shape,
 * so this loop works unmodified for OpenAI, Anthropic-via-proxy, and direct
 * (non-bridge-relayed) Ollama providers.
 */

import logger from 'lcyt/logger';

/**
 * Convert lcyt-tools' plain {name, description, inputSchema} shape into the
 * OpenAI tools wire format.
 * @param {Array<{name, description, inputSchema}>} tools
 */
export function toOpenAiToolSchema(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    },
  }));
}

function safeParseJson(text) {
  if (typeof text !== 'string') return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function buildRequestHeaders(apiSettings, extraHeaders = {}) {
  return {
    'Content-Type': 'application/json',
    ...(apiSettings.apiKey ? { Authorization: 'Bearer ' + apiSettings.apiKey } : {}),
    ...extraHeaders,
  };
}

/**
 * Invoke a model request through either the direct HTTP transport or the
 * bridge-backed transport, returning the parsed response body.
 *
 * @param {{ apiUrl: string, apiKey: string, model: string, transport?: string, bridgeManager?: object, bridgeInstanceId?: string }} apiSettings
 * @param {object} payload
 * @param {{ endpointPath?: string, headers?: object }} [opts]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function invokeModelCall(apiSettings, payload, opts = {}) {
  const endpointPath = opts.endpointPath || '/v1/chat/completions';
  const endpoint = `${apiSettings.apiUrl.replace(/\/$/, '')}${endpointPath}`;
  const headers = buildRequestHeaders(apiSettings, opts.headers || {});

  if (apiSettings.transport === 'bridge') {
    if (!apiSettings.bridgeManager || !apiSettings.bridgeInstanceId) {
      throw new Error('Bridge relay settings are incomplete: missing bridgeManager and/or bridgeInstanceId');
    }
    const result = await apiSettings.bridgeManager.sendCommand(apiSettings.bridgeInstanceId, {
      type: 'model_call',
      endpoint,
      headers,
      payload,
    });
    if (!result.ok) {
      throw new Error(result.error || 'Bridge relay failed');
    }
    return { status: result.status ?? 200, body: result.body };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Chat API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json().catch((err) => {
    throw new Error(`Chat API error ${res.status}: invalid JSON response (${err.message})`);
  });
  return { status: res.status, body: data };
}

/**
 * One OpenAI-compatible chat-completions call with tools attached.
 * @param {{ apiUrl: string, apiKey: string, model: string, transport?: string, bridgeManager?: object, bridgeInstanceId?: string }} apiSettings
 * @param {Array<object>} messages
 * @param {Array<object>} openAiTools
 * @returns {Promise<{ role: string, content: string|null, tool_calls?: Array }>}
 */
export async function callChatCompletionWithTools(apiSettings, messages, openAiTools) {
  const result = await invokeModelCall(apiSettings, {
    model: apiSettings.model,
    messages,
    ...(openAiTools.length > 0 ? { tools: openAiTools } : {}),
    temperature: 0.2,
  });
  const data = result.body;
  const message = data?.choices?.[0]?.message;
  if (!message || typeof message !== 'object') {
    throw new Error('Unexpected chat API response format');
  }
  return message;
}

/**
 * Resolve a role's chat-completions settings from its raw ai_providers row
 * (plan/ai_model_registry) + the role config's own model_name.
 *
 * @param {object|null} providerRow — raw row from provider-registry.js's getProvider()
 * @param {string} modelName — project_ai_role_configs.model_name
 * @param {{ bridgeManager?: object }} [deps]
 * @returns {{ apiUrl: string, apiKey: string, model: string, transport?: 'bridge', bridgeManager?: object, bridgeInstanceId?: string }|null}
 */
export function resolveRoleProviderSettings(providerRow, modelName, deps = {}) {
  if (!providerRow || !providerRow.enabled) return null;
  if (providerRow.kind === 'deer') return null;
  if (!providerRow.base_url) return null;
  const settings = {
    apiUrl: providerRow.base_url,
    apiKey: providerRow.api_key_ref || '',
    model: modelName || '',
  };
  if (providerRow.bridge_instance_id) {
    if (!deps.bridgeManager) return null;
    return {
      ...settings,
      transport: 'bridge',
      bridgeManager: deps.bridgeManager,
      bridgeInstanceId: providerRow.bridge_instance_id,
    };
  }
  return settings;
}

/**
 * Default shouldExecute: read-only tools always run in-loop (the LLM needs
 * real data to keep reasoning); everything else is deferred to the caller's
 * own gating.
 */
export function defaultShouldExecute(_name, annotations) {
  return annotations?.readOnlyHint === true;
}

/**
 * Gate for the chat-driven-dialog roles (Setup/Asset Control/Graphics Editor
 * Assistant): read-only tools always run; destructive tools NEVER auto-run
 * through the turn loop (the hard rule from plan_ai_roles_framework.md —
 * deletes always go through the target's own confirm-delete dialog
 * regardless of mode); everything else runs only in 'auto' mode.
 * @param {'confirm'|'auto'} mode — effectiveMode(harnessConfig)
 */
export function makeDialogShouldExecute(mode) {
  return (_name, annotations = {}) => {
    if (annotations.readOnlyHint) return true;
    if (annotations.destructiveHint) return false;
    return mode === 'auto';
  };
}

/**
 * Run one agentic_chat turn to completion or until a tool call is held back.
 *
 * When every tool call in a given exchange passes `shouldExecute`, they run
 * and the loop continues. The moment ANY tool call in an exchange fails
 * `shouldExecute`, the whole exchange is held back (not partially executed —
 * a mix of executed/held calls in one turn could depend on each other's
 * side effects) and returned as `pendingActions` for the caller to stage,
 * queue, or otherwise act on.
 *
 * @param {object} opts
 * @param {{ apiUrl, apiKey, model }} opts.apiSettings
 * @param {string} opts.systemPrompt
 * @param {Array<{role, content}>} opts.messages — conversation so far (system prompt excluded)
 * @param {Array<{name, description, inputSchema, annotations}>} opts.tools — the allowlisted tool set
 * @param {(name: string, args: object, ctx: { apiKey: string }) => Promise<object>} opts.callTool
 * @param {string} opts.apiKey
 * @param {(name: string, annotations: object) => boolean} [opts.shouldExecute] — defaults to read-only-only
 * @param {number} [opts.maxIterations=5]
 * @returns {Promise<{ done: boolean, reply: string, pendingActions: Array<{name, args}>, toolCalls: Array, messages: Array }>}
 */
export async function runAgenticTurn(opts) {
  const {
    apiSettings, systemPrompt, messages, tools, callTool, apiKey,
    shouldExecute = defaultShouldExecute, maxIterations = 5,
  } = opts;

  const annotationsByName = new Map(tools.map((t) => [t.name, t.annotations ?? {}]));
  const openAiTools = toOpenAiToolSchema(tools);
  const chatMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  const toolCallLog = [];

  for (let i = 0; i < maxIterations; i++) {
    let message;
    try {
      message = await callChatCompletionWithTools(apiSettings, chatMessages, openAiTools);
    } catch (err) {
      logger.warn(`[agent] agentic turn chat completion failed: ${err.message}`);
      return { done: true, reply: '', pendingActions: [], toolCalls: toolCallLog, messages: chatMessages, error: err.message };
    }
    chatMessages.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      return { done: true, reply: message.content ?? '', pendingActions: [], toolCalls: toolCallLog, messages: chatMessages };
    }

    const parsedCalls = calls.map((c) => ({
      id: c.id,
      name: c.function.name,
      args: safeParseJson(c.function.arguments),
      annotations: annotationsByName.get(c.function.name) ?? {},
    }));

    const allExecutable = parsedCalls.every((c) => shouldExecute(c.name, c.annotations));
    if (!allExecutable) {
      return {
        done: false,
        reply: message.content ?? '',
        pendingActions: parsedCalls.map(({ name, args }) => ({ name, args })),
        toolCalls: toolCallLog,
        messages: chatMessages,
      };
    }

    for (const call of parsedCalls) {
      let result;
      try {
        result = await callTool(call.name, call.args, { apiKey });
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      toolCallLog.push({ name: call.name, args: call.args, result });
      chatMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return { done: false, reply: '', pendingActions: [], toolCalls: toolCallLog, messages: chatMessages, truncated: true };
}
