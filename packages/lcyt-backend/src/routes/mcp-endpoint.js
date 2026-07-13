/**
 * In-process MCP endpoint (Phase 1 — plan_unified_external_control.md).
 *
 * Mounts a Streamable-HTTP-style MCP transport inside lcyt-backend, backed by
 * the same _toolRegistry the composition root builds (server.js). This resolves
 * the CONSIDER.md "external MCP transport" gap by exposing the shared tool
 * registry over a real MCP protocol endpoint — no separate process, no HTTP
 * proxy round-trip.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST (MCP Streamable HTTP). Clients send
 * `tools/list` and `tools/call` requests; the endpoint responds synchronously.
 * Server-initiated notifications (e.g. resource updates) are not yet needed
 * and can be added later over SSE on GET.
 *
 * Auth: `createProjectAccessMiddleware(..., { requiredScope: 'mcp:connect' })`.
 * Tool-level authz: each tool declares required scopes; the endpoint lists only
 * callable tools and enforces on invoke.
 *
 * Safety: destructiveHint tools are staged for operator confirmation (reuse the
 * Production Assistant confirm/auto gate) unless the token has no scope
 * restrictions (full delegation). Read-only tools run immediately.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { tokenHasScope } from '../db/mcp-tokens.js';

// --- Tool scope mapping ---

/**
 * Derive the required scope for a tool based on its name and annotations.
 * Convention: `<resource>:<verb>` where resource is the tool's domain prefix
 * and verb is 'read' for readOnlyHint, 'write' otherwise.
 */
export function deriveToolScope(tool) {
  const resource = tool.name.split('.')[0].replace(/_/g, '-');
  // Map tool prefixes to scope resources
  const SCOPE_MAP = {
    'caption-target': 'target',
    'camera': 'camera',
    'mixer': 'mixer',
    'dsk-template': 'dsk',
    'asset': 'dsk',
  };
  const mapped = SCOPE_MAP[resource] || resource;
  const verb = tool.annotations?.readOnlyHint ? 'read' : 'write';
  return `${mapped}:${verb}`;
}

/**
 * Check whether a token's scopes allow calling a specific tool.
 * NULL/empty scopes = full delegation (all tools allowed).
 */
function tokenCanCallTool(scopes, tool) {
  if (!scopes || scopes.length === 0) return true;
  const needed = deriveToolScope(tool);
  return tokenHasScope(scopes, needed);
}

// --- JSON-RPC helpers ---

function jsonRpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// --- Rate limiting (simple in-memory per-token) ---

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CALLS = 120; // 120 tool calls per minute per token

class RateLimiter {
  constructor() {
    /** @type {Map<string, { count: number, windowStart: number }>} */
    this._windows = new Map();
  }

  check(key) {
    const now = Date.now();
    let entry = this._windows.get(key);
    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
      entry = { count: 0, windowStart: now };
      this._windows.set(key, entry);
    }
    entry.count++;
    return entry.count <= RATE_MAX_CALLS;
  }
}

/**
 * Create the MCP endpoint router.
 *
 * @param {object} opts
 * @param {ReturnType<import('lcyt-tools').createToolRegistry>} opts.registry
 * @param {import('../../../lcyt/src/event-bus.js').EventBus} opts.eventBus
 * @param {import('better-sqlite3').Database} opts.db
 * @param {import('../../../plugins/lcyt-agent/src/production-assistant.js').ProductionAssistantManager} [opts.assistantManager]
 * @returns {Router}
 */
export function createMcpEndpointRouter({ registry, eventBus, db, assistantManager }) {
  const router = Router();
  const rateLimiter = new RateLimiter();

  // MCP Streamable HTTP: POST / — JSON-RPC 2.0 request(s)
  router.post('/', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json(jsonRpcError(null, -32700, 'Parse error'));
    }

    // Support batch requests (array) or single request. Per the JSON-RPC 2.0
    // spec, a batch must be a non-empty array.
    const isBatch = Array.isArray(body);
    if (isBatch && body.length === 0) {
      return res.status(400).json(jsonRpcError(null, -32600, 'Invalid Request'));
    }
    const requests = isBatch ? body : [body];
    const results = [];

    const projectId = req.auth?.projectId;
    const scopes = req.auth?.scopes || null;
    const tokenId = req.auth?.tokenId || null;

    for (const rpcReq of requests) {
      if (!rpcReq.method || rpcReq.jsonrpc !== '2.0') {
        results.push(jsonRpcError(rpcReq?.id ?? null, -32600, 'Invalid Request'));
        continue;
      }
      results.push(handleRequest(rpcReq, { projectId, scopes, tokenId }));
    }

    // Resolve all (some handlers are async)
    Promise.all(results).then((resolved) => {
      // MCP spec: notifications (no id) get no response
      const responses = resolved.filter((r) => r !== null);
      if (isBatch) {
        res.json(responses);
      } else {
        res.json(responses[0] || {});
      }
    }).catch((err) => {
      res.status(500).json(jsonRpcError(null, INTERNAL_ERROR, err.message));
    });
  });

  // MCP Streamable HTTP: GET / — SSE for server-initiated notifications (optional)
  router.get('/', (req, res) => {
    const projectId = req.auth?.projectId;
    if (!projectId) return res.status(401).json({ error: 'Not authorized' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial endpoint info
    res.write(`event: endpoint\ndata: ${JSON.stringify({ protocolVersion: '2025-03-26' })}\n\n`);

    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
    }, 25000);

    function cleanup() {
      clearInterval(heartbeat);
    }

    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  // DELETE / — session termination (no-op for stateless)
  router.delete('/', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // --- Request handler ---

  async function handleRequest(rpcReq, ctx) {
    const { method, params, id } = rpcReq;
    const { projectId, scopes, tokenId } = ctx;

    // Notifications (no id) don't get a response
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize': {
        const result = {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'lcyt-mcp', version: '1.0.0' },
        };
        return isNotification ? null : jsonRpcResponse(id, result);
      }

      case 'notifications/initialized':
        return null; // notification — no response

      case 'tools/list': {
        // Filter tools by token scopes
        const allTools = registry.tools;
        const visibleTools = allTools.filter((t) => tokenCanCallTool(scopes, t));
        const mcpTools = visibleTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations || undefined,
        }));
        return isNotification ? null : jsonRpcResponse(id, { tools: mcpTools });
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        if (!name) {
          return isNotification ? null : jsonRpcError(id, INVALID_PARAMS, 'Missing tool name');
        }

        // Rate limit — every authenticated caller is bounded, keyed by
        // tokenId when present (external tokens) or projectId otherwise
        // (session/user/device JWTs, which carry no tokenId).
        if (!rateLimiter.check(tokenId ?? projectId)) {
          return isNotification ? null : jsonRpcError(id, -32000, 'Rate limit exceeded', { retryAfter: 60 });
        }

        // Find tool
        const tool = registry.byName.get(name);
        if (!tool) {
          return isNotification ? null : jsonRpcError(id, METHOD_NOT_FOUND, `Unknown tool: ${name}`);
        }

        // Scope check
        if (!tokenCanCallTool(scopes, tool)) {
          return isNotification ? null : jsonRpcError(id, -32001, `Insufficient scope for tool: ${name}`, { requiredScope: deriveToolScope(tool) });
        }

        // Safety gate: destructive tools are staged for confirmation
        // unless the caller is an external token with full delegation
        // (null/empty scopes). Session/user/device JWTs carry no tokenId
        // and always go through staging, even though their `scopes` field
        // is also empty/absent — "full delegation" is a property of scoped
        // external tokens, not of JWT callers in general.
        const isDestructive = tool.annotations?.destructiveHint === true;
        const hasFullDelegation = Boolean(tokenId) && (!scopes || scopes.length === 0);

        if (isDestructive && !hasFullDelegation && assistantManager) {
          // Stage as a suggestion for human confirmation via the assistant
          // manager's public stageSuggestion interface (matches the pattern
          // used by ProductionAssistantManager.runTrigger)
          const suggestion = {
            id: randomUUID(),
            tool: name,
            args: args || {},
            reasoning: `MCP client requested: ${name}`,
            ts: Date.now(),
            source: 'mcp',
            tokenId,
          };
          assistantManager.stageSuggestion(projectId, suggestion);

          // Emit event for the UI
          eventBus.publish(projectId, 'mcp.tool_staged', {
            suggestionId: suggestion.id,
            tool: name,
            args: args || {},
          });

          return isNotification ? null : jsonRpcResponse(id, {
            content: [{ type: 'text', text: JSON.stringify({
              ok: true,
              staged: true,
              suggestionId: suggestion.id,
              message: `Destructive tool "${name}" staged for operator confirmation.`,
            }) }],
          });
        }

        // Execute tool directly
        try {
          const result = await registry.callTool(name, args || {}, { apiKey: projectId });

          // Audit
          eventBus.publish(projectId, 'mcp.tool_executed', {
            tool: name,
            args: args || {},
            tokenId,
            result: typeof result === 'object' ? result : { value: result },
          });

          return isNotification ? null : jsonRpcResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          });
        } catch (err) {
          return isNotification ? null : jsonRpcResponse(id, {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
            isError: true,
          });
        }
      }

      case 'ping':
        return isNotification ? null : jsonRpcResponse(id, {});

      default:
        return isNotification ? null : jsonRpcError(id, METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  return router;
}
