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

## Building standalone executables

The server can be compiled into self-contained executables that run without Node.js installed,
using [esbuild](https://esbuild.github.io/) for bundling and [@yao-pkg/pkg](https://github.com/yao-pkg/pkg) for packaging.

```bash
# Install build dependencies first (one-time)
npm install

# Build for a specific platform
npm run build:win          # → dist/tcp-echo-server-1.0.0.exe    (Windows x64)
npm run build:mac          # → dist/tcp-echo-server-1.0.0-mac    (macOS x64)
npm run build:linux        # → dist/tcp-echo-server-1.0.0-linux  (Linux x64)
npm run build:linux-arm64  # → dist/tcp-echo-server-1.0.0-linux-arm64 (Linux ARM64)

# Build all platforms at once
npm run build:all
```

All platforms can be cross-compiled from any host operating system.
The `dist/` directory is gitignored; binaries are not committed to the repository.

## Notes

- **Not a workspace package** — this tool lives in `packages/tools/` but is intentionally excluded from the npm workspace glob.
- Runtime has no external dependencies; uses Node.js `node:net` only.
- Suitable for local dev and on-site network diagnostics.
