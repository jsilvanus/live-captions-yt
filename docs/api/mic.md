---
title: "/mic — Mic Lock"
methods: [POST]
auth: [bearer]
---

# /mic — Mic Lock

Claim or release the soft mic lock for a collaborative session. The mic lock is advisory — it signals which client should be considered the active speaker, but does not block other clients from sending captions.

---

## `POST /mic` — Mic Lock

**Authentication:** Bearer JWT

**Request**

```http
POST /mic
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "action": "claim",
  "clientId": "client-abc"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | `string` | Yes | `'claim'` to acquire the lock, `'release'` to relinquish it |
| `clientId` | `string` | Yes | Unique identifier for the calling client |

**Behavior:**
- **`claim`**: Sets the session's `micHolder` to `clientId`, overwriting any existing holder. All connected SSE clients receive a `mic_state` event.
- **`release`**: Clears `micHolder` only if the caller is the current holder. If the caller is not the holder, the request is a no-op.

**Response — `200 OK`**

```json
{
  "ok": true,
  "holder": "client-abc"
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | Always `true` |
| `holder` | `string \| null` | The current mic holder after this operation |

**Side effects:** A `mic_state` SSE event is broadcast to all SSE clients in the session.
