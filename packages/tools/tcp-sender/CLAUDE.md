# `packages/tools/tcp-sender` — TCP Command Sender

Standalone development utility. Opens a TCP connection to a given host/port, sends one command payload, prints any response, then closes. Client-side counterpart to `packages/tools/tcp-echo-server` — used for manually testing `lcyt-bridge` TCP targets (the echo server, or real AMX/Roland hardware) without running the full bridge agent.

**Entry:** `sender.js`
**Usage:** `node sender.js <host> <port> <command>`
**Env:** `TIMEOUT_MS` — how long to wait for a response before closing (default: 2000)
