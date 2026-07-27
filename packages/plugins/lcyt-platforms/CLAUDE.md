# `packages/plugins/lcyt-platforms` — Broadcast Platform Sync (v0.1.0)

Server-side OAuth, scheduling, thumbnails, go-live/end and viewer stats for external streaming platforms, tied to the `broadcasts` entity. **YouTube is fully implemented; Facebook Live exists only as a non-wired adapter skeleton.**

Implements `docs/plans/plan_broadcast_platform_sync.md` (sequenced by `docs/plans/plan_broadcast_platform_sync_phases.md`) — the "Phase 2 YouTube two-way sync" that `plan_broadcasts.md` explicitly deferred.

**Entry:** `src/api.js` — `initPlatforms(db, opts)`, `createOAuthRouter()`, `createBroadcastPlatformsRouter()`.

---

## What this replaced

The browser-only surface it supersedes is **gone**, not deprecated: `lcyt-web/src/lib/youtubeAuth.js`, `lcyt-web/src/lib/youtubeApi.js`, `lcyt-web/src/components/broadcast/YouTubeTab.jsx`, and `lcyt-backend/src/routes/youtube.js` (`GET /youtube/config`). That flow used Google Identity Services implicit tokens, which **cannot produce a refresh token** — so scheduling ahead of time, background thumbnail upload, and stats polling were all impossible once the operator's tab closed. Everything here runs server-side against an encrypted, auto-refreshing credential.

One capability from the old code was deliberately carried forward rather than dropped: `youtubeApi.js#enableHttpCaptions` set `contentDetails.closedCaptionsType = 'closedCaptionsHttpPost'`, without which YouTube rejects LCYT's caption POSTs entirely. The YouTube adapter now sets it at broadcast-creation time instead of leaving it as a separate step an operator must remember.

---

## Source files

| File | Purpose |
|---|---|
| `src/api.js` | `initPlatforms()` — migrations, token service, stats poller. Re-exports everything below. |
| `src/crypto.js` | AES-256-GCM secrets-at-rest. **The repo's first real one** — `mcp_tokens` stores one-way hashes, useless for a refresh token that must be decrypted to be used. |
| `src/db.js` | Migrations + CRUD for the three tables. `maskCredential()` is the only shape a route may return. |
| `src/oauth-state.js` | HMAC-signed, short-TTL `state` param. The **only** thing binding an unauthenticated callback to a project. |
| `src/token-service.js` | Lazy access-token refresh, single in-flight per credential, `CredentialUnusableError`. |
| `src/stats-poller.js` | One interval sweeping live links; quota back-off; re-reads work from the DB each tick. |
| `src/adapters/base.js` | The documented interface + `assertAdapterShape()` + `expiryFromNow()`. |
| `src/adapters/youtube.js` | Data API v3 + Analytics v2 over plain `fetch()`. No `googleapis` dependency. |
| `src/adapters/facebook.js` | **Skeleton, not wired.** Every method throws `NotImplementedError`. |
| `src/adapters/index.js` | Registry. Registers `youtube` only — `facebook` is deliberately absent, so no route can reach it. |
| `src/routes/oauth.js` | `/platforms` list, `oauth/start`, `oauth/callback`, `disconnect`. |
| `src/routes/broadcast-platforms.js` | Per-broadcast schedule/thumbnail/go-live/end/stats. |
| `src/routes/helpers.js` | `requireApiKey`, `requireAdapter`, `resolveCredential`, `respondToPlatformError`. |

---

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `PLATFORM_CREDENTIAL_KEY` | Base64 32-byte AES-256-GCM key encrypting OAuth tokens at rest. Tier A (env-only) alongside `JWT_SECRET` because it decrypts refresh tokens. | none |
| `YOUTUBE_CLIENT_ID` | Google OAuth 2.0 Web client ID. | none |
| `YOUTUBE_CLIENT_SECRET` | Google OAuth 2.0 client secret. **New requirement** — the retired implicit flow needed none. | none |
| `PLATFORM_OAUTH_REDIRECT_BASE` | Base URL the callback is reached at; must match the provider registration exactly. Falls back to `BACKEND_URL`, then `PUBLIC_URL`. | (falls back) |
| `PLATFORM_STATS_POLL_INTERVAL_S` | Live viewer-count poll interval. Floored at 5s. | 30 |

**Fail-closed, and only this far.** An unset `PLATFORM_CREDENTIAL_KEY` warns at startup and makes the credential *write* path refuse — there is deliberately no plaintext fallback. The server still boots and serves everything else; only platform connection is unavailable. `GET /platforms` reports `credentialStorageAvailable: false` so the UI can explain why rather than failing at the first attempt.

**Key rotation is not built (known limitation, v1).** Changing `PLATFORM_CREDENTIAL_KEY` invalidates every stored credential and operators must reconnect. `token-service.js` detects this specifically and returns `CredentialUnusableError` with `reason: 'undecryptable'` naming the likely cause.

---

## Tables

```
platform_credentials      id, api_key→api_keys(key), platform, external_account_id,
                          account_label, access_token_enc, refresh_token_enc,
                          expires_at, scopes, connected_at, revoked_at
                          UNIQUE (api_key, platform, external_account_id)

broadcast_platform_links  id, broadcast_id→broadcasts(id), platform, credential_id,
                          external_broadcast_id, external_stream_id, external_video_ids,
                          thumbnail_url, last_status, last_synced_at, last_sync_error
                          UNIQUE (broadcast_id, platform)

broadcast_platform_stats  id, broadcast_id, platform, captured_at,
                          kind ('live_snapshot' | 'post_broadcast_summary'),
                          concurrent_viewers, views, average_watch_time_s,
                          peak_concurrent_viewers
```

**Multi-channel is real.** The source plan proposed `UNIQUE(api_key, platform)`; what shipped is `UNIQUE(api_key, platform, external_account_id)`, so a project can connect several YouTube channels. Reconnecting the *same* channel replaces its row; connecting a *different* one adds. `broadcast_platform_links.credential_id` records which account scheduled a link, so a later poll or transition uses that same channel even after the project connects others.

`initPlatforms()` **must run after** lcyt-backend's core schema migrations — these tables carry real foreign keys onto `api_keys` and `broadcasts`, and this install enforces them (`PRAGMA foreign_keys` is on by default in better-sqlite3).

Revocation is a **soft delete** (`revoked_at`); rows are kept for audit and never hard-deleted.

---

## API routes

```
GET  /platforms                            list connected accounts, masked; several per platform is normal
GET  /platforms/:platform/oauth/start      → { url } to navigate the top-level window to
GET  /platforms/:platform/oauth/callback   PUBLIC by necessity — the provider redirects the browser here
POST /platforms/:platform/disconnect       { credentialId } required; no implicit "the only one"

GET  /broadcasts/:id/platforms                        this broadcast's links
POST /broadcasts/:id/platforms/:platform/schedule     create or update the external broadcast; binds the stream key
POST /broadcasts/:id/platforms/:platform/thumbnail    { data: base64, mimeType } — PNG/JPEG, ≤2 MB
POST /broadcasts/:id/platforms/:platform/go-live      transition to live
POST /broadcasts/:id/platforms/:platform/end          transition to complete + capture the summary
GET  /broadcasts/:id/platforms/:platform/stats        latest + summary; ?history=1 for the full series
```

Every per-broadcast route takes an optional `credentialId`. Omitted, it resolves only when the project has exactly one live account; with several, the response is **409 `ambiguous_credential`** carrying the candidate list — enough for a client to render a picker without a second round-trip.

### Error-code contract

`respondToPlatformError()` collapses three distinct situations that would otherwise all read as 500:

| Code | Status | Meaning |
|---|---|---|
| `not_connected` | 409 | No account connected for this platform |
| `ambiguous_credential` | 409 | Several accounts; caller must name one (`candidates` included) |
| `credential_unusable` | 409 | Reconnect required (`reason`: `revoked`, `grant_revoked`, `undecryptable`, `missing`) |
| `not_linked` | 409 | Schedule the broadcast on the platform first |
| `quotaExceeded` / `rateLimitExceeded` | 403 | Provider quota — the poller backs off on these |
| (other upstream) | 502 | Provider rejected the request |

---

## Design notes worth knowing

- **Thumbnails are base64 in a JSON body**, matching `lcyt-backend/src/routes/icons.js`. There is no multipart handling anywhere in `lcyt-backend`, and this plan was not the place to add a `multer` dependency for one endpoint.
- **`schedule` mirrors `external_broadcast_id` onto the legacy `broadcasts.youtube_broadcast_id`.** That column is *not* dead: `db/broadcasts.js` surfaces it as `youtubeBroadcastId` via `formatRow()`, and the broadcasts routes accept it on create and update. A mirroring failure is logged, not fatal — `broadcast_platform_links` is authoritative.
- **`go-live` reports partial success.** If the platform transition succeeds but the caption session does not start, the response says so (`partial: true` + `warning`) rather than 500ing — the transition cannot be undone, so "nothing happened" would be the wrong story. In the default deployment `startSession` is not wired at all (the frontend makes the second call itself), and the response then omits `captionSessionStarted` entirely rather than asserting a failure that never happened.
- **Peak concurrent viewers are derived from our own snapshots.** YouTube Analytics exposes no peak-concurrent metric. Analytics is also batch-processed, so a summary fetched seconds after a stream ends can legitimately come back empty — the row is written anyway, carrying the peak we already measured.
- **Live viewer counts come from the Data API, not Analytics** (`videos?part=liveStreamingDetails`). Analytics lags by hours and is useless while live. A missing `concurrentViewers` reads as `null`, never `0` — "not live" and "nobody watching" are different facts.
- **The stats poller self-heals.** It re-reads `listLiveLinks()` every tick rather than closing over a list, so a broadcast that ends or is deleted drops out on its own with no deregistration step anywhere. Same shape as `lcyt-connectors`' `poll-scheduler.js`.
- **The stream-key binding never silently overwrites.** After a successful schedule it creates a `youtube` `caption_targets` row when none exists; when one already exists it reports what it *would* bind and waits for an explicit `bindStreamKey: true`, so a key the operator pasted by hand is never clobbered.

## Event topics

Published on the shared `EventBus` (registered in `lcyt-backend/src/routes/events-catalog.js` as `platform.*`):

| Topic | Payload |
|---|---|
| `platform.stats_updated` | `{ broadcastId, platform, concurrentViewers, capturedAt }` — every poll while live |
| `platform.status_changed` | `{ broadcastId, platform, status }` — on go-live and end |

The frontend subscribes via `/events/stream` rather than polling the stats route, so the UI is not polling the backend that is already polling YouTube.

---

## Facebook Live (deferred)

`src/adapters/facebook.js` implements the full interface and throws on every call. It is **not registered**, so `/platforms/facebook/*` returns a clean 404. It exists only to prove `base.js` generalises past YouTube.

Two structural differences an implementer must design around, recorded in the file header: page access tokens are long-lived rather than classically refreshed (so `refreshAccessToken` degrades to a re-exchange), and `LIVE_NOW` requires an RTMP publisher to already be pushing, unlike YouTube's independently bindable broadcast/stream.

**The real long pole is Meta App Review**, not this file — `read_insights` and the pages permissions need approval before anyone outside the developer's own test roles can use the integration. Budget for that independently of the code.

---

## Test coverage

`npm test -w packages/plugins/lcyt-platforms` — **185 tests**, `node:test`, no live API calls ever.

| File | Covers |
|---|---|
| `test/crypto.test.js` | Round-trip, IV freshness, wrong key, tampered ciphertext, truncation, every fail-closed key path |
| `test/db.test.js` | Migration idempotency, the two-channel case, same-channel reconnect replacing not duplicating, project scoping, the masking guarantee |
| `test/adapters.test.js` | `assertAdapterShape`, registry (facebook unregistered), the Facebook skeleton conforming while throwing |
| `test/youtube-adapter.test.js` | **Every request's method, host, path, query params and body**, pinned against the published API reference |
| `test/oauth-state.test.js` | Forged/expired/cross-platform state, URL-safety, constant-time comparison |
| `test/token-service.test.js` | Refresh skew, single in-flight under concurrency, every `CredentialUnusableError` reason |
| `test/oauth-routes.test.js` | Multi-channel add-vs-replace, cross-project isolation, no ciphertext in any response |
| `test/stats-poller.test.js` | Snapshot recording, quota back-off + cooldown + resume, per-link error isolation, interval flooring |
| `test/broadcast-platforms-routes.test.js` | Full lifecycle against a fake adapter; partial go-live; stream-key binding rules; ambiguity contract |

**Why the YouTube adapter tests are so specific:** per the resolved decisions, development made no live API calls at all. Those assertions are the only thing standing between a typo and a failure that would first surface in post-merge smoke testing. Adapter logic is kept free of business rules so a real-API correction stays a one-file edit.

**Gap:** no test exercises a real OAuth round-trip or a real YouTube response — by design, and the reason a real-channel smoke test is still owed before this is trusted in production.

---

See root `CLAUDE.md` for the Plugin Architecture conventions, and `packages/lcyt-backend/CLAUDE.md` for how this plugin is wired into the composition root.
