#!/usr/bin/env node
/**
 * MCP server for lcyt — sends live captions to YouTube Live streams.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { YoutubeLiveCaptionSender } from "lcyt";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

// ── Backend helpers ───────────────────────────────────────────────────────────

const BACKEND_URL = (process.env.LCYT_BACKEND_URL ?? "").replace(/\/$/, "");
const API_KEY     = process.env.LCYT_API_KEY  ?? "";
const ADMIN_KEY   = process.env.LCYT_ADMIN_KEY ?? "";

async function backendGet(path, headers) {
  if (!BACKEND_URL) return JSON.stringify({ error: "LCYT_BACKEND_URL is not configured" });
  const res = await fetch(`${BACKEND_URL}${path}`, { headers });
  return res.text();
}

async function backendPost(path, headers, body) {
  if (!BACKEND_URL) return JSON.stringify({ error: "LCYT_BACKEND_URL is not configured" });
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return res.text();
}

// ── Tool definitions ─────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: "start",
    description: "Create a caption sender and start a session. Returns a session_id.",
    inputSchema: {
      type: "object",
      properties: {
        stream_key: {
          type: "string",
          description: "YouTube Live stream key (cid value).",
        },
      },
      required: ["stream_key"],
    },
  },
  {
    name: "send_caption",
    description: "Send a single caption to the live stream.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        text: { type: "string", description: "Caption text to send." },
        timestamp: {
          type: "string",
          description: "ISO-8601 timestamp. Omit to use the current time.",
        },
      },
      required: ["session_id", "text"],
    },
  },
  {
    name: "send_batch",
    description: "Send multiple captions atomically.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        captions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              timestamp: { type: "string" },
            },
            required: ["text"],
          },
          description: "Array of {text, timestamp?} objects.",
        },
      },
      required: ["session_id", "captions"],
    },
  },
  {
    name: "sync_clock",
    description:
      "NTP-style round-trip to YouTube to compute clock sync offset. Returns syncOffset in ms.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_status",
    description: "Return current sequence number and sync offset for the session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "stop",
    description: "End the session and clean up the sender.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },

  // ── Production tools ────────────────────────────────────────────────────────
  {
    name: "list_cameras",
    description: "List all cameras with their id, name, mixerInput, controlType, and controlConfig.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "camera_preset",
    description: "Trigger a PTZ preset on a camera. Returns { ok, cameraId, presetId }.",
    inputSchema: {
      type: "object",
      properties: {
        camera_id: { type: "string", description: "Camera ID." },
        preset_id: { type: "string", description: "Preset ID to trigger." },
      },
      required: ["camera_id", "preset_id"],
    },
  },
  {
    name: "list_mixers",
    description: "List all mixers with id, name, type, connected, and activeSource.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "switch_source",
    description: "Switch the mixer's live program source. Returns { ok, mixerId, activeSource }.",
    inputSchema: {
      type: "object",
      properties: {
        mixer_id: { type: "string", description: "Mixer ID." },
        input: { type: "integer", minimum: 1, description: "Input number (positive integer)." },
      },
      required: ["mixer_id", "input"],
    },
  },

  // ── Graphics / DSK tools ────────────────────────────────────────────────────
  {
    name: "list_dsk_templates",
    description: "List all saved DSK overlay templates for the API key. Returns [{ id, name, updated_at }].",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "activate_dsk_template",
    description: "Load a DSK template into the Playwright renderer. Returns { ok, id, name }.",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "integer", description: "Template ID to activate." },
      },
      required: ["template_id"],
    },
  },
  {
    name: "broadcast_dsk_data",
    description: "Inject live text into the renderer DOM without page reload. Accepts an array of {selector, text} objects.",
    inputSchema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              selector: { type: "string", description: "CSS selector to target." },
              text: { type: "string", description: "Text to inject." },
            },
            required: ["selector", "text"],
          },
          description: "Array of {selector, text} updates.",
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "dsk_renderer_status",
    description: "Get DSK renderer running state for the API key. Returns { running, rtmpUrl? }.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "start_dsk_renderer",
    description: "Start DSK Playwright capture loop → ffmpeg → nginx-rtmp. Returns { ok, rtmpUrl }.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "stop_dsk_renderer",
    description: "Stop DSK capture loop and ffmpeg. Returns { ok }.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── Handler factory (exported for testing with a fake sender) ────────────────

/**
 * Creates isolated handler functions backed by their own sessions map.
 * Pass a custom SenderClass to inject a fake in tests.
 *
 * @param {typeof YoutubeLiveCaptionSender} SenderClass
 */
export function createHandlers(SenderClass = YoutubeLiveCaptionSender) {
  /** @type {Map<string, InstanceType<typeof SenderClass>>} */
  const sessions = new Map();
  /** @type {Map<string, {startedAt: string}>} */
  const sessionMeta = new Map();

  function getSession(sessionId) {
    const sender = sessions.get(sessionId);
    if (!sender) throw new Error(`Unknown session_id: ${JSON.stringify(sessionId)}`);
    return sender;
  }

  async function handleListTools() {
    return { tools: TOOLS };
  }

  async function handleListResources() {
    return {
      resources: [...sessions.keys()].map((sid) => ({
        uri: `session://${sid}`,
        name: `Session ${sid}`,
        description: "JSON snapshot of the caption session state.",
        mimeType: "application/json",
      })),
    };
  }

  async function handleReadResource(uri) {
    const prefix = "session://";
    if (!uri.startsWith(prefix)) throw new Error(`Unknown resource URI: ${JSON.stringify(uri)}`);
    const sessionId = uri.slice(prefix.length);
    const sender = getSession(sessionId);
    const meta = sessionMeta.get(sessionId) ?? {};
    return JSON.stringify({
      sequence: sender.sequence,
      syncOffset: sender.syncOffset,
      startedAt: meta.startedAt ?? null,
    });
  }

  async function handleCallTool(name, args) {
    switch (name) {
      case "start": {
        const sender = new SenderClass({ streamKey: args.stream_key });
        await sender.start();
        const sid = randomBytes(8).toString("hex");
        sessions.set(sid, sender);
        sessionMeta.set(sid, { startedAt: new Date().toISOString() });
        return { content: [{ type: "text", text: JSON.stringify({ session_id: sid }) }] };
      }

      case "send_caption": {
        const sender = getSession(args.session_id);
        const result = await sender.send(args.text, args.timestamp);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, sequence: result.sequence }) }],
        };
      }

      case "send_batch": {
        const sender = getSession(args.session_id);
        const result = await sender.sendBatch(args.captions);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, sequence: result.sequence, count: result.count }),
            },
          ],
        };
      }

      case "sync_clock": {
        const sender = getSession(args.session_id);
        const result = await sender.sync();
        return {
          content: [{ type: "text", text: JSON.stringify({ syncOffset: result.syncOffset }) }],
        };
      }

      case "get_status": {
        const sender = getSession(args.session_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ sequence: sender.sequence, syncOffset: sender.syncOffset }),
            },
          ],
        };
      }

      case "stop": {
        const sender = sessions.get(args.session_id);
        if (!sender) throw new Error(`Unknown session_id: ${JSON.stringify(args.session_id)}`);
        sessions.delete(args.session_id);
        sessionMeta.delete(args.session_id);
        await sender.end();
        return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
      }

      // ── Production tools ──────────────────────────────────────────────────

      case "list_cameras":
        return { content: [{ type: "text", text: await backendGet("/production/cameras", { "X-Admin-Key": ADMIN_KEY }) }] };

      case "camera_preset":
        return { content: [{ type: "text", text: await backendPost(`/production/cameras/${args.camera_id}/preset/${args.preset_id}`, { "X-Admin-Key": ADMIN_KEY }) }] };

      case "list_mixers":
        return { content: [{ type: "text", text: await backendGet("/production/mixers", { "X-Admin-Key": ADMIN_KEY }) }] };

      case "switch_source":
        return { content: [{ type: "text", text: await backendPost(`/production/mixers/${args.mixer_id}/switch/${args.input}`, { "X-Admin-Key": ADMIN_KEY }) }] };

      // ── Graphics / DSK tools ──────────────────────────────────────────────

      case "list_dsk_templates":
        return { content: [{ type: "text", text: await backendGet(`/dsk/${API_KEY}/templates`, { "X-API-Key": API_KEY }) }] };

      case "activate_dsk_template":
        return { content: [{ type: "text", text: await backendPost(`/dsk/${API_KEY}/templates/${args.template_id}/activate`, { "X-API-Key": API_KEY }) }] };

      case "broadcast_dsk_data":
        return { content: [{ type: "text", text: await backendPost(`/dsk/${API_KEY}/broadcast`, { "X-API-Key": API_KEY }, { updates: args.updates }) }] };

      case "dsk_renderer_status":
        return { content: [{ type: "text", text: await backendGet(`/dsk/${API_KEY}/renderer/status`, { "X-API-Key": API_KEY }) }] };

      case "start_dsk_renderer":
        return { content: [{ type: "text", text: await backendPost(`/dsk/${API_KEY}/renderer/start`, { "X-API-Key": API_KEY }) }] };

      case "stop_dsk_renderer":
        return { content: [{ type: "text", text: await backendPost(`/dsk/${API_KEY}/renderer/stop`, { "X-API-Key": API_KEY }) }] };

      default:
        throw new Error(`Unknown tool: ${JSON.stringify(name)}`);
    }
  }

  return {
    sessions,
    sessionMeta,
    handleListTools,
    handleListResources,
    handleReadResource,
    handleCallTool,
  };
}

// ── Default handlers (used by the MCP server) ────────────────────────────────

export const {
  sessions,
  sessionMeta,
  handleListTools,
  handleListResources,
  handleReadResource,
  handleCallTool,
} = createHandlers();

// ── MCP server wiring ─────────────────────────────────────────────────────────

const server = new Server(
  { name: "lcyt-mcp-stdio", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => handleListTools());

server.setRequestHandler(ListResourcesRequestSchema, () => handleListResources());

server.setRequestHandler(ReadResourceRequestSchema, ({ params: { uri } }) =>
  handleReadResource(uri).then((text) => ({
    contents: [{ uri, mimeType: "application/json", text }],
  }))
);

server.setRequestHandler(CallToolRequestSchema, ({ params: { name, arguments: args } }) =>
  handleCallTool(name, args)
);

// ── Entry point (only when run directly) ─────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
