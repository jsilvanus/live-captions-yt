---
id: api/youtube
title: "/youtube — YouTube OAuth Configuration"
methods: [GET]
auth: [bearer]
---

# /youtube — YouTube OAuth Configuration

Returns the YouTube OAuth client ID configured on the server, allowing the lcyt-web client to perform the OAuth 2.0 token flow client-side via the Google Identity Services (GIS) library.

---

## `GET /youtube/config` — YouTube OAuth Client ID

Return the server's YouTube OAuth 2.0 client ID. The web client uses this to initiate the Google sign-in flow and obtain an access token for the YouTube Data API.

**Authentication:** Bearer JWT

**Request**

```http
GET /youtube/config
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "clientId": "123456789012-abcdefghijklmnop.apps.googleusercontent.com"
}
```

| Field | Type | Description |
|---|---|---|
| `clientId` | `string` | Google OAuth 2.0 Web application client ID |

**Error responses**

| Status | Reason |
|---|---|
| `401` | Missing or invalid JWT |
| `503` | `YOUTUBE_CLIENT_ID` not configured on the server |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `YOUTUBE_CLIENT_ID` | unset | Google OAuth 2.0 Web application client ID. Create one in the [Google Cloud Console](https://console.cloud.google.com/) under **APIs & Services → Credentials → OAuth 2.0 Client IDs**. The web application type is required; add the lcyt-web origin as an authorised JavaScript origin. |
