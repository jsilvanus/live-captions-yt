/**
 * Speech transcription session management for lcyt-mcp-sse.
 *
 * Provides three MCP tools:
 *   start_speech_session    — create session, return browser URL (non-blocking)
 *   get_speech_transcript   — block until session ends, return full transcript
 *   end_speech_session      — explicitly stop a session (with optional partial save)
 *
 * The browser URL points to the lcyt-web production deployment at LCYT_WEB_URL/mcp/:sessionId
 * (e.g. https://lcyt.fi/mcp/<id>). lcyt-web renders SpeechCapturePage at that route.
 *
 * Transcript chunks are posted by the browser directly to the MCP server's Express app:
 *   POST /stt/:sessionId/chunk  — receives transcript finals from the browser page
 *   POST /stt/:sessionId/done   — signals browser session ended
 *   OPTIONS /stt/:sessionId/*   — CORS preflight
 *
 * These routes are mounted in server.js via handleSttChunk / handleSttDone.
 * No separate embedded HTTP server is used.
 *
 * Sessions are in-memory only. YouTube forwarding uses YoutubeLiveCaptionSender.
 *
 * Required env:
 *   LCYT_WEB_URL      Base URL of the deployed lcyt-web app (e.g. https://lcyt.fi)
 *   SPEECH_PUBLIC_URL Base URL of this MCP server as reachable by the browser
 *                     (e.g. https://mcp.lcyt.fi — reverse-proxied so /stt is accessible)
 */

import { randomUUID } from "node:crypto";
import { YoutubeLiveCaptionSender } from "lcyt";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LANGUAGE = "fi-FI";
const DEFAULT_SILENCE_TIMEOUT_MS = 30_000;

const LCYT_WEB_URL = (process.env.LCYT_WEB_URL || "").replace(/\/$/, "");

/**
 * True when LCYT_WEB_URL is configured — required to build browser URLs.
 * When false, speech tools are excluded from the advertised tool list.
 */
export const SPEECH_ENABLED = !!LCYT_WEB_URL;

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
    try {
      const endResult = session.sender.end();
      if (endResult && typeof endResult.then === 'function') {
        endResult.catch(() => {});
      }
    } catch (e) {
      // ignore synchronous errors from end()
    }
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

// ── Express route handlers (mounted at /stt in server.js) ─────────────────────

/**
 * POST /stt/:sessionId/chunk — receive a final transcript chunk from the browser.
 * Body: { text: string, isFinal: boolean, timestamp?: string }
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function handleSttChunk(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { sessionId } = req.params;
  const session = speechSessions.get(sessionId);

  if (!session || session.status !== "active") {
    res.status(410).json({ error: "Session ended or not found" });
    return;
  }

  const { text, isFinal, timestamp } = req.body ?? {};
  handleChunk(session, text ?? "", !!isFinal, timestamp ?? null);
  res.status(204).end();
}

/**
 * POST /stt/:sessionId/done — browser signals that the user has stopped.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function handleSttDone(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { sessionId } = req.params;
  const session = speechSessions.get(sessionId);
  if (session && session.status === "active") {
    endSession(session, "user_stopped", true);
  }
  res.status(204).end();
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
 *
 * ?server=   Base URL of this MCP server (SPEECH_PUBLIC_URL, e.g. https://mcp.lcyt.fi).
 *            The browser will POST finals to {server}/stt/:sessionId/chunk.
 *
 * Stream keys are intentionally excluded from the URL; they are held server-side only.
 *
 * @param {SpeechSession} session
 * @returns {string}
 */
function buildBrowserUrl(session) {
  const speechPublicUrl = (process.env.SPEECH_PUBLIC_URL || "").replace(/\/$/, "");

  if (!LCYT_WEB_URL) {
    throw new Error(
      "LCYT_WEB_URL environment variable is required for speech tools " +
      "(e.g. LCYT_WEB_URL=https://lcyt.fi)"
    );
  }
  if (!speechPublicUrl) {
    throw new Error(
      "SPEECH_PUBLIC_URL environment variable is required for speech tools " +
      "(e.g. SPEECH_PUBLIC_URL=https://mcp.lcyt.fi)"
    );
  }

  const params = new URLSearchParams({
    server: speechPublicUrl,
    lang: session.language,
    silence: String(session.silenceTimeoutMs),
  });
  if (session.label) params.set("label", session.label);

  return `${LCYT_WEB_URL}/mcp/${session.sessionId}?${params}`;
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const SPEECH_TOOLS = [
  {
    name: "start_speech_session",
    description:
      "Create a browser-based voice capture session. Returns a browser URL for the user " +
      "to open in Chrome or Edge. The page uses the Web Speech API to capture microphone audio " +
      "and stream each recognised final phrase to the MCP server in real time. Non-blocking — returns immediately.",
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
];

// ── MCP tool call handlers ────────────────────────────────────────────────────

/**
 * Handle a call to one of the three speech tools.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
export async function handleSpeechTool(name, args) {
  switch (name) {
    case "start_speech_session": {
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
          {
            type: "text",
            text: `[Open transcription tool](${browserUrl})`,
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

    default:
      throw new Error(`Unknown speech tool: ${JSON.stringify(name)}`);
  }
}
