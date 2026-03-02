---
title: "privacy_deletion — Request Data Deletion"
stdio: false
sse: true
---

# `privacy_deletion` — Request Data Deletion

Submit a GDPR right-to-erasure request. Requires a configured database (`DB_PATH`) and a valid API key.

**Available in:** SSE only

---

## Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `api_key` | `string` | Yes | API key to anonymise and delete |

## Returns

```json
{
  "ok": true,
  "message": "Your data has been anonymised and deleted."
}
```

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | `true` on success |
| `message` | `string` | Confirmation message |

**Side effects:**
- Terminates any active session for the key
- Anonymises owner name and email in the database
- Deletes associated session stats, caption errors, and auth events

**Requires:** `DB_PATH` environment variable set on the SSE server.
