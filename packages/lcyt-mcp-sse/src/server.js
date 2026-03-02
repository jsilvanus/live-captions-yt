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
import {
  initDb, validateApiKey, checkAndIncrementUsage, anonymizeKey,
  writeAuthEvent, writeSessionStat, writeCaptionError,
  incrementDomainHourlySessionStart, incrementDomainHourlySessionEnd,
  incrementDomainHourlyCaptions,
} from "lcyt-backend/src/db.js";

// ── Auth database (optional) ──────────────────────────────────────────────────

const DB_PATH = process.env.DB_PATH || null;
const REQUIRE_API_KEY = process.env.MCP_REQUIRE_API_KEY === "1";

const db = DB_PATH ? initDb(DB_PATH) : null;

if (db && REQUIRE_API_KEY) {
  console.error(`[lcyt-mcp-sse] Auth required (DB_PATH=${DB_PATH})`);
} else if (db) {
  console.error(`[lcyt-mcp-sse] DB connected (DB_PATH=${DB_PATH}), auth optional — X-Api-Key enables logging`);
} else {
  console.error("[lcyt-mcp-sse] No DB — set DB_PATH to enable logging; MCP_REQUIRE_API_KEY=1 to enforce auth");
}

/**
 * Tracks in-flight MCP sessions for DB logging.
 * Keyed by MCP session_id (from `start` tool).
 * @type {Map<string, { apiKey: string, startedAt: number, captionsSent: number, captionsFailed: number, lastSequence: number }>}
 */
const mcpStats = new Map();

// ── Privacy notice (returned by `privacy` tool) ───────────────────────────────

const PRIVACY_NOTICE = `\
Privacy & Data Notice — lcyt-mcp-sse

WHAT THIS SERVICE DOES
lcyt-mcp-sse forwards caption text to YouTube Live via the lcyt relay backend.
Caption text is NOT stored — it is processed in memory and sent immediately to YouTube.

DATA STORED BY THE RELAY BACKEND
When an API key is associated with your connection, the following is stored:
  - API key record: owner name, email (if provided), creation date, expiry, caption counts.
  - Session records: session start/end times, duration, captions sent/failed. No caption text.
  - Error logs: error codes and messages when YouTube delivery fails.
  - Auth event logs: timestamps when authentication fails or usage limits are exceeded.
  - Anonymous usage statistics: aggregate caption/session counts per domain and time bucket.

THIRD-PARTY SERVICES
  - YouTube Live: caption text and timestamps are sent to YouTube's caption ingestion API.
    Google's privacy policy applies.

YOUR RIGHTS
Depending on your jurisdiction (e.g. GDPR, CCPA) you may have rights to access, correct,
export, or delete your data. Use the privacy_deletion tool to erase all records associated
with your API key. Contact the backend operator for other data requests.

DISCLAIMER
This service is provided as-is, without any warranty. The backend operator accepts no
liability for data loss, service interruptions, or errors in caption delivery.
`.trim();

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
  {
    name: "privacy",
    description: "Return the privacy notice and data-processing information for this service.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "privacy_deletion",
    description:
      "Permanently erase all data associated with your API key: owner name, session records, " +
      "error logs, auth events, and usage statistics. The key is revoked immediately. " +
      "Email (if any) may be retained briefly to prevent free-tier abuse. This cannot be undone.",
    inputSchema: { type: "object", properties: {} },
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

      case "privacy": {
        return { content: [{ type: "text", text: PRIVACY_NOTICE }] };
      }

      case "privacy_deletion": {
        // Intercepted upstream in createMcpServer() when db + apiKey are available.
        throw new Error(
          "privacy_deletion requires an authenticated connection (X-Api-Key + DB_PATH configured)"
        );
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

function createMcpServer(apiKey = null) {
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

  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
    // privacy_deletion needs db + apiKey from connection closure — handle before dispatch
    if (name === "privacy_deletion") {
      if (!db || !apiKey) {
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No authenticated API key on this connection" }) }],
          isError: true,
        };
      }
      anonymizeKey(db, apiKey);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, message: "Your data has been erased. The API key is now revoked." }) }],
      };
    }

    // Pre-call: usage limit check for send operations
    if (db && apiKey && (name === "send_caption" || name === "send_batch")) {
      const usage = checkAndIncrementUsage(db, apiKey);
      if (!usage.allowed) {
        console.error(`[lcyt-mcp-sse] Usage limit hit for key ${apiKey.slice(0, 8)}...: ${usage.reason}`);
        writeAuthEvent(db, { apiKey, eventType: usage.reason, domain: "mcp" });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: usage.reason }) }],
          isError: true,
        };
      }
    }

    // Dispatch
    let result;
    try {
      result = await handleCallTool(name, args);
    } catch (err) {
      if (db && apiKey && (name === "send_caption" || name === "send_batch")) {
        const stat = mcpStats.get(args.session_id);
        if (stat) {
          stat.captionsFailed++;
          writeCaptionError(db, {
            apiKey: stat.apiKey,
            sessionId: args.session_id,
            errorCode: err.statusCode ?? 502,
            errorMsg: err.message ?? "Failed to send captions",
            batchSize: name === "send_batch" ? (args.captions?.length ?? 1) : 1,
          });
          incrementDomainHourlyCaptions(db, "mcp", { failed: 1 });
        }
      }
      throw err;
    }

    // Post-call logging
    if (db && apiKey) {
      if (name === "start") {
        const sid = JSON.parse(result.content[0].text).session_id;
        mcpStats.set(sid, { apiKey, startedAt: Date.now(), captionsSent: 0, captionsFailed: 0, lastSequence: 0 });
        writeAuthEvent(db, { apiKey, eventType: "login", domain: "mcp" });
        incrementDomainHourlySessionStart(db, "mcp", mcpStats.size);

      } else if (name === "send_caption") {
        const stat = mcpStats.get(args.session_id);
        if (stat) {
          stat.captionsSent++;
          stat.lastSequence = JSON.parse(result.content[0].text).sequence ?? stat.lastSequence;
          incrementDomainHourlyCaptions(db, "mcp", { sent: 1 });
        }

      } else if (name === "send_batch") {
        const stat = mcpStats.get(args.session_id);
        if (stat) {
          stat.captionsSent++;
          stat.lastSequence = JSON.parse(result.content[0].text).sequence ?? stat.lastSequence;
          incrementDomainHourlyCaptions(db, "mcp", { sent: 1, batches: 1 });
        }

      } else if (name === "stop") {
        const stat = mcpStats.get(args.session_id);
        if (stat) {
          const durationMs = Date.now() - stat.startedAt;
          writeSessionStat(db, {
            sessionId: args.session_id,
            apiKey: stat.apiKey,
            domain: "mcp",
            startedAt: new Date(stat.startedAt).toISOString(),
            endedAt: new Date().toISOString(),
            durationMs,
            captionsSent: stat.captionsSent,
            captionsFailed: stat.captionsFailed,
            finalSequence: stat.lastSequence,
            endedBy: "client",
          });
          incrementDomainHourlySessionEnd(db, "mcp", durationMs);
          mcpStats.delete(args.session_id);
        }
      }
    }

    return result;
  });

  return server;
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

/** @type {Map<string, SSEServerTransport>} */
const transports = new Map();

app.get("/sse", async (req, res) => {
  let apiKey = null;

  const provided = db ? req.headers["x-api-key"] : null;

  if (provided) {
    // Key voluntarily provided — validate regardless of REQUIRE_API_KEY
    const result = validateApiKey(db, provided);
    if (!result.valid) {
      console.error(`[lcyt-mcp-sse] 403 — key ${provided.slice(0, 8)}... rejected: ${result.reason}`);
      writeAuthEvent(db, { apiKey: provided, eventType: result.reason, domain: "mcp" });
      res.status(403).json({ error: result.reason });
      return;
    }
    apiKey = provided;
    console.error(`[lcyt-mcp-sse] Accepted key ${apiKey.slice(0, 8)}... (owner: ${result.owner})`);
  } else if (REQUIRE_API_KEY) {
    console.error("[lcyt-mcp-sse] 401 — X-Api-Key header missing");
    res.status(401).json({ error: "X-Api-Key header required" });
    return;
  }

  const transport = new SSEServerTransport("/messages", res);
  const server = createMcpServer(apiKey);

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
