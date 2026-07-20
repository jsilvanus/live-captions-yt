---
id: plan/broadcast_platform_sync
title: "Broadcast Platform Sync — YouTube Live Scheduling, Thumbnails & Stats (Facebook Live, deferred)"
status: draft
summary: "Implements plan_broadcasts.md's deferred 'Phase 2' (YouTube Live two-way sync) and goes further: server-side OAuth (replacing the browser-only implicit-token flow), scheduling a broadcast directly to YouTube from the broadcasts calendar, thumbnail upload, one-click go-live/end, and viewer stats at three tiers (live concurrent viewers, post-broadcast summary, historical trend). Designed as a generic multi-platform adapter (new lcyt-platforms plugin) so a second provider — Facebook Live, explicitly scoped but deferred — is a new adapter file, not a redesign. Supersedes the ad-hoc, non-persistent client-side flow in lcyt-web's youtubeAuth.js/youtubeApi.js/YouTubeTab.jsx."
related: plan/broadcasts, plan/broadcasts_next, plan/selfservice_config_backend, plan/metering_audit, plan/client
---

# Broadcast Platform Sync — YouTube Live Scheduling, Thumbnails & Stats

## Motivation

`plan_broadcasts.md` made **Broadcast** a first-class entity and explicitly laid
down data hooks for this exact feature — `broadcasts.youtube_broadcast_id`
(reserved), `broadcasts.youtube_video_ids` (populated today from the caption
sender's own response, not the Data API), and a status vocabulary chosen to map
onto YouTube's (`created→draft`, `ready→scheduled`, `testing`/`live→live`,
`complete→completed`) — then deferred the actual sync as "Phase 2, out of
scope." This plan **is** that Phase 2, extended per this round's request:
schedule a broadcast, set its thumbnail, go live, and gather viewing stats —
all from inside LCYT, tied to the `broadcasts` entity — for YouTube first, with
Facebook Live scoped as a deferred second provider.

### What already exists (don't re-build)

- **A working, but incomplete, YouTube Data API v3 client-side surface:**
  `packages/lcyt-web/src/lib/youtubeAuth.js` (Google Identity Services implicit
  token flow, `youtube` scope) and `youtubeApi.js` (`listScheduledBroadcasts`,
  `getLiveStream`, `transitionBroadcast`, `enableHttpCaptions`), consumed by a
  standalone `YouTubeTab.jsx` inside `/broadcast` — **disconnected from the
  `broadcasts` entity**, browser-only, token never persisted or refreshed.
  `GET /youtube/config` (`packages/lcyt-backend/src/routes/youtube.js`) just
  hands the browser `YOUTUBE_CLIENT_ID`.
- **Reserved schema on `broadcasts`** (`youtube_broadcast_id`,
  `youtube_video_ids`) and a status vocabulary designed for this sync.
- **`caption_targets`** (`type: 'youtube'`) holds a flat, manually-pasted
  `stream_key` — no link to an authenticated channel or a real
  `liveStreams`/`liveBroadcasts` resource, even though `getLiveStream()`
  already knows how to fetch a broadcast's real CDN stream key
  (`liveStreams?part=cdn` → `cdn.ingestionInfo.streamName`) — just nothing
  calls it into `caption_targets.stream_key` today.
- **No server-side OAuth anywhere in the repo.** The only Google auth patterns
  are the browser implicit-token flow above and a separate service-account
  JWT-bearer flow for Google Cloud STT (`googleCredential.js`) — neither holds
  a refresh token or runs server-side. `plan_mcp_oauth.md` is the opposite
  direction (LCYT as an OAuth *server*, not a *client*) — not reusable code,
  but its "don't build ahead of a concrete need" framing doesn't apply here:
  scheduling ahead of time, background thumbnail upload, and stats polling
  *require* a server-held, auto-refreshing token, since the operator's browser
  won't be open for all of it.
- **No stats/analytics integration exists at all** — LCYT's own
  `viewer_key_daily_stats`/`viewer_anon_daily_stats` count connections to
  LCYT's *own* `/viewer/:key` SSE broadcast, unrelated to YouTube's real
  concurrent-viewer/watch-time numbers. This part of the plan is greenfield.

## Scope decisions (this round)

1. **YouTube first, implemented fully; Facebook Live designed generically but
   deferred to its own future phase.** The adapter interface (§ Design) is
   shaped so Facebook is a new adapter module plus its own OAuth app
   registration, not a schema or API redesign.
2. **Stats cover three tiers**, all requested: live concurrent viewers (poll
   while a broadcast is live), a post-broadcast summary (views, average watch
   time, peak concurrent), and a historical trend stored per broadcast so it
   can be charted across a project's broadcast history.

## Design principle: a provider abstraction, not a YouTube-only feature

Everything platform-specific sits behind one adapter interface so Facebook
Live (or any future target) is additive:

```js
// packages/plugins/lcyt-platforms/src/adapters/base.js (interface, documented not enforced — plain JS)
{
  platform: 'youtube' | 'facebook',
  scopes: string[],                         // OAuth scopes requested
  buildAuthUrl(state, redirectUri): string,
  exchangeCode(code, redirectUri): { accessToken, refreshToken, expiresIn, externalAccountId, accountLabel },
  refreshAccessToken(refreshToken): { accessToken, expiresIn },
  listUpcoming(accessToken): [{ externalBroadcastId, title, scheduledStart, status }],
  createScheduled(accessToken, { title, description, scheduledStart }): { externalBroadcastId, externalStreamId, streamKey, ingestUrl },
  updateSchedule(accessToken, externalBroadcastId, { title, description, scheduledStart }): void,
  transition(accessToken, externalBroadcastId, 'live'|'complete'): { status },
  setThumbnail(accessToken, externalBroadcastId, imageBuffer, mimeType): { thumbnailUrl },
  getLiveStats(accessToken, externalBroadcastId): { concurrentViewers },
  getPostBroadcastStats(accessToken, externalBroadcastId): { views, averageWatchTimeSec, peakConcurrentViewers },
}
```

`packages/plugins/lcyt-platforms/src/adapters/youtube.js` implements this over
`googleapis`'s `youtube`/`youtubeAnalytics` v2 REST endpoints (or plain
`fetch()`, matching this repo's existing no-`googleapis`-dependency style in
`youtubeApi.js` — **decide at implementation time**; either is fine since the
surface is small). `facebook.js` is **not written in this plan** — see
"Facebook Live (deferred)" below for what it would need.

### Why a new plugin, not more routes in `lcyt-backend`

This is a self-contained subsystem (OAuth token lifecycle + encryption,
per-provider adapters, a background stats poller) with its own tables,
mirroring how `lcyt-connectors` (also "own credentials, own background
poller") is a plugin rather than living inline in `lcyt-backend`. New package
`packages/plugins/lcyt-platforms`, workspace member via the existing
`packages/plugins/*` glob, wired into `lcyt-backend/package.json` exactly like
`lcyt-connectors`:

```js
import { initPlatforms, createPlatformsRouter } from 'lcyt-platforms';
const { poller } = initPlatforms(db, { encryptionKey: process.env.PLATFORM_CREDENTIAL_KEY });
app.use('/platforms', createPlatformsRouter(db, auth, poller));
```

`init*()` runs the plugin's own migrations and starts the stats-poll
background loop (`setInterval` + `.unref()`, same pattern as
`lcyt-connectors`' `poll-scheduler.js`). `packages/lcyt-backend/src/routes/youtube.js`
(today just `GET /youtube/config`) is **absorbed**: its one route becomes
redundant once OAuth is server-side (§ OAuth flow), and is removed in favor of
`GET /platforms/youtube/oauth/start`.

## Schema (new tables, `lcyt-platforms`-owned)

```sql
-- One row per project × platform × connected account. A project can connect
-- at most one account per platform for now (v1) — multi-channel-per-project
-- is a natural follow-on, not built here.
CREATE TABLE IF NOT EXISTS platform_credentials (
  id                 TEXT PRIMARY KEY,               -- uuid
  api_key            TEXT NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
  platform           TEXT NOT NULL,                  -- 'youtube' | 'facebook'
  external_account_id TEXT NOT NULL,                 -- channel id / page id
  account_label      TEXT,                           -- channel name / page name, for display
  access_token_enc   TEXT NOT NULL,                  -- AES-256-GCM ciphertext, base64
  refresh_token_enc  TEXT NOT NULL,
  expires_at         TEXT NOT NULL,                  -- ISO; access token expiry
  scopes             TEXT,                           -- space-joined, as granted
  connected_at       TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at         TEXT,                            -- set on disconnect; row kept for audit, never hard-deleted
  UNIQUE(api_key, platform)
);
CREATE INDEX IF NOT EXISTS idx_platform_credentials_key ON platform_credentials(api_key);

-- Generalizes broadcasts.youtube_broadcast_id/youtube_video_ids to any
-- platform, without touching those existing columns (see "Relationship to
-- existing youtube_* columns" below).
CREATE TABLE IF NOT EXISTS broadcast_platform_links (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id          TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  platform              TEXT NOT NULL,
  external_broadcast_id TEXT NOT NULL,
  external_stream_id    TEXT,
  external_video_ids    TEXT,                        -- JSON array, captured on completion
  thumbnail_url         TEXT,
  last_status           TEXT,                        -- raw platform status string, informational
  last_synced_at        TEXT,
  last_sync_error       TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(broadcast_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_bpl_broadcast ON broadcast_platform_links(broadcast_id);

-- Stats snapshots — polled while live, plus one post-broadcast summary row.
-- Powers the live widget, the post-broadcast summary, and the historical
-- trend chart (query grouped by broadcast/platform over time).
CREATE TABLE IF NOT EXISTS broadcast_platform_stats (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id          TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  platform              TEXT NOT NULL,
  captured_at           TEXT NOT NULL DEFAULT (datetime('now')),
  kind                  TEXT NOT NULL,                -- 'live_snapshot' | 'post_broadcast_summary'
  concurrent_viewers    INTEGER,
  views                 INTEGER,
  average_watch_time_s  INTEGER,
  peak_concurrent_viewers INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bps_broadcast ON broadcast_platform_stats(broadcast_id, kind, captured_at);
```

### Relationship to existing `broadcasts.youtube_broadcast_id`/`youtube_video_ids`

Those columns stay exactly as-is — `youtube_video_ids` keeps being populated
from `completeBroadcast()`'s caption-sender-derived ids (that path is the
*caption ingestion* transport, unrelated to this plan's Data-API sync) and
`youtube_broadcast_id` stays reserved/unused by that path. This plan's
`broadcast_platform_links.external_broadcast_id`/`external_video_ids` are the
**new, generic, actually-wired-up** fields, additive alongside the old ones.
**Implementation-time task:** once `broadcast_platform_links` exists, decide
whether to also mirror `external_broadcast_id`/`external_video_ids` back onto
the legacy `broadcasts` columns for any UI that still reads them directly
(cheap, one extra write) — not a blocking design decision, just don't forget
to check every current reader of those two columns before assuming they're
dead.

### Encryption at rest — new infrastructure, flagged explicitly

No secrets-at-rest convention exists in this repo today (only `mcp_tokens`
hashes, which are one-way — not applicable to a refresh token that must be
decrypted to use). This plan needs a real one:

- New env var `PLATFORM_CREDENTIAL_KEY` (32-byte, base64) — analogous to
  `JWT_SECRET`: warn at startup if unset, and refuse to store a token
  unencrypted (fail closed, don't fall back to plaintext).
- AES-256-GCM, random IV per encryption, IV+ciphertext+authTag stored together
  (base64) in `access_token_enc`/`refresh_token_enc`.
- Document rotation as **not built in v1** (rotating `PLATFORM_CREDENTIAL_KEY`
  would need to re-encrypt every row) — call this out as a known limitation,
  same spirit as this repo's "additive, no destructive migrations" convention.

## OAuth flow (server-side, Authorization Code + refresh)

The existing GIS implicit flow cannot produce a refresh token, so background
work (scheduled thumbnail upload, stats polling, a schedule created while the
operator isn't in the browser) needs the standard server-side flow instead:

```
GET  /platforms/:platform/oauth/start     (Bearer session or project token)
       → redirect to provider's consent screen
         (YouTube: access_type=offline&prompt=consent to force a refresh token
          on every connect, since Google only issues one on first consent
          otherwise)
GET  /platforms/:platform/oauth/callback  (public, provider redirects here)
       → exchange code for { accessToken, refreshToken, expiresIn }
       → encrypt + upsert platform_credentials (UNIQUE(api_key, platform) —
         reconnecting replaces the row)
       → redirect back to the frontend Setup Hub with a success/error flag
POST /platforms/:platform/disconnect      (Bearer)
       → revoked_at = now; row kept (audit), no more auto-refresh attempted
```

New env vars (backend, alongside the existing `YOUTUBE_CLIENT_ID`):
`YOUTUBE_CLIENT_SECRET`, `PLATFORM_OAUTH_REDIRECT_BASE` (falls back to
`BACKEND_URL`). The `state` param carries the encoded `api_key` (signed, short
TTL) so the callback knows which project to attach credentials to without
relying on a client-held session across the redirect.

`refreshAccessToken()` runs lazily on any adapter call within a token-expiry
window, or from the stats poller's own interval — no separate refresh
scheduler needed at this scale.

## Broadcast lifecycle integration

New/changed `broadcasts` routes (in the new plugin's router, or thin
delegations added to `packages/lcyt-backend/src/routes/broadcasts.js` — **pick
one at implementation time**; either keeps routes-stay-thin, DB-access-in-`db/*`):

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/platforms` | List connected platforms for this project: `{ platform, accountLabel, connectedAt }[]` |
| `POST` | `/platforms/:platform/oauth/start` \| `GET .../callback` \| `POST .../disconnect` | See above |
| `POST` | `/broadcasts/:id/platforms/:platform/schedule` | Create (or update, if already linked) the external scheduled broadcast from this LCYT broadcast's title/description/schedule; writes `broadcast_platform_links` |
| `POST` | `/broadcasts/:id/platforms/:platform/thumbnail` | Upload an image (multipart or a `caption_files`/DSK-asset reference) → adapter `setThumbnail` |
| `POST` | `/broadcasts/:id/platforms/:platform/go-live` | `transition(..., 'live')`; on success, also binds/starts the LCYT session the same way `POST /live` with `broadcastId` does today, so "go live on YouTube" and "start captioning" are one action from the UI (two calls under the hood, not a new merged endpoint) |
| `POST` | `/broadcasts/:id/platforms/:platform/end` | `transition(..., 'complete')` |
| `GET` | `/broadcasts/:id/platforms/:platform/stats` | Latest snapshot + `?history=1` for the full `broadcast_platform_stats` series |

Auto-fill `caption_targets.stream_key`: `schedule` (or a small follow-up
"bind target" action) calls the adapter's stream-key lookup
(`getLiveStream`-equivalent) and offers to create/update the project's
`youtube` `caption_targets` row with the real CDN stream key — closing the
"connect the dots" gap the research identified (this capability already
exists in `youtubeApi.js`, just unwired).

## Stats gathering — three tiers, as scoped

1. **Live concurrent viewers.** While a broadcast's linked platform status is
   `live`, the poller (in `lcyt-platforms`, mirroring `lcyt-connectors`'
   `poll-scheduler.js` shape) calls `getLiveStats()` every N seconds (default
   30s, configurable), writes a `kind='live_snapshot'` row, and pushes the
   latest value onto the shared `EventBus` (`platform.stats_updated`) so a
   Production dashboard widget can show it live without polling the REST
   route itself — same delivery pattern as the existing `dsk.*`/`cue.*`
   topics.
2. **Post-broadcast summary.** On transition to `complete` (or on
   `completeBroadcast()` firing from the session-end path), fetch
   `getPostBroadcastStats()` once (YouTube: `youtubeAnalytics.googleapis.com`,
   scope `yt-analytics.readonly` — a **second OAuth scope** beyond the
   `youtube` scope used for scheduling/thumbnails; request both at connect
   time) and write a `kind='post_broadcast_summary'` row.
3. **Historical trend.** Falls out of (1)+(2) for free: `GET
   .../stats?history=1` returns the full time series per broadcast; a
   `broadcasts`-list-level rollup (e.g. peak/total per broadcast, charted
   across a project's broadcast history) is a `GROUP BY broadcast_id` query
   over `broadcast_platform_stats` — no new table needed beyond what's above.

## Frontend

- **Setup Hub — new "Broadcast Platforms" card**: connect/disconnect YouTube
  (shows channel name once connected), mirrors the existing MCP-access-card
  and Connectors-card visual pattern.
- **Broadcasts calendar/detail (`plan_broadcasts.md`'s `/broadcasts` UI)** —
  per-broadcast panel gains: "Schedule on YouTube" (only enabled once
  connected), a thumbnail upload/picker (reusing the DSK asset library or a
  plain file picker), "Go Live" / "End Stream" buttons once scheduled, and a
  live viewer-count readout while `live` (subscribed via `/events/stream`
  filtered to `platform.stats_updated`) plus the post-broadcast summary once
  `completed`.
- **`YouTubeTab.jsx`/`youtubeAuth.js`/`youtubeApi.js`** — retired once the
  above ships; their capability is superseded and folded into the broadcast
  detail page. Confirm nothing else still imports them before deleting
  (`grep -rn "youtubeApi\|youtubeAuth"` across `lcyt-web`) — the plan intends
  a clean replacement, not a second parallel path.
- **Historical trend chart** — a small per-broadcast (or project-level,
  across broadcasts) line/bar chart of concurrent viewers / total views over
  time, on the broadcast detail page or Assets page's Broadcasts card.

## Facebook Live (deferred — scoped, not implemented)

Facebook's Live Video API is structurally similar enough that the adapter
interface above should cover it without a redesign:

- OAuth: Facebook Login for Business, page-scoped token via
  `pages_show_list`/`pages_manage_posts`/`pages_read_engagement` (and
  `read_insights` for post-broadcast stats) — a different app registration
  and consent screen from Google's, but the same
  `buildAuthUrl`/`exchangeCode`/`refreshAccessToken` shape (Facebook page
  tokens are long-lived rather than classically refreshed — `refreshAccessToken`
  degrades to a no-op/re-exchange for this adapter, which the interface
  already allows since it's per-adapter behavior).
- Scheduling: `POST /{page-id}/live_videos` with
  `status=SCHEDULED_UNPUBLISHED` + `planned_start_time` → returns
  `stream_url`/`secure_stream_url` (the RTMP ingest URL analogous to a
  YouTube stream key).
- Thumbnail: `picture` param at creation, or `POST /{live_video_id}/thumbnails`.
- Go live / end: `POST /{live_video_id}` with `status=LIVE_NOW` /
  `status=STOPPED` — Facebook actually requires an RTMP publisher to be
  actively pushing before `LIVE_NOW` succeeds, unlike YouTube's
  broadcast/stream being independently bindable — a real adapter-level
  difference to design around when this phase is picked up, not just a field
  mapping.
- Stats: `GET /{live_video_id}?fields=live_views` while live; Video Insights
  (`total_video_views`, average watch time) post-broadcast needs
  `read_insights` and, practically, **Meta App Review** for the relevant
  permissions before any user outside the developer's own test roles can use
  it — this approval process is the actual long pole for a Facebook phase,
  independent of the code, and worth flagging to whoever picks this phase up
  so it isn't scoped as "a day of adapter work."

**Not building in this pass:** the `facebook.js` adapter, the Meta app
registration/review, and any Facebook-specific frontend. Revisit once
YouTube's version has shipped and proven the adapter shape holds.

## Security considerations

- Refresh tokens are the highest-value secret this plan introduces — encrypted
  at rest (above), never returned by any `GET` route (mask like
  `caption_targets`/`translation_vendor_config` already do for their secrets),
  and scoped per-project (`api_key`), never shared across projects.
- `oauth/callback` is unauthenticated by necessity (the provider redirects the
  browser there directly) — the signed `state` param is the only thing
  binding it back to a project; verify signature + short TTL, reject stale or
  tampered state rather than trusting a bare `api_key` query param.
- Disconnecting revokes locally (`revoked_at`) but should also call the
  provider's token-revocation endpoint where available (Google:
  `https://oauth2.googleapis.com/revoke`) so a disconnected LCYT project
  doesn't leave a live grant sitting in the user's Google account security
  settings — a real UX/trust expectation, not just internal bookkeeping.

## Resolved decisions

1. **YouTube first, Facebook deferred** — adapter interface designed for both,
   only YouTube's adapter is written now.
2. **Stats: all three tiers** — live concurrent viewers (poll + push while
   live), post-broadcast summary (one-shot on completion), historical trend
   (falls out of the stats table, no extra schema).
3. **New plugin (`lcyt-platforms`)**, not inline `lcyt-backend` routes —
   matches the existing pattern for self-contained credential+poller
   subsystems (`lcyt-connectors`).
4. **Existing `broadcasts.youtube_broadcast_id`/`youtube_video_ids` columns
   are left untouched**; the new `broadcast_platform_links` table is additive
   and generic. No migration of old data is required for v1.

## Open questions (flag before implementation)

- Multi-channel-per-project (`UNIQUE(api_key, platform)` currently caps it at
  one connected account per platform) — fine for v1, but confirm this matches
  how orgs with multiple YouTube channels per project actually operate before
  building.
- Where exactly the new routes are mounted (new plugin router vs. thin
  delegation from `routes/broadcasts.js`) — either is consistent with repo
  convention; pick based on how much the plugin needs direct access to
  `broadcasts` DB helpers vs. calling them through an injected interface.
- `googleapis` npm dependency vs. continuing this repo's plain-`fetch()` style
  for the new server-side calls — the existing `youtubeApi.js` deliberately
  has no such dependency; server-side Analytics API calls are a similar
  surface area either way.

## Out of scope (this plan)

- Facebook Live implementation (adapter, app review, frontend) — scoped above,
  deferred.
- Multi-channel-per-project support.
- Recurrence-aware scheduling sync (ties into `plan_broadcasts.md`'s own
  deferred recurrence item).
- Encryption-key rotation tooling for `PLATFORM_CREDENTIAL_KEY`.
- Automated pre-broadcast checks (e.g. "thumbnail missing, schedule not
  confirmed on YouTube yet") — a natural follow-on once this lands, same as
  `plan_broadcasts.md`'s own deferred item of the same shape.
