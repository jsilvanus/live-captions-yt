# tcp-sender

A minimal TCP command sender for testing lcyt-bridge TCP targets — AMX/NetLinx masters, Roland mixers, the `tcp-echo-server` in this repo, or anything else that speaks plain TCP.

## What it does

Opens a TCP connection to `<host>:<port>`, writes a single command payload, prints anything the remote end sends back within a short window, then closes the connection. This is the client-side counterpart to `tcp-echo-server` — where the echo server gives you something to send *to*, `tcp-sender` gives you a way to send *from*, without needing the full `lcyt-bridge` agent or the lcyt-web UI running.

## Usage

```bash
# Basic send
node sender.js <host> <port> <command>

# Against the local echo server
node sender.js 127.0.0.1 9999 PING

# Against a NetLinx bridge listener (see keskuskirkko-netlinx's
# docs/plans/lcyt-bridge-tcp-camera-control.md for the wire format)
node sender.js 192.168.1.50 6500 "CAM1:PRESET:3;"

# Wait longer for a response
TIMEOUT_MS=5000 node sender.js 192.168.1.50 6500 "CAM1:MOVE:UP;"
```

Quote the command if it contains spaces or shell-special characters (`;`, `$`, `'`, `"`).

## Testing round-trip with the echo server

```bash
# Terminal 1
node packages/tools/tcp-echo-server/server.js

# Terminal 2
node packages/tools/tcp-sender/sender.js 127.0.0.1 9999 "PING"
```

The sender should print the connection, the outgoing payload, and the echoed response back from the server.

## Building standalone executables

The sender can be compiled into self-contained executables that run without Node.js installed,
using [esbuild](https://esbuild.github.io/) for bundling and [@yao-pkg/pkg](https://github.com/yao-pkg/pkg) for packaging.

```bash
# Install build dependencies first (one-time)
npm install

# Build for a specific platform
npm run build:win          # → dist/tcp-sender-1.0.0.exe    (Windows x64)
npm run build:mac          # → dist/tcp-sender-1.0.0-mac    (macOS x64)
npm run build:linux        # → dist/tcp-sender-1.0.0-linux  (Linux x64)
npm run build:linux-arm64  # → dist/tcp-sender-1.0.0-linux-arm64 (Linux ARM64)

# Build all platforms at once
npm run build:all
```

All platforms can be cross-compiled from any host operating system.
The `dist/` directory is gitignored; binaries are not committed to the repository.

## Notes

- **Not a workspace package** — this tool lives in `packages/tools/` but is intentionally excluded from the npm workspace glob, same as `tcp-echo-server`.
- Runtime has no external dependencies; uses Node.js `node:net` only.
- Suitable for local dev and on-site network diagnostics (e.g. verifying a NetLinx master's TCP listener is reachable before wiring up `lcyt-bridge`).
