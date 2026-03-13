---
id: api/usage
title: "/usage — Domain Usage"
methods: [GET]
auth: [adminkey, none]
---

# /usage — Domain Usage

Return aggregated caption statistics broken down by domain and time period.

---

## `GET /usage` — Domain Usage Statistics

**Authentication:**
- If `USAGE_PUBLIC` environment variable is set: no authentication required (CORS limited to `ALLOWED_DOMAINS`)
- Otherwise: `X-Admin-Key` header required

**Request**

```http
GET /usage?from=2024-01-01&to=2024-01-31&granularity=day
X-Admin-Key: <ADMIN_KEY>
```

**Query Parameters**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | `string` | 30 days ago | Start date in `YYYY-MM-DD` format |
| `to` | `string` | today | End date in `YYYY-MM-DD` format |
| `granularity` | `string` | `'day'` | Aggregation level: `'hour'` or `'day'` |
| `domain` | `string` | all domains | Filter to a specific domain |

**Response — `200 OK`**

```json
{
  "from": "2024-01-01",
  "to": "2024-01-31",
  "granularity": "day",
  "public": false,
  "data": [
    {
      "domain": "https://my-app.example.com",
      "date": "2024-01-15",
      "sessions_started": 12,
      "sessions_ended": 11,
      "captions_sent": 480,
      "captions_failed": 3,
      "batches_sent": 120,
      "total_duration_ms": 3600000,
      "peak_sessions": 4
    }
  ]
}
```

When `granularity=hour`, each record also includes an `hour` field (integer 0–23).

| Field | Type | Description |
|---|---|---|
| `domain` | `string` | Origin domain |
| `date` | `string` | Date in `YYYY-MM-DD` format |
| `hour` | `number` | Hour of day (only present when `granularity=hour`) |
| `sessions_started` | `number` | Sessions created in this period |
| `sessions_ended` | `number` | Sessions closed in this period |
| `captions_sent` | `number` | Captions successfully delivered |
| `captions_failed` | `number` | Captions that failed delivery |
| `batches_sent` | `number` | Number of batch requests |
| `total_duration_ms` | `number` | Sum of session durations in milliseconds |
| `peak_sessions` | `number` | Highest concurrent session count observed |

The response also includes a top-level `viewerStats` array with anonymous daily viewer open counts:

```json
{
  "from": "2024-01-01",
  "to": "2024-01-31",
  "granularity": "day",
  "public": false,
  "data": [...],
  "viewerStats": [
    { "date": "2024-01-15", "opens": 38 }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `viewerStats[].date` | `string` | Date in `YYYY-MM-DD` format |
| `viewerStats[].opens` | `number` | Total anonymous viewer SSE opens on that date |
