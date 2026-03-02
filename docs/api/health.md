---
title: "Health & Contact"
methods: [GET]
auth: [none]
---

# Health & Contact

Utility endpoints that do not require authentication.

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

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | Always `true` when the server is healthy |
| `uptime` | `number` | Server uptime in seconds |
| `activeSessions` | `number` | Number of currently active caption relay sessions |

---

## `GET /contact` — Contact Information

Return the operator's contact details. Fields are configured via environment variables and are optional.

**Authentication:** None

**Request**

```http
GET /contact
```

**Response — `200 OK`**

```json
{
  "name": "LCYT Service Operator",
  "email": "operator@example.com",
  "phone": "+1-555-0100",
  "website": "https://example.com"
}
```

Fields that are not configured in the server environment are omitted from the response.

| Field | Type | Source env var | Description |
|---|---|---|---|
| `name` | `string` | `CONTACT_NAME` | Operator name |
| `email` | `string` | `CONTACT_EMAIL` | Operator email address |
| `phone` | `string` | `CONTACT_PHONE` | Operator phone number |
| `website` | `string` | `CONTACT_WEBSITE` | Operator website URL |

If none of the contact environment variables are set, the response body will be an empty object (`{}`).
