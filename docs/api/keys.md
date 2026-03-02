---
title: "API Key Management"
methods: [POST, GET, PATCH, DELETE]
auth: [adminkey, none]
---

# API Key Management

Admin endpoints for managing API keys. All endpoints require the `X-Admin-Key` header unless noted.

If `ADMIN_KEY` is not configured in the server environment, all admin routes return `503 Service Unavailable`.

> See the [Free-tier self-service key](#post-keysfreetier--free-tier-key-signup) section for the unauthenticated key creation option.

---

## `POST /keys` — Create Key

Create a new API key.

**Authentication:** `X-Admin-Key` header

**Request**

```http
POST /keys
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json
```

```json
{
  "owner": "Alice",
  "key": "custom-key-value",
  "expires": "2025-01-01",
  "daily_limit": 1000,
  "lifetime_limit": 50000
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `owner` | `string` | Yes | Human-readable owner name |
| `key` | `string` | No | Custom key string. If omitted, a UUID is generated. |
| `expires` | `string` | No | Expiry date in `YYYY-MM-DD` format. No expiry if omitted. |
| `daily_limit` | `number` | No | Max captions per day. Unlimited if omitted. |
| `lifetime_limit` | `number` | No | Max captions for the key's lifetime. Unlimited if omitted. |

**Response — `201 Created`**

```json
{
  "key": "custom-key-value",
  "owner": "Alice",
  "active": 1,
  "created_at": "2024-01-01T12:00:00.000Z",
  "expires_at": "2025-01-01T00:00:00.000Z",
  "daily_limit": 1000,
  "lifetime_limit": 50000,
  "lifetime_used": 0,
  "revoked_at": null
}
```

---

## `GET /keys` — List Keys

List all API keys.

**Authentication:** `X-Admin-Key` header

**Request**

```http
GET /keys
X-Admin-Key: <ADMIN_KEY>
```

**Response — `200 OK`**

```json
{
  "keys": [
    {
      "key": "key-abc",
      "owner": "Alice",
      "active": 1,
      "created_at": "2024-01-01T12:00:00.000Z",
      "expires_at": null,
      "daily_limit": null,
      "lifetime_limit": null,
      "lifetime_used": 42,
      "revoked_at": null
    }
  ]
}
```

---

## `GET /keys/:key` — Get Key

Retrieve a single API key with usage statistics.

**Authentication:** `X-Admin-Key` header

**Request**

```http
GET /keys/key-abc
X-Admin-Key: <ADMIN_KEY>
```

**Response — `200 OK`**

```json
{
  "key": "key-abc",
  "owner": "Alice",
  "active": 1,
  "created_at": "2024-01-01T12:00:00.000Z",
  "expires_at": null,
  "daily_limit": null,
  "lifetime_limit": null,
  "lifetime_used": 42,
  "daily_used": 5,
  "revoked_at": null
}
```

**Error responses**

| Status | Reason |
|---|---|
| `404` | Key not found |

---

## `PATCH /keys/:key` — Update Key

Update mutable fields on an existing API key.

**Authentication:** `X-Admin-Key` header

**Request**

```http
PATCH /keys/key-abc
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json
```

```json
{
  "owner": "Alice Smith",
  "expires": "2026-01-01",
  "daily_limit": 2000,
  "lifetime_limit": 100000
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `owner` | `string` | No | Updated owner name |
| `expires` | `string` | No | New expiry date (`YYYY-MM-DD`) |
| `daily_limit` | `number \| null` | No | New daily limit. Pass `null` to remove the limit. |
| `lifetime_limit` | `number \| null` | No | New lifetime limit. Pass `null` to remove the limit. |

**Response — `200 OK`** — Updated key object (same shape as `GET /keys/:key`)

**Error responses**

| Status | Reason |
|---|---|
| `404` | Key not found |

---

## `DELETE /keys/:key` — Revoke or Delete Key

Revoke (soft-delete) or permanently delete an API key.

**Authentication:** `X-Admin-Key` header

**Request**

```http
DELETE /keys/key-abc
X-Admin-Key: <ADMIN_KEY>
```

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `permanent` | `boolean` | If `true`, hard-delete the key from the database. Default: soft-revoke. |

Soft-revoke sets the key's `active` flag to `0` and records `revoked_at`. The key remains in the database for audit purposes and is purged after `REVOKED_KEY_TTL_DAYS` (default 30 days).

**Response — `200 OK`**

Soft-revoke:
```json
{ "key": "key-abc", "revoked": true }
```

Hard-delete:
```json
{ "key": "key-abc", "deleted": true }
```

**Error responses**

| Status | Reason |
|---|---|
| `404` | Key not found |

---

## `POST /keys?freetier` — Free-Tier Key Signup

Self-service key creation for end users. Only available when `FREE_APIKEY_ACTIVE=1` is set in the server environment. Does not require admin authentication.

**Authentication:** None

**Request**

```http
POST /keys?freetier
Content-Type: application/json
```

```json
{
  "name": "Alice",
  "email": "alice@example.com"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Requester's name |
| `email` | `string` | Yes | Requester's email address |

**Response — `201 Created`** — Key object with default free-tier limits:
- Expiry: 1 month from creation
- Daily limit: 200 captions
- Lifetime limit: 1000 captions

**Error responses**

| Status | Reason |
|---|---|
| `400` | Missing name or email |
| `503` | Free-tier signup not enabled (`FREE_APIKEY_ACTIVE` not set) |
