# lcyt-production — Production Control Plugin

Production control library for camera PTZ presets and video mixer source switching. Manages connections to physical AV hardware and provides a device registry system for on-site control.

**Version:** 0.1.0  
**License:** MIT

## Overview

lcyt-production provides:
- **Device registry** — Cameras, mixers, bridge agents
- **Hardware adapters** — AMX, VISCA, ATEM, OBS, Roland, etc.
- **Bridge agent management** — SSE command dispatch to on-site bridges
- **Preset system** — Named camera PTZ positions
- **Source switching** — Video mixer input selection
- **Device roles** — PIN-code authentication for production devices

## Installation

```bash
npm install lcyt-production
```

## Quick Start

In `lcyt-backend`:

```javascript
import { createProductionRouter, initProductionControl } from 'lcyt-production';

const { registry, bridgeManager } = await initProductionControl(db);
app.use('/production', createProductionRouter(db, registry, bridgeManager, { publicUrl }));
```

## API Routes

### Camera Management

```
GET    /production/cameras
       List all cameras
       Response: [{ id, name, type, host, port, presets: [...] }]

POST   /production/cameras
       Create new camera
       Body: { name, type, host, port, presets: [...] }
       Response: 201 { id }

PUT    /production/cameras/:id
       Update camera
       Response: 200

DELETE /production/cameras/:id
       Delete camera
       Response: 204

POST   /production/cameras/:id/preset/:preset
       Trigger camera preset (PTZ)
       Body: { pan?, tilt?, zoom? }
       Response: 200 { status: 'executed' }
```

### Mixer Management

```
GET    /production/mixers
       List mixers with connection status
       Response: [{ id, name, type, status, inputs: [...] }]

POST   /production/mixers
       Create mixer
       Body: { name, type, host, port, inputs: [...] }
       Response: 201 { id }

PUT    /production/mixers/:id
       Update mixer
       Response: 200

DELETE /production/mixers/:id
       Delete mixer
       Response: 204

POST   /production/mixers/:id/switch
       Switch mixer to input
       Body: { input: 1 }
       Response: 200 { currentInput: 1 }
```

### Bridge Agent Management

```
GET    /production/bridge/commands?token=xxx
       SSE stream for bridge agents to receive commands
       Response: text/event-stream

POST   /production/bridge/status
       Bridge heartbeat + command result
       Body: { bridgeId, status, result }
       Response: 200

GET    /production/bridge/instances
       List registered bridge agents
       Response: [{ id, name, status, lastSeen }]

POST   /production/bridge/instances
       Register new bridge instance
       Body: { name, ... }
       Response: 201 { token }

DELETE /production/bridge/instances/:id
       Unregister bridge
       Response: 204
```

### Device Roles

```
GET/POST/PUT/DELETE /production/device-roles
       Device role CRUD
       Response: [{ code, name, capabilities, pinCode }]

GET    /production/device-roles/:code/auth
       Authenticate device via PIN
       Body: { pinCode }
       Response: 200 { token } or 401
```

## Camera Adapter Types

| Type | Protocol | Hardware | Setup |
|------|----------|----------|-------|
| `amx` | TCP/IP | AMX NI-3100, etc. | Netlinx code |
| `visca-ip` | VISCA over IP | Sony cameras, etc. | Camera IP + port |
| `browser` | WebRTC / media device | Local browser | No config needed |
| `none` | Software-only | N/A | Testing |

## Mixer Adapter Types

| Type | Protocol | Hardware | Setup |
|------|----------|----------|-------|
| `roland` | TCP/IP | Roland V-800HD, etc. | IP + port |
| `amx` | TCP/IP | AMX NI-3100, etc. | Netlinx code |
| `atem` | TCP/IP | Blackmagic ATEM | IP + port |
| `obs` | WebSocket | OBS Studio | localhost:4444 |
| `lcyt` | Internal | Software mixer | Built-in |
| `monarch_hdx` | TCP/IP | Matrox Monarch HDX | IP + port |

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAMERA_TYPE` | — | Default camera adapter type |
| `MIXER_TYPE` | — | Default mixer adapter type |
| `BRIDGE_POLL_INTERVAL_MS` | 20000 | Bridge heartbeat interval |
| `BRIDGE_COMMAND_TIMEOUT_MS` | 10000 | Command result timeout |

### Database Schema

```sql
-- Cameras
CREATE TABLE prod_cameras (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  name TEXT,
  type TEXT,                -- 'amx', 'visca-ip', 'browser', 'none'
  host TEXT,
  port INTEGER,
  config JSONB,             -- Type-specific config
  presets JSONB,            -- Named PTZ positions
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);

-- Mixers
CREATE TABLE prod_mixers (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  name TEXT,
  type TEXT,                -- 'roland', 'amx', 'atem', 'obs', 'lcyt', 'monarch_hdx'
  host TEXT,
  port INTEGER,
  config JSONB,
  inputs JSONB,             -- Input definitions
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);

-- Bridge instances (on-site agents)
CREATE TABLE prod_bridge_instances (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  name TEXT,
  token TEXT UNIQUE,        -- SSE auth token
  status TEXT,              -- 'connected', 'idle', 'offline'
  last_heartbeat DATETIME,
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);

-- Device roles (PIN-authenticated devices)
CREATE TABLE prod_device_roles (
  code TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  name TEXT,
  capabilities TEXT,       -- JSON array of allowed actions
  pin_code TEXT,            -- Hashed PIN
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);
```

## Bridge Agent Workflow

1. **Registration:**
   - Admin creates bridge instance: `POST /production/bridge/instances`
   - Returns SSE token

2. **Connection:**
   - Bridge agent connects: `GET /production/bridge/commands?token=xxx`
   - Establishes SSE stream with backend

3. **Command dispatch:**
   - Backend sends: `{ commandId, type: 'tcp_send', connName, data }`
   - Bridge executes: Sends TCP data to hardware
   - Bridge reports: `POST /production/bridge/status`

4. **Result delivery:**
   - Backend resolves Promise with result
   - Frontend receives via REST response

## Bridge Connection Diagram

```
Backend
  ├─ Registry (cameras, mixers, bridges)
  ├─ Adapter layer (protocol implementations)
  └─ SSE stream handler

          ↕ SSE commands

Bridge Agent
  ├─ SSE listener
  └─ TCP pool (hardware connections)

          ↕ TCP commands

Hardware (AMX, Roland, Sony, etc.)
```

## Testing

```bash
npm test -w packages/plugins/lcyt-production
```

Tests cover:
- Device registry CRUD
- Adapter instantiation
- Command dispatch (with mock hardware)
- Bridge SSE connection
- Status callback handling

## Integration with Other Plugins

**RTMP Plugin** (`lcyt-rtmp`):
- May coordinate camera/mixer state with RTMP relay

**Web UI** (`lcyt-web`):
- `/production/*` pages for operator control

## Frontend Integration

lcyt-web includes:

- **Operator control surface** (`/production`) — Live preview + camera/mixer controls
- **Camera management** (`/production/cameras`) — Setup wizard
- **Mixer management** (`/production/mixers`) — Source selection
- **Bridge management** (`/production/bridges`) — Registration + monitoring
- **Device roles** (`/production/devices`) — PIN-code auth setup

## See Also

- [Bridge agent documentation](../../lcyt-bridge/README.md)
- [Production operator page](../../lcyt-web/) — `/production/*` routes
- [Plan: Production Control](../../docs/plans/plan_prod.md)
