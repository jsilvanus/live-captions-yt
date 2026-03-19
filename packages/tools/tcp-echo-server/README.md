# tcp-echo-server

A minimal TCP echo server for testing lcyt-bridge TCP connectivity.

## What it does

Listens for TCP connections and echoes every received byte back to the sender. Useful as a lightweight target to verify that a bridge TCP route is alive without needing real AMX / Roland hardware.

## Usage

```bash
# Default port 9999
node server.js

# Custom port via argument
node server.js 7000

# Custom port via env var
PORT=8080 node server.js

# Bind to loopback only
HOST=127.0.0.1 node server.js
```

## Testing with the lcyt-bridge UI

1. Start the echo server on the machine accessible to your bridge agent:
   ```bash
   node packages/tools/tcp-echo-server/server.js
   ```
2. Open **Production → Bridges** in the LCYT web UI.
3. Click **Send TCP** on the bridge you want to test.
4. Enter the host/IP of the echo server, port `9999`, and any payload text (e.g. `PING`).
5. Click **Send** — the bridge will relay the TCP send command, the echo server will receive and echo it back, and the UI will display the result.

## Testing manually with nc / telnet

```bash
# netcat
echo -n "PING" | nc 127.0.0.1 9999

# telnet
telnet 127.0.0.1 9999
```

## Notes

- **Not a workspace package** — this tool lives in `packages/tools/` but is intentionally excluded from the npm workspace to keep it dependency-free.
- No external dependencies; uses Node.js `node:net` only.
- Suitable for local dev and on-site network diagnostics.
