# lcyt-backend — Implementation Todo (Steps 5–16)

Steps 1–4 are complete (package scaffolding, db.js, admin CLI, store.js).

---

## Step 5: CORS middleware (`src/middleware/cors.js`)

- [ ] Create `packages/lcyt-backend/src/middleware/` directory
- [ ] Create `cors.js` — read `Origin` header from incoming request
- [ ] For `POST /live` and `GET /health`: set permissive CORS headers (any origin allowed)
- [ ] For `/keys` routes: omit all CORS headers (admin endpoints — server-side use only)
- [ ] For all other routes: look up sessions via `store.getByDomain(origin)`. If match found, set `Access-Control-Allow-Origin: <origin>`, `Allow-Methods`, `Allow-Headers`, `Allow-Credentials`
- [ ] Handle `OPTIONS` preflight requests: respond `204` with appropriate CORS headers
- [ ] Export middleware factory `createCorsMiddleware(store)`
- [ ] Commit: "Step 5: Add dynamic CORS middleware"

---

## Step 6: Auth middleware (`src/middleware/auth.js`)

- [ ] Create `packages/lcyt-backend/src/middleware/auth.js`
- [ ] Read `Authorization: Bearer <token>` from request header
- [ ] Verify JWT signature using `jwtSecret` parameter (passed from server.js)
- [ ] On success: decode payload `{ sessionId, apiKey, streamKey, domain }`, attach to `req.session`
- [ ] On missing header: respond `401 { error: "Authorization header required" }`
- [ ] On invalid/expired token: respond `401 { error: "Invalid or expired token" }`
- [ ] Export middleware factory `createAuthMiddleware(jwtSecret)`
- [ ] Commit: "Step 6: Add JWT auth middleware"

---

## Step 7: Routes — `/live` (`src/routes/live.js`)

- [ ] Create `packages/lcyt-backend/src/routes/live.js`
- [ ] Export router factory `createLiveRouter(db, store, jwtSecret)`
- [ ] **`POST /live`**:
  - [ ] Validate required fields (`apiKey`, `streamKey`, `domain`); respond `400` if missing
  - [ ] Call `validateApiKey(db, apiKey)`; respond `401` with reason if invalid/revoked/expired
  - [ ] Compute session ID via `makeSessionId`; if session exists, return existing JWT (idempotent)
  - [ ] Instantiate `YoutubeLiveCaptionSender({ streamKey, sequence })`
  - [ ] Call `sender.start()`
  - [ ] Call `sender.sync()` to get initial `syncOffset` (wrap in try/catch; default to `0` on failure)
  - [ ] Sign JWT: `{ sessionId, apiKey, streamKey, domain }` with `jwtSecret`
  - [ ] Create session in store via `store.create()`
  - [ ] Set `Access-Control-Allow-Origin: <domain>` on response
  - [ ] Respond `200 { token, sessionId, sequence, syncOffset, startedAt }`
- [ ] **`GET /live`**:
  - [ ] Apply auth middleware
  - [ ] Look up session by `req.session.sessionId`; respond `404` if not found
  - [ ] Touch session activity (`store.touch`)
  - [ ] Respond `200 { sequence, syncOffset }`
- [ ] **`DELETE /live`**:
  - [ ] Apply auth middleware
  - [ ] Look up session by `req.session.sessionId`; respond `404` if not found
  - [ ] Call `session.sender.end()` (wrap in try/catch)
  - [ ] Remove session from store via `store.remove()`
  - [ ] Respond `200 { removed: true, sessionId }`
- [ ] Commit: "Step 7: Add /live routes (register, status, remove session)"

---

## Step 8: Routes — `/captions` (`src/routes/captions.js`)

- [ ] Create `packages/lcyt-backend/src/routes/captions.js`
- [ ] Export router factory `createCaptionsRouter(store)`
- [ ] **`POST /captions`** (auth middleware applied):
  - [ ] Validate `captions` array present and non-empty; respond `400` if not
  - [ ] Look up session by `req.session.sessionId`; respond `404` if not found
  - [ ] For each caption with `time` field (and no `timestamp`): compute `new Date(session.startedAt + time + session.syncOffset)`
  - [ ] Single caption: call `session.sender.send(text, timestamp)`
  - [ ] Multiple captions: call `session.sender.sendBatch(captions)`
  - [ ] Update `session.sequence` from sender after send
  - [ ] Call `store.touch(sessionId)` to update activity
  - [ ] On success: respond `200` with `{ sequence, timestamp/count, statusCode, serverTimestamp }`
  - [ ] On YouTube error: respond with appropriate status `{ error, statusCode, sequence }`
- [ ] Commit: "Step 8: Add /captions route"

---

## Step 9: Routes — `/sync` (`src/routes/sync.js`)

- [ ] Create `packages/lcyt-backend/src/routes/sync.js`
- [ ] Export router factory `createSyncRouter(store)`
- [ ] **`POST /sync`** (auth middleware applied):
  - [ ] Look up session by `req.session.sessionId`; respond `404` if not found
  - [ ] Call `session.sender.sync()`
  - [ ] Update `session.syncOffset` from result
  - [ ] Call `store.touch(sessionId)`
  - [ ] On success: respond `200 { syncOffset, roundTripTime, serverTimestamp, statusCode }`
  - [ ] On failure: respond `502 { error, statusCode }`
- [ ] Commit: "Step 9: Add /sync route"

---

## Step 10: Admin middleware + `/keys` routes

- [ ] Create `packages/lcyt-backend/src/middleware/admin.js`
  - [ ] Read `X-Admin-Key` header
  - [ ] If `ADMIN_KEY` env var not set: respond `503 { error: "Admin API not configured" }`
  - [ ] If header missing: respond `401 { error: "X-Admin-Key header required" }`
  - [ ] Compare with `ADMIN_KEY` via `crypto.timingSafeEqual`; respond `403` on mismatch
  - [ ] Export `adminMiddleware`
- [ ] Create `packages/lcyt-backend/src/routes/keys.js`
  - [ ] Export router factory `createKeysRouter(db)`
  - [ ] Apply admin middleware to all routes
  - [ ] **`GET /keys`**: call `getAllKeys(db)`, return formatted list
  - [ ] **`POST /keys`**: validate `owner` field; call `createKey(db, ...)`; respond `201` with key
  - [ ] **`GET /keys/:key`**: call `getKey(db, key)`; respond `404` if not found
  - [ ] **`PATCH /keys/:key`**: call `updateKey(db, key, { owner, expiresAt })`; respond `404` if not found
  - [ ] **`DELETE /keys/:key`**: if `permanent=true` query param, call `deleteKey`; else call `revokeKey`; respond `404` if not found
- [ ] Commit: "Step 10: Add admin middleware and /keys CRUD routes"

---

## Step 11: Server entry point (`src/server.js` + `src/index.js`)

- [ ] Create `packages/lcyt-backend/src/server.js`:
  - [ ] Generate/read `jwtSecret` (random bytes if `JWT_SECRET` not set; log loud warning)
  - [ ] Log info notice if `ADMIN_KEY` not set
  - [ ] Call `initDb()` with `DB_PATH` env var or default
  - [ ] Instantiate `SessionStore`
  - [ ] Create Express app
  - [ ] Mount JSON body parser with 64KB limit: `express.json({ limit: '64kb' })`
  - [ ] Mount request logging middleware (method, path, status, duration)
  - [ ] Mount dynamic CORS middleware
  - [ ] Mount `/health` route: `GET /health` returns `{ ok: true, uptime, activeSessions }` (no auth)
  - [ ] Mount `/live` router (factory with db, store, jwtSecret)
  - [ ] Mount `/captions` router (factory with store, auth middleware injected)
  - [ ] Mount `/sync` router (factory with store, auth middleware injected)
  - [ ] Mount `/keys` router (factory with db)
  - [ ] Implement graceful shutdown: on `SIGTERM`/`SIGINT`, end all sessions, stop cleanup, close db, close server
  - [ ] Export `{ app, db, store }` for testing
- [ ] Create `packages/lcyt-backend/src/index.js`:
  - [ ] Import server.js, start listening on `PORT` (default: 3000)
  - [ ] Log `Listening on port <PORT>` at startup
- [ ] Commit: "Step 11: Add Express server entry point with graceful shutdown"

---

## Step 12: `BackendCaptionSender` (`packages/lcyt/src/backend-sender.js`)

- [ ] Create `packages/lcyt/src/backend-sender.js`
- [ ] Implement `_fetch(path, { method, body, auth })` helper using global `fetch()`
  - [ ] Attach `Authorization: Bearer` header when `auth=true` and token present
  - [ ] Throw `NetworkError` on non-ok response
- [ ] Implement constructor: store `backendUrl`, `apiKey`, `streamKey`, `domain` (default `location.origin` or `http://localhost`), `sequence`, `verbose`
- [ ] Implement `start()`: `POST /live`, store `_token`, update `sequence`, `syncOffset`, `startedAt`, set `isStarted = true`; return `this`
- [ ] Implement `end()`: `DELETE /live`, clear `_token`, set `isStarted = false`; return `this`
- [ ] Implement `send(text, timestampOrOptions?)`: resolve `time` vs `timestamp`; `POST /captions` with single caption; update `sequence` from response
- [ ] Implement `sendBatch(captions?)`: use provided captions or drain local queue; `POST /captions`; update `sequence`
- [ ] Implement `construct(text, timestamp?)`: push to local `_queue`; return queue length
- [ ] Implement `getQueue()` / `clearQueue()`
- [ ] Implement `sync()`: `POST /sync`; update `syncOffset` from response
- [ ] Implement `heartbeat()`: `GET /live`; update `sequence` and `syncOffset`
- [ ] Implement `getSequence()` / `setSequence()` / `getSyncOffset()` / `setSyncOffset()` / `getStartedAt()`
- [ ] Commit: "Step 12: Add BackendCaptionSender class"

---

## Step 13: `BackendCaptionSender` types + exports

- [ ] Create `packages/lcyt/src/backend-sender.d.ts` with full type definitions (see plan)
- [ ] Add `"./backend"` export entry to `packages/lcyt/package.json` (ESM import, CJS require, types)
- [ ] Update `packages/lcyt/scripts/build-cjs.js` to transform `backend-sender.js` → `dist/backend-sender.cjs`
- [ ] Run `npm run build` in `packages/lcyt` and verify `dist/backend-sender.cjs` is generated
- [ ] Commit: "Step 13: Add BackendCaptionSender types and package exports"

---

## Step 14: `BackendCaptionSender` tests (`packages/lcyt/test/backend-sender.test.js`)

- [ ] Create `packages/lcyt/test/backend-sender.test.js` using Node built-in test runner
- [ ] Mock `fetch` globally to intercept all HTTP calls
- [ ] Test `start()`: verify `POST /live` is called, JWT stored, sequence/syncOffset/startedAt updated
- [ ] Test `send()` single caption: verify `POST /captions` payload and sequence update
- [ ] Test `send()` with `{ time }`: verify time is passed through correctly
- [ ] Test `sendBatch()`: verify batch payload
- [ ] Test `sync()`: verify `POST /sync` called, syncOffset updated
- [ ] Test `heartbeat()`: verify `GET /live` called, values updated
- [ ] Test `end()`: verify `DELETE /live` called, isStarted false
- [ ] Test `construct()` / `getQueue()` / `clearQueue()`: local queue operations, no network
- [ ] Test error: invalid API key → `start()` throws `NetworkError`
- [ ] Test error: network failure → throws
- [ ] Run `npm test` in `packages/lcyt` and verify all tests pass
- [ ] Commit: "Step 14: Add BackendCaptionSender tests"

---

## Step 15: Backend integration tests (`packages/lcyt-backend/test/`)

- [ ] Create `packages/lcyt-backend/test/` directory
- [ ] Create `db.test.js`: test all db.js functions against in-memory SQLite (`:memory:`)
  - [ ] `initDb`, `createKey`, `getKey`, `getAllKeys`, `validateApiKey` (valid, revoked, expired, unknown)
  - [ ] `revokeKey`, `deleteKey`, `renewKey`, `updateKey`
- [ ] Create `store.test.js`: test `SessionStore` with mock senders
  - [ ] `create`, `get`, `has`, `getByDomain`, `remove`, `all`, `touch`, `size`, `stopCleanup`
  - [ ] Cleanup sweep: verify idle sessions removed and `sender.end()` called
- [ ] Create `live.test.js`: integration tests for `/live` endpoints (mock `YoutubeLiveCaptionSender`)
  - [ ] `POST /live`: success, idempotent re-register, missing fields, invalid API key
  - [ ] `GET /live`: success, no auth, session not found
  - [ ] `DELETE /live`: success, no auth, session not found
- [ ] Create `captions.test.js`: integration tests for `POST /captions`
  - [ ] Single caption, batch captions, relative `time` resolution
  - [ ] Missing captions array, no auth, session not found
- [ ] Create `sync.test.js`: integration tests for `POST /sync`
  - [ ] Success, sync failure (YouTube unreachable), no auth
- [ ] Create `health.test.js`: test `GET /health` response shape
- [ ] Create `keys.test.js`: integration tests for `/keys` CRUD endpoints
  - [ ] List, create, get, patch, revoke (soft), delete (permanent); missing admin key, wrong key
- [ ] Run `npm test` in `packages/lcyt-backend` and verify all tests pass
- [ ] Commit: "Step 15: Add backend integration and unit tests"

---

## Step 16: Root workspace scripts + Dockerfile

- [ ] Add `"start:backend"` script to root `package.json`: `"node packages/lcyt-backend/src/index.js"`
- [ ] Run `npm install` at repo root to verify workspace links are correct
- [ ] Create `packages/lcyt-backend/Dockerfile` (multi-stage, node:20-slim; see plan for exact content)
- [ ] Create `packages/lcyt-backend/.dockerignore` (exclude `node_modules`, `.git`, `test/`, `*.db`, `*.md`)
- [ ] Commit: "Step 16: Add Dockerfile, .dockerignore, and start:backend script"
