/**
 * Speech transcription session management for lcyt-mcp-sse.
 *
 * Provides four MCP tools:
 *   start_speech_session    — create session + embedded HTTP server, return browser URL (non-blocking)
 *   get_speech_transcript   — block until session ends, return full transcript
 *   end_speech_session      — explicitly stop a session (with optional partial save)
 *   transcribe_speech_now   — combined start+wait; returns URL+transcript in one blocking call
 *
 * The embedded HTTP server (default port 3002, env SPEECH_PORT) serves:
 *   GET  /speech/:sessionId        — self-contained browser capture page (Web Speech API)
 *   POST /speech/:sessionId/chunk  — receives transcript chunks from browser
 *   POST /speech/:sessionId/done   — signals browser session ended
 *
 * Sessions are in-memory only. YouTube forwarding uses YoutubeLiveCaptionSender.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { YoutubeLiveCaptionSender } from "lcyt";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LANGUAGE = "fi-FI";
const DEFAULT_SILENCE_TIMEOUT_MS = 30_000;
const DEFAULT_SPEECH_PORT = 3002;

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
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handleSpeechRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Pattern: /speech/<sessionId>[/chunk|/done]
  const m = url.pathname.match(/^\/speech\/([^/]+)(\/chunk|\/done)?$/);
  if (!m) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const sessionId = m[1];
  const action = m[2]; // undefined | '/chunk' | '/done'

  // ── GET /speech/:sessionId — serve capture page ──────────────────────────

  if (req.method === "GET" && !action) {
    const session = speechSessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Session not found");
      return;
    }
    const html = buildCapturePage(session, getSpeechServerBaseUrl());
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // ── POST /speech/:sessionId/chunk — receive transcript chunk ─────────────

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

    handleChunk(session, parsed.text ?? "", !!parsed.isFinal);

    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /speech/:sessionId/done — browser signals completion ────────────

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
 * Resets the silence timer; forwards finals to YouTube.
 */
function handleChunk(session, text, isFinal) {
  if (!text) return;

  // Reset silence-VAD timer on any activity
  if (session.silenceTimer) clearTimeout(session.silenceTimer);
  session.silenceTimer = setTimeout(() => {
    endSession(session, "silence_timeout", true);
  }, session.silenceTimeoutMs);

  // Forward final results to YouTube Live
  if (isFinal && session.sender) {
    session.sender.send(text).catch((err) => {
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
 * If the session is already ended, rejects immediately with an error.
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
    // Shouldn't happen (ended sessions are removed), but handle gracefully
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

// ── Browser capture page ──────────────────────────────────────────────────────

/**
 * Build the self-contained HTML capture page for a speech session.
 * All session data is inlined as JSON literals — no external dependencies.
 * @param {SpeechSession} session
 * @param {string} serverBaseUrl   Base URL of the speech HTTP server.
 * @returns {string}
 */
function buildCapturePage(session, serverBaseUrl) {
  const streamKeyDisplay = session.streamKey
    ? `****${session.streamKey.slice(-4)}`
    : null;

  const chunkUrl = `${serverBaseUrl}/speech/${session.sessionId}/chunk`;
  const doneUrl = `${serverBaseUrl}/speech/${session.sessionId}/done`;

  // Safely inline values as JSON
  const jsSessionId = JSON.stringify(session.sessionId);
  const jsLanguage = JSON.stringify(session.language);
  const jsChunkUrl = JSON.stringify(chunkUrl);
  const jsDoneUrl = JSON.stringify(doneUrl);
  const jsSilenceMs = String(session.silenceTimeoutMs);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(session.language.split("-")[0])}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Captions — Speech Capture</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: system-ui, sans-serif;
      max-width: 720px;
      margin: 2rem auto;
      padding: 0 1rem;
      color: #111;
      background: #fafafa;
    }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    .meta { color: #555; font-size: 0.85rem; margin-bottom: 1rem; }
    .controls { display: flex; gap: 0.75rem; margin-bottom: 1.25rem; }
    button {
      padding: 0.5rem 1.25rem;
      font-size: 1rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
    }
    #startBtn { background: #1a73e8; color: #fff; }
    #startBtn:disabled { background: #aaa; cursor: default; }
    #stopBtn  { background: #e53935; color: #fff; }
    #stopBtn:disabled  { background: #aaa; cursor: default; }
    .transcript-box {
      min-height: 200px;
      border: 1px solid #ccc;
      border-radius: 6px;
      padding: 0.75rem 1rem;
      background: #fff;
      font-size: 1.05rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .interim { color: #888; }
    .final   { color: #111; }
    #status  { margin-top: 0.75rem; font-size: 0.9rem; color: #444; min-height: 1.4em; }
    #warning {
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
      color: #664d03;
    }
    #done-msg {
      display: none;
      background: #d4edda;
      border: 1px solid #28a745;
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin-top: 1rem;
      color: #155724;
      font-size: 1rem;
    }
  </style>
</head>
<body>
  <h1>Live Captions — Speech Capture</h1>
  <div class="meta">
    Session:&nbsp;<code>${escapeHtml(session.sessionId)}</code>
    &nbsp;|&nbsp;
    Language:&nbsp;<code>${escapeHtml(session.language)}</code>${
      streamKeyDisplay
        ? `\n    &nbsp;|&nbsp;\n    Stream key:&nbsp;<code>${escapeHtml(streamKeyDisplay)}</code>`
        : ""
    }${
      session.label
        ? `\n    &nbsp;|&nbsp;\n    Label:&nbsp;<code>${escapeHtml(session.label)}</code>`
        : ""
    }
  </div>

  <div id="warning">
    ⚠️ <strong>Web Speech API not supported in this browser.</strong>
    Please open this page in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.
  </div>

  <div class="controls">
    <button id="startBtn" disabled>Start</button>
    <button id="stopBtn"  disabled>Stop</button>
  </div>

  <div class="transcript-box" id="transcript" aria-live="polite" aria-label="Live transcript">
    <span class="interim" id="interimSpan"></span>
  </div>
  <div id="status"></div>

  <div id="done-msg">
    ✅ Transkriptio valmis. Voit sulkea tämän välilehden.<br>
    ✅ Transcription complete. You can close this tab.
  </div>

<script>
(function () {
  const SESSION_ID   = ${jsSessionId};
  const LANGUAGE     = ${jsLanguage};
  const CHUNK_URL    = ${jsChunkUrl};
  const DONE_URL     = ${jsDoneUrl};
  const SILENCE_MS   = ${jsSilenceMs};

  const startBtn     = document.getElementById('startBtn');
  const stopBtn      = document.getElementById('stopBtn');
  const transcriptEl = document.getElementById('transcript');
  const interimSpan  = document.getElementById('interimSpan');
  const statusEl     = document.getElementById('status');
  const warningEl    = document.getElementById('warning');
  const doneMsgEl    = document.getElementById('done-msg');

  // ── Browser compatibility check ─────────────────────────────────────────

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    warningEl.style.display = 'block';
    setStatus('Web Speech API not available — use Chrome or Edge.');
    return;
  }
  warningEl.style.display = 'none';
  startBtn.disabled = false;

  // ── State ───────────────────────────────────────────────────────────────

  let recognition  = null;
  let finalText    = '';
  let running      = false;

  // ── Helpers ─────────────────────────────────────────────────────────────

  function setStatus(msg) { statusEl.textContent = msg; }

  function renderTranscript() {
    // Replace everything except the interim span
    transcriptEl.innerHTML = '';
    const finalNode = document.createTextNode(finalText);
    transcriptEl.appendChild(finalNode);
    transcriptEl.appendChild(interimSpan);
  }

  function postChunk(text, isFinal) {
    fetch(CHUNK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, isFinal }),
      keepalive: true,
    }).catch(() => {});  // fire and forget; server may have already ended session
  }

  function postDone() {
    fetch(DONE_URL, {
      method: 'POST',
      keepalive: true,
    }).catch(() => {});
  }

  function stop(showDone) {
    if (!running) return;
    running = false;
    try { recognition.stop(); } catch {}
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    setStatus('Stopped.');
    postDone();
    if (showDone) {
      doneMsgEl.style.display = 'block';
    }
  }

  // ── SpeechRecognition ───────────────────────────────────────────────────

  function buildRecognition() {
    const r = new SpeechRecognition();
    r.lang            = LANGUAGE;
    r.continuous      = true;
    r.interimResults  = true;
    r.maxAlternatives = 1;

    r.onstart = () => {
      running = true;
      setStatus('Listening…');
    };

    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += (finalText ? ' ' : '') + transcript.trim();
          postChunk(transcript.trim(), true);
        } else {
          interim += transcript;
        }
      }
      interimSpan.textContent = interim;
      interimSpan.className   = 'interim';
      renderTranscript();
    };

    r.onerror = (event) => {
      if (event.error === 'no-speech') return; // ignore, keep going
      if (event.error === 'aborted') return;   // intentional stop
      setStatus('Error: ' + event.error);
      stop(false);
    };

    r.onend = () => {
      if (running) {
        // Continuous mode restarted automatically (e.g. after network hiccup)
        try { r.start(); } catch {}
      }
    };

    return r;
  }

  // ── Button handlers ─────────────────────────────────────────────────────

  startBtn.addEventListener('click', () => {
    if (running) return;
    finalText = '';
    interimSpan.textContent = '';
    renderTranscript();
    recognition = buildRecognition();
    startBtn.disabled = true;
    stopBtn.disabled  = false;
    try { recognition.start(); } catch (err) {
      setStatus('Could not start: ' + err.message);
      startBtn.disabled = false;
      stopBtn.disabled  = true;
    }
  });

  stopBtn.addEventListener('click', () => stop(true));

  setStatus('Ready. Click Start to begin.');
})();
</script>
</body>
</html>`;
}

/** Minimal HTML entity escaping for values inserted into HTML context. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const SPEECH_TOOLS = [
  {
    name: "start_speech_session",
    description:
      "Create a browser-based voice capture session. Starts an embedded HTTP server (if not " +
      "already running) and returns a browser URL for the user to open in Chrome or Edge. " +
      "The page uses the Web Speech API to capture microphone audio and stream each recognised " +
      "phrase back to the server in real time. Non-blocking — returns immediately.",
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
 * Returns an MCP tool result object, or throws if the tool name is unknown.
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
export async function handleSpeechTool(name, args) {
  switch (name) {
    case "start_speech_session": {
      const baseUrl = await ensureSpeechServer();
      const session = await createSpeechSession({
        language: args.language,
        youtube_stream_key: args.youtube_stream_key,
        label: args.label,
        silence_timeout_seconds: args.silence_timeout_seconds,
      });
      const browserUrl = `${baseUrl}/speech/${session.sessionId}`;
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
      const baseUrl = await ensureSpeechServer();
      const session = await createSpeechSession({
        language: args.language,
        youtube_stream_key: args.youtube_stream_key,
        label: args.label,
        silence_timeout_seconds: args.silence_timeout_seconds,
      });
      const browserUrl = `${baseUrl}/speech/${session.sessionId}`;
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
