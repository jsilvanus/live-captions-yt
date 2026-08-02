---
id: plan/broadcast_platform_sync_phases
title: "Phase Plan — Broadcast Platform Sync (lcyt-platforms)"
status: implemented
summary: "Executable phase plan for plan_broadcast_platform_sync.md. 7 phases (0–6). Critical path runs through the plugin foundation (schema + crypto), the YouTube adapter, the OAuth token lifecycle, then the per-broadcast lifecycle routes, backend wiring, frontend replacement, and docs. Multi-channel-per-project is threaded from Phase 0 onward per the resolved decisions, not retrofitted."
related: plan/broadcast_platform_sync, plan/broadcasts, plan/api_connectors_variables
---

# Phase Plan: Broadcast Platform Sync — `lcyt-platforms`

## Overview

Seven phases (0–6) implementing `docs/plans/plan_broadcast_platform_sync.md`
under its four resolved decisions. The critical path is
**foundation → adapter → OAuth → lifecycle routes → wiring → frontend**;
docs and the legacy-surface deletion trail behind it.

Two things shape the ordering:

1. **Multi-channel is threaded from Phase 0, never retrofitted.** Decision #1
   turns a credential from a singleton-per-`(api_key, platform)` into a
   selectable entity. Every downstream signature — DB helper, route param,
   poller key, React prop — carries a `credentialId`. Retrofitting that after
   the routes exist would touch every file twice, so the credential-selector
   shape is fixed in Phase 0's schema and Phase 1's adapter-call boundary and
   never revisited.
2. **The riskiest work is unverifiable, so it moves early and gets pinned by
   tests.** Decision #4 means no live YouTube call ever happens during this
   build. The YouTube adapter's request shapes are therefore the single
   highest-risk artifact in the plan — wrong shapes fail only in the owner's
   post-merge smoke test. Phase 1 builds the adapter first and pins every
   request (method, URL, query params, body) with stubbed-`fetch` assertions
   written directly against the published Data API v3 / Analytics v2 contracts,
   so a later real-API mismatch is a one-file fix, not a redesign.

**Grounding — what the research confirmed.** `lcyt-connectors` is the template
in every respect that matters: `src/api.js` exporting `initConnectors(db, opts)`
+ `create*Router(db, auth, …)`, `src/db.js` owning `runMigrations(db)` with
`CREATE TABLE IF NOT EXISTS` plus `try { ALTER TABLE … } catch {}` for additive
columns, `src/poll-scheduler.js` as the background-loop shape (a `Map` of
handles, `restore()` on startup, self-healing by re-reading the DB each tick),
and `routes/*.js` masking secrets before they reach the client. Two useful
findings beyond the plan's own research:

- **No `multer` and no multipart handling exists anywhere in `lcyt-backend`.**
  `routes/icons.js` accepts images as base64 in a JSON body against a MIME
  allowlist. Thumbnail upload follows that existing convention rather than
  adding a multipart dependency — this settles the plan's "multipart or a
  `caption_files`/DSK-asset reference" open phrasing in favour of
  **base64 JSON body OR an asset reference**, no new dependency.
- **The legacy `youtube_broadcast_id` column is genuinely live, not dead.**
  `db/broadcasts.js:45` surfaces it as `youtubeBroadcastId` through
  `formatRow()`, and `routes/broadcasts.js` accepts it on both create and
  update. The plan's "check every current reader before assuming they're dead"
  task therefore resolves to **yes, mirror it** — Phase 3 writes
  `external_broadcast_id` back to the legacy column on link creation.

### Dependency map

```
Phase 0  foundation (pkg + crypto + schema + db helpers)
   │
   ├──────────────┬────────────────────┐
   ▼              ▼                    ▼
Phase 1        (Ph1 Stream C)     Phase 4 partial
adapters       facebook.js        settings registry entries
   │            skeleton          (can land any time ≥ Ph0)
   ▼
Phase 2  OAuth lifecycle (start/callback/disconnect/refresh)
   │
   ▼
Phase 3  lifecycle routes + stats poller + EventBus topic
   │
   ▼
Phase 4  backend wiring (server.js, delete routes/youtube.js)
   │
   ▼
Phase 5  frontend (Setup Hub card, broadcast panel, delete legacy surface)
   │
   ▼
Phase 6  docs, CLAUDE.md, PLANS.md, test-coverage sweep
```

---

## Phase 0: Plugin foundation

**Mode:** Sequential
**Depends on:** none
**Goal:** `lcyt-platforms` is a resolvable workspace package whose migrations
create all three tables on a fresh DB, and whose crypto module round-trips a
token and fails closed without a key.

Minimal by design — just enough to unblock Phase 1's parallel streams. No
routes, no adapters, no wiring into `server.js` yet.

1. **Scaffold the package** — `packages/plugins/lcyt-platforms/` with
   `package.json` (name `lcyt-platforms`, `"type": "module"`, `main: src/api.js`,
   `"test": "node --test test/*.test.js"`, deps `express`), mirroring
   `lcyt-connectors/package.json` field-for-field including the `repository.directory`
   entry. Run `npm install` at repo root so the workspace symlink exists —
   nothing else can `import 'lcyt-platforms'` until this lands.
2. **`src/crypto.js`** — AES-256-GCM. `encryptSecret(plaintext, key)` →
   base64 of `IV(12) || ciphertext || authTag(16)`; `decryptSecret(blob, key)`
   inverse. `loadCredentialKey()` reads `PLATFORM_CREDENTIAL_KEY`, validates it
   decodes to exactly 32 bytes, and **throws** rather than returning null —
   fail closed per the plan, never a plaintext fallback. Must come before
   `db.js` because the credential write path calls into it.
3. **`src/db.js` — `runMigrations(db)`** — the three tables, with decision #1's
   change applied: `platform_credentials` gets
   `UNIQUE(api_key, platform, external_account_id)`, **not**
   `UNIQUE(api_key, platform)`. Add `credential_id` to `broadcast_platform_links`
   (`REFERENCES platform_credentials(id)`) so a link records which account it was
   created under, and keep `UNIQUE(broadcast_id, platform)` — one link per
   broadcast per platform is still right; it's the *account behind it* that's
   now selectable.
4. **`src/db.js` — CRUD helpers** — `listCredentials`, `getCredential`,
   `upsertCredential`, `revokeCredential`, `maskCredential` (never emits
   `access_token_enc`/`refresh_token_enc` — the `maskConnector()` idiom),
   plus link and stats helpers. `getDefaultCredential(db, apiKey, platform)`
   resolves the single-account common case so callers may omit `credentialId`
   when exactly one live account exists, and errors unambiguously when several do.

**Sync point:** `npm test -w packages/plugins/lcyt-platforms` passes with a
migrations test (all three tables + indexes exist on a fresh in-memory DB,
`runMigrations` is idempotent across two calls) and a crypto test (round-trip;
wrong key fails; tampered ciphertext fails the auth tag; missing/short key
throws). `import('lcyt-platforms')` resolves from `lcyt-backend`.

---

## Phase 1: Adapters

**Mode:** Parallel (3 streams)
**Depends on:** Phase 0
**Goal:** A documented adapter interface, a complete YouTube implementation
whose every outbound request is pinned by a test, and a non-wired Facebook
skeleton proving the interface generalises.

These three streams share no files and no outputs — A defines the contract in
prose/JSDoc, B and C implement against it independently.

**Stream A — `src/adapters/base.js`**
- The interface from the plan as JSDoc typedefs + a `assertAdapterShape(adapter)`
  helper that checks every required method exists (documented-not-enforced, per
  the plan's plain-JS style, but cheap to assert in tests).
- `src/adapters/index.js` registry: `getAdapter(platform)`. Registers **only**
  `youtube` — `facebook` is deliberately absent per decision #3.

**Stream B — `src/adapters/youtube.js`** (the critical-path stream)
- Plain `fetch()`, no `googleapis`. All calls go through one small
  `ytFetch(accessToken, url, opts)` helper that attaches the bearer token and
  maps non-2xx responses onto the repo's `NetworkError` with `statusCode`.
- `buildAuthUrl` — `accounts.google.com/o/oauth2/v2/auth` with
  `access_type=offline&prompt=consent`, scopes
  `https://www.googleapis.com/auth/youtube` +
  `https://www.googleapis.com/auth/yt-analytics.readonly` (both requested at
  connect time, per the plan's stats tier 2).
- `exchangeCode` / `refreshAccessToken` — `oauth2.googleapis.com/token`.
- `externalAccountId`/`accountLabel` from `youtube/v3/channels?part=snippet&mine=true`.
- `listUpcoming`, `createScheduled` (`liveBroadcasts.insert` +
  `liveStreams.insert` + `liveBroadcasts.bind`), `updateSchedule`,
  `transition`, `setThumbnail` (`thumbnails.set`, upload endpoint),
  `getLiveStats` (`videos?part=liveStreamingDetails` →
  `concurrentViewers`), `getPostBroadcastStats` (`youtubeAnalytics/v2/reports`).
- `getStreamKey(accessToken, externalStreamId)` → `cdn.ingestionInfo.streamName`
  — the capability `youtubeApi.js` already had and nothing called; Phase 3 wires
  it into `caption_targets`.

**Stream C — `src/adapters/facebook.js`**
- Full interface surface, every method `throw new Error('facebook adapter not
  implemented — see plan_broadcast_platform_sync.md §Facebook Live (deferred)')`
  with a `TODO` naming the specific Graph API endpoint it would call.
- Carries the plan's two real adapter-level warnings as comments: page tokens
  are long-lived rather than refreshed (so `refreshAccessToken` degrades to a
  re-exchange), and `LIVE_NOW` requires an active RTMP publisher, unlike
  YouTube's independently bindable broadcast/stream.
- **Not** added to the registry.

**Sync point:** Stream B's test file asserts the exact method, URL, query
string, and JSON body of every YouTube request against a stubbed `fetch`, plus
error mapping for a 401 and a 403-quota response. Stream C passes
`assertAdapterShape` while every method throws. No live network call occurs in
any test.

---

## Phase 2: OAuth lifecycle

**Mode:** Sequential
**Depends on:** Phase 0 (crypto, credential helpers), Phase 1 Streams A+B
**Goal:** A project can connect *several* YouTube channels, tokens are stored
encrypted, and any adapter call transparently gets a fresh access token.

Sequential because each step consumes the previous one's output: state signing
gates the callback, the callback gates having a stored credential, and the
stored credential gates the refresh path.

1. **`src/oauth-state.js`** — sign/verify the `state` param (HMAC over
   `{ apiKey, platform, nonce, exp }` using `JWT_SECRET`, 10-minute TTL).
   Verification rejects a bad signature, an expired token, and a platform
   mismatch. The callback is unauthenticated by necessity, so this is the only
   thing binding it to a project — it must exist before the callback route.
2. **`src/token-service.js`** — `getAccessToken(db, credentialId)`: decrypt,
   return as-is when >60s of life remains, otherwise call
   `refreshAccessToken`, re-encrypt, persist the new expiry, return. Single
   in-flight refresh per credential (a `Map<credentialId, Promise>`) so a
   poller tick and an operator action can't double-refresh. Refuses a
   `revoked_at` credential.
3. **`src/routes/oauth.js`** — `GET /platforms/:platform/oauth/start`
   (authenticated, accepts an optional `label`), `GET /platforms/:platform/oauth/callback`
   (public; verify state → `exchangeCode` → fetch channel identity → encrypt →
   upsert on `(api_key, platform, external_account_id)` → redirect to the Setup
   Hub with a success/error flag), `POST /platforms/:platform/disconnect`
   (body `{ credentialId }`; call Google's `oauth2.googleapis.com/revoke`,
   then set `revoked_at`; a failed remote revoke still records the local
   revocation but reports the partial failure rather than claiming clean
   success).
4. **`GET /platforms`** — list connected accounts,
   `{ platform, credentialId, accountLabel, externalAccountId, connectedAt, revokedAt }[]`,
   masked. Multiple rows per platform is now the normal case, not an error.

**Sync point:** Route tests cover — connecting two distinct channels to one
project yields two live credentials (the decision-#1 regression guard);
reconnecting the *same* channel replaces its row rather than duplicating;
a tampered, expired, or cross-platform `state` is rejected; no `GET` response
anywhere contains a token or ciphertext; an expired access token triggers
exactly one refresh under concurrent callers.

---

## Phase 3: Broadcast lifecycle + stats

**Mode:** Parallel (3 streams) after a sequential prelude
**Depends on:** Phase 2
**Goal:** Every per-broadcast platform action works end to end against a fake
adapter, and stats land in the DB and on the EventBus.

**Prelude (sequential, gates all three streams):** define the injected
`broadcastsApi` interface — the plugin never imports `lcyt-backend/src/db/*`
directly (the recorded implementer's-discretion call), so
`createPlatformsRouter(db, auth, { adapters, broadcastsApi, captionTargetsApi, eventBus, poller })`
receives `getBroadcast`/`updateBroadcast`/`completeBroadcast` and the
caption-target helpers as functions. Both streams A and B call through it, so
its shape must be fixed first.

**Stream A — scheduling, thumbnail, transitions**
- `POST /broadcasts/:id/platforms/:platform/schedule` — create or update the
  external broadcast from the LCYT broadcast's title/description/scheduled_start;
  write `broadcast_platform_links` including `credential_id`; mirror
  `external_broadcast_id` onto the legacy `broadcasts.youtube_broadcast_id`
  (the research above confirmed live readers).
- `POST …/thumbnail` — base64 JSON body (`{ data, mimeType }`, MIME allowlist,
  size cap) **or** `{ assetRef }` resolving through the existing file/asset
  layer; follows `routes/icons.js`, adds no multipart dependency.
- `POST …/go-live` and `POST …/end` — `transition()`, then update
  `last_status`. Go-live additionally triggers the LCYT session start the same
  way `POST /live` with a `broadcastId` does — **two calls under the hood, not a
  new merged endpoint**, exactly as the plan specifies.
- Every route accepts an optional `credentialId`, defaulting via
  `getDefaultCredential` when the project has exactly one live account for that
  platform.

**Stream B — caption-target stream-key binding**
- After a successful `schedule`, call the adapter's `getStreamKey()` and
  create-or-update the project's `youtube` `caption_targets` row with the real
  CDN stream key, closing the gap the plan identified.
- Deliberately **not** silent: returns what it bound so the UI can say so, and
  never overwrites a manually-entered key without an explicit
  `bindStreamKey: true`.

**Stream C — stats poller + EventBus**
- `src/stats-poller.js` mirroring `poll-scheduler.js`: `Map` of handles,
  `restore()` on startup, re-reads its target from the DB each tick (self-healing
  on a deleted broadcast), `setInterval(...).unref()`, floor on the interval so
  a misconfiguration can't hammer the API.
- Writes `kind='live_snapshot'` rows while a link's `last_status` is `live`;
  publishes `platform.stats_updated` on the shared `EventBus` and registers the
  topic in `routes/events-catalog.js` alongside `dsk.*`/`cue.fired`.
- On transition to `complete` (route path *and* the `completeBroadcast()`
  session-end path), fetch `getPostBroadcastStats()` once and write the
  `kind='post_broadcast_summary'` row.
- `GET /broadcasts/:id/platforms/:platform/stats` — latest snapshot, plus
  `?history=1` for the full series (tier 3 falls out of this for free).

**Sync point:** A fake adapter drives every route through a full lifecycle —
schedule → thumbnail → go-live → live snapshots → end → summary — asserting DB
rows and emitted events at each step. Quota-failure and expired-token paths are
covered. The poller stops itself when a broadcast is deleted mid-flight.

---

## Phase 4: Backend wiring

**Mode:** Sequential
**Depends on:** Phase 3
**Goal:** The plugin is live in `server.js`; `routes/youtube.js` is gone; every
new setting is registered.

Sequential and deliberately small — this is the phase where the app either
boots or doesn't, and each step's failure mode is distinct.

1. **Settings registry** (`packages/lcyt-backend/src/settings/registry.js`) —
   add `bootstrap.platform_credential_key` (`PLATFORM_CREDENTIAL_KEY`, Tier A,
   `secret: true` — it decrypts refresh tokens, so it belongs beside
   `JWT_SECRET`, never DB-writable), `app.youtube_client_secret`
   (`YOUTUBE_CLIENT_SECRET`, secret), `app.platform_oauth_redirect_base`
   (`PLATFORM_OAUTH_REDIRECT_BASE`, falling back to the existing backend URL),
   and `app.platform_stats_poll_interval_s` (default 30, `apply: 'timer'`).
   Update the `app.youtube_client_id` description — it no longer feeds a
   removed `GET /youtube/config`.
2. **Wire into `server.js`** — `initPlatforms(db, { encryptionKey, eventBus })`
   beside the other `init*()` calls; mount
   `app.use('/platforms', createPlatformsRouter(db, scopedAuth('platform'), …))`.
   Startup warns (not throws) when `PLATFORM_CREDENTIAL_KEY` is unset, and the
   credential write path is what actually refuses — a server with no key still
   boots and serves everything else.
3. **Delete `packages/lcyt-backend/src/routes/youtube.js`** and
   `test/youtube.test.js`, and remove their `server.js` registration. Its single
   route is redundant once OAuth is server-side.

**Sync point:** `npm test` green across all packages; the backend boots both
with and without `PLATFORM_CREDENTIAL_KEY` set; no import of the deleted
`routes/youtube.js` survives (`grep`).

---

## Phase 5: Frontend

**Mode:** Sequential prelude, then parallel (3 streams)
**Depends on:** Phase 4
**Goal:** Operators can connect channels and drive a broadcast's platform
lifecycle from the UI, and the legacy browser-only YouTube surface is gone.

**Prelude (sequential):** `src/hooks/usePlatforms.js` — the shared client for
`/platforms*` (list, connect, disconnect, per-broadcast actions, stats). All
three streams consume it, so it lands first.

**Stream A — Setup Hub "Broadcast Platforms" card**
- New `components/setup-hub/PlatformsSection.jsx` following
  `ConnectorsSection.jsx`'s structure (`SetupCard` + `SetupItemRow` + `Dialog`,
  its local `useApi` idiom), registered in `SetupHubPage.jsx` under
  "AI & integrations" with an `isVisible('broadcast-platforms')` guard and an
  icon in `setup-hub/icons.jsx`.
- **Lists multiple connected channels per platform** with per-row disconnect and
  an explicit "Connect another channel" action — decision #1's UI half.

**Stream B — Broadcast detail platform panel**
- Per-broadcast panel in the `/broadcasts` UI: account picker (only shown when
  >1 live credential), "Schedule on YouTube", thumbnail upload/picker, "Go Live"
  / "End Stream", live viewer-count readout subscribed via the existing
  `useEventStream` hook filtered to `platform.stats_updated`, and the
  post-broadcast summary once completed.
- Disabled with an explanatory hint — not hidden — when no account is connected,
  linking to `/setup/broadcast-platforms`.

**Stream C — Retire the legacy surface** (decision #2)
- Delete `src/lib/youtubeAuth.js`, `src/lib/youtubeApi.js`,
  `src/components/broadcast/YouTubeTab.jsx`.
- Rewire the two confirmed importers: `BroadcastModal.jsx:5,41` and
  `broadcast/SettingsTab.jsx:5,45` — their `youtube` tab becomes a pointer to
  the Setup Hub card and the per-broadcast panel rather than an inline
  implicit-token flow.
- Re-run `grep -rn "youtubeApi\|youtubeAuth\|YouTubeTab" packages/lcyt-web`
  and confirm zero hits before considering the stream done.

**Sync point:** `npm test -w packages/lcyt-web` (including Vitest) green; the
grep returns nothing; a build (`npm run build:web`) succeeds — the real check
that no dangling import survived the deletion.

---

## Phase 6: Documentation & sweep

**Mode:** Parallel (2 streams)
**Depends on:** Phase 5
**Goal:** The repo's own conventions are satisfied and the plan is marked done.

**Stream A — package docs**
- `packages/plugins/lcyt-platforms/CLAUDE.md` — routes, tables, env vars, test
  coverage, matching the other plugins' structure (required: every plugin dir
  has one).
- Root `CLAUDE.md` — add the row to the Package Index table and name
  `lcyt-platforms` in the plugin list.

**Stream B — plan & coverage bookkeeping**
- `docs/PLANS.md` — flip `plan_broadcast_platform_sync.md` from draft to
  implemented, noting what shipped and what stayed deferred (Facebook beyond the
  skeleton, key rotation, recurrence sync, pre-broadcast checks).
- Set the plan file's own `status:` frontmatter to `implemented`.
- `docs/TEST_COVERAGE.md` — add the new package's row.
- `.env.example` — the four new vars.

**Sync point:** `npm test` green repo-wide; every new env var appears in both
the registry and `.env.example`.

---

## Critical path

```
Phase 0 (crypto → schema → db helpers)
  → Phase 1 Stream B (youtube.js adapter)
  → Phase 2 (state → token-service → oauth routes)
  → Phase 3 prelude + Stream A (schedule/thumbnail/transitions)
  → Phase 4 (settings → server.js wiring → delete routes/youtube.js)
  → Phase 5 prelude + Stream B (broadcast detail panel)
  → Phase 6
```

Phase 1 Streams A/C, Phase 3 Streams B/C, and Phase 5 Streams A/C all hang off
this chain without extending it. The chain's length is dominated by Phase 1
Stream B and Phase 3 Stream A — the two largest single artifacts.

## Risk register

- **The YouTube adapter is never validated against the real API** (decision #4).
  A wrong request shape surfaces only in the owner's post-merge smoke test.
  *Mitigation:* pin every request shape in Phase 1 tests written against the
  published API contracts, and funnel all calls through one `ytFetch` helper so
  auth/error handling is fixed in one place. Keep adapter logic free of business
  rules so a correction is a one-file edit.
- **`PLATFORM_CREDENTIAL_KEY` fail-closed could break an existing deployment's
  startup.** *Mitigation:* warn-at-startup, refuse-at-write — an unset key
  disables platform connection only, never the whole backend. Explicitly tested
  in Phase 4.
- **Deleting the legacy YouTube surface is the one irreversible, user-visible
  step.** *Mitigation:* it is last (Phase 5 Stream C), gated behind a working
  replacement, verified by grep *and* a production build rather than by tests
  alone. Recoverable from git history if the replacement proves inadequate.
- **Go-live spans two systems** — a successful YouTube transition followed by a
  failed LCYT session start leaves the broadcast live on YouTube with no
  captions. *Mitigation:* order the calls YouTube-first, report partial success
  explicitly rather than rolling back a transition that cannot be undone, and
  surface it in the UI as a distinct state.
- **Stats polling burns YouTube quota** — the Data API quota is per-project and
  finite; a 30s poll across several concurrent broadcasts adds up.
  *Mitigation:* configurable interval with a hard floor, polling only while a
  link's status is `live`, and quota-error (403) handling that backs off rather
  than retrying tightly.

## Recommended starting point

Phase 0, step 1 — scaffolding the package and running `npm install`. Nothing
in the repo can `import 'lcyt-platforms'` until the workspace symlink exists,
so it gates literally every other step.
