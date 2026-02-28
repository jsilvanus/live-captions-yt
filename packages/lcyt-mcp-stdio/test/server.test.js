/**
 * Smoke tests for packages/lcyt-mcp/src/server.js
 * start → send_caption → send_batch → get_status → stop lifecycle.
 *
 * Uses createHandlers(FakeSender) to avoid any network calls.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHandlers, TOOLS } from "../src/server.js";

// ---------------------------------------------------------------------------
// Fake sender — mirrors the public API of YoutubeLiveCaptionSender
// ---------------------------------------------------------------------------

class FakeSender {
  constructor({ streamKey } = {}) {
    this.streamKey = streamKey;
    this.sequence = 0;
    this.syncOffset = 0;
    this.isStarted = false;
  }

  async start() {
    this.isStarted = true;
    return this;
  }

  async send(text, timestamp) {
    const seq = this.sequence++;
    return { sequence: seq, statusCode: 200, response: "ok", serverTimestamp: null, timestamp };
  }

  async sendBatch(captions) {
    const count = captions.length;
    const seq = this.sequence;
    this.sequence += count;
    return { sequence: seq, count, statusCode: 200, response: "ok", serverTimestamp: null };
  }

  async sync() {
    return { syncOffset: 42, roundTripTime: 10, serverTimestamp: null, statusCode: 200 };
  }

  async end() {
    this.isStarted = false;
    return this;
  }
}

// ---------------------------------------------------------------------------
// Test suite — each test gets a fresh handler set via createHandlers(FakeSender)
// ---------------------------------------------------------------------------

describe("lcyt-mcp server", () => {
  let handlers;

  beforeEach(() => {
    handlers = createHandlers(FakeSender);
  });

  // -- tool listing ----------------------------------------------------------

  it("lists all six tools", async () => {
    const { tools } = await handlers.handleListTools();
    assert.equal(tools.length, 6);
    const names = new Set(tools.map((t) => t.name));
    for (const n of ["start", "send_caption", "send_batch", "sync_clock", "get_status", "stop"]) {
      assert.ok(names.has(n), `missing tool: ${n}`);
    }
  });

  it("TOOLS export matches handler list", async () => {
    const { tools } = await handlers.handleListTools();
    assert.deepEqual(tools, TOOLS);
  });

  // -- start -----------------------------------------------------------------

  it("start: creates a session and returns session_id", async () => {
    const result = await handlers.handleCallTool("start", { stream_key: "test-key" });
    const payload = JSON.parse(result.content[0].text);
    assert.ok(typeof payload.session_id === "string");
    assert.ok(handlers.sessions.has(payload.session_id));
  });

  it("start: stores startedAt metadata", async () => {
    const result = await handlers.handleCallTool("start", { stream_key: "test-key" });
    const { session_id } = JSON.parse(result.content[0].text);
    const meta = handlers.sessionMeta.get(session_id);
    assert.ok(meta);
    assert.ok(typeof meta.startedAt === "string");
  });

  // -- send_caption ----------------------------------------------------------

  it("send_caption: returns ok and sequence", async () => {
    const { content: [{ text: startText }] } = await handlers.handleCallTool("start", { stream_key: "k" });
    const { session_id } = JSON.parse(startText);

    const result = await handlers.handleCallTool("send_caption", { session_id, text: "Hello, world!" });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.ok, true);
    assert.ok("sequence" in payload);
  });

  // -- send_batch ------------------------------------------------------------

  it("send_batch: returns ok, sequence, and count", async () => {
    const { content: [{ text: startText }] } = await handlers.handleCallTool("start", { stream_key: "k" });
    const { session_id } = JSON.parse(startText);

    const captions = [{ text: "A" }, { text: "B" }, { text: "C" }];
    const result = await handlers.handleCallTool("send_batch", { session_id, captions });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.ok, true);
    assert.equal(payload.count, 3);
  });

  // -- sync_clock ------------------------------------------------------------

  it("sync_clock: returns syncOffset", async () => {
    const { content: [{ text: startText }] } = await handlers.handleCallTool("start", { stream_key: "k" });
    const { session_id } = JSON.parse(startText);

    const result = await handlers.handleCallTool("sync_clock", { session_id });
    const payload = JSON.parse(result.content[0].text);
    assert.ok("syncOffset" in payload);
    assert.equal(payload.syncOffset, 42);
  });

  // -- get_status ------------------------------------------------------------

  it("get_status: returns sequence and syncOffset", async () => {
    const { content: [{ text: startText }] } = await handlers.handleCallTool("start", { stream_key: "k" });
    const { session_id } = JSON.parse(startText);

    const result = await handlers.handleCallTool("get_status", { session_id });
    const payload = JSON.parse(result.content[0].text);
    assert.ok("sequence" in payload);
    assert.ok("syncOffset" in payload);
  });

  // -- stop ------------------------------------------------------------------

  it("stop: removes session and returns ok", async () => {
    const { content: [{ text: startText }] } = await handlers.handleCallTool("start", { stream_key: "k" });
    const { session_id } = JSON.parse(startText);

    const result = await handlers.handleCallTool("stop", { session_id });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.ok, true);
    assert.ok(!handlers.sessions.has(session_id));
  });

  // -- full lifecycle --------------------------------------------------------

  it("full lifecycle: start → send → batch → status → stop", async () => {
    const { content: [{ text: startText }] } = await handlers.handleCallTool("start", {
      stream_key: "my-stream",
    });
    const { session_id } = JSON.parse(startText);
    assert.ok(handlers.sessions.has(session_id));

    // single caption — sequence becomes 1
    await handlers.handleCallTool("send_caption", { session_id, text: "Line one" });

    // batch of two — sequence becomes 3
    await handlers.handleCallTool("send_batch", { session_id, captions: [{ text: "A" }, { text: "B" }] });

    // status
    const status = await handlers.handleCallTool("get_status", { session_id });
    const { sequence } = JSON.parse(status.content[0].text);
    assert.equal(sequence, 3);

    // stop
    const stop = await handlers.handleCallTool("stop", { session_id });
    assert.equal(JSON.parse(stop.content[0].text).ok, true);
    assert.ok(!handlers.sessions.has(session_id));
  });

  // -- error cases -----------------------------------------------------------

  it("throws on unknown session_id", async () => {
    await assert.rejects(
      () => handlers.handleCallTool("send_caption", { session_id: "bad-id", text: "Hi" }),
      /Unknown session_id/
    );
  });

  it("throws on unknown tool name", async () => {
    await assert.rejects(
      () => handlers.handleCallTool("not_a_tool", {}),
      /Unknown tool/
    );
  });

  // -- resources -------------------------------------------------------------

  it("list_resources: reflects active sessions", async () => {
    const before = await handlers.handleListResources();
    assert.equal(before.resources.length, 0);

    const { content: [{ text: startText }] } = await handlers.handleCallTool("start", { stream_key: "k" });
    const { session_id } = JSON.parse(startText);

    const after = await handlers.handleListResources();
    const uris = after.resources.map((r) => r.uri);
    assert.ok(uris.includes(`session://${session_id}`));
  });

  it("read_resource: returns session snapshot", async () => {
    const { content: [{ text: startText }] } = await handlers.handleCallTool("start", { stream_key: "k" });
    const { session_id } = JSON.parse(startText);

    const text = await handlers.handleReadResource(`session://${session_id}`);
    const payload = JSON.parse(text);
    assert.ok("sequence" in payload);
    assert.ok("syncOffset" in payload);
    assert.ok("startedAt" in payload);
  });

  it("read_resource: throws on unknown URI", async () => {
    await assert.rejects(
      () => handlers.handleReadResource("unknown://foo"),
      /Unknown resource URI/
    );
  });
});
