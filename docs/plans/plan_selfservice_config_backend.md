---
id: plan/selfservice_config_backend
title: "Self-Service Config Backend: Caption Targets/Translation, Ingestion, and Web Radio"
status: implemented
summary: "Design for promoting three client-only or admin-only config surfaces into proper backend-persisted entities with real CRUD: (1) caption targets + translation config, currently 100% localStorage; (2) RTMP ingestion, currently two boolean flags on api_keys with no rotatable stream key; (3) Web Radio, currently a single admin-toggled boolean with no metadata. Companion to plan_team_org_backend.md's appendix items 1-3."
---

# Self-Service Config Backend: Caption Targets/Translation, Ingestion, and Web Radio

## Context

These three items were flagged as a prioritized backlog in `plan_team_org_backend.md`'s "Other Backend Gaps" appendix (items 1-3). All three share the same shape: something that today lives entirely client-side (`localStorage`) or as a bare admin-only boolean column gets promoted to a real per-project, server-persisted, self-service-CRUD entity. They are grouped in one document rather than split three ways because they were commissioned together as one gap-analysis batch and are individually small enough that separate files would mostly repeat the same "current state → schema → routes" skeleton — but each section below is self-contained and could be lifted into its own plan file later if one of them grows into a multi-day project (the Caption Targets section is the closest to that; see its own effort note).

**No backward-compatibility burden.** LCYT has no released users yet. None of the schema below hedges for existing production rows, gradual rollout, or zero-downtime migration — additive/nullable columns are used because that is simply good schema design (a project genuinely can have zero configured targets, or no ingestion rotated yet), not because of any compat requirement.

**Implementation status:** backend implemented in PR #239 (merged to `main`).
Setup Hub's Ingestion, Web Radio, and Caption Targets cards
(`packages/lcyt-web/src/components/setup-hub/IngestionSection.jsx`,
`WebRadioSection.jsx`, `CaptionTargetsSection.jsx`) are built against §1/§2/§3
below (Ingestion/Radio extended with a `live` status field each, §2a/§3a) and
were verified field-for-field compatible against PR #239's actual route code
before it merged: `GET/PATCH /ingestion/config`'s nested `{ video, dsk }`
shape incl. `live`/`501` DSK semantics, `GET/PUT /radio/config`'s
`{ title, description, coverImageUrl, autoplay, enabled, live }`, and
`GET/POST/PUT/DELETE /targets`'s target shape (`type`/`enabled`/`streamKey`/
`url`/`headers`/`viewerKey`/`noBatch`) all matched exactly with no changes
needed on either side. §1's Translation half now has a real Setup Hub card
(`LanguagesSection.jsx`/`LanguagesPage.jsx`, replacing the old plain link-out
card) — but as built (2026-07-06) it's wired to the localStorage
`lib/translationConfig.js` instead of the already-implemented
`GET/PUT /translation/config*` routes documented above, a bug to fix
independently (tracked in `plan_server_stt.md`'s Phase 5 todo, since that
phase's UI work depends on the fix either way). `scripts/dev/
screenshot-mock-backend.mjs` keeps in-memory stubs for all three routes for
local frontend dev without a full `lcyt-backend` instance running.

---

## 1. Caption Targets + Translation Config → Server-Persisted

### Current state

Confirmed by reading `packages/lcyt-web/src/lib/targetConfig.js` and `packages/lcyt-web/src/lib/translationConfig.js`:

- **Targets** (`getTargets()`/`setTargets()`): a flat array in `localStorage` under `KEYS.targets.list`. Each entry: `{ id, enabled, type: 'youtube'|'generic'|'viewer', streamKey?, url?, headers?, viewerKey?, noBatch? }`. No server awareness of this list at all — the client reads it, builds the array, and ships the whole thing to the backend only at session-start time (`POST /live` body `targets`).
- **Translation**: two logically distinct things, both client-only:
  - A vendor-level config (`mymemory`/`google`/`deepl`/`libretranslate`, plus vendor API key / LibreTranslate URL+key / show-original flag) — effectively one row of settings per browser.
  - A list of translation entries (`getTranslations()`/`setTranslations()`, `KEYS.translation.list`): `{ id, enabled, lang, target: 'captions'|'file'|'backend-file', format? }` — multiple rows, same shape-of-list problem as targets.

Neither survives a browser switch, a cleared cache, or a second operator on the same project. `docs/plans/plan_setup_wizard.md` documents this localStorage-only state explicitly (`KEYS.targets.list`, `KEYS.translation.*`) as the wizard's persistence layer today.

**Templates used for this design** (both read in full): `stt_config` (`packages/plugins/lcyt-rtmp/src/db.js`) is the pattern for a single-row-per-key config object with a `GET`/`PUT` pair (`packages/lcyt-backend/src/routes/stt.js`). `key_storage_config` (`packages/plugins/lcyt-files/src/db.js`) is the same single-row-per-key pattern with an upsert helper (`INSERT ... ON CONFLICT DO UPDATE`). Neither is a template for a *list* of rows per key — for that, `project_members` (one row per membership, `api_key` + a stable id) and `rtmp_relays` (one row per slot, `api_key` + a stable `slot`/`id`) are the closer precedent.

### Proposed schema

Three tables — one list table for targets, one single-row vendor-config table, and one list table for translation entries. All additive, all live in `lcyt-backend/src/db/schema.js` (core concept, not RTMP/DSK-specific, unlike `stt_config`/`key_storage_config` which are plugin-owned):

```sql
-- One row per configured caption delivery target.
CREATE TABLE IF NOT EXISTS caption_targets (
  id          TEXT    PRIMARY KEY,             -- client-generated UUID, stable across saves
  api_key     TEXT    NOT NULL,
  type        TEXT    NOT NULL,                 -- 'youtube' | 'generic' | 'viewer'
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  stream_key  TEXT,                              -- type='youtube'
  url         TEXT,                              -- type='generic'
  headers     TEXT,                              -- type='generic'; JSON string, as today
  viewer_key  TEXT,                              -- type='viewer'
  no_batch    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_caption_targets_api_key ON caption_targets(api_key);

-- Vendor-level translation settings: one row per key (mirrors stt_config's shape).
CREATE TABLE IF NOT EXISTS translation_vendor_config (
  api_key        TEXT PRIMARY KEY,
  vendor         TEXT NOT NULL DEFAULT 'mymemory',  -- mymemory | google | deepl | libretranslate
  vendor_api_key TEXT,                               -- Google/DeepL API key
  libre_url      TEXT,
  libre_key      TEXT,
  show_original  INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per configured translation (language + destination).
CREATE TABLE IF NOT EXISTS translation_targets (
  id          TEXT    PRIMARY KEY,
  api_key     TEXT    NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  lang        TEXT    NOT NULL,
  target      TEXT    NOT NULL,                  -- 'captions' | 'file' | 'backend-file'
  format      TEXT,                              -- 'text' | 'youtube' | 'vtt' (file/backend-file only)
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_translation_targets_api_key ON translation_targets(api_key);
```

Naming note: `translation_targets` is deliberately distinct from `caption_targets` even though both are "targets" in the UI sense — a caption target is a *delivery destination* (YouTube/viewer/generic), a translation target is a *language + output* pairing. Reusing "target" for both in code would be confusing across two tables; the column/type vocabulary already in `translationConfig.js` (`TRANSLATION_TARGETS` = `captions`/`file`/`backend-file`) keeps its own name.

Splitting vendor config from the translation list (rather than one wide table) mirrors the actual UI/data shape: there is one vendor choice + one set of credentials per project, but a variable number of language configs — exactly the same split MyMemory/Google/DeepL/LibreTranslate settings already have in `translationConfig.js` today (global vendor getters/setters vs. the `getTranslations()` list).

### Routes

Session-Bearer auth (`auth` middleware, same as `/stt/config`, `/stream`) — these are per-connected-project settings, not user-account-level settings, so they follow the `/stt/config`-style pattern rather than the `/keys/:key/features`-style user-Bearer pattern:

```
GET    /targets                — list all caption targets for the API key
POST   /targets                — create a target { type, streamKey?/url?/headers?/viewerKey?, enabled?, noBatch? }
PUT    /targets/:id             — update a target
DELETE /targets/:id             — delete a target
PUT    /targets/reorder         — body: { order: string[] } (ids in new order) — persists sort_order in one call

GET    /translation/config           — { vendor: {...}, targets: [...] }  (combined read for one round-trip)
PUT    /translation/config/vendor    — update vendor row { vendor?, vendorApiKey?, libreUrl?, libreKey?, showOriginal? }
POST   /translation/config/targets   — create a translation target { lang, target, format?, enabled? }
PUT    /translation/config/targets/:id    — update a translation target
DELETE /translation/config/targets/:id    — delete a translation target
```

`GET /translation/config` returns both pieces together (like `stt_config`'s single combined `GET /stt/config`) because the frontend's `TranslationPanel`/`TranslationsPage` always needs both at once to render.

### Central design decision: interaction with session-start (`POST /live`)

This is the trickiest part, as flagged, because of an existing subtlety in `packages/lcyt-backend/src/routes/live.js` worth calling out precisely before proposing the fix.

**How `POST /live` handles `targets` today:** `buildExtraTargets(targets)` treats *any* non-array or empty-array input identically — `if (!Array.isArray(targets) || targets.length === 0) return { ok: true, extraTargets: [] }`. On the **new-session** path this is harmless (a fresh session with no targets is just empty). On the **existing-session (idempotent) path**, though, the code unconditionally does `existing.extraTargets = extraTargets;` — meaning if a client ever calls `POST /live` again *without* a `targets` field (e.g. a reconnect helper, a thinner client, a future embed page), the running session's configured targets are silently wiped to `[]`. In practice this has never surfaced as a bug because the only existing caller (lcyt-web) always reads its full `localStorage` list and resends it on every connect — but it means `targets` is not actually "optional" today in any functional sense, only optional in the type system.

**Two options for what happens once targets are server-persisted:**

1. **No protocol change.** The client still always sends the full targets array it read from `GET /targets` on `POST /live`; the persisted table exists purely for multi-device sync (so a second browser's `GET /targets` sees the same list), not for driving session defaults. Simplest, zero risk to existing behavior, but wastes the actual point of persisting server-side — every client still has to fetch-then-resend the whole list every time, and thin/headless callers (CLI, MCP tools, a future minimal embed widget) would have to duplicate that fetch-and-build logic themselves instead of getting it for free.
2. **`targets` becomes an explicit override; omitting it loads the project's saved defaults.** When the `targets` field is present in the body (**including an explicit empty array**, `targets: []`), it is used as-is for that session, exactly as today — this preserves every existing caller's behavior byte-for-byte, since lcyt-web always sends a concrete array. When the field is **absent** (`undefined`, not merely falsy/empty), the server loads `getCaptionTargets(db, apiKey)` filtered to `enabled = 1` and builds `extraTargets` from that, via the same `buildExtraTargets()` helper. On the existing-session path, the same undefined-vs-provided distinction must gate whether `existing.extraTargets` is touched at all — fixing the wipe-on-reconnect issue described above as a side effect.

**Recommendation: option 2.** It is the actual value proposition of server-persisting this config — a thin client can start a session with just `{ apiKey, domain }` and get the project's configured delivery targets automatically, the same way `/stt/start` already falls back to env-var defaults (`STT_PROVIDER`, etc.) when the caller omits fields. Implementation is a small, precise change to `buildExtraTargets()`'s call sites in `live.js`, not a redesign: replace the two `targets` destructures with a check for `targets !== undefined` before deciding override-vs-load-saved, in both the new-session and existing-session branches of `POST /live`, and the same in `PATCH /live`.

**Frontend workflow this enables:** the `TargetsPanel`/`TranslationPanel` editing flow becomes: (1) call the new persisted CRUD routes (`POST`/`PUT`/`DELETE /targets`) — these are now the source of truth, and `localStorage` can be dropped entirely as a required layer (a thin read-through cache is optional, not required, since there's no offline-editing use case that needs it); (2) if a session is currently live, immediately call `PATCH /live` with the freshly-saved full target list (an explicit override, per option 2 above) so the change applies to the running session without a reconnect — this is exactly today's existing `PATCH /live` `targets` mechanism, unchanged. On a fresh connect, the client can now simply omit `targets` from `POST /live` and rely on the server default, removing a whole class of "read localStorage, reconstruct array, resend" client code — though lcyt-web is free to keep sending it explicitly if there's ever a reason a session should start with a *different* target set than the project's saved default (e.g. a "test without affecting my saved config" mode).

### Effort note

This is the largest of the three items here — three new tables, five+ route groups, and the `live.js`/`buildExtraTargets()` override-vs-default logic touching both `POST` and `PATCH /live`. If it grows scope during implementation (e.g. adding per-target delivery stats, or reordering UI), it's a reasonable candidate to split into its own `plan_caption_targets_backend.md` at that point — kept combined here only because the design itself, as scoped, fits in one section.

---

## 2. Ingestion as a First-Class Entity

### Current state

Confirmed by reading `packages/plugins/lcyt-rtmp/src/db/relay.js`, `packages/plugins/lcyt-rtmp/src/routes/rtmp.js`, and `packages/lcyt-backend/src/routes/stream.js` (via its actual location, `packages/plugins/lcyt-rtmp/src/routes/stream.js`):

- `relay_allowed` (boolean column on `api_keys`) is the **true ingestion gate**, not just an egress flag as the name might suggest: `routes/rtmp.js`'s `on_publish` nginx-rtmp callback (`call === 'publish'`) does `if (!isRelayAllowed(db, apiKey)) return res.status(403).send('relay not allowed')` — this is what accepts or rejects the *incoming* RTMP publish itself. It is admin-only today, set via `PATCH /keys/:key` (`X-Admin-Key`).
- `relay_active` (boolean column) is the existing **self-service** toggle (`PUT /stream/active`, session Bearer) — it does not gate the incoming publish, only whether the 4-slot egress fan-out (`rtmp_relays`) starts once nginx has already accepted the stream.
- The RTMP "stream key" a broadcaster pastes into OBS/a hardware encoder **is the literal `api_keys.key` value** — nginx's `$name` field in the `on_publish` callback is used directly as the api_key (`const { name: apiKey } = req.body`). There is no separate, rotatable ingest credential. This matters because the api_key is also the credential used for session auth, DSK editor `X-API-Key` access, and everything else — while the RTMP stream key specifically is the one credential that lives inside a third-party encoder's saved profile, is the most likely of all the project's secrets to end up in a screenshot, a support ticket, or a stolen laptop's OBS config. Today, rotating it means rotating (and thus breaking) the entire project's api_key.
- `radio_enabled`/`hls_enabled`/`graphics_enabled` gate parallel, independently-keyed RTMP ingest paths (a `radio` nginx app, a `dsk` nginx app) that follow the exact same "stream name = literal api_key" pattern — worth keeping in mind for UI consistency, but out of scope for the schema change below, which is scoped to the primary `/rtmp` app ingest (what "the ingest slot" means in the product today, symmetric with the fully-modeled 4-slot `rtmp_relays` egress table).

### What's actually missing

1. **Self-service enable/disable** — `relay_allowed` exists but is admin-only. This is a route/policy change, not schema.
2. **Stream-key rotation** — genuinely absent. No column stores an ingest credential distinct from the api_key.
3. **Read-only ingest URL display** — no route composes `rtmp://<host>/<app>/<key>` for the frontend today; a user currently has to construct it by hand from docs/env-var knowledge.

### Decision: does this need a new table?

**No.** There is exactly one ingest slot per key (unlike the 4-slot `rtmp_relays` egress model this deliberately mirrors), so a dedicated `ingestion_config` table would be pure overhead. One nullable column is enough, following the same pattern `radio_enabled`/`hls_enabled`/`graphics_enabled` already use — plain `api_keys` columns, not one-row-per-key config tables:

```sql
ALTER TABLE api_keys ADD COLUMN ingest_stream_key TEXT UNIQUE;
-- NULL = "the RTMP stream key is the api_key itself" (today's behavior, unchanged
-- for any key that never rotates). Populated only once a project owner rotates it.
```

**The real implementation cost is not schema — it's the on_publish lookup change.** Every nginx-rtmp/MediaMTX callback that currently receives `name` and treats it as the literal api_key (`routes/rtmp.js`, `routes/radio.js`, `packages/plugins/lcyt-dsk/src/routes/dsk-rtmp.js`) needs to resolve it through a small helper instead:

```js
// packages/plugins/lcyt-rtmp/src/db/relay.js
export function resolveApiKeyFromIngestStreamKey(db, name) {
  const row = db.prepare('SELECT key FROM api_keys WHERE ingest_stream_key = ?').get(name);
  return row ? row.key : name; // fall back to treating `name` as the literal api_key
}
```

Every `on_publish` handler's first line becomes `const apiKey = resolveApiKeyFromIngestStreamKey(db, rawName);` instead of `const apiKey = rawName;`. This is mechanical but touches three plugin files, which is why it's called out explicitly rather than left implicit in the schema diff.

### Routes

```
GET   /ingestion/config
  Auth: session Bearer
  Response: {
    enabled: boolean,      // relay_allowed
    active: boolean,       // relay_active (existing toggle, unchanged, still PUT /stream/active)
    streamKey: string,     // ingest_stream_key ?? apiKey — value to paste into the encoder
    ingestUrl: string,     // fully composed rtmp://<host>/<app>/<streamKey>, ready to paste
    rotatable: true
  }

PATCH /ingestion/config
  Auth: session Bearer
  Body: { enabled?: boolean }
  Notes: flips relay_allowed — this is the piece moving from admin-only to
         self-service. Recommend gating this route behind the existing `rtmp`
         feature code (already gates the Broadcast page per CLAUDE.md's feature
         table) via FEATURE_GATE_ENFORCE, rather than making it universally open —
         there are no abuse/capacity controls on RTMP ingest yet, and a feature
         gate is a one-line reuse of infrastructure that already exists.
  Response: { enabled }

POST  /ingestion/config/rotate
  Auth: session Bearer
  Effect: generates a new random ingest_stream_key, replacing any previous value.
          Any encoder still configured with the old value gets rejected on its
          next on_publish attempt once the lookup no longer resolves it — surfaced
          to the user as a disconnected stream, prompting them to update the
          encoder with the new key/URL.
  Response: { streamKey, ingestUrl }
```

`ingestUrl`'s host/app portion is derived the same way `routes/radio.js`'s `buildPlayerSnippet()` already derives `backendOrigin` (`process.env.BACKEND_URL || req.protocol://req.get('host')`), combined with `process.env.RTMP_APPLICATION`/`RTMP_HOST` — no new env vars needed, just a route that composes what operators already configure.

### 2a. DSK ingest slot + live status (added 2026-07-06, for the Setup Hub card)

The mockup's `IngestionCard.dc.html` shows **two** item rows — "one Video, one DSK" per the Setup Hub description — not just the one slot §2 designed. Extend the shape above rather than adding a parallel route:

```
GET   /ingestion/config
  Response: {
    video: { enabled, active, streamKey, ingestUrl, rotatable: true, live: boolean },
    dsk:   { enabled, ingestUrl, live: boolean|null }   // see caveats below
  }

PATCH /ingestion/config
  Body: { video?: { enabled? }, dsk?: { enabled? } }
  Response: same shape as GET
```

- `video.live` ← `relayManager.isPublishing(apiKey)` (`packages/plugins/lcyt-rtmp/src/rtmp-manager.js:964`) — already tracked, just never returned over HTTP. Cheap and synchronous; safe to call on every `GET`.
- `dsk.enabled` — this plan's own §2 note already flags that `graphics_enabled` gates the DSK RTMP app in parallel to `relay_allowed` gating the video one, but scoped that out as "out of scope for the schema change." Confirmed while implementing: `packages/plugins/lcyt-dsk/src/routes/dsk-rtmp.js`'s `on_publish` handler does **not** check `graphics_enabled` (or anything else) today — it only validates the stream-name regex, with no gate at all. So `dsk.enabled` in the response is `graphics_enabled` surfaced read-only (an existing broader feature entitlement, not an ingest-specific gate), and `PATCH .../dsk` is a `501` until a real DSK-ingest gate is designed and wired into that handler — flipping a flag that doesn't gate anything would be actively misleading.
- `dsk.live` — **no equivalent to `isPublishing()` exists in `lcyt-dsk`.** Returns `null` (unknown) rather than guessing `false` — the frontend already renders `null` as a dim/neutral status dot, not a false "offline." Wiring real DSK-publish tracking (likely: the DSK RTMP app's `on_publish`/`on_publish_done` needs the same kind of `Set<apiKey>` `RtmpRelayManager._publishing` already uses) is a self-contained fast-follow, not a blocker for shipping `video`'s real status.

---

## 3. Web Radio Config CRUD

### Current state

Confirmed by reading `packages/plugins/lcyt-rtmp/src/radio-manager.js` and `packages/plugins/lcyt-rtmp/src/routes/radio.js`:

- `radio_enabled` (boolean column on `api_keys`) is the only piece of radio config that exists, and it's admin-only (`PATCH /keys/:key`).
- `RadioManager` itself is stateless metadata-wise — it tracks only `{ radioKey → { slug } }` for currently-live streams, nothing persistent.
- Public routes already exist and are entirely read-only/generated: `GET /radio/:key/info` (`{ live, hlsUrl, slug? }`), `GET /radio/:key/player.js` (a self-contained `<audio controls>` player snippet — no title, no cover art, no autoplay support), and the HLS proxy itself. Note in passing: `GET /radio/:key/info` does not currently check `radio_enabled` at all — it reports live/hlsUrl regardless of whether the feature flag is on. Out of scope to fix here, but worth knowing before assuming the flag fully gates public visibility.
- Nothing anywhere stores a title, description, cover image, or autoplay preference for a radio stream.

### Proposed schema

Lives in `lcyt-rtmp` (the plugin that owns `RadioManager` and the `/radio` routes), in a new `db/radio.js` alongside the existing `db/relay.js`:

```sql
CREATE TABLE IF NOT EXISTS radio_config (
  api_key         TEXT PRIMARY KEY,
  title           TEXT,
  description     TEXT,
  cover_image_url TEXT,     -- absolute URL, not a cross-plugin FK — see note below
  autoplay        INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`cover_image_url` is a plain URL string rather than a foreign key into `lcyt-dsk`'s `images` table. `lcyt-rtmp` does not import or depend on `lcyt-dsk`, and no other plugin-owned table in the codebase reaches across a plugin boundary with a FK — each plugin's `db.js` is self-contained by design (per CLAUDE.md's Plugin Architecture section). If `GRAPHICS_ENABLED` image uploads are active, the frontend uploads via the existing `POST /images` route and pastes the returned public URL into this field; if not, the field just accepts any externally-hosted image URL. This keeps `radio_config` usable regardless of whether the DSK graphics plugin is even installed.

### Routes

```
GET /radio/config
  Auth: session Bearer
  Response: { title, description, coverImageUrl, autoplay, enabled }
           (enabled = radio_enabled, read-only here — see toggle decision below)

PUT /radio/config
  Auth: session Bearer
  Body: { title?, description?, coverImageUrl?, autoplay? }
  Response: updated config
```

Mounted on the existing `/radio` router (`createRadioRouter`) as a session-Bearer-guarded sub-route, distinct from the public unauthenticated `/radio/:key/*` routes (those stay exactly as they are — `:key` there is the api_key/radio key itself and needs no session).

**Surface the new fields publicly, harmlessly.** `GET /radio/:key/info` is already public with no secrets in its response; extend it to include `{ title, description, coverImageUrl, autoplay }` so embeddable widgets and future clients (e.g. a hypothetical Android radio widget, mirroring `android/lcyt-tv`'s caption viewer) can render a real "Now Playing" card instead of a bare `<audio>` element. `buildPlayerSnippet()` in `routes/radio.js` should read the same fields to optionally inject a title/cover image above the `<audio>` tag and set `audio.autoplay = true` + `audio.muted = true` when `autoplay` is requested (unmuted autoplay is blocked by browser policy without a user gesture regardless of what the config says — the player has to mute-then-play to honor the setting at all, which is worth flagging as an implementation detail, not a design blocker).

### Self-service enable/disable decision

`radio_enabled` is admin-only today, same situation as `relay_allowed` in section 2. The task framing asks this to reference — without blocking on — the site-feature-policy tri-state model reportedly under design elsewhere (not available to inspect from this worktree). Recommendation, stated so it stands on its own regardless of whether that other design lands first or at all:

- **Short term (ships with this plan):** keep `radio_enabled` admin-only, exactly as today. `GET/PUT /radio/config` (metadata) ship as self-service immediately — there is no reason title/description/cover-art editing needs admin gatekeeping, only the raw "can this key accept an RTMP publish for radio at all" switch does, for the same nascent-abuse-surface reason as ingestion in section 2.
- **Once a site-feature-policy system exists:** register something like a `radio-enable` feature code with a `self_service` capability tier, so a project owner can flip `radio_enabled` themselves once the platform has a general mechanism for "which admin-gated toggles are safe to hand to users," rather than this plan inventing a one-off bespoke policy just for radio. Until that system exists, `radio_enabled` stays `denied`/admin-only — a simple, uncontroversial default that this plan does not need to unblock.

### 3a. Live status + Setup Hub card mapping (added 2026-07-06)

The mockup's `WebRadioCard.dc.html` shows one item row once configured: name, a meta line, a toggle switch, and a settings icon. Mapping onto this plan's already-designed fields, with one addition:

```
GET /radio/config
  Response: { title, description, coverImageUrl, autoplay, enabled, live: boolean }
```

- `live` ← `radioManager.isRunning(apiKey)` (`packages/plugins/lcyt-rtmp/src/radio-manager.js:128`) — already tracked, just never returned over HTTP. This is the status dot; distinct from `enabled` (the admin entitlement, read-only per §3 above).
- **The item row's toggle is `autoplay`, not `enabled`.** `enabled`/`radio_enabled` stays admin-gated per this section's own recommendation above — the Setup Hub card does not add a second way to flip it. `autoplay` is already a genuine self-service field in this plan's schema (`PUT /radio/config` body), and mapping the mock's single toggle switch onto it means the card needs zero new capability beyond what §3 already specced — it was just a question of which existing field the toggle affordance should drive.
- The card's "Configure" dialog (shown via the settings icon, or the header button when `!title` i.e. never configured) is the `title`/`description`/`coverImageUrl`/`autoplay` form from `PUT /radio/config`, unchanged from §3. `PUT /radio/config` returns the updated config object directly (same shape as `GET`), matching how `WebRadioSection.jsx` consumes the response (`setConfig(await r.json())`).

---

## Summary of New Schema (all additive)

| Table / column | Owner | Purpose |
|---|---|---|
| `caption_targets` | `lcyt-backend` | Per-project list of caption delivery targets |
| `translation_vendor_config` | `lcyt-backend` | Per-project translation vendor + credentials (single row) |
| `translation_targets` | `lcyt-backend` | Per-project list of language/destination translation configs |
| `api_keys.ingest_stream_key` | `lcyt-backend` (core schema) | Optional rotatable RTMP ingest credential, decoupled from the api_key |
| `radio_config` | `lcyt-rtmp` plugin | Per-project radio metadata (title/description/cover/autoplay) |

No table in this plan requires a migration/back-fill strategy beyond `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` — consistent with the no-legacy-data note in the Context section above.
