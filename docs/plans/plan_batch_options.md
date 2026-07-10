# Batched YouTube Sending with Per-Caption Options

**Status:** implemented
**Scope:** `packages/lcyt` (client library), `packages/lcyt-web` (`useSession`), regression tests in `packages/lcyt-backend`
**Backend changes:** none (verification only)

> Implemented as planned: `BackendCaptionSender.construct(text, timestamp, extraOpts)` with queue-time timestamping (plus `{ time }` form support for parity with `send()`), `useSession.construct` opts forwarding, `.d.ts` types (`BackendCaptionItem extends SendExtraOptions`), and the Phase 3 backend regression test (`test/captions.test.js`, "batch send keeps per-caption options...").

## Problem

When the batch interval is enabled (Settings → CC → batch interval, `lcyt.captions.batchInterval`), captions are queued client-side and flushed to `POST /captions` as one request every N seconds. This keeps the YouTube ingestion POST rate low, but the queue currently strips every per-caption option on the way in:

1. `useSession.construct(text, timestamp, opts)` accepts `opts` but calls `senderRef.current.construct(text, timestamp)` — `opts` is dropped (`packages/lcyt-web/src/hooks/useSession.js`).
2. `BackendCaptionSender.construct(text, timestamp)` has no options parameter at all; queue items are bare `{ text, timestamp: timestamp ?? null }` (`packages/lcyt/src/backend-sender.js`).

So in batch mode, `translations`, `captionLang`, `showOriginal`, `codes`, and `fileFormats` all silently vanish. Translated viewer pages, routed translation targets, backend caption files, and metacodes only work when batching is off.

There is a second, related loss: **timestamps collapse to flush time.** `InputBar` queues with `timestamp: undefined`, so every caption in the batch arrives at the backend without a timestamp and gets stamped on arrival — up to `interval` seconds late, and all captions in one flush get effectively the same time. This mis-spaces YouTube cues and (since VTT archiving landed) writes wrong cue times into archived VTT files.

## Key insight — the backend already supports this

`POST /captions` uses one code path for single and batch sends (`packages/lcyt-backend/src/routes/captions.js`). For an array of captions it already, **per caption**:

- resolves `time` → absolute timestamp,
- runs metacode processors,
- composes text from `translations`/`captionLang`/`showOriginal`,
- writes backend caption files per language (honouring per-language `fileFormats`),
- fans out to `extraTargets` with per-target routed translations (`translationsByTargetId`),
- broadcasts to viewer SSE subscribers,

and then delivers the whole composed batch to YouTube in **one** `session.sender.sendBatch(sendCaptions)` call. In other words: "batch for YouTube, translations separate" is exactly what the server does today — the client just never gives it the data. No backend changes are required; the whole fix is client-side.

## Design

Extend the queue path to carry the same whitelisted option fields as `send()`, and stamp timestamps at queue time.

### Phase 1 — `packages/lcyt` (`BackendCaptionSender`)

1. **`construct(text, timestamp, extraOpts)`** — merge the same whitelisted fields as `send()` into the queued item: `translations`, `captionLang`, `showOriginal`, `codes`, `fileFormats`. `sendBatch()` needs no change; it already posts queue items as-is.
2. **Queue-time timestamping** — when `timestamp` is omitted, stamp the item with the current wall-clock time as an ISO string without trailing `Z` (repo timestamp convention), instead of queuing `timestamp: null`. This preserves real cue spacing across the flush delay for both YouTube and archived VTT.
   - *Rejected alternative:* queuing `{ time: Date.now() - this.startedAt }` for server-side resolution. The `{ time }` contract resolves against the **server's** `session.startedAt + syncOffset`; the library's local `startedAt` is set client-side before the `/live` round-trip completes and can diverge after idempotent reconnects. An absolute client timestamp matches what `AudioPanel` already passes explicitly today, so it introduces no new clock-skew class.
3. **Types** — `backend-sender.d.ts`: add `extraOpts?: SendExtraOptions` to `construct()` and extend `BackendCaptionItem` with the optional `SendExtraOptions` fields (the interface added by the fileFormats work).
4. **Tests** (`packages/lcyt/test/backend-sender.test.js`): queued items carry the whitelisted fields and drop unknown ones; `sendBatch()` posts them verbatim; omitted timestamps are stamped at construct time (two constructs a tick apart get distinct timestamps); explicit timestamps pass through unchanged.

### Phase 2 — `packages/lcyt-web` (`useSession`)

1. `construct(text, timestamp, opts)` forwards `opts` to `senderRef.current.construct(text, timestamp, opts)` — a one-line change; the surrounding pending-entry bookkeeping already extracts display metadata from `opts` via `_translationMeta`, so the sent-log UI needs nothing.
2. `flushBatch()` is unchanged (`sendBatch()` with no args drains the sender queue as-is).
3. No `InputBar`/`AudioPanel` changes: both already build the full `opts` object and pass it to `session.construct(...)` — it just stops being dropped.
4. **Tests**: extend the existing `useSession` Vitest coverage with a batch-mode case asserting the flushed `POST /captions` body contains per-caption `translations`/`fileFormats` and construct-time timestamps.

### Phase 3 — `packages/lcyt-backend` (regression test only)

Add one batch test to `test/captions.test.js`: two captions in one POST, each with different `translations` and `fileFormats`, against a session with a mock primary sender and a local storage adapter. Assert:

- the primary sender receives **one** `sendBatch` call with two per-caption composed texts,
- backend caption files are written per caption per language with the requested formats,
- each caption keeps its own timestamp (distinct VTT cue times).

This pins the "backend already handles it" claim so a future refactor can't silently regress it.

## Edge cases and limits

- **Payload size:** the backend parses JSON with a 64 kB limit (`express.json({ limit: '64kb' })`). A 20 s batch of STT captions with 3–4 translation languages is typically well under 10 kB, so no guard is needed now. If limits are ever hit, the right fix is a client-side early flush when the queue exceeds ~50 items — noted here, deliberately not built.
- **Backward compatibility:** all new fields are optional; bare `{ text, timestamp }` items from old clients behave exactly as before. `construct()`'s new third parameter is additive.
- **Mixed batches:** captions with and without options can share one flush; every per-caption field is already handled independently server-side.

## Out of scope

- Server-side translation (see `plan_translate.md`) — translations remain computed client-side before `construct()`, which already happens (both `InputBar` and `AudioPanel` await `translateAll` before queueing).
- Changing how translations are routed to targets — the existing `translationsByTargetId` routing, viewer SSE composition, and backend-file writing are reused untouched.
- Batching of `extraTargets` fan-out HTTP calls (still per-caption, fire-and-forget).
