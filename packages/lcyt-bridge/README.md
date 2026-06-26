# lcyt-bridge — Production Control Bridge Agent

Standalone agent that connects to the LCYT backend via SSE and relays commands to physical AV hardware (AMX controllers, Roland mixers) over TCP. Designed to run on-site where the hardware is located.

**Version:** 0.3.0  
**License:** MIT  
**Author:** Juha Itäleino <jsilvanus@gmail.com>

## Overview

The bridge agent is a lightweight Node.js service that:
- Connects to `lcyt-backend` via Server-Sent Events (SSE)
- Receives production control commands (PTZ, mixer source switching)
- Dispatches commands to physical AV hardware over TCP
- Reports command results back to the backend
- Auto-reconnects on connection loss with exponential backoff

## Installation & Setup

```bash
npm install -g lcyt-bridge
```

Or run directly:
```bash
node packages/lcyt-bridge/src/index.js
```

### Configuration

Create a `.env` file in the same directory as the executable:

```env
BACKEND_URL=https://api.lcyt.fi
BRIDGE_TOKEN=your-bridge-token-from-backend
```

Or set environment variables:
```bash
export BACKEND_URL=https://api.lcyt.fi
export BRIDGE_TOKEN=your-bridge-token
node src/index.js
```

**Required variables:**
| Variable | Purpose |
|----------|---------|
| `BACKEND_URL` | Base URL of the LCYT backend (e.g., `https://api.lcyt.fi`) |
| `BRIDGE_TOKEN` | Authentication token from `POST /production/bridge/instances` |

## Quick Start

1. Register a bridge instance with the backend:
   ```bash
   curl -X POST https://api.lcyt.fi/production/bridge/instances \
     -H "Authorization: Bearer $SESSION_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Main Bridge"}'
   ```

2. Copy the returned `token` and save to `.env`

3. Start the bridge:
   ```bash
   node packages/lcyt-bridge/src/index.js
   ```

## Build as Standalone Executable

Using the `pkg` tool, create platform-specific binaries:

```bash
npm run build:win    # → dist/lcyt-bridge.exe  (Windows x64)
npm run build:mac    # → dist/lcyt-bridge-mac  (macOS x64)
npm run build:linux  # → dist/lcyt-bridge-linux (Linux x64)
```

## Architecture

**Main components:**

| File | Purpose |
|------|---------|
| `src/index.js` | Entry point; loads config; starts the bridge; optional system tray |
| `src/bridge.js` | `Bridge` class (EventEmitter); SSE connection; command dispatch; reconnect logic |
| `src/tcp-pool.js` | `TcpPool`: manages named TCP connections to hardware; auto-reconnect |
| `src/tray.js` | Optional system tray icon for packaged desktop use |

**Flow:**

```
Backend SSE /production/bridge/commands?token=xxx
         ↓
      Bridge (SSE listener)
         ↓
    TcpPool (tcp_send commands)
         ↓
Physical Hardware (AMX, Roland, etc.)
         ↓
    TcpPool (result callback)
         ↓
  Bridge → POST /production/bridge/status
```

## Hardware Adapters

The backend supports several hardware types:

**Cameras:** AMX, VISCA-over-IP, browser WebRTC, software-only  
**Mixers:** Roland, AMX, Blackmagic ATEM, OBS Studio, LCYT software, Matrox Monarch HDX

The bridge forwards raw TCP commands from the backend's adapter layer. See `packages/plugins/lcyt-production` for adapter implementations.

## Testing

Test bridge connectivity without real hardware using the echo server:

```bash
# Start the echo server (echoes all TCP messages back)
node packages/tools/tcp-echo-server/server.js

# Configure bridge to connect to it
TCP_HOST=127.0.0.1
TCP_PORT=9999
```

## API Events

**SSE connection** (streaming from backend):
- `tcp_send` — Command to send to hardware `{ connName, data, timeout }`

**Status callback** (back to backend):
- POST `/production/bridge/status` — Result `{ bridgeId, commandId, status, result }`

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKEND_URL` | — | Base URL of LCYT backend |
| `BRIDGE_TOKEN` | — | Authentication token |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `HEARTBEAT_INTERVAL_MS` | 20000 | SSE heartbeat interval |
| `RECONNECT_MIN_MS` | 5000 | Min backoff on disconnect |
| `RECONNECT_MAX_MS` | 60000 | Max backoff on disconnect |

## Troubleshooting

**Bridge won't connect:**
- Check `BACKEND_URL` and `BRIDGE_TOKEN` are correct
- Verify backend is running and accessible
- Check firewall allows outbound HTTPS

**Commands not reaching hardware:**
- Verify TCP hardware address and port are correct in backend configuration
- Use echo server to test TCP connectivity
- Check hardware is powered on and responsive

**See also:**
- [Production control documentation](../../docs/guide-web/production.md)
- [LCYT backend documentation](../lcyt-backend/README.md)
- [Plan: Production Control](../../docs/plans/plan_prod.md)
