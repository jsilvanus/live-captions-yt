# lcyt-backend — Plan

## Purpose

A small Node.js backend that acts as a **CORS relay** for YouTube Live caption ingestion. Clients (browsers, web apps) cannot POST directly to `upload.youtube.com` due to CORS restrictions. This backend accepts captions from web clients, forwards them to YouTube via the `lcyt` library, and returns the result — with CORS headers set to match the caller's registered domain.

## Key Features

- Register a session with an API key, stream key, and allowed origin domain
- Multiple concurrent sessions: different stream keys, different domains, same API key
- JWT-based authentication for caption sending
- Automatic sequence tracking and sync offset management
- Dynamic CORS: each session specifies its allowed origin
- Dedicated sync endpoint for NTP-style clock synchronization with YouTube
- **SQLite database** for API key management (owners, expiration dates)
- **Admin CLI** (`lcyt-backend-admin`) for managing API keys

---

## Architecture

### Framework & Storage

| Choice     | Value        | Rationale                                               |
| ---------- | ------------ | ------------------------------------------------------- |
| Framework  | **Express**  | Lightweight, widely used, good fit for a small relay    |
| Sessions   | **In-memory** (Map) | Active sessions are ephemeral; reset on restart |
| API Keys   | **SQLite** (better-sqlite3) | Persistent storage for API key registry with owners and expiration |
| Auth       | **JWT** (jsonwebtoken) | Issued on registration, required for /captions |
| Sender     | **lcyt** (workspace sibling) | Reuse existing `YoutubeLiveCaptionSender` |

### Package Layout

```
packages/lcyt-backend/
├── package.json
├── lcyt-backend.db        # SQLite database (created at runtime, gitignored)
├── bin/
│   └── lcyt-backend-admin # CLI for managing API keys (ESM, shebang script)
├── src/
│   ├── server.js          # Express app setup, CORS, routes
│   ├── routes/
│   │   ├── live.js        # GET/POST/DELETE /live
│   │   ├── captions.js    # POST /captions
│   │   └── sync.js        # POST /sync
│   ├── middleware/
│   │   ├── auth.js        # JWT verification middleware
│   │   └── cors.js        # Dynamic CORS middleware
│   ├── db.js              # SQLite database setup + API key queries
│   ├── store.js           # In-memory session store (active sessions)
│   └── index.js           # Entry point (start server)
└── test/
    ├── live.test.js
    ├── captions.test.js
    ├── sync.test.js
    ├── db.test.js
    └── store.test.js
```

### Dependencies

```json
{
  "dependencies": {
    "express": "^4.21",
    "jsonwebtoken": "^9.0",
    "better-sqlite3": "^11.0",
    "lcyt": "*"
  },
  "devDependencies": {}
}
```

---

## Data Model

### SQLite Database — API Keys (`src/db.js`)

Persistent storage for registered API keys. The database file lives at `DB_PATH` env var or defaults to `./lcyt-backend.db` relative to the package root.

**Table: `api_keys`**

```sql
CREATE TABLE api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,   -- the API key string (UUID or custom)
  owner       TEXT    NOT NULL,          -- human-readable owner name / description
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT,                      -- NULL = never expires
  active      INTEGER NOT NULL DEFAULT 1 -- 1 = active, 0 = revoked
);
```

**`db.js` exports:**

```js
initDb(dbPath?)                        // Create tables if not exist, return db instance
validateApiKey(db, key) → { valid, owner, expiresAt } | { valid: false, reason }
getAllKeys(db) → Array<ApiKeyRow>
getKey(db, key) → ApiKeyRow | null
createKey(db, { key?, owner, expiresAt? }) → ApiKeyRow  // auto-generates key if omitted
revokeKey(db, key) → boolean
deleteKey(db, key) → boolean
renewKey(db, key, newExpiresAt) → boolean
```

**Validation logic (`validateApiKey`):**
1. Look up key in `api_keys` table
2. If not found → `{ valid: false, reason: "unknown_key" }`
3. If `active = 0` → `{ valid: false, reason: "revoked" }`
4. If `expires_at` is set and in the past → `{ valid: false, reason: "expired" }`
5. Otherwise → `{ valid: true, owner, expiresAt }`

### Session Store — Active Sessions (in-memory Map, `src/store.js`)

```
Map<sessionId, Session>
```

**Session** (keyed by `${apiKey}:${streamKey}:${domain}`):

```js
{
  sessionId: string,          // composite key: apiKey:streamKey:domain
  apiKey: string,             // validated API key (must exist in SQLite)
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
2. **Validate API key against SQLite** — call `validateApiKey(db, apiKey)`. Reject with 401 if unknown, revoked, or expired.
3. Create composite session ID: `${apiKey}:${streamKey}:${domain}`
4. If session already exists, return existing JWT (idempotent)
5. Create a `YoutubeLiveCaptionSender` instance with `{ streamKey, sequence }`
6. Call `sender.start()`
7. Optionally call `sender.sync()` to get initial sync offset
8. Generate JWT containing `{ sessionId, apiKey, streamKey, domain }`
9. Store session in Map
10. Return response

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

### `POST /sync` — Clock Synchronization (Authenticated)

Triggers an NTP-style clock sync between the backend and YouTube's server for the session's sender. This updates the `syncOffset` used for all subsequent caption timestamps.

**Headers:**

```
Authorization: Bearer <jwt>
```

**Request body:** None required.

**Behavior:**

1. Verify JWT
2. Look up session by `sessionId` from JWT payload
3. Call `sender.sync()` — sends a heartbeat to YouTube, measures round-trip time, computes clock offset
4. Update `session.syncOffset` with the new value
5. Return sync result

**Response (200):**

```json
{
  "syncOffset": -15,
  "roundTripTime": 42,
  "serverTimestamp": "2026-02-20T12:00:00.000Z",
  "statusCode": 200
}
```

**Error (if YouTube unreachable):**

```json
{
  "error": "Sync failed: YouTube server did not respond",
  "statusCode": 502
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

## Admin CLI (`bin/lcyt-backend-admin`)

A small CLI tool for managing the API key database. Registered as `lcyt-backend-admin` in `package.json` bin field.

### Commands

```bash
lcyt-backend-admin list                          # List all API keys
lcyt-backend-admin add --owner "Alice"           # Generate new key for owner
lcyt-backend-admin add --owner "Bob" --key "custom-key-123"  # Use specific key
lcyt-backend-admin add --owner "Eve" --expires "2026-12-31"  # Key with expiration
lcyt-backend-admin revoke <key>                  # Deactivate key (soft delete)
lcyt-backend-admin delete <key>                  # Permanently remove key
lcyt-backend-admin renew <key> --expires "2027-06-30"  # Extend expiration
lcyt-backend-admin info <key>                    # Show details for a key
```

### `list` output

```
  KEY                                   OWNER     ACTIVE  EXPIRES       CREATED
  a1b2c3d4-e5f6-7890-abcd-ef1234567890 Alice     yes     never         2026-02-20
  b2c3d4e5-f6a7-8901-bcde-f12345678901 Bob       yes     2026-12-31    2026-02-20
  c3d4e5f6-a7b8-9012-cdef-123456789012 Eve       REVOKED 2026-12-31    2026-02-19
```

### Implementation

- ESM script with shebang (`#!/usr/bin/env node`)
- Uses `process.argv` for argument parsing (simple enough, no yargs needed)
- Imports `db.js` for all database operations
- Accepts `--db <path>` flag to override database path (default: `./lcyt-backend.db` or `DB_PATH` env var)
- Auto-generates UUID v4 keys when `--key` is not provided (using `crypto.randomUUID()`)

---

## `BackendCaptionSender` — Client for `lcyt-backend` (in `packages/lcyt`)

A new class in the `lcyt` library that mirrors the `YoutubeLiveCaptionSender` API but sends captions through an `lcyt-backend` instance instead of directly to YouTube. This lets browser/web clients use the same familiar interface.

### File: `packages/lcyt/src/backend-sender.js`

### Constructor

```js
new BackendCaptionSender({
  backendUrl: string,         // e.g. "https://captions.example.com"
  apiKey: string,             // API key (must exist in backend's SQLite db)
  streamKey: string,          // YouTube stream key
  domain?: string,            // CORS origin — defaults to globalThis.location?.origin || 'http://localhost'
  sequence?: number,          // Starting sequence (default: 0, overridden by backend on start())
  verbose?: boolean           // Enable verbose logging
})
```

### API — Same shape as `YoutubeLiveCaptionSender`

| Method | Behavior | Backend call |
| --- | --- | --- |
| `start()` | Register session, store JWT, update sequence/syncOffset from response. **Returns a Promise** (unlike the original which is sync). | `POST /live` |
| `send(text, timestamp?)` | Send single caption via backend relay | `POST /captions` with `{ captions: [{ text, timestamp }] }` |
| `sendBatch(captions?)` | Send multiple captions (or drain local queue) | `POST /captions` with `{ captions: [...] }` |
| `construct(text, timestamp?)` | Queue locally (identical to original — no network) | — |
| `getQueue()` | Return local queue copy | — |
| `clearQueue()` | Clear local queue | — |
| `sync()` | Trigger clock sync on the backend sender | `POST /sync` |
| `heartbeat()` | Check session status, return sequence + syncOffset | `GET /live` |
| `end()` | Tear down backend session, clear JWT | `DELETE /live` |
| `getSequence()` | Return local sequence (updated from backend responses) | — |
| `setSequence(seq)` | Set local sequence | — |
| `getSyncOffset()` | Return local syncOffset (updated from backend responses) | — |
| `setSyncOffset(offset)` | Set local syncOffset | — |

### Key differences from `YoutubeLiveCaptionSender`

1. **`start()` is async** — it must call `POST /live` to register. Returns `Promise<BackendCaptionSender>`.
2. **No `ingestionUrl`/`baseUrl`/`region`/`cue`** — these are handled server-side.
3. **No `sendTest()`** — test payloads are a YouTube-direct concern.
4. **Uses `fetch()`** — works in browsers and Node 18+. No `http` module dependency.
5. **Stores JWT** internally after `start()`, attaches as `Authorization: Bearer` header.
6. **Sequence/syncOffset are synced** — updated from every backend response so the client always has current values.

### Internal `_fetch` helper

```js
async _fetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && this._token) headers['Authorization'] = `Bearer ${this._token}`;
  const res = await fetch(`${this.backendUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new NetworkError(data.error || `HTTP ${res.status}`, res.status);
  return data;
}
```

### Type definitions: `packages/lcyt/src/backend-sender.d.ts`

```ts
export interface BackendSenderOptions {
  backendUrl: string;
  apiKey: string;
  streamKey: string;
  domain?: string;
  sequence?: number;
  verbose?: boolean;
}

export declare class BackendCaptionSender {
  backendUrl: string;
  apiKey: string;
  streamKey: string;
  domain: string;
  sequence: number;
  isStarted: boolean;
  syncOffset: number;
  verbose: boolean;

  constructor(options: BackendSenderOptions);

  start(): Promise<this>;
  end(): Promise<this>;

  send(text: string, timestamp?: string | Date | number): Promise<SendResult>;
  sendBatch(captions?: CaptionItem[]): Promise<SendBatchResult>;

  construct(text: string, timestamp?: string | Date | number): number;
  getQueue(): CaptionItem[];
  clearQueue(): number;

  heartbeat(): Promise<{ sequence: number; syncOffset: number }>;
  sync(): Promise<SyncResult>;

  getSequence(): number;
  setSequence(seq: number): this;
  getSyncOffset(): number;
  setSyncOffset(offset: number): this;
}
```

### Export from `lcyt` package

Add to `packages/lcyt/package.json` exports:

```json
"./backend": {
  "types": "./src/backend-sender.d.ts",
  "import": "./src/backend-sender.js",
  "require": "./dist/backend-sender.cjs"
}
```

Usage:

```js
import { BackendCaptionSender } from 'lcyt/backend';

const sender = new BackendCaptionSender({
  backendUrl: 'https://captions.example.com',
  apiKey: 'a1b2c3d4-...',
  streamKey: 'YOUR_YOUTUBE_KEY'
});

await sender.start();             // POST /live → registers, gets JWT
await sender.send('Hello!');      // POST /captions → relayed to YouTube
await sender.sync();              // POST /sync → NTP sync via backend
const status = await sender.heartbeat(); // GET /live → { sequence, syncOffset }
await sender.end();               // DELETE /live → tears down session
```

### Browser usage

Since `BackendCaptionSender` uses `fetch()` and has no Node-specific dependencies, it works directly in browsers. The `domain` defaults to `location.origin`, and CORS is handled by the backend's dynamic CORS middleware.

```html
<script type="module">
  import { BackendCaptionSender } from 'lcyt/backend';

  const sender = new BackendCaptionSender({
    backendUrl: 'https://captions.example.com',
    apiKey: 'my-api-key',
    streamKey: 'YOUTUBE_STREAM_KEY'
  });

  await sender.start();
  await sender.send('Live from the browser!');
</script>
```

---

## Implementation Steps

### Step 1: Package scaffolding

- Create `packages/lcyt-backend/` directory structure
- Create `package.json` with workspace dependency on `lcyt`, `express`, `jsonwebtoken`, `better-sqlite3`
- Add `bin` field: `{ "lcyt-backend-admin": "bin/lcyt-backend-admin" }`
- Add `"packages/lcyt-backend"` to root `package.json` workspaces array
- Set `"type": "module"` for ESM

### Step 2: SQLite database layer (`src/db.js`)

- `initDb(dbPath?)` — open/create database, run `CREATE TABLE IF NOT EXISTS`
- `validateApiKey(db, key)` — check existence, active status, expiration
- `createKey(db, { key?, owner, expiresAt? })` — insert new key, auto-generate UUID if not provided
- `getAllKeys(db)`, `getKey(db, key)` — read operations
- `revokeKey(db, key)` — set `active = 0`
- `deleteKey(db, key)` — permanent removal
- `renewKey(db, key, newExpiresAt)` — update expiration

### Step 3: Admin CLI (`bin/lcyt-backend-admin`)

- Parse `process.argv` for commands: `list`, `add`, `revoke`, `delete`, `renew`, `info`
- Wire each command to `db.js` functions
- Format output as aligned table for `list`

### Step 4: Session store (`src/store.js`)

- Implement `SessionStore` class with Map-based storage
- Methods: `create(apiKey, streamKey, domain, sequence)`, `get(sessionId)`, `getByDomain(domain)`, `remove(sessionId)`, `has(sessionId)`
- Each session holds a `YoutubeLiveCaptionSender` instance

### Step 5: CORS middleware (`src/middleware/cors.js`)

- Dynamic origin matching against registered domains in the session store
- Permissive for `POST /live` (registration endpoint)
- Preflight (`OPTIONS`) support

### Step 6: Auth middleware (`src/middleware/auth.js`)

- JWT verification with `jsonwebtoken`
- Secret from `JWT_SECRET` env var or auto-generated
- Attaches decoded session info to `req.session`

### Step 7: Routes — `/live` (`src/routes/live.js`)

- `POST`: Validate API key against SQLite, create session + sender, generate JWT, return token
- `GET`: Auth required, return sequence + syncOffset
- `DELETE`: Auth required, tear down sender, remove session

### Step 8: Routes — `/captions` (`src/routes/captions.js`)

- `POST`: Auth required, look up session, call `sender.send()` or `sender.sendBatch()`, return result

### Step 9: Routes — `/sync` (`src/routes/sync.js`)

- `POST`: Auth required, look up session, call `sender.sync()`, return sync result

### Step 10: Server entry point (`src/server.js` + `src/index.js`)

- Create Express app
- Initialize SQLite database via `initDb()`
- Mount middleware (JSON body parser, dynamic CORS)
- Mount routes (pass `db` and `store` to route factories)
- `index.js`: Start server on `PORT` env var (default: 3000)
- Export app for testing

### Step 11: `BackendCaptionSender` (`packages/lcyt/src/backend-sender.js`)

- Implement class with `fetch()`-based `_fetch` helper
- `start()` → `POST /live`, store JWT, update sequence/syncOffset
- `send()` / `sendBatch()` → `POST /captions` with JWT auth
- `construct()` / `getQueue()` / `clearQueue()` — local queue (same as original)
- `sync()` → `POST /sync`
- `heartbeat()` → `GET /live`
- `end()` → `DELETE /live`
- Update sequence/syncOffset from every backend response

### Step 12: `BackendCaptionSender` types + exports

- Create `packages/lcyt/src/backend-sender.d.ts`
- Add `"./backend"` entry to `packages/lcyt/package.json` exports map
- Update `packages/lcyt/scripts/build-cjs.js` to include `backend-sender.js` → `backend-sender.cjs`

### Step 13: `BackendCaptionSender` tests

- Unit tests in `packages/lcyt/test/backend-sender.test.js`
- Mock `fetch()` globally to simulate backend responses
- Test full lifecycle: start → send → sendBatch → sync → heartbeat → end
- Test error cases: invalid API key, expired session, network failure

### Step 14: Backend tests

- Unit tests for `db.js` (using a temporary in-memory SQLite database)
- Unit tests for `SessionStore`
- Integration tests for each endpoint using Node's built-in test runner
- Mock `YoutubeLiveCaptionSender` to avoid real HTTP calls

### Step 15: Root workspace update

- Add `packages/lcyt-backend` to root workspaces
- Add `start:backend` script to root package.json
- Run `npm install` to link workspace dependencies

---

## Environment Variables

| Variable     | Default              | Description                              |
| ------------ | -------------------- | ---------------------------------------- |
| `PORT`       | `3000`               | Server listen port                       |
| `JWT_SECRET` | (auto-generated)     | Secret for signing/verifying JWTs. If not set, a random secret is generated at startup (tokens won't survive restarts) |
| `DB_PATH`    | `./lcyt-backend.db`  | Path to SQLite database file             |

---

## Open Questions / Decisions Needed

1. **Rate limiting**: Should we add rate limiting to prevent abuse?
   - *Current plan*: Not in v1. Can be added later via `express-rate-limit`.

2. **HTTPS / Deployment**: Should the backend handle TLS, or sit behind a reverse proxy?
   - *Current plan*: HTTP only — assume deployment behind nginx/Cloudflare/etc.

3. **Session expiry**: Should sessions auto-expire after some idle time?
   - *Current plan*: No expiry in v1. Sessions live until explicitly deleted or server restart.

4. **Key format**: Should auto-generated API keys be UUID v4 or something shorter?
   - *Current plan*: UUID v4 via `crypto.randomUUID()`. Can be overridden with `--key` in the CLI.
