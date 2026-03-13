---
id: api/rtmp-callbacks
title: "/rtmp — nginx-rtmp Callbacks"
methods: [POST]
auth: [none]
---

# /rtmp — nginx-rtmp Publish Callbacks

A single endpoint called by nginx-rtmp when a broadcaster starts or stops publishing to the RTMP ingest server. This is the entry point for the RTMP relay fan-out system.

**Authentication:** None (nginx is the caller — restrict at the network level). Optionally validated against the `RTMP_APPLICATION` environment variable.

---

## `POST /rtmp` — nginx-rtmp Publish Callback

```http
POST /rtmp
Content-Type: application/x-www-form-urlencoded

app=stream&name=my-api-key&call=publish
```

or

```
app=stream&name=my-api-key&call=publish_done
```

| Field | Type | Description |
|---|---|---|
| `app` | `string` | RTMP application name (e.g. `stream`). Validated against `RTMP_APPLICATION` env if set. |
| `name` | `string` | Stream name — used as the API key to look up relay configuration. |
| `call` | `string` | `publish` (broadcaster connected) or `publish_done` (broadcaster disconnected). |

**Behavior on `call=publish`:**
1. Validates the RTMP application name (if `RTMP_APPLICATION` is configured).
2. Checks that `relay_allowed = true` for the API key. Returns `403` to deny the publish if not.
3. Marks the key as publishing (so `PUT /stream/active` can start fan-out immediately if activated later).
4. If `relay_active = true` for the key and relay slots are configured, starts a single ffmpeg process with a `tee` muxer fanning out to all configured slots.
5. Returns `200 ok` to allow the publish (fan-out is best-effort — failures are logged but do not deny the stream).

**Behavior on `call=publish_done`:**
1. Marks the key as no longer publishing.
2. Stops all running ffmpeg relay processes for the key.
3. Returns `200 ok`.

**Error responses (plain text)**

| Status | Reason |
|---|---|
| `400` | Missing `name` field |
| `403` | Wrong RTMP application name, or `relay_allowed` not set |

Returns `200 ok` on success.

---

## nginx-rtmp Configuration Example

```nginx
application stream {
  live on;
  record off;

  # Single endpoint — distinguishes publish/publish_done via the `call` field
  on_publish      http://127.0.0.1:3000/rtmp;
  on_publish_done http://127.0.0.1:3000/rtmp;
}
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RTMP_APPLICATION` | unset | If set, `/rtmp` rejects callbacks where the RTMP `app` name does not match. Prevents other nginx applications from accidentally triggering relay fan-out. |
| `RTMP_RELAY_ACTIVE` | unset | Set to `1` to enable the relay subsystem. Without this, the relay manager ignores incoming RTMP events. |
