# HTTP Caching Strategy — Backend, Plugins & nginx

**Status:** pending
**Date:** 2026-03-29

---

## Motivation

The backend serves a wide range of HTTP endpoints — real-time caption delivery,
static media files, configuration JSON, HLS streams, SSE event streams, and
public embeddable content. Today, caching is inconsistent:

- A global `no-store` middleware blankets every response.
- A handful of routes explicitly override with `max-age` values, but the vast
  majority of GET endpoints never set any cache header.
- The frontend (`lcyt-web`) makes every API call as a fresh `fetch()` with no
  client-side caching layer — there is no stale-while-revalidate, no ETag
  conditional request logic, and no in-memory memoisation.
- nginx configuration (`scripts/nginx-app.conf.sample`) only covers Vite
  assets (`/assets/` → 1 year immutable) and bridge downloads.
- The generated nginx radio config (`NginxManager`) sets `no-cache, no-store`
  on all proxied HLS streams, even immutable TS segments.

This leads to unnecessary backend load on endpoints whose data rarely changes
(e.g. feature flags, DSK viewport definitions, YouTube config, icons, caption
files) and missed opportunities for CDN/proxy-level caching of public media
endpoints (HLS segments, preview thumbnails, player scripts).

---

## Current State Audit

### Global default (server.js:311-314)

```js
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
```

All responses inherit `no-store` unless a route explicitly overrides it.

### Endpoints that already set Cache-Control

| Route | Current value | Source file |
|---|---|---|
| `GET /contact` | `public, max-age=3600` | `server.js:384` |
| `GET /usage` (historical) | `public, max-age=1800, stale-while-revalidate=3600` | `routes/usage.js:83` |
| `GET /icons/:id` | `public, max-age=3600` | `routes/icons.js:176` |
| `GET /images/:id` (DSK) | `public, max-age=86400` | `lcyt-dsk/routes/images.js:279` |
| `GET /video/:key` (player HTML) | `no-cache, no-store` | `routes/video.js:220` |
| `GET /video/:key/master.m3u8` | `no-cache, no-store` | `routes/video.js:242` |
| `GET /video/:key/subs/:lang/playlist.m3u8` | `no-cache, no-store` | `routes/video.js:264` |
| `GET /video/:key/subs/:lang/:seg.vtt` | `public, max-age=60` | `routes/video.js:297` |
| `GET /stream-hls/:key/player.js` | `public, max-age=3600` | `lcyt-rtmp/routes/stream-hls.js:208` |
| `GET /stream-hls/:key/:file` (m3u8) | `no-cache, no-store` | `lcyt-rtmp/routes/stream-hls.js:246` |
| `GET /stream-hls/:key/:file` (ts) | `public, max-age=60` | `lcyt-rtmp/routes/stream-hls.js:246` |
| `GET /radio/:key/player.js` | `public, max-age=3600` | `lcyt-rtmp/routes/radio.js:244` |
| `GET /radio/:key/info` | `no-cache, no-store` | `lcyt-rtmp/routes/radio.js:267` |
| `GET /radio/:key/:file` (m3u8) | `no-cache, no-store` | `lcyt-rtmp/routes/radio.js:305` |
| `GET /radio/:key/:file` (ts) | `public, max-age=60` | `lcyt-rtmp/routes/radio.js:305` |
| `GET /preview/:key/incoming.jpg` | `no-cache` | `lcyt-rtmp/routes/preview.js:22` |
| All SSE endpoints | `no-cache` | events.js, viewer.js, stt.js, dsk.js, bridge-manager.js |

### Endpoints that fall through to global `no-store` (with no override)

| Route | Auth | Data volatility |
|---|---|---|
| `GET /health` | No | Semi-static (uptime counter, session count) |
| `GET /live` | Session | Real-time session state |
| `GET /stats` | Session | Daily aggregates (immutable after day ends) |
| `GET /file` | Session | File list (changes on upload/delete only) |
| `GET /file/:id` | Session/token | Immutable file content |
| `GET /file/storage-config` | Session | Rarely changed config |
| `GET /features` | Session | Rarely changed feature flags |
| `GET /keys` | User/Admin | Project list (changes on CRUD only) |
| `GET /keys/:key` | User/Admin | Single project detail |
| `GET /icons` | Session | Icon list (changes on upload/delete only) |
| `GET /youtube/config` | Session | Static config per deployment |
| `GET /stt/status` | Session | Real-time STT state |
| `GET /stt/config` | Session | Rarely changed config |
| `GET /cues/rules` | Session | Rules list (changes on CRUD only) |
| `GET /cues/events` | Session | Event log (append-only, recent) |
| `GET /ai/config` | Session | Rarely changed AI config |
| `GET /ai/status` | Session | Server capabilities (static) |
| `GET /agent/status` | Session | Agent capabilities (static) |
| `GET /agent/context` | Session | Context window (changes on add/clear) |
| `GET /agent/events` | Session | Event log (append-only, recent) |
| `GET /dsk/:apikey/images` | No | Image list (changes on upload/delete only) |
| `GET /dsk/:apikey/viewports/public` | No | Viewport definitions (rarely changed) |
| `GET /production/cameras` | Admin | Camera list (changes on CRUD only) |
| `GET /production/mixers` | Admin | Mixer list (changes on CRUD only) |
| `GET /production/bridge/instances` | Admin | Bridge list (changes on CRUD only) |
| `GET /admin/users` | Admin | User list |
| `GET /admin/projects` | Admin | Project list |

### Frontend caching (lcyt-web)

- `api.js` wrapper uses bare `fetch()` — no `cache` directive set (except
  `/health` which explicitly uses `cache: 'no-store'`).
- Backend features array from `/health` is cached in `localStorage`
  (`lcyt.backend.features`).
- Project features cached in `localStorage` (`lcyt.project.features`).
- No in-memory request deduplication or memoisation.
- No ETag / `If-None-Match` support.

### nginx configuration

- `scripts/nginx-app.conf.sample`: Only `/assets/` (Vite hashed, 1 year
  immutable) and `/bridge-downloads/` (no-cache).
- `NginxManager` generated config: `proxy_cache off; Cache-Control: no-cache, no-store`
  on all radio HLS proxy locations — including immutable TS segments.

---

## Design Decisions

### 1. Cache-Control vs ETag

**Decision: Cache-Control with `max-age` for the majority; ETag only for preview thumbnails.**

Rationale:

- **`max-age`** is simpler, requires no server-side state, and is understood by
  every proxy, CDN, and browser. For endpoints where the data is either
  immutable (files, HLS segments, images) or rarely changing (config, feature
  flags), a well-chosen `max-age` eliminates conditional requests entirely.

- **ETag** adds value only when the response body changes unpredictably and the
  cost of re-sending it is high relative to the validation round-trip.
  In this codebase, the only endpoint that fits is preview thumbnails
  (`/preview/:key/incoming.jpg`): the JPEG changes every ~5 seconds but many
  clients may poll more frequently. Using `ETag` (content hash) + `max-age=2`
  lets clients skip the response body on 304.

- **Avoid Last-Modified for API JSON** — Express's built-in `Last-Modified`
  handling is designed for static files. API JSON responses have no meaningful
  modification time; using `max-age` is cleaner.

### 2. `private` vs `public`

- **`private`**: Any response that varies per user/session (i.e., requires
  Bearer token). Prevents CDN/proxy caching of user-specific data.
- **`public`**: Responses accessible without auth (viewer, HLS, DSK images,
  icons, contact, health) OR responses where the URL itself is the access
  control (e.g., `/dsk/:apikey/images` — the apikey in the URL is the secret).

### 3. `stale-while-revalidate`

Use `stale-while-revalidate` on endpoints where a brief staleness window is
acceptable and instant response is preferred (e.g., `/health`, `/stats`,
configuration endpoints). The browser returns the cached value immediately and
revalidates in the background.

### 4. nginx HLS segment caching

The generated nginx radio config must differentiate playlists from segments:
- `.m3u8` playlists → `no-cache, no-store` (live, changes every segment)
- `.ts` segments → `public, max-age=86400` (immutable once written; segment
  names include a sequence number)

### 5. Frontend approach

Add a thin caching layer to `api.js`:
- `api.getCached(path, maxAgeMs)` — returns cached response if within
  `maxAgeMs`; otherwise fetches fresh. In-memory Map, no persistence.
- Used for: feature flags, config endpoints, image/icon lists.
- NOT used for: session state, real-time data, write operations.

---

## Endpoint Cache Matrix

Complete classification of every GET endpoint used by `lcyt-web`, with
recommended caching:

### Tier 1 — Never cache (real-time / write-heavy)

| Endpoint | Reason |
|---|---|
| `POST/PATCH/DELETE /live` | Session mutation |
| `POST /captions` | Real-time caption delivery |
| `POST /sync` | Clock synchronisation |
| `POST /mic` | Real-time mic lock |
| `GET /live` | Real-time session state (sequence, sync offset) |
| `GET /stt/status` | Real-time STT session state |
| `GET /events` (SSE) | Real-time event stream |
| `GET /stt/events` (SSE) | Real-time transcript stream |
| `GET /viewer/:key` (SSE) | Real-time caption stream |
| `GET /dsk/:apikey/events` (SSE) | Real-time graphics stream |
| `GET /radio/:key/info` | Live status changes when stream starts/stops |
| All POST/PUT/DELETE routes | Write operations |

These endpoints keep `no-store` (from global middleware) or `no-cache` (SSE).
**No changes needed.**

### Tier 2 — Short cache (frequently polled, tolerates brief staleness)

| Endpoint | Auth | Recommended | Rationale |
|---|---|---|---|
| `GET /health` | No | `public, max-age=30, stale-while-revalidate=60` | Polled every 30s; uptime/session count are informational. Feature list is static. |
| `GET /stats` | Session | `private, max-age=60, stale-while-revalidate=120` | Daily aggregates; within-day totals tolerate 60s staleness. |
| `GET /file` | Session | `private, max-age=30, stale-while-revalidate=60` | File list changes only on upload/delete; 30s is fine. |
| `GET /cues/rules` | Session | `private, max-age=30, stale-while-revalidate=60` | Rules change on CRUD; 30s OK. |
| `GET /cues/events` | Session | `private, max-age=15` | Event log; short cache for repeated views. |
| `GET /agent/context` | Session | `private, max-age=30` | Context window; short cache. |
| `GET /agent/events` | Session | `private, max-age=15` | Event log; short cache. |
| `GET /keys` | User | `private, max-age=30, stale-while-revalidate=60` | Project list; changes on CRUD. |
| `GET /keys/:key` | User | `private, max-age=30` | Project detail; infrequent changes. |
| `GET /icons` (list) | Session | `private, max-age=60, stale-while-revalidate=120` | Icon list; changes on upload/delete. |
| `GET /images` (list, auth) | Session | `private, max-age=60, stale-while-revalidate=120` | DSK image list; changes on upload/delete. |
| `GET /production/cameras` | Admin | `private, max-age=30, stale-while-revalidate=60` | Camera list; CRUD-driven changes. |
| `GET /production/mixers` | Admin | `private, max-age=30, stale-while-revalidate=60` | Mixer list; includes live connection status. |
| `GET /production/bridge/instances` | Admin | `private, max-age=30, stale-while-revalidate=60` | Bridge list. |
| `GET /admin/users` | Admin | `private, max-age=30` | Admin view; tolerable staleness. |
| `GET /admin/projects` | Admin | `private, max-age=30` | Admin view; tolerable staleness. |
| `GET /stream` | Session | `private, max-age=15` | RTMP relay status; changes on start/stop. |
| `GET /preview/:key/incoming.jpg` | No | `public, max-age=2` + `ETag` | Thumbnails update every ~5s; ETag avoids re-sending identical JPEGs. |

### Tier 3 — Medium cache (config / infrequently changing)

| Endpoint | Auth | Recommended | Rationale |
|---|---|---|---|
| `GET /features` | Session | `private, max-age=300, stale-while-revalidate=600` | Feature flags; change only on admin action. |
| `GET /stt/config` | Session | `private, max-age=300, stale-while-revalidate=600` | STT config; changes on explicit save. |
| `GET /ai/config` | Session | `private, max-age=300, stale-while-revalidate=600` | AI config; changes on explicit save. |
| `GET /file/storage-config` | Session | `private, max-age=300` | Storage config; rarely changed. |
| `GET /youtube/config` | Session | `private, max-age=3600` | Static per deployment; env var only. |
| `GET /ai/status` | Session | `private, max-age=3600, stale-while-revalidate=3600` | Server capabilities; static until restart. |
| `GET /agent/status` | Session | `private, max-age=3600, stale-while-revalidate=3600` | Agent capabilities; static until restart. |
| `GET /dsk/:apikey/images` | No | `public, max-age=300, stale-while-revalidate=600` | DSK image list; public endpoint, key in URL. |
| `GET /dsk/:apikey/viewports/public` | No | `public, max-age=3600, stale-while-revalidate=3600` | Viewport definitions; rarely change. |
| `GET /contact` | No | `public, max-age=3600` | Already correct ✓ |
| `GET /usage` (historical) | Admin | `public, max-age=1800, stale-while-revalidate=3600` | Already correct ✓ |

### Tier 4 — Long cache (immutable / content-addressed)

| Endpoint | Auth | Recommended | Rationale |
|---|---|---|---|
| `GET /file/:id` | Session/token | `private, max-age=31536000, immutable` | Caption files never change after creation. |
| `GET /icons/:id` | No | `public, max-age=86400` | Icons are replaced via delete+re-upload, not edited in place. Increase from current 3600. |
| `GET /images/:id` | No | `public, max-age=86400` | Already correct ✓ |
| `GET /stream-hls/:key/*.ts` | No | `public, max-age=86400` | TS segments are immutable. Increase from current 60. |
| `GET /radio/:key/*.ts` | No | `public, max-age=86400` | TS segments are immutable. Increase from current 60. |
| `GET /video/:key/subs/:lang/:seg.vtt` | No | `public, max-age=86400` | VTT segments are immutable. Increase from current 60. |
| `GET /stream-hls/:key/player.js` | No | `public, max-age=3600` | Already correct ✓ |
| `GET /radio/:key/player.js` | No | `public, max-age=3600` | Already correct ✓ |

---

## Implementation Phases

### Phase 1 — Backend Cache-Control headers (high-impact, low-risk)

Add explicit `Cache-Control` headers to backend GET routes that currently fall
through to the global `no-store`.

**Files to modify:**

1. **`packages/lcyt-backend/src/server.js`**
   - `GET /health`: add `res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')`
   - `GET /icons/:id`: change `max-age=3600` → `max-age=86400`

2. **`packages/lcyt-backend/src/routes/stats.js`** (or wherever `GET /stats` is defined)
   - Add `res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120')`

3. **`packages/lcyt-backend/src/routes/video.js`**
   - `GET /video/:key/subs/:lang/:seg.vtt`: change `max-age=60` → `max-age=86400`

4. **`packages/plugins/lcyt-files/src/routes/files.js`**
   - `GET /file` (list): add `private, max-age=30, stale-while-revalidate=60`
   - `GET /file/:id` (download): add `private, max-age=31536000, immutable`
   - `GET /file/storage-config`: add `private, max-age=300`

5. **`packages/plugins/lcyt-rtmp/src/routes/stream-hls.js`**
   - `.ts` segments: change `max-age=60` → `max-age=86400`

6. **`packages/plugins/lcyt-rtmp/src/routes/radio.js`**
   - `.ts` segments: change `max-age=60` → `max-age=86400`

7. **`packages/plugins/lcyt-rtmp/src/routes/preview.js`**
   - Add `max-age=2` and compute ETag from JPEG content hash.

8. **`packages/plugins/lcyt-dsk/src/routes/dsk.js`**
   - `GET /dsk/:apikey/images`: change `no-store` → `public, max-age=300, stale-while-revalidate=600`
   - `GET /dsk/:apikey/viewports/public`: change `no-store` → `public, max-age=3600, stale-while-revalidate=3600`

9. **`packages/plugins/lcyt-cues/src/routes/cues.js`**
   - `GET /cues/rules`: add `private, max-age=30, stale-while-revalidate=60`
   - `GET /cues/events`: add `private, max-age=15`

10. **`packages/plugins/lcyt-agent/src/routes/agent.js`**
    - `GET /agent/status`: add `private, max-age=3600, stale-while-revalidate=3600`
    - `GET /agent/context`: add `private, max-age=30`
    - `GET /agent/events`: add `private, max-age=15`

11. **`packages/plugins/lcyt-agent/src/routes/ai.js`**
    - `GET /ai/config`: add `private, max-age=300, stale-while-revalidate=600`
    - `GET /ai/status`: add `private, max-age=3600, stale-while-revalidate=3600`

12. **Session-scoped config routes** (in routes that serve `GET /features`,
    `GET /stt/config`, `GET /youtube/config`, etc.):
    - `GET /features`: add `private, max-age=300, stale-while-revalidate=600`
    - `GET /stt/config`: add `private, max-age=300, stale-while-revalidate=600`
    - `GET /youtube/config`: add `private, max-age=3600`

**Testing:**
- Extend existing test files to assert the `Cache-Control` header value on
  each modified route. Many tests already do this (e.g., `video.test.js`,
  `usage.test.js`, `icons.test.js`).

---

### Phase 2 — nginx configuration for backend reverse proxy

Update `scripts/nginx-app.conf.sample` with a complete API reverse-proxy
configuration that leverages `proxy_cache` for public media endpoints.

**New sections to add:**

```nginx
# ── API reverse proxy ──────────────────────────────────────────────────
#
# All /api/* requests are proxied to the lcyt-backend.
# Assumes backend is at http://127.0.0.1:3000.

upstream lcyt_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

# nginx proxy cache zone for public media (HLS segments, images, icons)
proxy_cache_path /var/cache/nginx/lcyt
    levels=1:2 keys_zone=lcyt_media:10m
    max_size=1g inactive=24h use_temp_path=off;

server {
    # ... existing SSL/root/location blocks ...

    # ── Immutable HLS segments ──────────────────────────────────────────
    # TS segments are content-addressed by sequence number — never change.
    location ~ ^/(stream-hls|radio)/[^/]+/[^/]+\.ts$ {
        proxy_pass http://lcyt_backend;
        proxy_cache lcyt_media;
        proxy_cache_valid 200 24h;
        proxy_cache_use_stale error timeout updating http_500 http_502;
        add_header X-Cache-Status $upstream_cache_status;
    }

    # ── HLS playlists (live, no cache) ──────────────────────────────────
    location ~ ^/(stream-hls|radio)/[^/]+/index\.m3u8$ {
        proxy_pass http://lcyt_backend;
        proxy_cache off;
        add_header Cache-Control "no-cache, no-store" always;
    }

    # ── VTT subtitle segments ───────────────────────────────────────────
    location ~ ^/video/[^/]+/subs/[^/]+/seg\d+\.vtt$ {
        proxy_pass http://lcyt_backend;
        proxy_cache lcyt_media;
        proxy_cache_valid 200 24h;
        add_header X-Cache-Status $upstream_cache_status;
    }

    # ── Public image/icon endpoints ─────────────────────────────────────
    location ~ ^/(images|icons)/\d+ {
        proxy_pass http://lcyt_backend;
        proxy_cache lcyt_media;
        proxy_cache_valid 200 24h;
        add_header X-Cache-Status $upstream_cache_status;
    }

    # ── Preview thumbnails ──────────────────────────────────────────────
    location ~ ^/preview/[^/]+/incoming {
        proxy_pass http://lcyt_backend;
        proxy_cache lcyt_media;
        proxy_cache_valid 200 5s;
        add_header X-Cache-Status $upstream_cache_status;
    }

    # ── SSE endpoints (no buffering) ────────────────────────────────────
    location ~ ^/(events|viewer/|stt/events|dsk/[^/]+/events) {
        proxy_pass http://lcyt_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # ── Default API proxy (no cache) ────────────────────────────────────
    location / {
        proxy_pass http://lcyt_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Key points:**
- `proxy_cache_path` creates a shared 1 GB on-disk cache for media.
- `proxy_cache_valid 200 24h` respects the backend `Cache-Control` but adds
  an nginx-level floor. Media with `max-age=86400` from the backend is also
  cached in nginx for 24h.
- `proxy_cache_use_stale` serves stale content during backend errors.
- `X-Cache-Status` header aids debugging (HIT/MISS/EXPIRED/STALE).
- SSE endpoints disable buffering and caching entirely.

---

### Phase 3 — NginxManager HLS segment caching fix

Currently `NginxManager._buildConfig()` sets `Cache-Control: no-cache, no-store`
on all proxied radio HLS locations. This is incorrect for immutable TS segments.

**File:** `packages/plugins/lcyt-rtmp/src/nginx-manager.js` (lines 220-228)

**Change:** Split the generated location into two — one for playlists, one
for segments:

```nginx
# Current (incorrect — caches nothing):
location /r/<slug>/ {
    proxy_pass http://mediamtx:8080/<apiKey>/;
    ...
    add_header Cache-Control "no-cache, no-store" always;
}

# Proposed (correct — cache segments, not playlists):
location ~ ^/r/<slug>/.*\.m3u8$ {
    proxy_pass http://mediamtx:8080/<apiKey>/;
    ...
    add_header Cache-Control "no-cache, no-store" always;
}

location ~ ^/r/<slug>/.*\.ts$ {
    proxy_pass http://mediamtx:8080/<apiKey>/;
    ...
    proxy_cache lcyt_media;
    proxy_cache_valid 200 24h;
    add_header Cache-Control "public, max-age=86400" always;
}

# Fallback for other files (init segments, etc.)
location /r/<slug>/ {
    proxy_pass http://mediamtx:8080/<apiKey>/;
    ...
    add_header Cache-Control "no-cache" always;
}
```

**Implementation detail:**
- Modify `_buildConfig()` to emit three location blocks per stream instead
  of one.
- Add a `proxy_cache_path` directive to the preamble of the generated config
  (the operator must include this in the `http {}` block or reference the zone
  from the sample config).
- Alternatively, rely on the operator's existing `proxy_cache_path` from the
  sample config and just reference the zone name.

**Testing:**
- Update `packages/plugins/lcyt-rtmp/test/nginx-manager.test.js` to verify
  the generated config contains separate playlist and segment location blocks
  with correct `Cache-Control` values.

---

### Phase 4 — Frontend in-memory request cache

Add a lightweight in-memory cache to `api.js` for GET requests that benefit
from client-side deduplication.

**File:** `packages/lcyt-web/src/lib/api.js`

**Design:**

```js
// New export alongside createApi:
export function createApi(senderRef, backendUrlRef) {
  const cache = new Map();  // path → { data, fetchedAt }

  async function request(path, opts) { /* existing */ }

  async function getCached(path, maxAgeMs = 30_000) {
    const entry = cache.get(path);
    if (entry && Date.now() - entry.fetchedAt < maxAgeMs) {
      return entry.data;
    }
    const data = await request(path);
    cache.set(path, { data, fetchedAt: Date.now() });
    return data;
  }

  function invalidate(pathOrPrefix) {
    for (const key of cache.keys()) {
      if (key === pathOrPrefix || key.startsWith(pathOrPrefix)) {
        cache.delete(key);
      }
    }
  }

  return {
    get:        (path) => request(path),
    getCached,
    invalidate,
    post:       (path, body) => request(path, { method: 'POST', body, parseErrorBody: true }),
    put:        (path, body) => request(path, { method: 'PUT', body, parseErrorBody: true }),
    del:        (path, opts) => request(path, { method: 'DELETE', ...opts }),
  };
}
```

**Usage in `useSession.js`:**

```js
// Before (every call is fresh):
const getSessionFeatures = useCallback(() => api.get('/features'), []);

// After (cached for 5 minutes, invalidated on feature change):
const getSessionFeatures = useCallback(() => api.getCached('/features', 300_000), []);
```

Endpoints to use `getCached`:
- `/features` → 300s
- `/stt/config` → 300s
- `/ai/config` → 300s
- `/youtube/config` → 3600s
- `/file/storage-config` → 300s
- `/ai/status` → 3600s
- `/agent/status` → 3600s
- `/dsk/:apikey/viewports/public` → 3600s (external fetch, not via api.js)

Call `api.invalidate(path)` after any PUT/POST/DELETE that changes the
cached resource.

**Testing:**
- Add unit tests in `packages/lcyt-web/test/api.test.js` for `getCached`
  and `invalidate`.

---

### Phase 5 — Preview thumbnail ETag

Add content-hash ETag support to the preview endpoint for bandwidth savings
on frequently-polled thumbnails.

**File:** `packages/plugins/lcyt-rtmp/src/routes/preview.js`

**Change:**
After fetching the thumbnail from `previewManager`, compute a weak ETag
from a fast hash (e.g., first+last 1 KB + length) and check `If-None-Match`.

```js
import { createHash } from 'node:crypto';

async function handleIncoming(req, res) {
  // ... existing fetch logic ...
  const buffer = await collectBuffer(coerced.stream);
  
  const etag = `W/"${createHash('md5').update(buffer).digest('hex')}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=2');
  
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}
```

**Trade-off:** Buffering the entire JPEG (~50-200 KB) to compute the hash.
Acceptable because preview thumbnails are small and the bandwidth savings
from 304 responses on 5-second polling intervals are significant.

**Testing:**
- Extend `preview-route.test.js` with ETag/304 tests.

---

### Phase 6 — Documentation and operator guide

1. Add a "Caching" section to the operator deployment runbook
   (`ops/runbooks/` or a new `docs/CACHING.md`) covering:
   - nginx proxy_cache setup
   - Cache zone sizing
   - How to monitor cache hit rates (`X-Cache-Status` header)
   - How to purge the cache
   - CDN (Cloudflare, CloudFront) configuration recommendations

2. Update `CLAUDE.md` to document the caching strategy and the new
   `api.getCached()` utility.

---

## Summary of changes by file

| File | Phase | Changes |
|---|---|---|
| `packages/lcyt-backend/src/server.js` | 1 | Cache-Control on `/health` |
| `packages/lcyt-backend/src/routes/icons.js` | 1 | Increase icon `max-age` to 86400 |
| `packages/lcyt-backend/src/routes/video.js` | 1 | Increase VTT segment `max-age` to 86400 |
| `packages/plugins/lcyt-files/src/routes/files.js` | 1 | Cache-Control on GET routes |
| `packages/plugins/lcyt-rtmp/src/routes/stream-hls.js` | 1 | Increase TS segment `max-age` to 86400 |
| `packages/plugins/lcyt-rtmp/src/routes/radio.js` | 1 | Increase TS segment `max-age` to 86400 |
| `packages/plugins/lcyt-rtmp/src/routes/preview.js` | 1, 5 | `max-age=2`, ETag support |
| `packages/plugins/lcyt-dsk/src/routes/dsk.js` | 1 | Cache-Control on public DSK endpoints |
| `packages/plugins/lcyt-cues/src/routes/cues.js` | 1 | Cache-Control on GET routes |
| `packages/plugins/lcyt-agent/src/routes/agent.js` | 1 | Cache-Control on GET routes |
| `packages/plugins/lcyt-agent/src/routes/ai.js` | 1 | Cache-Control on GET routes |
| Backend routes for `/features`, `/stt/config`, `/youtube/config` | 1 | Cache-Control on GET routes |
| `scripts/nginx-app.conf.sample` | 2 | Full API reverse proxy with proxy_cache |
| `packages/plugins/lcyt-rtmp/src/nginx-manager.js` | 3 | Split HLS proxy into playlist + segment locations |
| `packages/lcyt-web/src/lib/api.js` | 4 | `getCached()` + `invalidate()` |
| `packages/lcyt-web/src/hooks/useSession.js` | 4 | Use `getCached()` for config endpoints |
| `packages/plugins/lcyt-rtmp/src/routes/preview.js` | 5 | ETag computation + 304 support |
| `docs/` or `ops/runbooks/` | 6 | Caching operator guide |

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Stale feature flags hide newly enabled features | `stale-while-revalidate` ensures background refresh; explicit `invalidate()` on feature change |
| Cached file list doesn't show newly uploaded file | Short TTL (30s) + `invalidate('/file')` after upload |
| CDN caches `private` responses | Backend headers correctly use `private` for authenticated endpoints; CDN configs must honour this |
| nginx cache fills disk | `max_size=1g` limit in `proxy_cache_path`; `inactive=24h` auto-evicts cold entries |
| ETag computation overhead on preview | JPEG is small (50-200 KB); MD5 is fast; only computed on cache miss |
| Breaking existing clients that rely on `no-store` | All changes are additive (adding cache where there was none); clients that ignore `Cache-Control` are unaffected |
