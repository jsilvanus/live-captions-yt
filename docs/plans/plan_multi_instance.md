# Plan: Multi-instance behaviour

**Status:** in-progress (approved 2026-10-12). L1, L2 and L3 built; L4 (relay ownership) deferred, relays stay pinned to one instance; L5 docs and deploy later. The Saarnavideo half (S1 to S3) lives in jsilvanus/saarnavideo.


Written from live-captions-yt main (a2cfe32, after #346) and saarnavideo main (57f6c0f), not run.

## Rule for everything below
Single instance stays the default and must behave exactly as today. Every shared mechanism sits behind a small interface with two implementations: an in-process one (default, used with SQLite and local storage) and a shared one (used when `DATABASE_URL` is Postgres and, where files are involved, storage is S3). No new required service: no Redis, no etcd. Postgres is the only coordination point. Each phase is one PR and ships with a two-instance test plus the unchanged single-instance suite. Python backend stays on SQLite and out of scope.

## Shared building blocks (built once, in LCYT first, same ideas in Saarnavideo)
1. **Instance id.** `INSTANCE_ID` env, default `hostname-pid-random`. Shown in logs and `/health`.
2. **Lease** (`acquireLease(name, ttl)`, `renew`, `release`): a row `leases(name, owner, expires_at)` taken with one atomic upsert-if-expired statement. Postgres only; with SQLite the single process always wins, so the call is a no-op returning true. Used for "exactly one instance runs this".
3. **Event bus** (`publish(channel, payload)`, `subscribe`): in-process `EventEmitter` by default; with Postgres `LISTEN/NOTIFY` (payload up to 8 KB, bigger payloads go by row id). Needs a direct or session-mode connection, not PgBouncer transaction mode (documented).
4. **Ownership registry** for things that live in one process (an ffmpeg relay, an SSE connection): `owner_instance` plus heartbeat, so other instances know where to look, and a takeover rule when the owner's heartbeat is stale.

## LCYT: what is per-process today
From `lcyt-backend/src` and the plugins (Maps and timers that hold truth):

| State | Where | Breaks with 2 instances | Plan |
|---|---|---|---|
| Caption sessions, senders, sequence | `store.js` `SessionStore` (Map, db optional) | Caption POST on B for a session started on A: 404/unknown session, sequence numbers diverge | Persist session (apiKey, domain, targets, sequence) in DB; any instance rebuilds senders lazily on first use; sequence advanced with an atomic `UPDATE ... RETURNING` so two instances never reuse a number. YouTube senders are cheap and stateless apart from sequence. |
| Viewer SSE fan-out | `routes/viewer.js` `viewerSubs`, `caption-fanout.js` | A viewer connected to B never sees captions sent via A | `broadcastToViewers` publishes on the bus; every instance delivers to its own local subscribers. Single instance: unchanged direct call. |
| Live subs HLS | `lcyt-rtmp/hls-subs-manager.js` | Playlist is in-memory | Already planned and merged (#343, reports/lcyt-live-subs-multi-instance-plan-2026-10-11.md). Nothing new. |
| DSK/graphics bus, operator manager, roles bus, variables bus, production events | `dsk-bus.js`, `operator-manager.js`, `lcyt-agent/roles-bus.js`, `lcyt-connectors/variables-bus.js` | Same as viewer SSE | Same bus; each channel keyed by project/apiKey. |
| RTMP relay, HLS/radio/preview, STT, crop, perception, music | `rtmp-manager.js` (`_procs`), `stt-manager`, `perception-manager`, `crop-manager` | ffmpeg child lives on one host; a second instance starting "the same" relay duplicates or conflicts; stop/status calls hit the wrong host | Ownership registry: starter records `owner_instance` for the stream key. Start is allowed only through the lease. Stop/status for a key owned elsewhere is forwarded (HTTP to the owner's internal URL, `INSTANCE_URL`) or answered from the registry. If the owner dies, the lease expires and the next start takes over. Media ingest stays pinned to the host MediaMTX/nginx runs on; routing ingest is a deploy matter (document it). |
| Timers: usage rollups, backups, TTL/poll schedulers, token refresh, sweeps | `db/usage-rollups.js`, `backup.js`, `lcyt-connectors/ttl-scheduler.js`, `poll-scheduler.js`, `lcyt-platforms/token-service.js` | Each instance runs them: double rollups, duplicate connector calls, racing OAuth refresh | Run each under a named lease (`rollup`, `backup`, `connectors-poll:<project>`, `token-refresh:<id>`). Rollups also made idempotent (upsert by period). |
| Caches: settings, feature policies, metrics buffer | `settings/service.js`, `metrics/*` | Stale reads after an admin edit on the other instance; metrics split per instance | Settings: invalidate via bus event. Metrics: leave per instance (scraped per target), label with `instance`. |
| Caption files | `caption-file-writer.js`, `lcyt-files` | Local disk | Already store-based (`FILE_STORAGE=s3`); require S3 in multi-instance mode, check for a startup warning. |
| DSK renderer (Playwright) | `lcyt-dsk` | CPU heavy, per instance | Already movable to fleet workers via lcyt-compute; no change. |

Ordered phases (each its own PR, each green on SQLite and Postgres):
- **L1 Foundations.** `INSTANCE_ID`, lease helper, bus interface (in-process + Postgres), `leases` and `instances` tables, `/health` shows instance. Tests: two Prisma clients race for a lease; NOTIFY round trip.
- **L2 Sessions and viewer fan-out.** Persisted sessions, atomic sequence, bus-based `broadcastToViewers`, remaining buses. Two-instance test: start on A, send on B, SSE seen on A and B, sequences strictly increasing.
- **L3 Single-owner jobs.** Leases on rollups, backup, schedulers, token refresh; idempotent rollups.
- **L4 Relay ownership.** Registry, forwarding of stop/status, takeover. This is the riskiest piece; needs real MediaMTX/ffmpeg to verify and probably a staged approach (registry and refusal of duplicate start first, forwarding second).
- **L5 Settings invalidation, docs, deploy.** `DEPLOY.md` multi-instance chapter, compose example with two backends and one Postgres, deploy-media overlay `multi`.

## Saarnavideo: what is per-process today
Saarnavideo is closer: the DB is the queue and the app is almost stateless.

Already fine: job claim is an atomic `updateMany ... status QUEUED -> RUNNING` with `workerId` and heartbeat (`claimJob`), stale jobs are recovered atomically (`recoverStaleJobs`, a transcription is taken over, anything else fails), publications are claimed the same way, cancel is a DB flag polled by the worker, media is in S3 when configured, presigned uploads keep their session in `Source.uploadSession`, ACCESS_SECRET cookie is an HMAC (works across app instances).

Gaps found:
1. **Local storage with several hosts.** `MEDIA_STORAGE=local` plus workers on other machines cannot work (files live on one disk). Plan: startup check that refuses more than one host in local mode when it can tell (shared `instances` table with hostnames), and a clear doc line. S3 is the multi-host mode.
2. **DOWNLOAD jobs write a local file** (`sources/<project>/<id>.mp4`) before it is stored; with S3 it must be uploaded by the same worker that downloaded it. Verify and add a test with two workers (one downloads, another renders).
3. **Job ordering and dependencies.** `claimJob` picks a candidate, checks `dependsOnJobId` in a separate query. Safe because the final update is conditional, but two workers can both skip the same blocked job and starve it; add `ORDER BY createdAt` with `FOR UPDATE SKIP LOCKED` on Postgres (raw query) and keep the current path for SQLite.
4. **Per-worker concurrency.** `MAX_CONCURRENT_JOBS` is per process, so total concurrency is workers x N. Add optional per-type global limits (count RUNNING rows of a type, e.g. only 2 TRANSCRIBE at once) enforced at claim time. Default off.
5. **Housekeeping on request.** `cleanupStalePendingUploads` runs inside the presigned-url route on every call: harmless with races (idempotent deletes) but move it to a lease-guarded worker timer (`upload-cleanup`) so it also runs when nobody uploads.
6. **Token refresh race.** YouTube access token refresh from app and worker: two refreshes at once can invalidate the stored refresh token on some providers. Wrap in a Postgres advisory lock or a row-level `UPDATE ... WHERE tokenExpiry < now` check; SQLite no-op.
7. **Heartbeat/recovery clocks.** Staleness uses each worker's own clock against DB timestamps written by the worker; use DB time (`now()`) for heartbeats on Postgres to avoid clock skew between hosts.
8. **Login throttle.** The 600 ms pause per wrong guess is per request, not per client, so it already works; no change. No in-memory rate limits to share.
9. **Worker cache and work dirs** are per host by design (`MEDIA_ROOT/cache`, `work/<job>`); no sharing needed. Document disk sizing per worker.
10. **fffleet** is the shared executor and already handles many workers; Saarnavideo must not assume a single orchestrator. `FFFLEET_URL` can point at one orchestrator, which stays the single scheduler (its own durable state is a fffleet concern, see below).

Phases (own PRs):
- **S1 Claim hardening.** `SKIP LOCKED` claim on Postgres, DB-time heartbeats, per-type global limits (optional), tests with two workers against Postgres (CI already runs Postgres).
- **S2 Leases for housekeeping and token refresh.** Small `Lease` model in both Prisma schemas; stale upload cleanup and token refresh use it.
- **S3 Local-mode guard and docs.** Startup warning/refusal for local storage with multiple hosts, `docs/DEPLOYMENT.md` "Several instances" chapter, compose example with two workers (deploy-media overlay).
- **S4 Two-instance e2e.** Two workers and two app processes against Postgres and the fake S3: upload, render, publish each handled once; kill a worker mid-job and check recovery.

## fffleet and deploy-media
- fffleet: orchestrator HA is out of scope for this plan. Document that one orchestrator is the scheduler and clients tolerate its restart (durable state exists in 2.4.0). If Juha wants an HA orchestrator, that is a separate plan.
- deploy-media: add a `multi` overlay (second backend/app and worker replicas, one Postgres, S3 required) after L1 and S1 land. Hetzner burst scaling already adds workers only, which these plans support.

## Testing approach
- Unit: lease and bus interfaces with both implementations behind the same test suite.
- Integration: two instances in one test process sharing one Postgres (docker `postgres:17` in CI, already used), explicit timeouts on every wait (CI has stalled before; per-file and job timeouts stay).
- Single instance regression: whole existing suite on SQLite unchanged.
- Windows local stack: run single instance first, then the compose multi overlay.
- Not testable here: PgBouncer transaction mode, real MediaMTX relay takeover, real S3 latency.

## Risks
- `LISTEN/NOTIFY` needs a dedicated connection; Prisma does not manage it, so it uses a small `pg` client alongside Prisma (extra dependency already present for pooling in the old code? verify before L1).
- Relay ownership (L4) cannot be fully proven without real streams.
- Lease TTLs vs long GC pauses: choose TTL 30 s, renew every 10 s, work must tolerate a double run for one TTL (idempotent).

## Decisions for Juha
1. Go for the building blocks (leases + Postgres LISTEN/NOTIFY, no Redis)? Recommended yes.
2. Order: Saarnavideo S1-S3 first (small, mostly done), LCYT L1-L3 next, L4 relay ownership last and only if you really run several relay hosts. Recommended.
3. Is L4 needed at all now, or do we pin RTMP/relay to one dedicated instance and document it? Recommended: pin and document first, build L4 later.
4. Per-type global job limits in Saarnavideo (S1.4): **decided by Juha 2026-10-12: add.** Optional, off by default.

## Progress
- **L1 (2026-10-12):** `INSTANCE_ID`, leases (`leases` table), instance registry (`instances` table), and the EventBus relay over PostgreSQL LISTEN/NOTIFY are built (`packages/lcyt-backend/src/cluster/`). `EventBus` gained `forward()` and `publishRemote()`; a remote event reaches SSE subscribers and listeners that subscribed with `{ remote: true }`, never taps or ordinary listeners, so actors (operator, cue engine, crop follow) still act once, on the instance that published. Envelopes over 7000 bytes travel through `bus_payloads`. `/health` shows `instance` (and `instances` in shared mode). Listener connection loss reconnects with backoff; events during the gap are lost (best-effort, as before). `pg` is a new dependency of `lcyt-backend`.
- The plan assumed a new bus; the unified `EventBus` (`lcyt/event-bus`) already existed, so L1 only bridges it between instances.
- **L2 (2026-10-12):** sessions are usable on any instance. `SessionStore.getOrLoad()` loads a session from its row (targets are now stored in `sessions.data`) and rebuilds senders (`restoreSessionRuntime`, `src/session-targets.js`, which also now holds `buildExtraTargets`); `touch()` writes only `last_activity` and a forward-only sequence; `runExclusive()` serialises a session's sends across instances with the lease `session-send:<id>` and syncs the sequence from the database; the TTL sweep consults the stored last activity and deletes with a conditional delete; orphaned rows are swept under a lease; `EventBus.onRemote()` drops sessions ended elsewhere and mirrors the mic holder; `/events` subscribes with `{ remote: true }`; viewer captions are relayed (`setViewerRelay`); CORS knows sessions of other instances (`domainKnown`). Rehydrate at boot is skipped in shared mode. Known gaps are listed in `docs/DEPLOY.md` (per-session counters; plugin lookups by project key).

- **L6 (2026-10-12):** caption send lock replaced by an atomic sequence reservation (`SessionStore.reserveSequence`, `CLUSTER_SEND_LOCK=atomic` default, `lease` keeps the old behaviour); sticky routing by session recommended for strict order. Decided by Juha after the question whether DB-backed captions make the lock unnecessary.
