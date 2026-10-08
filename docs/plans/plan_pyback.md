---
id: plan/pyback
title: "Python Backend Scope Reduction â€” Unauthenticated CORS Relay"
status: implemented
summary: "Reduce Python backend (python-packages/lcyt-backend) to a minimal, unauthenticated CORS relay for YouTube caption sending. Remove API key management, JWT auth, admin routes, and SQLite database. The full-featured backend is the Node.js lcyt-backend."
---

# Python Backend â€” Unauthenticated CORS Relay

**Date:** 2026-03-27
**Status:** Implemented

---

## Purpose

The Python backend (`python-packages/lcyt-backend`) exists as a **lightweight CORS relay** for sending captions to YouTube's HTTP POST caption ingestion API. It is intended for simple deployments where:

- A browser-based client needs to bypass CORS restrictions when posting captions to YouTube
- No API key management, user authentication, or session tracking is needed
- The full-featured Node.js `lcyt-backend` is not available or not desired

The Python backend is **not** a replacement for the Node.js backend. It does not support:
- Multi-user sessions
- User accounts or projects
- RTMP relay, HLS streaming, radio
- DSK graphics
- Production control (cameras, mixers, bridges)
- Server-side STT
- File storage
- Viewer targets
- SSE event streams
- Any plugin functionality

## Architecture

```
Browser (lcyt-web or custom client)
    â”‚
    â”‚  POST /live      { apiKey?, streamKey, domain }  â†’ { token, sessionId, ... }
    â”‚  POST /captions  { captions: [...] }             â†’ YouTube result (Bearer token)
    â”‚  POST /sync                                      â†’ { syncOffset, ... } (Bearer token)
    â”‚  GET  /health                                    â†’ { ok, features: [...] }
    â”‚
    â–¼
Python Flask Backend (CORS relay)
    â”‚
    â”‚  HTTP POST (caption ingestion)
    â”‚
    â–¼
YouTube Live Caption API
```

The relay follows the same `POST /live` â†’ Bearer token â†’ `POST /captions` flow
as the Node.js backend so that **lcyt-web can connect to either backend without
code changes**. The difference is that no API key database exists â€” any `apiKey`
value is accepted. Session tokens (HS256 JWT) are signed with an auto-generated
secret and used only to identify which sender to route captions to.

## API Surface

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Server uptime, active sessions, `features` list |
| `POST` | `/api/v1/live` | None | Register session â†’ returns JWT token |
| `GET` | `/api/v1/live` | Bearer | Session status (sequence, syncOffset) |
| `DELETE` | `/api/v1/live` | Bearer | Tear down session |
| `POST` | `/api/v1/captions` | Bearer | Send caption(s) to YouTube |
| `POST` | `/api/v1/sync` | Bearer | NTP-style clock sync |

### `GET /health`

```json
{
  "ok": true,
  "uptime": 123,
  "activeSessions": 1,
  "features": ["captions", "sync"]
}
```

The `features` array tells lcyt-web which capabilities are available.
The Node.js backend returns a larger set (e.g. `["captions", "sync", "login",
"rtmp", "graphics", "stt", "files", "viewer", "production"]`).

### `POST /live`

```json
{
  "apiKey": "anything",
  "streamKey": "xxxx-xxxx-xxxx-xxxx",
  "domain": "https://example.com"
}
```

Returns `{ token, sessionId, sequence, syncOffset, startedAt }`.
`apiKey` is accepted but not validated against a database.

### `POST /captions`

```json
{
  "captions": [
    { "text": "Hello world", "timestamp": "2026-03-27T08:00:00.000" }
  ]
}
```

Requires `Authorization: Bearer <token>` from `POST /live`.

### `POST /sync`

Requires `Authorization: Bearer <token>`. No request body needed.

Returns `{ syncOffset, roundTripTime, serverTimestamp, statusCode }`.

## What Was Removed (vs. Original Python Backend)

- **SQLite database** (`db.py`) â€” no API keys table, no key validation
- **Admin middleware** (`middleware/admin.py`) â€” no `X-Admin-Key`
- **Admin routes** (`routes/keys.py`) â€” no CRUD for API keys
- **Dynamic CORS** (`middleware/cors.py`) â€” replaced with permissive `Access-Control-Allow-Origin: *`
- **Session store** (`store.py`) â€” replaced with simple dict sender cache

## Deployment

```bash
cd python-packages/lcyt-backend
pip install -e ../lcyt -e .
python run.py
# Or via Passenger (cPanel):
# passenger_wsgi.py provides the `application` object
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |

No `JWT_SECRET`, `ADMIN_KEY`, or `DB_PATH` needed â€” this is a stateless relay.

## Relationship to Node.js Backend

The Node.js backend (`packages/lcyt-backend`) is the canonical, full-featured backend. It supports all LCYT features including multi-user sessions, RTMP relay, DSK graphics, production control, file storage, and server-side STT.

The Python backend is an alternative for environments where:
- Only Python hosting is available (e.g. shared hosting with cPanel/Passenger)
- A minimal caption relay is sufficient
- No authentication or key management is required

For production deployments with multiple users, use the Node.js backend.

