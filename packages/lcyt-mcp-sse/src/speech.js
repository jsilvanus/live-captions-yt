/**
 * Speech transcription session management for lcyt-mcp-sse.
 *
 * Provides four MCP tools:
 *   start_speech_session    — create session + embedded HTTP server, return browser URL (non-blocking)
 *   get_speech_transcript   — block until session ends, return full transcript
 *   end_speech_session      — explicitly stop a session (with optional partial save)
 *   transcribe_speech_now   — combined start+wait; returns URL+transcript in one blocking call
 *
 * The browser URL points to the lcyt-web production deployment at LCYT_WEB_URL/mcp/:sessionId
 * (e.g. https://lcyt.fi/mcp/<id>). lcyt-web renders SpeechCapturePage at that route.
 *
 * The embedded HTTP server (default port 3002, env SPEECH_PORT) serves only:
 *   POST /mcp/:sessionId/chunk  — receives transcript chunks from the browser page
 *   POST /mcp/:sessionId/done   — signals browser session ended
 *   OPTIONS /mcp/:sessionId/*   — CORS preflight (browser may come from LCYT_WEB_URL origin)
 *
 * Sessions are in-memory only. YouTube forwarding uses YoutubeLiveCaptionSender.
 *
 * Required env:
 *   LCYT_WEB_URL   Base URL of the deployed lcyt-web app (e.g. https://lcyt.fi)
 *
 * Optional env:
 *   SPEECH_PORT    Port for the chunk/done HTTP server (default 3002)
 *   SPEECH_HOST    Host to bind (default localhost)
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { YoutubeLiveCaptionSender } from "lcyt";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LANGUAGE = "fi-FI";
const DEFAULT_SILENCE_TIMEOUT_MS = 30_000;
const DEFAULT_SPEECH_PORT = 3002;

const LCYT_WEB_URL = (process.env.LCYT_WEB_URL || "").replace(/\/$/, "");

/**
 * True when LCYT_WEB_URL is configured — required to build browser URLs.
 * When false, speech tools are excluded from the advertised tool list.
 */
export const SPEECH_ENABLED = !!LCYT_WEB_URL;

/**
 * Public-facing base URL of the speech capture server (what the browser will POST to).
 * Defaults to the bind address. Override with SPEECH_PUBLIC_URL when the server is
 * behind a proxy or when the browser must reach a different host/port.
 * Example: SPEECH_PUBLIC_URL=https://mcp.example.com
 */
function getSpeechPublicUrl() {
  const pub = (process.env.SPEECH_PUBLIC_URL || "").replace(/\/$/, "");
  return pub || getSpeechServerBaseUrl();
}

// ── Session store ─────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   sessionId: string,
 *   language: string,
 *   label: string | null,
 *   streamKey: string | null,
 *   transcript: string[],
 *   status: 'active' | 'ended',
 *   sender: import('lcyt').YoutubeLiveCaptionSender | null,
 *   waiters: Array<{ resolve: Function, reject: Function }>,
 *   silenceTimer: ReturnType<typeof setTimeout> | null,
 *   silenceTimeoutMs: number,
 *   createdAt: Date,
 * }} SpeechSession
 */

/** @type {Map<string, SpeechSession>} */
const speechSessions = new Map();

// ── Embedded HTTP server ──────────────────────────────────────────────────────

let speechHttpServer = null;
let _speechServerPort = null;
let _speechServerHost = null;

/** Return the base URL of the running speech server, or null. */
export function getSpeechServerBaseUrl() {
  if (!speechHttpServer) return null;
  return `http://${_speechServerHost}:${_speechServerPort}`;
}

/**
 * Start the embedded speech HTTP server if not already running.
 * Subsequent calls are no-ops.
 * @returns {Promise<string>} The base URL of the speech server.
 */
export async function ensureSpeechServer() {
  if (speechHttpServer) return getSpeechServerBaseUrl();

  const port = parseInt(process.env.SPEECH_PORT || String(DEFAULT_SPEECH_PORT), 10);
  const host = process.env.SPEECH_HOST || "localhost";

  const server = createServer((req, res) => {
    handleSpeechRequest(req, res).catch((err) => {
      console.error(`[speech] Unhandled request error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("Internal error");
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => resolve());
  });

  speechHttpServer = server;
  _speechServerPort = port;
  _speechServerHost = host;

  console.error(`[speech] Capture server listening on http://${host}:${port}`);
  return `http://${host}:${port}`;
}

/**
 * Route incoming HTTP requests for the speech capture server.
 * Routes: POST /mcp/:sessionId/chunk  and  POST /mcp/:sessionId/done
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handleSpeechRequest(req, res) {
  // CORS — allow requests from the lcyt-web origin (or any, for localhost dev)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Pattern: /mcp/<sessionId>[/chunk|/done]
  const m = url.pathname.match(/^\/mcp\/([^/]+)(\/chunk|\/done)?$/);
  if (!m) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const sessionId = m[1];
  const action = m[2]; // undefined | '/chunk' | '/done'

  // ── POST /mcp/:sessionId/chunk — receive transcript chunk ─────────────────

  if (req.method === "POST" && action === "/chunk") {
    const body = await readBody(req);
    const session = speechSessions.get(sessionId);

    if (!session || session.status !== "active") {
      res.writeHead(410, { "Content-Type": "text/plain" });
      res.end("Session ended or not found");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end("Bad JSON");
      return;
    }

    handleChunk(session, parsed.text ?? "", !!parsed.isFinal, parsed.timestamp ?? null);

    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /mcp/:sessionId/done — browser signals completion ───────────────

  if (req.method === "POST" && action === "/done") {
    const session = speechSessions.get(sessionId);
    if (session && session.status === "active") {
      endSession(session, "user_stopped", true);
    }
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain" });
  res.end("Method not allowed");
}

/** Read the full body of an HTTP request as a UTF-8 string. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

/**
 * Process a transcript chunk arriving from the browser.
 * Resets the silence timer; forwards finals to YouTube with the utterance-start timestamp.
 * @param {SpeechSession} session
 * @param {string} text
 * @param {boolean} isFinal
 * @param {string | null} timestamp  Utterance-start timestamp from the browser (YouTube format)
 */
function handleChunk(session, text, isFinal, timestamp) {
  if (!text) return;

  // Reset silence-VAD timer on any activity
  if (session.silenceTimer) clearTimeout(session.silenceTimer);
  session.silenceTimer = setTimeout(() => {
    endSession(session, "silence_timeout", true);
  }, session.silenceTimeoutMs);

  // Forward final results to YouTube Live, preserving utterance-start timestamp
  if (isFinal && session.sender) {
    session.sender.send(text, timestamp || undefined).catch((err) => {
      console.error(`[speech] YouTube send failed for session ${session.sessionId}: ${err.message}`);
    });
  }

  // Accumulate finals into transcript
  if (isFinal) {
    session.transcript.push(text.trim());
  }
}

/**
 * End a session, resolve/reject all waiters, and clean up resources.
 * @param {SpeechSession} session
 * @param {string} reason
 * @param {boolean} savePartial  true → resolve waiters; false → reject them
 */
function endSession(session, reason, savePartial) {
  if (session.status === "ended") return;
  session.status = "ended";

  if (session.silenceTimer) {
    clearTimeout(session.silenceTimer);
    session.silenceTimer = null;
  }

  if (session.sender) {
    session.sender.end().catch(() => {});
    session.sender = null;
  }

  const transcript = session.transcript.join(" ");
  const waiters = session.waiters.splice(0);

  for (const waiter of waiters) {
    if (savePartial) {
      waiter.resolve({ transcript, reason });
    } else {
      waiter.reject(new Error(`Speech session aborted (reason: ${reason})`));
    }
  }

  speechSessions.delete(session.sessionId);
}

// ── Public API used by MCP tool handlers ─────────────────────────────────────

/**
 * Create a new speech session and start YouTube sender if stream key provided.
 * @param {{ language?: string, youtube_stream_key?: string, label?: string, silence_timeout_seconds?: number }} opts
 * @returns {Promise<SpeechSession>}
 */
export async function createSpeechSession({
  language,
  youtube_stream_key,
  label,
  silence_timeout_seconds,
} = {}) {
  const sessionId = randomUUID();
  const silenceTimeoutMs = ((silence_timeout_seconds ?? 30) * 1000);

  let sender = null;
  if (youtube_stream_key) {
    sender = new YoutubeLiveCaptionSender({ streamKey: youtube_stream_key });
    await sender.start();
  }

  /** @type {SpeechSession} */
  const session = {
    sessionId,
    language: language || DEFAULT_LANGUAGE,
    label: label || null,
    streamKey: youtube_stream_key || null,
    transcript: [],
    status: "active",
    sender,
    waiters: [],
    silenceTimer: null,
    silenceTimeoutMs,
    createdAt: new Date(),
  };

  // Arm silence timer immediately so sessions don't linger if browser never connects
  session.silenceTimer = setTimeout(() => {
    endSession(session, "silence_timeout", true);
  }, session.silenceTimeoutMs);

  speechSessions.set(sessionId, session);
  return session;
}

/**
 * Return a Promise that resolves when the speech session ends.
 * @param {string} sessionId
 * @param {number | undefined} timeoutSeconds  Optional max wait in seconds.
 * @returns {Promise<{ transcript: string, reason: string }>}
 */
export function waitForTranscript(sessionId, timeoutSeconds) {
  const session = speechSessions.get(sessionId);
  if (!session) {
    return Promise.reject(new Error(`Unknown speech session: ${JSON.stringify(sessionId)}`));
  }
  if (session.status === "ended") {
    return Promise.resolve({ transcript: session.transcript.join(" "), reason: "already_ended" });
  }

  return new Promise((resolve, reject) => {
    let deadlineTimer;

    const waiter = {
      resolve: (result) => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        resolve(result);
      },
      reject: (err) => {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        reject(err);
      },
    };

    if (timeoutSeconds != null && timeoutSeconds > 0) {
      deadlineTimer = setTimeout(() => {
        session.waiters = session.waiters.filter((w) => w !== waiter);
        reject(new Error(`get_speech_transcript timed out after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);
    }

    session.waiters.push(waiter);
  });
}

/**
 * Explicitly end a speech session.
 * @param {string} sessionId
 * @param {boolean} savePartial   true → resolve waiters; false → reject them
 * @param {string} [reason]
 */
export function endSpeechSession(sessionId, savePartial, reason) {
  const session = speechSessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown speech session: ${JSON.stringify(sessionId)}`);
  }
  endSession(session, reason || "agent_ended", savePartial);
}

// ── Browser URL builder ───────────────────────────────────────────────────────

/**
 * Build the browser URL for a speech session.
 * The URL points to LCYT_WEB_URL/mcp/:sessionId with session config as query params.
 * The SpeechCapturePage React component in lcyt-web handles this route.
 * @param {SpeechSession} session
 * @returns {string}
 */
function buildBrowserUrl(session) {
  if (!LCYT_WEB_URL) {
    throw new Error(
      "LCYT_WEB_URL environment variable is required for speech tools " +
      "(e.g. LCYT_WEB_URL=https://lcyt.fi)"
    );
  }

  const streamDisplay = session.streamKey
    ? `****${session.streamKey.slice(-4)}`
    : null;

  const params = new URLSearchParams({
    server: getSpeechPublicUrl(),
    lang: session.language,
    silence: String(session.silenceTimeoutMs),
  });
  if (streamDisplay) params.set("key", streamDisplay);
  if (session.label)  params.set("label", session.label);

  return `${LCYT_WEB_URL}/mcp/${session.sessionId}?${params}`;
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const SPEECH_TOOLS = [
  {
    name: "start_speech_session",
    description:
      "Create a browser-based voice capture session. Starts an embedded HTTP server (if not " +
      "already running) to receive transcript chunks, then returns a browser URL for the user " +
      "to open in Chrome or Edge. The page uses the Web Speech API to capture microphone audio " +
      "and stream each recognised phrase back in real time. Non-blocking — returns immediately.",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "BCP-47 language tag for recognition (default: fi-FI).",
        },
        youtube_stream_key: {
          type: "string",
          description:
            "YouTube Live stream key. If provided, recognised speech is forwarded to YouTube " +
            "as captions in real time. Only the last 4 characters are shown in output and UI.",
        },
        label: {
          type: "string",
          description: "Optional human-readable label for this session.",
        },
        silence_timeout_seconds: {
          type: "number",
          description:
            "Seconds of silence after which the session is automatically ended and the " +
            "transcript saved. Default: 30.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_speech_transcript",
    description:
      "Block until the specified speech session ends (user stops, silence timeout, or " +
      "end_speech_session is called) and return the full accumulated transcript. Use this " +
      "after start_speech_session to wait for the result.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Speech session ID returned by start_speech_session.",
        },
        timeout_seconds: {
          type: "number",
          description:
            "Maximum seconds to wait before the tool itself times out. " +
            "Omit to wait indefinitely.",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "end_speech_session",
    description:
      "Explicitly stop a speech session. Depending on save_partial, any pending " +
      "get_speech_transcript call is either resolved (true) or rejected (false).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Speech session ID to stop.",
        },
        save_partial: {
          type: "boolean",
          description:
            "If true, resolve any waiting get_speech_transcript with the transcript " +
            "captured so far. If false, reject it. Default: true.",
        },
        reason: {
          type: "string",
          enum: ["end_speech", "end_transcript", "abort"],
          description:
            "Reason for ending: end_speech (user done speaking), " +
            "end_transcript (session complete), abort (discard).",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "transcribe_speech_now",
    description:
      "Convenience tool: create a speech session and wait for it to finish in a single " +
      "blocking call. The browser URL is included in the response so the user can open it " +
      "while the agent waits. Returns the full transcript when the session ends.",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "BCP-47 language tag for recognition (default: fi-FI).",
        },
        youtube_stream_key: {
          type: "string",
          description: "Optional YouTube Live stream key for real-time caption forwarding.",
        },
        label: {
          type: "string",
          description: "Optional human-readable label for this session.",
        },
        silence_timeout_seconds: {
          type: "number",
          description: "Silence timeout in seconds. Default: 30.",
        },
        timeout_seconds: {
          type: "number",
          description:
            "Maximum seconds to block waiting for the session to end. " +
            "Omit to wait indefinitely.",
        },
      },
      required: [],
    },
  },
];

// ── MCP tool call handlers ────────────────────────────────────────────────────

/**
 * Handle a call to one of the four speech tools.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
export async function handleSpeechTool(name, args) {
  switch (name) {
    case "start_speech_session": {
      await ensureSpeechServer();
      const session = await createSpeechSession({
        language: args.language,
        youtube_stream_key: args.youtube_stream_key,
        label: args.label,
        silence_timeout_seconds: args.silence_timeout_seconds,
      });
      const browserUrl = buildBrowserUrl(session);
      const streamDisplay = session.streamKey
        ? `****${session.streamKey.slice(-4)}`
        : "(none)";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              session_id: session.sessionId,
              browser_url: browserUrl,
              language: session.language,
              stream_key: streamDisplay,
              silence_timeout_seconds: session.silenceTimeoutMs / 1000,
            }),
          },
        ],
      };
    }

    case "get_speech_transcript": {
      const { transcript, reason } = await waitForTranscript(
        args.session_id,
        args.timeout_seconds
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, transcript, end_reason: reason }),
          },
        ],
      };
    }

    case "end_speech_session": {
      const savePartial = args.save_partial !== false; // default true
      endSpeechSession(args.session_id, savePartial, args.reason);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, save_partial: savePartial }),
          },
        ],
      };
    }

    case "transcribe_speech_now": {
      await ensureSpeechServer();
      const session = await createSpeechSession({
        language: args.language,
        youtube_stream_key: args.youtube_stream_key,
        label: args.label,
        silence_timeout_seconds: args.silence_timeout_seconds,
      });
      const browserUrl = buildBrowserUrl(session);
      const streamDisplay = session.streamKey
        ? `****${session.streamKey.slice(-4)}`
        : "(none)";

      // Block until the session ends
      const { transcript, reason } = await waitForTranscript(
        session.sessionId,
        args.timeout_seconds
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              browser_url: browserUrl,
              session_id: session.sessionId,
              language: session.language,
              stream_key: streamDisplay,
              transcript,
              end_reason: reason,
            }),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown speech tool: ${JSON.stringify(name)}`);
  }
}
