# `packages/tools/tcp-echo-server` — TCP Echo Server

Standalone development utility. Listens for TCP connections and echoes every received message back to the sender. Used for testing `lcyt-bridge` TCP connections without real AV hardware.

**Entry:** `server.js`
**Usage:** `node server.js [port]` or `PORT=8080 node server.js`
**Default port:** 9999
