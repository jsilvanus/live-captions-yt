#!/usr/bin/env node
/**
 * MCP server for lcyt — HTTP SSE transport.
 * Exposes the same tools as lcyt-mcp-stdio over HTTP Server-Sent Events.
 *
 * GET  /sse       — open SSE stream (MCP client connects here)
 * POST /messages  — send messages to an active SSE session (?sessionId=...)
 *
 * All HTTP connections share one session map, so caption sessions (identified
 * by session_id) survive reconnects.
 *
 * Port: process.env.PORT (default 3001)
 */

import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { YoutubeLiveCaptionSender } from "lcyt";
import { randomBytes } from "node:crypto";

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
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
];

// ── Handler factory ───────────────────────────────────────────────────────────

/**
 * Creates isolated handler functions backed by their own sessions map.
 * Pass a custom SenderClass to inject a fake in tests.
 *
 * @param {typeof YoutubeLiveCaptionSender} SenderClass
 */
function createHandlers(SenderClass = YoutubeLiveCaptionSender) {
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

      default:
        throw new Error(`Unknown tool: ${JSON.stringify(name)}`);
    }
  }

  return { handleListTools, handleListResources, handleReadResource, handleCallTool };
}

// ── Shared handlers (all HTTP connections share one session map) ──────────────

const { handleListTools, handleListResources, handleReadResource, handleCallTool } =
  createHandlers();

// ── MCP server factory (one Server per SSE connection) ────────────────────────

function createMcpServer() {
  const server = new Server(
    { name: "lcyt-mcp-sse", version: "0.1.0" },
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

  return server;
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

/** @type {Map<string, SSEServerTransport>} */
const transports = new Map();

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const server = createMcpServer();

  transports.set(transport.sessionId, transport);
  res.on("close", () => transports.delete(transport.sessionId));

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.error(`lcyt-mcp-sse listening on port ${PORT}`);
});
