---
id: api/health
title: "/health — Health Check"
methods: [GET]
auth: [none]
---

# /health — Health Check

Server health information. Suitable for load balancer health probes and uptime monitoring.

---

## `GET /health` — Health Check

Return server health information. Suitable for load balancer health probes and uptime monitoring.

**Authentication:** None

**Request**

```http
GET /health
```

**Response — `200 OK`**

```json
{
  "ok": true,
  "uptime": 3600.42,
  "activeSessions": 3
}
```

When `RTMP_RELAY_ACTIVE=1` is set, the response also includes an `rtmpIngest` object:

```json
{
  "ok": true,
  "uptime": 3600.42,
  "activeSessions": 3,
  "rtmpIngest": {
    "host": "rtmp.example.com",
    "app": "stream"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | Always `true` when the server is healthy |
| `uptime` | `number` | Server uptime in seconds |
| `activeSessions` | `number` | Number of currently active caption relay sessions |
| `rtmpIngest.host` | `string` | RTMP ingest hostname (from `RTMP_HOST` env var) |
| `rtmpIngest.app` | `string` | RTMP application name (from `RTMP_APP` env var) |

