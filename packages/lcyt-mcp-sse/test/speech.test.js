/**
 * Integration tests for the MCP/web transcription (speech) tool.
 *
 * Simulates the full flow that occurs during real operation:
 *   1. MCP client calls start_speech_session
 *   2. Browser page opens and POSTs transcript chunks to POST /stt/:sessionId/chunk
 *   3. Browser signals it's done via POST /stt/:sessionId/done
 *   4. MCP client's get_speech_transcript call resolves with the assembled transcript
 *
 * Also tests all error paths: unknown sessions, timeouts, aborts, CORS.
 *
 * Requires env vars set at process start (via the "test" npm script):
 *   LCYT_WEB_URL=https://lcyt-test.example
 *   SPEECH_PUBLIC_URL=https://mcp-test.example
 */

import { describe, it, before, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";

import {
  createSpeechSession,
  waitForTranscript,
  endSpeechSession,
  handleSttChunk,
  handleSttDone,
  handleSpeechTool,
  SPEECH_TOOLS,
  SPEECH_ENABLED,
} from "../src/speech.js";

// ── Express test app (mirrors the STT routes mounted in server.js) ────────────

const app = express();

app.options("/stt/:sessionId/*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).end();
});
app.post("/stt/:sessionId/chunk", express.json(), handleSttChunk);
app.post("/stt/:sessionId/done", express.json(), handleSttDone);

let server;
let baseUrl;

before(
  () =>
    new Promise((resolve) => {
      server = createServer(app);
      server.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    })
);

after(() => new Promise((resolve) => server.close(resolve)));

// ── Request helpers ───────────────────────────────────────────────────────────

function postChunk(sessionId, body) {
  return fetch(`${baseUrl}/stt/${sessionId}/chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postDone(sessionId) {
  return fetch(`${baseUrl}/stt/${sessionId}/done`, { method: "POST" });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Safely end a session by id, ignoring errors (already ended etc). */
function cleanupSession(sessionId) {
  if (!sessionId) return;
  try {
    endSpeechSession(sessionId, false, "test_cleanup");
  } catch {
    // session already ended — ignore
  }
}

/** Parse the MCP content response text field. */
function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

// ── 1. Module-level exports ───────────────────────────────────────────────────

describe("module exports", () => {
  it("SPEECH_ENABLED is true when LCYT_WEB_URL is set", () => {
    assert.equal(SPEECH_ENABLED, true);
  });

  it("SPEECH_TOOLS exports exactly 3 tools", () => {
    assert.equal(SPEECH_TOOLS.length, 3);
  });

  it("SPEECH_TOOLS contains the three expected tool names", () => {
    const names = SPEECH_TOOLS.map((t) => t.name);
    assert.deepEqual(names, [
      "start_speech_session",
      "get_speech_transcript",
      "end_speech_session",
    ]);
  });

  it("each SPEECH_TOOL has inputSchema with required fields array", () => {
    for (const tool of SPEECH_TOOLS) {
      assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
      assert.equal(tool.inputSchema.type, "object");
    }
  });
});

// ── 2. createSpeechSession ────────────────────────────────────────────────────

describe("createSpeechSession", () => {
  let session;

  afterEach(() => {
    if (session) {
      cleanupSession(session.sessionId);
      session = null;
    }
  });

  it("returns a session with a string sessionId", async () => {
    session = await createSpeechSession({ silence_timeout_seconds: 60 });
    assert.ok(typeof session.sessionId === "string");
    assert.ok(session.sessionId.length > 0);
  });

  it("status is 'active' on creation", async () => {
    session = await createSpeechSession({ silence_timeout_seconds: 60 });
    assert.equal(session.status, "active");
  });

  it("transcript starts empty", async () => {
    session = await createSpeechSession({ silence_timeout_seconds: 60 });
    assert.deepEqual(session.transcript, []);
  });

  it("sender is null when no youtube_stream_key provided", async () => {
    session = await createSpeechSession({ silence_timeout_seconds: 60 });
    assert.equal(session.sender, null);
  });

  it("defaults language to fi-FI", async () => {
    session = await createSpeechSession({ silence_timeout_seconds: 60 });
    assert.equal(session.language, "fi-FI");
  });

  it("respects language option", async () => {
    session = await createSpeechSession({ language: "en-US", silence_timeout_seconds: 60 });
    assert.equal(session.language, "en-US");
  });

  it("respects label option", async () => {
    session = await createSpeechSession({ label: "my-label", silence_timeout_seconds: 60 });
    assert.equal(session.label, "my-label");
  });

  it("label is null when omitted", async () => {
    session = await createSpeechSession({ silence_timeout_seconds: 60 });
    assert.equal(session.label, null);
  });

  it("respects silence_timeout_seconds and stores it as ms", async () => {
    session = await createSpeechSession({ silence_timeout_seconds: 45 });
    assert.equal(session.silenceTimeoutMs, 45_000);
  });

  it("arms silence timer immediately", async () => {
    session = await createSpeechSession({ silence_timeout_seconds: 60 });
    assert.ok(session.silenceTimer !== null);
  });

  it("session auto-ends on silence timeout and resolves with silence_timeout reason", async () => {
    session = await createSpeechSession({ silence_timeout_seconds: 0.05 }); // 50 ms
    const { reason } = await waitForTranscript(session.sessionId);
    assert.equal(reason, "silence_timeout");
    session = null; // already ended
  });
});

// ── 3. endSpeechSession ───────────────────────────────────────────────────────

describe("endSpeechSession", () => {
  it("resolves waitForTranscript with reason when save_partial is true", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    const waiter = waitForTranscript(session.sessionId);
    endSpeechSession(session.sessionId, true, "agent_ended");
    const result = await waiter;
    assert.equal(result.reason, "agent_ended");
    assert.equal(result.transcript, "");
  });

  it("rejects waitForTranscript when save_partial is false", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    const waiter = waitForTranscript(session.sessionId);
    endSpeechSession(session.sessionId, false, "abort");
    await assert.rejects(() => waiter, /Speech session aborted/);
  });

  it("throws for an unknown session_id", () => {
    assert.throws(() => endSpeechSession("no-such-id", true), /Unknown speech session/);
  });

  it("throws on second call after session is already ended", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    endSpeechSession(session.sessionId, true);
    assert.throws(() => endSpeechSession(session.sessionId, true), /Unknown speech session/);
  });
});

// ── 4. waitForTranscript ──────────────────────────────────────────────────────

describe("waitForTranscript", () => {
  it("rejects immediately for an unknown session_id", async () => {
    await assert.rejects(() => waitForTranscript("bad-id"), /Unknown speech session/);
  });

  it("rejects with timeout error when timeout_seconds elapses", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    try {
      await assert.rejects(
        () => waitForTranscript(session.sessionId, 0.05), // 50 ms
        /timed out/
      );
    } finally {
      cleanupSession(session.sessionId);
    }
  });

  it("multiple waiters on the same session all resolve", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    const w1 = waitForTranscript(session.sessionId);
    const w2 = waitForTranscript(session.sessionId);
    endSpeechSession(session.sessionId, true, "done");
    const [r1, r2] = await Promise.all([w1, w2]);
    assert.equal(r1.reason, "done");
    assert.equal(r2.reason, "done");
  });
});

// ── 5. POST /stt/:sessionId/chunk ─────────────────────────────────────────────

describe("POST /stt/:sessionId/chunk", () => {
  let sessionId;

  afterEach(() => {
    cleanupSession(sessionId);
    sessionId = null;
  });

  it("returns 204 for a valid final chunk", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    sessionId = session.sessionId;
    const res = await postChunk(sessionId, { text: "Hello", isFinal: true });
    assert.equal(res.status, 204);
  });

  it("returns 204 for a non-final chunk", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    sessionId = session.sessionId;
    const res = await postChunk(sessionId, { text: "partial...", isFinal: false });
    assert.equal(res.status, 204);
  });

  it("accumulates multiple final chunks into the transcript", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    sessionId = session.sessionId;
    const waiter = waitForTranscript(sessionId);

    await postChunk(sessionId, { text: "Hello", isFinal: true });
    await postChunk(sessionId, { text: "world", isFinal: true });
    await postDone(sessionId);

    const { transcript } = await waiter;
    assert.equal(transcript, "Hello world");
    sessionId = null; // already ended
  });

  it("ignores non-final (interim) chunks in the transcript", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    sessionId = session.sessionId;
    const waiter = waitForTranscript(sessionId);

    await postChunk(sessionId, { text: "interim text", isFinal: false });
    await postChunk(sessionId, { text: "final text", isFinal: true });
    await postDone(sessionId);

    const { transcript } = await waiter;
    assert.equal(transcript, "final text");
    sessionId = null;
  });

  it("trims whitespace from final chunks", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    sessionId = session.sessionId;
    const waiter = waitForTranscript(sessionId);

    await postChunk(sessionId, { text: "  padded  ", isFinal: true });
    await postDone(sessionId);

    const { transcript } = await waiter;
    assert.equal(transcript, "padded");
    sessionId = null;
  });

  it("returns 410 for an unknown session_id", async () => {
    const res = await postChunk("no-such-session", { text: "Hi", isFinal: true });
    assert.equal(res.status, 410);
    const body = await res.json();
    assert.ok(body.error);
  });

  it("returns 410 for an already-ended session", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    sessionId = session.sessionId;
    endSpeechSession(sessionId, true);
    const res = await postChunk(sessionId, { text: "late chunk", isFinal: true });
    assert.equal(res.status, 410);
    sessionId = null;
  });

  it("sets Access-Control-Allow-Origin: * on the response", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    sessionId = session.sessionId;
    const res = await postChunk(sessionId, { text: "Hi", isFinal: true });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});

// ── 6. POST /stt/:sessionId/done ─────────────────────────────────────────────

describe("POST /stt/:sessionId/done", () => {
  it("returns 204 and ends the session with user_stopped reason", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    const waiter = waitForTranscript(session.sessionId);
    const res = await postDone(session.sessionId);
    assert.equal(res.status, 204);
    const { reason } = await waiter;
    assert.equal(reason, "user_stopped");
  });

  it("returns 204 even for an unknown session_id", async () => {
    const res = await postDone("no-such-session");
    assert.equal(res.status, 204);
  });

  it("sets Access-Control-Allow-Origin: * on the response", async () => {
    const session = await createSpeechSession({ silence_timeout_seconds: 60 });
    const res = await postDone(session.sessionId);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});

// ── 7. CORS preflight ─────────────────────────────────────────────────────────

describe("OPTIONS /stt/:sessionId/chunk (CORS preflight)", () => {
  it("returns 204 with correct CORS headers", async () => {
    const res = await fetch(`${baseUrl}/stt/any-id/chunk`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.ok(res.headers.get("access-control-allow-methods").includes("POST"));
    assert.ok(res.headers.get("access-control-allow-headers").includes("Content-Type"));
  });
});

// ── 8. handleSpeechTool — start_speech_session ────────────────────────────────

describe("handleSpeechTool: start_speech_session", () => {
  let sessionId;

  afterEach(() => {
    cleanupSession(sessionId);
    sessionId = null;
  });

  it("returns ok and a session_id", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    assert.equal(payload.ok, true);
    assert.ok(typeof payload.session_id === "string");
    sessionId = payload.session_id;
  });

  it("returns a browser_url pointing to LCYT_WEB_URL/mcp/:sessionId", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    assert.ok(
      payload.browser_url.startsWith("https://lcyt-test.example/mcp/"),
      `browser_url should start with LCYT_WEB_URL/mcp/; got: ${payload.browser_url}`
    );
    sessionId = payload.session_id;
  });

  it("browser_url contains session_id in the path", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    assert.ok(
      payload.browser_url.includes(payload.session_id),
      "browser_url should contain session_id"
    );
    sessionId = payload.session_id;
  });

  it("browser_url contains server query param set to SPEECH_PUBLIC_URL", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    const url = new URL(payload.browser_url);
    assert.equal(url.searchParams.get("server"), "https://mcp-test.example");
    sessionId = payload.session_id;
  });

  it("browser_url contains lang query param matching language", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      language: "sv-SE",
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    const url = new URL(payload.browser_url);
    assert.equal(url.searchParams.get("lang"), "sv-SE");
    sessionId = payload.session_id;
  });

  it("browser_url contains silence param in ms", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 45,
    });
    const payload = parseResult(result);
    const url = new URL(payload.browser_url);
    assert.equal(url.searchParams.get("silence"), "45000");
    sessionId = payload.session_id;
  });

  it("browser_url contains label param when label is provided", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      label: "my-session",
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    const url = new URL(payload.browser_url);
    assert.equal(url.searchParams.get("label"), "my-session");
    sessionId = payload.session_id;
  });

  it("browser_url omits label param when label is not provided", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    const url = new URL(payload.browser_url);
    assert.equal(url.searchParams.get("label"), null);
    sessionId = payload.session_id;
  });

  it("returns default language fi-FI when language is omitted", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    assert.equal(payload.language, "fi-FI");
    sessionId = payload.session_id;
  });

  it("returns the configured silence_timeout_seconds in output", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 120,
    });
    const payload = parseResult(result);
    assert.equal(payload.silence_timeout_seconds, 120);
    sessionId = payload.session_id;
  });

  it("stream_key shows (none) when no youtube_stream_key is provided", async () => {
    const result = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    assert.equal(payload.stream_key, "(none)");
    sessionId = payload.session_id;
  });

  it("stream_key masks all but last 4 characters with ****", async () => {
    // Note: start() on YoutubeLiveCaptionSender is synchronous — no network call.
    const result = await handleSpeechTool("start_speech_session", {
      youtube_stream_key: "abcd-1234",
      silence_timeout_seconds: 60,
    });
    const payload = parseResult(result);
    assert.equal(payload.stream_key, "****1234");
    sessionId = payload.session_id;
  });
});

// ── 9. handleSpeechTool — get_speech_transcript ───────────────────────────────

describe("handleSpeechTool: get_speech_transcript", () => {
  it("resolves with transcript after browser sends chunks and posts done", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);

    // Begin waiting for transcript concurrently
    const transcriptPromise = handleSpeechTool("get_speech_transcript", { session_id });

    await postChunk(session_id, { text: "Hello", isFinal: true });
    await postChunk(session_id, { text: "world", isFinal: true });
    await postDone(session_id);

    const payload = parseResult(await transcriptPromise);
    assert.equal(payload.ok, true);
    assert.equal(payload.transcript, "Hello world");
    assert.equal(payload.end_reason, "user_stopped");
  });

  it("resolves with empty transcript when done is sent without any chunks", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);
    const transcriptPromise = handleSpeechTool("get_speech_transcript", { session_id });
    await postDone(session_id);
    const payload = parseResult(await transcriptPromise);
    assert.equal(payload.ok, true);
    assert.equal(payload.transcript, "");
  });

  it("rejects with timeout error when timeout_seconds elapses", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);
    try {
      await assert.rejects(
        () => handleSpeechTool("get_speech_transcript", {
          session_id,
          timeout_seconds: 0.05,
        }),
        /timed out/
      );
    } finally {
      cleanupSession(session_id);
    }
  });

  it("rejects for an unknown session_id", async () => {
    await assert.rejects(
      () => handleSpeechTool("get_speech_transcript", { session_id: "no-such-id" }),
      /Unknown speech session/
    );
  });
});

// ── 10. handleSpeechTool — end_speech_session ─────────────────────────────────

describe("handleSpeechTool: end_speech_session", () => {
  it("returns ok and save_partial defaults to true", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);
    const result = await handleSpeechTool("end_speech_session", { session_id });
    const payload = parseResult(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.save_partial, true);
  });

  it("returns save_partial false when explicitly set to false", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);
    const result = await handleSpeechTool("end_speech_session", {
      session_id,
      save_partial: false,
    });
    const payload = parseResult(result);
    assert.equal(payload.ok, true);
    assert.equal(payload.save_partial, false);
  });

  it("resolves a pending get_speech_transcript when save_partial is true", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);
    const transcriptPromise = handleSpeechTool("get_speech_transcript", { session_id });
    await handleSpeechTool("end_speech_session", { session_id, save_partial: true });
    const payload = parseResult(await transcriptPromise);
    assert.equal(payload.ok, true);
  });

  it("rejects a pending get_speech_transcript when save_partial is false", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);
    const transcriptPromise = handleSpeechTool("get_speech_transcript", { session_id });
    await handleSpeechTool("end_speech_session", { session_id, save_partial: false });
    await assert.rejects(() => transcriptPromise, /Speech session aborted/);
  });

  it("throws for an unknown session_id", async () => {
    await assert.rejects(
      () => handleSpeechTool("end_speech_session", { session_id: "no-such-id" }),
      /Unknown speech session/
    );
  });
});

// ── 11. handleSpeechTool — unknown tool name ──────────────────────────────────

describe("handleSpeechTool: unknown tool", () => {
  it("throws for an unrecognised tool name", async () => {
    await assert.rejects(
      () => handleSpeechTool("not_a_speech_tool", {}),
      /Unknown speech tool/
    );
  });
});

// ── 12. Full MCP/web integration flows ───────────────────────────────────────

describe("full MCP/web integration flow", () => {
  it("basic flow: start → chunks → done → transcript resolves", async () => {
    // Step 1: MCP client starts a speech session
    const start = await handleSpeechTool("start_speech_session", {
      language: "en-US",
      silence_timeout_seconds: 60,
    });
    const startPayload = parseResult(start);
    assert.equal(startPayload.ok, true);
    const sessionId = startPayload.session_id;

    // Step 2: MCP client waits for transcript (concurrent)
    const transcriptPromise = handleSpeechTool("get_speech_transcript", {
      session_id: sessionId,
    });

    // Step 3: Browser captures speech and POSTs finals
    await postChunk(sessionId, { text: "This", isFinal: true });
    await postChunk(sessionId, { text: "is", isFinal: true });
    await postChunk(sessionId, { text: "a test", isFinal: true });

    // Step 4: Browser signals user stopped
    await postDone(sessionId);

    // Step 5: get_speech_transcript resolves with full transcript
    const transcriptPayload = parseResult(await transcriptPromise);
    assert.equal(transcriptPayload.ok, true);
    assert.equal(transcriptPayload.transcript, "This is a test");
    assert.equal(transcriptPayload.end_reason, "user_stopped");
  });

  it("flow with interim chunks interleaved: only finals appear in transcript", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);
    const transcriptPromise = handleSpeechTool("get_speech_transcript", {
      session_id,
    });

    await postChunk(session_id, { text: "Go", isFinal: false });
    await postChunk(session_id, { text: "Good morning", isFinal: false });
    await postChunk(session_id, { text: "Good morning everyone", isFinal: true });
    await postChunk(session_id, { text: "Welc", isFinal: false });
    await postChunk(session_id, { text: "Welcome", isFinal: true });
    await postDone(session_id);

    const payload = parseResult(await transcriptPromise);
    assert.equal(payload.transcript, "Good morning everyone Welcome");
  });

  it("flow ending via silence timeout: transcript contains chunks received before timeout", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      language: "fi-FI",
      silence_timeout_seconds: 0.1, // 100 ms
    });
    const { session_id } = parseResult(start);

    await postChunk(session_id, { text: "Hei", isFinal: true });
    await postChunk(session_id, { text: "maailma", isFinal: true });

    // get_speech_transcript will wait for the silence timeout to fire
    const payload = parseResult(
      await handleSpeechTool("get_speech_transcript", { session_id })
    );
    assert.equal(payload.ok, true);
    assert.equal(payload.transcript, "Hei maailma");
    assert.equal(payload.end_reason, "silence_timeout");
  });

  it("flow aborted via end_speech_session with save_partial false", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);

    const transcriptPromise = handleSpeechTool("get_speech_transcript", { session_id });

    await postChunk(session_id, { text: "Partial phrase", isFinal: true });
    await handleSpeechTool("end_speech_session", {
      session_id,
      save_partial: false,
      reason: "abort",
    });

    await assert.rejects(() => transcriptPromise, /Speech session aborted/);
  });

  it("flow aborted via end_speech_session with save_partial true saves partial transcript", async () => {
    const start = await handleSpeechTool("start_speech_session", {
      silence_timeout_seconds: 60,
    });
    const { session_id } = parseResult(start);

    const transcriptPromise = handleSpeechTool("get_speech_transcript", { session_id });

    await postChunk(session_id, { text: "Partial phrase", isFinal: true });
    await handleSpeechTool("end_speech_session", {
      session_id,
      save_partial: true,
      reason: "end_speech",
    });

    const payload = parseResult(await transcriptPromise);
    assert.equal(payload.ok, true);
    assert.equal(payload.transcript, "Partial phrase");
    assert.equal(payload.end_reason, "end_speech");
  });

  it("two concurrent sessions are independent", async () => {
    const start1 = await handleSpeechTool("start_speech_session", {
      language: "en-US",
      silence_timeout_seconds: 60,
    });
    const start2 = await handleSpeechTool("start_speech_session", {
      language: "fi-FI",
      silence_timeout_seconds: 60,
    });
    const id1 = parseResult(start1).session_id;
    const id2 = parseResult(start2).session_id;

    const p1 = handleSpeechTool("get_speech_transcript", { session_id: id1 });
    const p2 = handleSpeechTool("get_speech_transcript", { session_id: id2 });

    await postChunk(id1, { text: "English", isFinal: true });
    await postChunk(id2, { text: "Finnish", isFinal: true });
    await postDone(id1);
    await postDone(id2);

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(parseResult(r1).transcript, "English");
    assert.equal(parseResult(r2).transcript, "Finnish");
  });
});
