# MCP Stdio Transport

`lcyt-mcp-stdio` is an MCP server that communicates over **standard input/output** (stdin/stdout). It is the recommended integration for Claude Desktop and any MCP client that launches the server as a child process.

**Package:** `packages/lcyt-mcp-stdio`

---

## How It Works

The MCP client launches `lcyt-mcp-stdio` as a subprocess. The client sends JSON-RPC messages over stdin; the server responds on stdout. This is the standard MCP stdio transport pattern.

Caption sessions are stored in memory within the subprocess. They are lost if the process exits.

---

## Running the Server

```bash
node packages/lcyt-mcp-stdio/src/server.js
```

Set `LCYT_LOG_STDERR=1` so that `lcyt` log messages go to `stderr` and do not corrupt the MCP protocol stream on `stdout`:

```bash
LCYT_LOG_STDERR=1 node packages/lcyt-mcp-stdio/src/server.js
```

---

## Claude Desktop Integration

Add the following to your Claude Desktop configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lcyt": {
      "command": "node",
      "args": ["/absolute/path/to/packages/lcyt-mcp-stdio/src/server.js"],
      "env": {
        "LCYT_LOG_STDERR": "1"
      }
    }
  }
}
```

After restarting Claude Desktop, the `lcyt` MCP server will be available. You can prompt Claude with:

> _"Start a YouTube Live caption session with stream key xxxx-xxxx-xxxx-xxxx and send 'Hello, world!'"_

---

## Available Tools

| Tool | Description |
|---|---|
| [`start`](./tools.md#start--start-caption-session) | Create a new caption session |
| [`send_caption`](./tools.md#send_caption--send-a-single-caption) | Send a single caption |
| [`send_batch`](./tools.md#send_batch--send-multiple-captions) | Send multiple captions at once |
| [`sync_clock`](./tools.md#sync_clock--synchronise-clock) | Synchronise clock with YouTube |
| [`get_status`](./tools.md#get_status--session-status) | Query session state |
| [`stop`](./tools.md#stop--stop-caption-session) | End a session |

See the [Tools Reference](./tools.md) for full parameter and return value documentation.

---

## Resources

The stdio server exposes MCP resources that clients can read directly:

| URI | Returns |
|---|---|
| `session://<session_id>` | JSON: `{sequence, syncOffset, startedAt}` |

---

## Architecture

```
MCP Client (Claude Desktop)
        │ stdin/stdout
        ▼
lcyt-mcp-stdio (subprocess)
        │
        ▼
YoutubeLiveCaptionSender
        │
        ▼
YouTube Live Ingestion API
```

- One MCP server process handles one client connection
- Sessions survive reconnects within the same process lifetime
- Process exit destroys all sessions

---

## Environment Variables

| Variable | Effect |
|---|---|
| `LCYT_LOG_STDERR=1` | Route all lcyt logs to stderr (required for MCP stdio) |

No other environment variables are required. Stream keys and session parameters are supplied via tool calls at runtime.

---

## Troubleshooting

**Server not appearing in Claude Desktop**
- Ensure the path in `args` is absolute and the file exists
- Verify Node.js is available in the `command`'s `PATH`
- Check Claude Desktop logs for subprocess startup errors

**Garbled output / JSON parse errors**
- Make sure `LCYT_LOG_STDERR=1` is set — log output on stdout breaks the MCP stream

**Session not found errors**
- Sessions are in-memory and are lost if the server process restarts
- Call `start` again to create a new session
