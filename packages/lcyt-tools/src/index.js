/**
 * lcyt-tools — shared tool-schema/handler registry (plan/mcp).
 *
 * Every tool used by any agentic_chat role (plan/ai_roles_framework) is
 * defined once, here, and reused by two kinds of consumer:
 *   - MCP servers (lcyt-mcp-http today) register these tools alongside their
 *     existing caption/production/graphics tools, reachable by external
 *     clients (Claude Desktop, Claude Code) over real MCP transport.
 *   - lcyt-agent connects to the same schema as an in-process MCP Client,
 *     over InMemoryTransport, for its agentic_chat turn loop — see
 *     createInProcessMcpBridge() below. This is why the module builds a real
 *     `@modelcontextprotocol/sdk` Server rather than a plain function export:
 *     a plain import risks the in-process shape and the externally-registered
 *     shape drifting apart; going through the same Server object for both
 *     consumers makes that structurally impossible.
 *
 * Tool ids match `ai_roles.available_tools` / `harness_config.toolAllowlist`
 * from plan/ai_roles_framework exactly.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { createCaptionTargetTools } from './tools/caption-targets.js';
import { createCameraTools } from './tools/cameras.js';
import { createMixerTools } from './tools/mixers.js';
import { createDskTemplateTools } from './tools/dsk-templates.js';
import { createAssetTools } from './tools/assets.js';

/**
 * Build the full tool registry.
 *
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {object} [deps.captionTargets] — { getCaptionTargets, createCaptionTarget, updateCaptionTarget, deleteCaptionTarget } from 'lcyt-backend/db'
 * @param {object} [deps.production] — { registry, bridgeManager, listCameras, getCameraById, createCamera, updateCamera, deleteCamera, listMixers, getMixerById, createMixer, updateMixer, deleteMixer, buildSwitchCommand } from 'lcyt-production'
 * @param {import('lcyt-agent').AgentEngine} [deps.agent] — for dsk_template.* tools
 * @param {object} [deps.assets] — { listImages, getImageByKey, updateImageSettings, deleteImage } from 'lcyt-dsk'
 * @returns {{ tools: Array<{name, description, inputSchema, annotations}>, callTool: Function, byName: Map }}
 */
export function createToolRegistry(deps = {}) {
  const { db, captionTargets, production, agent, assets } = deps;

  const groups = [];
  if (captionTargets) groups.push(createCaptionTargetTools({ db, ...captionTargets }));
  if (production) {
    groups.push(createCameraTools({ db, registry: production.registry, bridgeManager: production.bridgeManager, ...production }));
    groups.push(createMixerTools({ db, registry: production.registry, bridgeManager: production.bridgeManager, ...production }));
  }
  if (agent) groups.push(createDskTemplateTools({ agent }));
  if (assets) groups.push(createAssetTools({ db, ...assets }));

  const entries = groups.flat();
  const byName = new Map(entries.map((t) => [t.name, t]));

  const tools = entries.map(({ name, description, inputSchema, annotations }) => ({
    name, description, inputSchema, annotations,
  }));

  /**
   * @param {string} name
   * @param {object} args
   * @param {{ apiKey: string }} ctx
   * @returns {Promise<object>}
   */
  async function callTool(name, args, ctx) {
    const tool = byName.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (!ctx?.apiKey) throw new Error(`Tool "${name}" requires an apiKey in call context`);
    return tool.handler(args ?? {}, ctx);
  }

  return { tools, callTool, byName };
}

/**
 * Register a tool registry on a real MCP Server, and connect an in-process
 * Client to it over InMemoryTransport.createLinkedPair() — no subprocess, no
 * network hop, but real tools/list + tools/call semantics, so lcyt-agent's
 * turn loop sees exactly the schema an external MCP client would see.
 *
 * The MCP SDK's Client has no supported way to attach out-of-band auth
 * context to an outgoing request (authInfo is populated server-side from a
 * transport's own auth layer, e.g. a verified HTTP bearer token — it isn't
 * something a Client can set for itself). Since this bridge has exactly one
 * trusted in-process caller (lcyt-agent), apiKey is instead threaded through
 * as a reserved `_apiKey` argument, stripped out of `arguments` before it
 * reaches the tool handler so no tool ever sees it as a real input.
 *
 * @param {ReturnType<typeof createToolRegistry>} registry
 * @param {{ name?: string, version?: string }} [serverInfo]
 * @returns {{ server: Server, client: Client, connect(): Promise<void>, callToolAs(apiKey, name, args): Promise<object> }}
 */
export function createInProcessMcpBridge(registry, serverInfo = {}) {
  const server = new Server(
    { name: serverInfo.name ?? 'lcyt-tools', version: serverInfo.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: registry.tools }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: rawArgs } }) => {
    const { _apiKey: apiKey, ...args } = rawArgs ?? {};
    try {
      const result = await registry.callTool(name, args, { apiKey });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  });

  const client = new Client({ name: 'lcyt-agent', version: '0.1.0' }, { capabilities: {} });

  let connected = null;
  function connect() {
    if (!connected) {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      connected = Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    }
    return connected;
  }

  /**
   * Call a tool as a specific project.
   */
  async function callToolAs(apiKey, name, args) {
    await connect();
    const result = await client.callTool({ name, arguments: { ...(args ?? {}), _apiKey: apiKey } });
    const text = result?.content?.[0]?.text;
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (result?.isError) throw new Error(parsed?.error || `Tool "${name}" failed`);
    return parsed;
  }

  return { server, client, connect, callToolAs };
}
