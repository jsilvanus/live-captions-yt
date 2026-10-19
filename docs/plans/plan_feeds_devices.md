# Plan: Feeds and Devices

**Status:** PR 1 of 8 (table, `/feeds` API, backfill) in review; nothing reads `prod_feeds` yet. Supersedes the "feeds are cameras" choice of `plan_ingest_feeds.md`. Eight-PR order in section 8; PRs are merged one at a time, in order.

Status: plan only, nothing implemented. Repo: jsilvanus/live-captions-yt at main d4cc6d9 (after #378). Requested by Juha in the thread "Incoming streams chip".

## 1. The idea

Juha's proposal: a **Feeds** card for incoming streams and a **Devices** card for cameras, mixers and encoders. Device listings are for control schemes; feeds are for incoming media. A feed can be linked to a camera, mixer or encoder. A feed can be tagged as camera, program, DSK or something else.

## 2. What the Ingestion card is for today (verified in code)

`setup-hub/IngestionSection.jsx` (card id `ingestion`, title "Ingestion") does two unrelated jobs:

1. **Two fixed per-project slots**, Video and DSK, backed by `GET/PATCH /ingestion/config` and `POST /ingestion/config/rotate` (`lcyt-rtmp/src/routes/ingestion.js`). Video = the project's `api_keys.ingest_stream_key` (or the API key) with the `relay_allowed` switch (feature code `ingest`). DSK = the `dsk/<key>` RTMP app; its enable switch returns 501 (no gate exists) and its `live` is `null`.
2. **A list of every `prod_cameras` row that has a `camera_key`** (control types `webcam`, `mobile`, `rtmp`), with a live dot, and a computed "Monitor" badge when no `rtmp_relays.source_camera_id` points at it (`plan_ingest_feeds.md`, implemented 2026-07-19).

So the card is already half a Feeds card, but its named feeds are stored as **cameras**, which is the modelling problem Juha spotted. `plan_ingest_feeds.md` chose that deliberately to avoid a new table. The cost: a feed that is not a camera (a program feed from a hardware switcher, a DSK key feed, a screen capture) is stored as a "camera" with `control_type: 'rtmp'`, and #378's "Add as feed" does exactly that (`IngestStreamsChip.jsx:93`).

Read-only helpers around it: the top-bar chip and "Discover streams" call `GET /ingestion/streams` and `/ingestion/streams/unclaimed` (`lcyt-rtmp/src/ingest-streams.js`), which list MediaMTX paths for the project's keys: ingest key, `dsk/<key>`, and `rtmp` cameras' keys.

**What the card is for, in one line:** "where does media come into this project, and is it live". It is the incoming side of the Egress card. That is a Feeds card, so the proposal fits: Ingestion becomes Feeds, and the Video/DSK slots become pinned rows in it.

## 3. Who reads `prod_cameras.camera_key` today (what a split must keep working)

| Consumer | File | Uses |
|---|---|---|
| Camera CRUD, `live`, WHIP/HLS URLs | `lcyt-production/src/routes/cameras.js`, `crud.js`, `registry.js` | key, control types, `isPathPublishing` |
| Thumbnails | `camera-thumbnail.js` | `if (camera.cameraKey)` |
| Mixer sources list (`thumbUrl`, `hlsUrl`, `live`) | `routes/mixers.js:332-342` | key, `mixer_input` |
| `rtmp` publish gate | `lcyt-rtmp/src/routes/feed-rtmp.js` | `camera_key` + `control_type='rtmp'` is the permission |
| Relay source | `lcyt-rtmp/src/db/relay.js`, `routes/stream.js`, `rtmp-manager.js` | `rtmp_relays.source_camera_id` resolved to key |
| Discover / known keys | `routes/ingestion.js:134,161` | `rtmp` keys, all keys |
| Perception and vision | `perception-manager.js`, `perception-autostart.js`, `perception-overview.js` (`hasFeed`), `vision-source-resolver.js`, `shared-feed-resolver.js`, `lcyt-compute/src/perception/frame-source.js`, `vision-role-manager.js` | key = "this camera has its own feed" |
| Crop follow | `lcyt-rtmp/src/db/crop.js` | `crop_source_map` by camera id / `mixer_input`; no key needed |
| Web | `ProductionCamerasPage`, `IngestionSection`, `EgressSection`, `RelaySlotRow`, `ProductionVisualPage`, `IngestStreamsChip` | `cameraKey`, `controlType` |

Two things matter for the design:

- Crop-follow and program-on-air logic key off **devices** (camera id, mixer input), not off the feed. They stay on devices.
- Perception, thumbnails and the relay source need the **media path**. They need a feed, which a camera may or may not have.

## 4. Target model

### 4.1 New table `prod_feeds` (Prisma, both schemas)

```
prod_feeds
  id              String  @id
  owner_api_key   String            -- project
  name            String
  feed_key        String            -- MediaMTX path name, SAFE_NAME_RE
  transport       String            -- 'rtmp' | 'whip'  (how it arrives)
  kind            String  default 'generic'  -- 'generic' | 'camera' | 'dsk'   (Juha, 2026-10-19)
  label           String?           -- free text for generic feeds: preview, program, mixer, mixer2, guest speaker ...
  device_type     String?           -- 'camera' | 'mixer' | 'encoder'  (optional link)
  device_id       String?           -- id in prod_cameras / prod_mixers / prod_encoders (no FK; checked in code)
  sort_order      Int     default 0
  created_at      String
  @@unique([feed_key])
  @@index([owner_api_key])
  @@index([device_type, device_id])  -- not unique: a device may have several feeds
```

- Three kinds only. `camera` feeds link to a camera; `dsk` feeds are excluded from perception and carry the key-colour hints; `generic` covers everything else and is named by its free `label` (the UI suggests preview, program, mixer, guest speaker, but any text works). Nothing in routing depends on the label.
- A device may have several feeds (a camera's main and low-res, a mixer's program and preview). Links are therefore many-to-one, no uniqueness.
- Live status is not stored; it is read from MediaMTX as today.
- No `mixer_input` on a feed. It stays on the camera, so crop-follow is untouched.
- The per-project Video slot (`ingest_stream_key`) and DSK slot become ordinary feeds (Juha's answer to question 1): the backfill creates a `generic` feed labelled "main" from the ingest key and a `dsk` feed from `dsk/<key>`, keeping the rotate action and the `relay_allowed` switch on the Video one. Their keys are derived from `api_keys`, so these two rows are "managed" (a `managed` flag, not deletable, key rotated through `/ingestion/config/rotate`). Detail to confirm in PR 1.

### 4.2 Devices

`prod_cameras` keeps control (PTZ, `mixer_input`, presets, zone, label, perception flag) and loses feed duties over a transition. `control_type: 'rtmp'` goes away: such a camera becomes a `camera` feed with no device, or a `none` camera plus a linked feed. `webcam`/`mobile` stay as control types; their WHIP key moves to a `camera` feed with `transport: 'whip'`.

**Linking (Juha, 2026-10-19):** any feed can be assigned to any device, whatever its kind or label. The link is only "this feed belongs to / comes from that device" and carries no routing meaning. A mixer needs no special output feed: the existing `prod_mixers.output_key` is backfilled to a generic feed named after the mixer and linked to it, and after that the link can be changed or removed in the UI like any other.

### 4.3 Relay source

`rtmp_relays.source_camera_id` becomes `source_feed_id`; `source_view` (`program` | `crop`) stays as the fallback when null. `relay.js` resolves a feed id to `feed_key` the way it resolves a camera today. The old column stays during the transition (read both, write new).

## 5. UI

- **Feeds card** (`/setup/feeds`) replaces Ingestion. Rows: Video and DSK slots as today, then named feeds with kind and label, live dot, linked-device chip and the Monitor badge. "Add feed" dialog: name, key, transport, kind, label, optional device. Discover and the chip's "Add as feed" create a `prod_feeds` row, not a camera.
- **Devices**: Cameras, Mixers, Encoders (and Bridges) grouped; each device row shows its linked feed with a live dot and a "Link feed" action.
- **Egress and `RelaySlotRow`**: the source picker lists feeds, grouped by kind and label.
- **Plumbing**: `workflowFeatureMap.js` (`ingest: ['egress','ingestion']`), `setup-wizard/lib/capabilities.js` (four `/setup/ingestion` links), `cardSetupStatus.js`, locale keys fi/en/sv. `/setup/ingestion` redirects to `/setup/feeds`. Feature code `ingest` stays.
- **Chip**: unchanged except "Add as feed" posts to the feeds route.

## 6. API

- `GET/POST/PATCH/DELETE /feeds` (new, in `lcyt-rtmp`, which owns ingest, MediaMTX paths and the publish gate; `lcyt-production` stays device-only). Fields as §4.1 plus computed `live` and `ingestUrl` / `whipUrl`.
- `GET /ingestion/config`, `/ingestion/streams`, `/ingestion/streams/unclaimed` stay (the chip uses them); `streams` reads feed keys from `prod_feeds`.
- `GET /production/cameras` keeps `cameraKey`, `live`, `thumbnailUrl`, now derived from the linked feed and marked deprecated, so perception, mixers and the camera page keep working until their own PRs.
- Publish gate (`feed-rtmp.js`) resolves `feed_key` in `prod_feeds` (transport `rtmp`).

## 7. Migrating existing data

Prisma migration plus an idempotent startup backfill. No deployments exist, so no downtime concern.

1. Each `prod_cameras` row with `control_type='rtmp'` and a key becomes a feed (`transport rtmp`, `kind camera`, name and key copied, linked to the camera). The camera's `control_type` is left alone in PR 1 (it becomes `none` in PR 7, once nothing reads it); it keeps `mixer_input`, label, zone, perception flag.
2. Each `webcam`/`mobile` camera with a key gets a `whip` feed, same link.
3. Each `prod_mixers.output_key` becomes a `generic` feed labelled with the mixer name, linked to the mixer. Video and DSK slots become the two managed feeds from 4.1.
4. `rtmp_relays.source_camera_id` is copied to `source_feed_id` using the feed created in step 1/2.
5. `camera_key` stays populated and written in sync (dual write) until the cleanup PR.

Keys do not change, so no publisher is reconfigured and MediaMTX paths stay identical. The backfill fails loudly if two rows share a key.

## 8. PR order

1. **Schema, store, `/feeds` CRUD** (both Prisma schemas, `sqlite/schema.sql`, postgres migration, `lcyt-rtmp` db module, routes, tests) plus the backfill. No UI, no behaviour change.
2. **Reads move to feeds** (Discover also skips `<key>__<viewport>` names, which are our own DSK viewport renders, not incoming feeds): publish gate, `ingest-streams` known keys, `GET /production/cameras` derived fields, `relay.js` accepts `source_feed_id` (dual read). Tests for old and new rows.
3. **Feeds card**: replaces Ingestion, add/edit/discover, chip creates feeds, redirect, wizard links, locale keys, `cardSetupStatus`.
4. **Devices card**: grouping, "Link feed", camera form drops the "RTMP Feed" type.
5. **Egress and relay UI**: source picker on feeds, writes `source_feed_id`.
6. **Perception, thumbnails, mixer sources** read the feed directly instead of through the shim.
7. **Cleanup**: drop `camera_key`, `source_camera_id`, `control_type: 'rtmp'`; mark `plan_ingest_feeds.md` superseded, adjust `plan_mixer_feed_sources.md`, the `lcyt-production`, `lcyt-rtmp` and `lcyt-web` CLAUDE.md files and `docs/PLANS.md`.

8. **Primary feed** (later, own PR; decided with Juha 2026-10-19): add `primary_feed_id` on the project, move the callers that find "the project's main stream" by project key (relay default source and `-out/-crop/-t<i>` paths, recorder `recording/feeds.js`, radio, DSK composite, live route) to it, and migrate `ingest_stream_key` into an ordinary feed with the same key. After this the Video feed is an ordinary, renamable, deletable feed and "managed" goes away. Not before PR 7 because it touches relay, recorder and radio together and cannot be tested without a real MediaMTX.

PRs 3 and 4 can run in parallel after 2. PR 6 can slip without breaking anything because of the shim.

## 9. Risks

- Perception and vision treat "has `cameraKey`" as "has its own feed" (§3). The shim must keep that exact meaning, with a test per consumer.
- Key uniqueness is only a convention today (see the collision notes in `feed-rtmp.js` and `rtmp-manager.js`); `@@unique([feed_key])` fixes that but the backfill must handle existing duplicates.
- Polymorphic `device_id` has no FK; deleting a device must unlink its feed in code.
- Nothing here is verified against a real MediaMTX or fleet. The Windows relay/fan-out checks are still manual; repeat them after PR 5.

## 10. Decisions and open questions

Decided by Juha on 2026-10-19: (1) Video and DSK slots become ordinary feeds with roles; (4) three kinds: generic (free label), camera, dsk; (5) several feeds per device are allowed; (6) Ingestion becomes Feeds.

Also decided (2026-10-19): Devices = one Hub card with Cameras/Mixers/Encoders sections, Bridges separate; any feed can be assigned to any device; the Video slot is labelled "main"; making the project key non-forced is PR 8.

Still open (none blocks PR 1):
- Our own DSK viewport output ("copy to HDMI"): not found in the DSK plugin docs; outside the Feeds scope either way.
- Whether the DSK renderer's `<key>__<viewport>` stream can also feed the incoming `dsk/<key>` composite path; to be checked before PR 1.
