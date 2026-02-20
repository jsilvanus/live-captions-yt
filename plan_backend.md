# lcyt-backend — Plan

## Purpose

A small Node.js backend that acts as a **CORS relay** for YouTube Live caption ingestion. Clients (browsers, web apps) cannot POST directly to `upload.youtube.com` due to CORS restrictions. This backend accepts captions from web clients, forwards them to YouTube via the `lcyt` library, and returns the result — with CORS headers set to match the caller's registered domain.

## Key Features

- Register a session with an API key, stream key, and allowed origin domain
- Multiple concurrent sessions: different stream keys, different domains, same API key
- JWT-based authentication for caption sending
- Automatic sequence tracking and sync offset management
- Dynamic CORS: each session specifies its allowed origin

---

## Architecture

### Framework & Storage

| Choice     | Value        | Rationale                                               |
| ---------- | ------------ | ------------------------------------------------------- |
| Framework  | **Express**  | Lightweight, widely used, good fit for a small relay    |
| Storage    | **In-memory** (Map) | Sessions are ephemeral; no persistence needed. Data resets on restart |
| Auth       | **JWT** (jsonwebtoken) | Issued on registration, required for /captions |
| Sender     | **lcyt** (workspace sibling) | Reuse existing `YoutubeLiveCaptionSender` |

### Package Layout

```
packages/lcyt-backend/
├── package.json
├── src/
│   ├── server.js          # Express app setup, CORS, routes
│   ├── routes/
│   │   ├── live.js        # GET/POST/DELETE /live
│   │   └── captions.js    # POST /captions
│   ├── middleware/
│   │   ├── auth.js        # JWT verification middleware
│   │   └── cors.js        # Dynamic CORS middleware
│   ├── store.js           # In-memory session store
│   └── index.js           # Entry point (start server)
└── test/
    ├── live.test.js
    ├── captions.test.js
    └── store.test.js
```

### Dependencies

```json
{
  "dependencies": {
    "express": "^4.21",
    "jsonwebtoken": "^9.0",
    "lcyt": "*"
  },
  "devDependencies": {}
}
```

---

## Data Model

### Session Store (in-memory Map)

```
Map<sessionId, Session>
```

**Session** (keyed by `${apiKey}:${streamKey}:${domain}`):

```js
{
  sessionId: string,          // composite key: apiKey:streamKey:domain
  apiKey: string,             // client-provided API key (shared secret)
  streamKey: string,          // YouTube stream key (cid)
  domain: string,             // allowed CORS origin (e.g., "https://example.com")
  jwt: string,                // issued JWT for this session
  sequence: number,           // current caption sequence number
  syncOffset: number,         // clock sync offset (ms)
  sender: YoutubeLiveCaptionSender,  // reusable sender instance
  createdAt: Date
}
```

Multiple sessions can share the same `apiKey` — enabling one client to send captions to multiple YouTube streams from multiple domains.

---

## API Endpoints

### `POST /live` — Register Session

**Request body (JSON):**

```json
{
  "apiKey": "user-provided-secret",
  "streamKey": "youtube-cid-value",
  "domain": "https://example.com",
  "sequence": 0
}
```

- `apiKey` (string, required): Shared secret for this client
- `streamKey` (string, required): YouTube stream key
- `domain` (string, required): Origin domain for CORS
- `sequence` (number, optional, default: `0`): Starting sequence number

**Behavior:**

1. Validate required fields
2. Create composite session ID: `${apiKey}:${streamKey}:${domain}`
3. If session already exists, return existing JWT (idempotent)
4. Create a `YoutubeLiveCaptionSender` instance with `{ streamKey, sequence }`
5. Call `sender.start()`
6. Optionally call `sender.sync()` to get initial sync offset
7. Generate JWT containing `{ sessionId, apiKey, streamKey, domain }`
8. Store session in Map
9. Return response

**Response (200):**

```json
{
  "token": "eyJhbG...",
  "sessionId": "apiKey:streamKey:domain",
  "sequence": 0,
  "syncOffset": 0
}
```

**CORS:** Response includes `Access-Control-Allow-Origin: <domain>` from request body.

---

### `GET /live` — Get Session Status

**Headers:**

```
Authorization: Bearer <jwt>
```

**Behavior:**

1. Verify JWT
2. Look up session by `sessionId` from JWT payload
3. Return current sequence and sync offset

**Response (200):**

```json
{
  "sequence": 42,
  "syncOffset": -15
}
```

---

### `DELETE /live` — Remove Session

**Headers:**

```
Authorization: Bearer <jwt>
```

**Behavior:**

1. Verify JWT
2. Look up session by `sessionId` from JWT payload
3. Call `sender.end()` to clean up
4. Remove session from Map
5. Return confirmation

**Response (200):**

```json
{
  "removed": true,
  "sessionId": "apiKey:streamKey:domain"
}
```

---

### `POST /captions` — Send Captions (Authenticated)

**Headers:**

```
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Request body (JSON):**

```json
{
  "captions": [
    { "text": "Hello world" },
    { "text": "How are you?", "timestamp": "2026-02-20T12:00:00.000" }
  ]
}
```

- `captions` (array, required): Array of caption objects
  - `text` (string, required): Caption text
  - `timestamp` (string | number, optional): Date/time for caption. If omitted, auto-generated by sender

**Behavior:**

1. Verify JWT
2. Look up session by `sessionId` from JWT payload
3. If single caption: call `sender.send(text, timestamp)`
4. If multiple captions: call `sender.sendBatch(captions)`
5. Update stored sequence number
6. Return result from YouTube

**Response (200) — single caption:**

```json
{
  "sequence": 43,
  "timestamp": "2026-02-20T12:00:00.000",
  "statusCode": 200,
  "serverTimestamp": "..."
}
```

**Response (200) — batch:**

```json
{
  "sequence": 44,
  "count": 2,
  "statusCode": 200,
  "serverTimestamp": "..."
}
```

**Error (4xx/5xx from YouTube):**

```json
{
  "error": "YouTube returned status 400",
  "statusCode": 400,
  "sequence": 43
}
```

---

## Middleware

### Dynamic CORS (`middleware/cors.js`)

Rather than a single static CORS origin, this middleware:

1. Reads the `Origin` header from the incoming request
2. Looks up all sessions that have that origin registered as their `domain`
3. If a match exists, sets:
   - `Access-Control-Allow-Origin: <origin>`
   - `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`
   - `Access-Control-Allow-Headers: Content-Type, Authorization`
   - `Access-Control-Allow-Credentials: true`
4. If no match, omits CORS headers (browser will block the request)
5. For `POST /live` (registration), CORS is permissive — any origin can register

### JWT Auth (`middleware/auth.js`)

1. Extract `Authorization: Bearer <token>` from request headers
2. Verify JWT signature using server secret (env var `JWT_SECRET` or random per-instance)
3. Decode payload: `{ sessionId, apiKey, streamKey, domain }`
4. Attach `req.session` with the decoded payload
5. Reject with 401 if token missing, expired, or invalid

---

## CORS Flow (Visual)

```
Browser (https://example.com)           lcyt-backend              YouTube
  │                                         │                        │
  │─── POST /live ──────────────────────────>│                        │
  │    {apiKey, streamKey, domain}           │                        │
  │<── {token, sequence, syncOffset} ───────│                        │
  │    + CORS: Access-Control-Allow-Origin  │                        │
  │                                         │                        │
  │─── POST /captions ─────────────────────>│                        │
  │    Authorization: Bearer <jwt>          │                        │
  │    {captions: [{text: "Hi"}]}           │── POST /closedcaption─>│
  │                                         │   ?cid=KEY&seq=N       │
  │                                         │<── 200 ───────────────│
  │<── {sequence, statusCode} ─────────────│                        │
  │    + CORS headers                       │                        │
  │                                         │                        │
  │─── DELETE /live ────────────────────────>│                        │
  │    Authorization: Bearer <jwt>          │                        │
  │<── {removed: true} ────────────────────│                        │
```

---

## Implementation Steps

### Step 1: Package scaffolding

- Create `packages/lcyt-backend/` directory structure
- Create `package.json` with workspace dependency on `lcyt`
- Add `"packages/lcyt-backend"` to root `package.json` workspaces array
- Set `"type": "module"` for ESM

### Step 2: Session store (`src/store.js`)

- Implement `SessionStore` class with Map-based storage
- Methods: `create(apiKey, streamKey, domain, sequence)`, `get(sessionId)`, `getByDomain(domain)`, `remove(sessionId)`, `has(sessionId)`
- Each session holds a `YoutubeLiveCaptionSender` instance

### Step 3: CORS middleware (`src/middleware/cors.js`)

- Dynamic origin matching against registered domains
- Permissive for `POST /live` (registration endpoint)
- Preflight (`OPTIONS`) support

### Step 4: Auth middleware (`src/middleware/auth.js`)

- JWT verification with `jsonwebtoken`
- Secret from `JWT_SECRET` env var or auto-generated
- Attaches decoded session info to `req.session`

### Step 5: Routes — `/live` (`src/routes/live.js`)

- `POST`: Validate input, create session + sender, generate JWT, return token
- `GET`: Auth required, return sequence + syncOffset
- `DELETE`: Auth required, tear down sender, remove session

### Step 6: Routes — `/captions` (`src/routes/captions.js`)

- `POST`: Auth required, look up session, call `sender.send()` or `sender.sendBatch()`, return result

### Step 7: Server entry point (`src/server.js` + `src/index.js`)

- Create Express app
- Mount middleware (JSON body parser, dynamic CORS)
- Mount routes
- `index.js`: Start server on `PORT` env var (default: 3000)
- Export app for testing

### Step 8: Tests

- Unit tests for `SessionStore`
- Integration tests for each endpoint using Node's built-in test runner (matching existing monorepo convention)
- Mock `YoutubeLiveCaptionSender` to avoid real HTTP calls

### Step 9: Root workspace update

- Add `packages/lcyt-backend` to root workspaces
- Add `start:backend` script to root package.json
- Run `npm install` to link workspace dependencies

---

## Environment Variables

| Variable     | Default      | Description                              |
| ------------ | ------------ | ---------------------------------------- |
| `PORT`       | `3000`       | Server listen port                       |
| `JWT_SECRET` | (auto-generated) | Secret for signing/verifying JWTs. If not set, a random secret is generated at startup (tokens won't survive restarts) |

---

## Open Questions / Decisions Needed

1. **API key validation**: Should the backend validate API keys against a list, or accept any client-provided key as a shared secret (essentially a namespace)?
   - *Current plan*: Accept any key — it's just used as a session namespace identifier. The JWT is the real auth.

2. **Rate limiting**: Should we add rate limiting to prevent abuse?
   - *Current plan*: Not in v1. Can be added later via `express-rate-limit`.

3. **HTTPS / Deployment**: Should the backend handle TLS, or sit behind a reverse proxy?
   - *Current plan*: HTTP only — assume deployment behind nginx/Cloudflare/etc.

4. **Session expiry**: Should sessions auto-expire after some idle time?
   - *Current plan*: No expiry in v1. Sessions live until explicitly deleted or server restart.

5. **Sync endpoint**: Should there be a dedicated endpoint for clock sync (`sender.sync()`)?
   - *Current plan*: Sync is done automatically on session creation. The sync offset is returned in `GET /live`. A dedicated sync endpoint could be added later.
