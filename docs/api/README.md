---
title: "lcyt-backend API Reference"
---

# lcyt-backend API Reference

`lcyt-backend` is an Express.js HTTP relay server that sits between your client applications and YouTube Live. Clients authenticate with API keys and JWTs; the backend sends captions to YouTube on their behalf and streams delivery results back via SSE.

**Default port:** `3000`

---

## Contents

- [Authentication](#authentication)
- [Environment Variables](#environment-variables)
- [Endpoints](#endpoints)
  - [Sessions — `/live`, `/sync`](./sessions.md)
  - [Captions — `/captions`, `/events`](./captions.md)
  - [API Keys — `/keys`](./keys.md)
  - [Statistics — `/stats`, `/usage`](./stats.md)
  - [Health — `/health`, `/contact`](./health.md)

---

## Authentication

The API uses two independent authentication mechanisms depending on the endpoint.

### Bearer JWT (session-level)

Most endpoints require a `Authorization: Bearer <token>` header.

Obtain a token by registering a session:
```http
POST /live
Content-Type: application/json

{ "apiKey": "...", "streamKey": "...", "domain": "https://your-app.example.com" }
```

Response:
```json
{ "token": "<JWT>", "sessionId": "...", "sequence": 0, "syncOffset": 0 }
```

Use the returned `token` in subsequent requests:
```http
Authorization: Bearer <JWT>
```

Alternatively, for SSE connections, pass the token as a query parameter:
```
GET /events?token=<JWT>
```

### Admin API Key (server-level)

Admin routes (`/keys`, `GET /usage` without `USAGE_PUBLIC`) require:
```http
X-Admin-Key: <ADMIN_KEY>
```

The `ADMIN_KEY` value is set via the server environment variable. If `ADMIN_KEY` is not configured, all admin routes return `503 Service Unavailable`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | auto-generated | HS256 signing secret for JWTs. **Always set this in production.** |
| `ADMIN_KEY` | none | API key for admin endpoints. Admin routes are disabled if not set. |
| `PORT` | `3000` | HTTP server port |
| `DB_PATH` | `./lcyt-backend.db` | Path to the SQLite database file |
| `SESSION_TTL` | `7200000` | Session idle timeout in milliseconds (default 2 hours) |
| `CLEANUP_INTERVAL` | `300000` | Session cleanup sweep interval in milliseconds (default 5 minutes) |
| `REVOKED_KEY_TTL_DAYS` | `30` | Days before revoked API keys are purged from the database |
| `REVOKED_KEY_CLEANUP_INTERVAL` | `86400000` | Revoked key cleanup interval in milliseconds (default 24 hours) |
| `ALLOWED_DOMAINS` | `lcyt.fi,www.lcyt.fi` | Comma-separated list of domains allowed to access `GET /usage` without an admin key (when `USAGE_PUBLIC` is set) |
| `USAGE_PUBLIC` | unset | If set to any value, `GET /usage` is accessible without authentication |
| `STATIC_DIR` | none | Directory to serve as static files |
| `FREE_APIKEY_ACTIVE` | unset | If set to `1`, enables the free-tier key self-service endpoint (`POST /keys?freetier`) |
| `CONTACT_NAME` | none | Name returned by `GET /contact` |
| `CONTACT_EMAIL` | none | Email returned by `GET /contact` |
| `CONTACT_PHONE` | none | Phone number returned by `GET /contact` |
| `CONTACT_WEBSITE` | none | Website URL returned by `GET /contact` |

---

## CORS

CORS is handled dynamically:

- **`POST /live`**, **`GET /health`**, **`GET /contact`** — open to all origins
- **`POST /keys?freetier`** — open to all origins (if `FREE_APIKEY_ACTIVE=1`)
- **Authenticated routes** — only the `domain` registered in the session is allowed
- **Admin routes** — no CORS headers (intended for server-side use only)

---

## Error Responses

All endpoints return errors as JSON:

```json
{ "error": "Human-readable description" }
```

| Status | Meaning |
|---|---|
| `400` | Bad request / validation failure |
| `401` | Missing or invalid authentication |
| `403` | Valid credentials but insufficient permission |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate session) |
| `429` | Usage limit exceeded |
| `503` | Admin endpoint disabled (no `ADMIN_KEY` configured) |

---

## Database Schema

The SQLite database contains the following tables:

| Table | Purpose |
|---|---|
| `api_keys` | Registered API keys with owner, limits, expiry |
| `caption_usage` | Daily per-key caption counts |
| `session_stats` | Completed session telemetry |
| `caption_errors` | Caption delivery failure log |
| `auth_events` | Authentication and usage events |
| `domain_hourly_stats` | Per-domain aggregated caption statistics |

Additive migrations run automatically on startup.
