---
id: api/production
title: "/production — Production Control"
methods: [GET, POST, PUT, DELETE]
auth: [admin-key]
---

# /production — Production Control

The production control subsystem lets operators trigger camera presets and switch video mixer sources from the same interface used for captions. It is provided by the `production-control` workspace package and mounted at `/production` in the lcyt-backend.

**Authentication:** All `/production` endpoints require `X-Admin-Key` unless noted otherwise. The bridge SSE and status endpoints use their own per-bridge token instead.

> **Activation:** The production control router is always mounted when `initProductionControl()` is called during server startup. No additional environment variable is required.

---

## Contents

- [Cameras](#cameras)
- [Mixers](#mixers)
- [Bridge instances](#bridge-instances)
- [Bridge agent protocol](#bridge-agent-protocol)
- [Database tables](#database-tables)

---

## Cameras

Cameras represent physical cameras connected to the system. Each camera has a control type (`amx` or `none`) that determines how preset commands are delivered.

---

### `GET /production/cameras`

List all cameras, ordered by `sortOrder` then creation date.

**Authentication:** `X-Admin-Key`

**Response `200`**

```json
[
  {
    "id": "cam-altar",
    "name": "Altar",
    "mixerInput": 1,
    "controlType": "amx",
    "controlConfig": {
      "host": "192.168.2.50",
      "port": 1319,
      "presets": [
        { "id": "wide",  "name": "Wide shot",  "command": "SEND_COMMAND dvCam,'PRESET-1'" },
        { "id": "close", "name": "Close-up",   "command": "SEND_COMMAND dvCam,'PRESET-2'" }
      ]
    },
    "bridgeInstanceId": null,
    "sortOrder": 0,
    "createdAt": "2026-03-14T10:00:00"
  }
]
```

---

### `GET /production/cameras/:id`

Return a single camera by ID.

**Authentication:** `X-Admin-Key`

**Response `200`** — same shape as the list item above.

**Response `404`** — `{ "error": "Camera not found" }`

---

### `POST /production/cameras`

Create a new camera.

**Authentication:** `X-Admin-Key`

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Human-readable name |
| `mixerInput` | `number` | No | Mixer input number this camera feeds (1-based) |
| `controlType` | `string` | No | `"amx"` or `"none"` (default `"none"`) |
| `controlConfig` | `object` | No | Type-specific config (see [AMX controlConfig](#amx-controlconfig)) |
| `sortOrder` | `number` | No | Display order in the operator UI (default `0`) |
| `bridgeInstanceId` | `string\|null` | No | UUID of the bridge instance that relays commands for this camera |

**AMX controlConfig**

```json
{
  "host": "192.168.2.50",
  "port": 1319,
  "presets": [
    { "id": "wide",  "name": "Wide shot",  "command": "SEND_COMMAND dvCam,'PRESET-1'" },
    { "id": "close", "name": "Close-up",   "command": "SEND_COMMAND dvCam,'PRESET-2'" }
  ]
}
```

Each preset `command` is sent verbatim to the AMX NetLinx master over TCP — no syntax validation is performed.

**Response `201`** — the created camera object.

**Response `400`** — `{ "error": "name is required" }`

---

### `PUT /production/cameras/:id`

Update an existing camera. All fields are optional; omitted fields keep their current value.

**Authentication:** `X-Admin-Key`

**Request body** — same fields as `POST /production/cameras`.

**Response `200`** — the updated camera object.

**Response `404`** — `{ "error": "Camera not found" }`

---

### `DELETE /production/cameras/:id`

Delete a camera.

**Authentication:** `X-Admin-Key`

**Response `204`** — no body.

**Response `404`** — `{ "error": "Camera not found" }`

---

### `POST /production/cameras/:id/preset/:presetId`

Trigger a named preset on a camera. The command is sent either directly via TCP (if no bridge is assigned) or relayed through the bridge agent over SSE.

**Authentication:** `X-Admin-Key`

**Response `200`**

```json
{ "ok": true, "cameraId": "cam-altar", "presetId": "wide" }
```

**Response `400`** — preset ID not found in `controlConfig.presets`

**Response `404`** — camera not found

**Response `503`** — assigned bridge is not currently connected

---

## Mixers

Mixers represent video switchers (Roland, AMX). The active source is tracked in memory and updated when a switch command succeeds.

---

### `GET /production/mixers`

List all mixers with live connection status.

**Authentication:** `X-Admin-Key`

**Response `200`**

```json
[
  {
    "id": "mixer-main",
    "name": "Main Roland",
    "type": "roland",
    "connectionConfig": {
      "host": "192.168.2.100",
      "port": 8023
    },
    "bridgeInstanceId": null,
    "createdAt": "2026-03-14T10:00:00",
    "connected": true,
    "activeSource": 2
  }
]
```

| Field | Description |
|---|---|
| `connected` | Whether the backend currently has a live TCP connection to this mixer |
| `activeSource` | The mixer input number that is currently on program output, or `null` if unknown |

---

### `GET /production/mixers/:id`

Return a single mixer by ID.

**Authentication:** `X-Admin-Key`

**Response `200`** — same shape as the list item above.

**Response `404`** — `{ "error": "Mixer not found" }`

---

### `POST /production/mixers`

Create a new mixer.

**Authentication:** `X-Admin-Key`

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Human-readable name |
| `type` | `string` | Yes | `"roland"` or `"amx"` |
| `connectionConfig` | `object` | No | Type-specific config (see below) |
| `bridgeInstanceId` | `string\|null` | No | UUID of the bridge instance for relay |

**Roland connectionConfig**

```json
{ "host": "192.168.2.100", "port": 8023 }
```

**AMX mixer connectionConfig**

```json
{
  "host": "192.168.2.50",
  "port": 1319,
  "inputs": [
    { "input": 1, "command": "SEND_COMMAND dvMixer,'INPUT-1'" },
    { "input": 2, "command": "SEND_COMMAND dvMixer,'INPUT-2'" }
  ]
}
```

**Response `201`** — the created mixer object (with `connected: false, activeSource: null`).

**Response `400`** — `{ "error": "name is required" }` or invalid `type`

---

### `PUT /production/mixers/:id`

Update an existing mixer. All fields are optional.

**Authentication:** `X-Admin-Key`

**Response `200`** — the updated mixer object.

**Response `404`** — `{ "error": "Mixer not found" }`

---

### `DELETE /production/mixers/:id`

Delete a mixer.

**Authentication:** `X-Admin-Key`

**Response `204`** — no body.

**Response `404`** — `{ "error": "Mixer not found" }`

---

### `POST /production/mixers/:id/switch/:inputNumber`

Switch the mixer to the given input number.

**Authentication:** `X-Admin-Key`

| Parameter | Type | Description |
|---|---|---|
| `inputNumber` | positive integer | Mixer input number to switch to (1-based) |

**Response `200`**

```json
{ "ok": true, "mixerId": "mixer-main", "activeSource": 2 }
```

**Response `400`** — invalid `inputNumber` or no command configured for that input (AMX mixer)

**Response `404`** — mixer not found

**Response `503`** — assigned bridge is not currently connected

---

### `GET /production/mixers/:id/active`

Return the current active input for a mixer.

**Authentication:** `X-Admin-Key`

**Response `200`**

```json
{ "mixerId": "mixer-main", "activeSource": 2, "connected": true }
```

`activeSource` is `null` if the mixer has not been switched since server startup or if the TCP connection is not established.

---

### `POST /production/mixers/:id/test`

Test TCP reachability of the mixer without establishing a persistent connection. Times out after 4 seconds.

**Authentication:** `X-Admin-Key`

**Response `200`** — TCP connection succeeded

```json
{ "ok": true, "host": "192.168.2.100", "port": 8023 }
```

**Response `502`** — connection failed or timed out

```json
{ "ok": false, "error": "Connection timed out", "host": "192.168.2.100", "port": 8023 }
```

**Response `400`** — `connectionConfig.host` not set

---

## Bridge instances

A bridge instance represents a physical streaming computer running `lcyt-bridge`. The bridge connects to the backend via SSE and relays TCP commands to AMX and Roland devices on the local AV network.

---

### `GET /production/bridge/instances`

List all registered bridge instances with live connection status.

**Authentication:** `X-Admin-Key`

**Response `200`**

```json
[
  {
    "id": "b1a2c3d4-...",
    "name": "Main church",
    "status": "connected",
    "lastSeen": "2026-03-14T10:05:00",
    "createdAt": "2026-03-01T09:00:00"
  }
]
```

> **Security note:** The bridge token is never included in list or detail responses. Download the `.env` file immediately after creation — see below.

---

### `POST /production/bridge/instances`

Create a new bridge instance. A cryptographically random 32-byte token is generated and returned **once** as part of `envContent`. It is never returned again in plain text.

**Authentication:** `X-Admin-Key`

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Human-readable name for this bridge (e.g. "Main church") |

**Response `201`**

```json
{
  "id": "b1a2c3d4-...",
  "name": "Main church",
  "envContent": "# lcyt-bridge configuration\n...\nBRIDGE_TOKEN=<hex-token>\n"
}
```

`envContent` is a ready-to-use `.env` file. Save it next to `lcyt-bridge.exe` and keep it private.

**Response `400`** — `{ "error": "name is required" }`

---

### `DELETE /production/bridge/instances/:id`

Delete a bridge instance. If cameras or mixers are currently assigned to it, the request fails with `409` unless `?force=1` is supplied.

**Authentication:** `X-Admin-Key`

| Query param | Description |
|---|---|
| `?force=1` | Null out all camera/mixer assignments and delete the instance |

**Response `204`** — deleted.

**Response `404`** — instance not found.

**Response `409`** — instance has assigned devices (without `?force=1`):

```json
{
  "error": "Bridge has assigned devices",
  "cameras": 2,
  "mixers": 1,
  "hint": "Add ?force=1 to null out assignments and delete anyway"
}
```

---

### `GET /production/bridge/instances/:id/env`

Re-download the pre-filled `.env` configuration file for an existing bridge instance. The token is read from the database and included in the downloaded file.

**Authentication:** `X-Admin-Key`

**Response `200`** — `Content-Type: text/plain`, `Content-Disposition: attachment; filename="lcyt-bridge-<name>.env"`

**Response `404`** — instance not found.

---

## Bridge agent protocol

The lcyt-bridge Windows agent communicates with the backend using a simple SSE + HTTP POST protocol. No inbound ports are required on the streaming computer — all connections are outbound.

### SSE command stream

```
GET /production/bridge/commands?token=<bridge-token>
```

| SSE event | Direction | Payload |
|---|---|---|
| `connected` | backend → bridge | `{ "instanceId": "<id>" }` |
| `command` | backend → bridge | `{ "type": "tcp_send", "requestId": "<uuid>", "host": "<ip>", "port": <n>, "payload": "<string>" }` |
| `: heartbeat` | backend → bridge | SSE comment (every 20 s, keeps proxy connections alive) |

**Authentication:** `?token=<bridge-token>` query parameter. Returns `401` for invalid tokens.

When a second bridge connects with the same token, the first connection is closed immediately (crash-reconnect handling).

### Status reporting

```
POST /production/bridge/status
X-Bridge-Token: <bridge-token>
Content-Type: application/json
```

**Command result body**

```json
{
  "requestId": "<uuid from the command event>",
  "ok": true
}
```

Or on failure:

```json
{
  "requestId": "<uuid>",
  "ok": false,
  "error": "Connection refused"
}
```

**Heartbeat body** (sent by bridge every 30 s)

```json
{ "type": "heartbeat" }
```

`last_seen` is updated on every POST. **Response `200`:** `{ "ok": true }`.

### Command timeout

The backend resolves a pending command Promise after 10 seconds if no status POST arrives. The camera/mixer API endpoint returns `503` in this case.

---

## Database tables

The production control subsystem adds three tables to the lcyt-backend SQLite database. All migrations run automatically on startup and are additive/idempotent.

| Table | Purpose |
|---|---|
| `prod_bridge_instances` | Registered bridge instances (id, name, token, status, last_seen) |
| `prod_cameras` | Camera configuration (name, mixer_input, control_type, control_config JSON, bridge_instance_id, sort_order) |
| `prod_mixers` | Mixer configuration (name, type, connection_config JSON, bridge_instance_id) |
