# Plan: Consolidate the Operator Web UI onto a Single `/events/stream` Connection

**Status:** Draft — not yet scheduled (self-contained follow-up; not in the event-bus PR)
**Date:** 2026-07-12
**Context:** The authenticated operator web UI currently opens **several** SSE
connections — one per domain (`useVariables` → `/variables/events`, roles panels →
`/roles/:roleCode/events`, the caption session → `/events`, …). After the pub/sub
work (`plan_pubsub_event_bus.md`) those bespoke endpoints are all thin wrappers over
one `EventBus`, so the UI can collapse to a **single `EventSource`** on
`GET /events/stream`, demultiplexed by topic. Result: one client-side listener, one
server-held SSE connection, one auth/reconnect path — instead of N. (Supersedes the
earlier `plan_usevariables_events_stream.md`, which scoped only the variables hook;
the real payoff is UI-wide consolidation, with `useVariables` as the pilot.)

---

## Goal

One shared `EventSource` in the operator UI, subscribed to
`GET /events/stream?topics=variable.*,role.*,cue.fired,dsk.*,caption.*,session.*&flat=1`,
that fans envelopes out to the existing per-feature consumers by `envelope.topic`.
Retire the bespoke **authenticated** SSE endpoints once nothing consumes them.

**Out of scope (stays as-is):** the **public** SSE surfaces — `/dsk/:apikey/events`
(OBS overlays), `/viewer/:key`, `/music/:key/live`. They're unauthenticated and
served to browser sources on arbitrary machines, so they can't move onto the authed
unified stream.

## What it takes

### 1. Backend — flat delivery mode
`GET /events/stream?flat=1` emits every matching event under a **constant** SSE event
name (`message`) with the full canonical envelope in `data`, so `EventSource`
(`es.onmessage`) can consume dynamically-named topics like `variable.<name>.changed`
(named events can't be pre-registered). Tiny change — `subscribeSse` already supports
`rename`; flat = `rename: () => 'message'`, envelope kept. (Default per-topic named
events stay for OBS-style consumers.) One `events-stream.test.js` case.

### 2. Frontend — one `useEventStream` hook
New `packages/lcyt-web/src/hooks/useEventStream.js`: opens the single `EventSource`
(user/session JWT via `?token=`), parses each envelope, and dispatches to registered
per-topic handlers (`on(topicPattern, handler)` using the same `topicMatches`
semantics). Owns the reconnect/backoff + heartbeat handling once, for everyone.

### 3. Migrate consumers onto it
- **`useVariables`** — drop its own `EventSource`; register `variable.*` on the shared
  hook, keep the `GET /variables` snapshot fetch. (The pilot.)
- **Roles panels** — drop `/roles/:roleCode/events`; register `role.<roleCode>.*`,
  filtering by the role they care about.
- Each migrated consumer stops owning a socket and becomes a topic subscriber.

### 4. Session-scoped events need a client-side `sessionId` filter
`/events/stream` is **project**-scoped; the old `/events` route was **session**-scoped
(it filtered `caption.sent`/`session.mic_state`/`session.closed` to one `sessionId`).
On the unified stream the UI receives those for *all* the project's sessions, so
consumers filter by `envelope.sessionId` (carried in the envelope meta). Fine for a
single-operator UI; required if a project ever runs multiple concurrent sessions.

### 5. Retire the bespoke authed endpoints (after soak)
Once no UI code opens them, remove `/variables/events` and `/roles/:roleCode/events`
(and their `VariablesBus`/`RolesBus` `addSubscriber`/`removeSubscriber` wrappers —
leave the publish paths). Do this as its own small PR after the migration has run in
production for a bit, so a rollback doesn't touch the bus.

## Phasing

- **Phase A (core consolidation):** flat mode + `useEventStream` + migrate
  `useVariables` and the roles panels. Retire `/variables/events` + `/roles/:roleCode/events`.
- **Phase B (optional, later):** fold the caption **session** stream (`caption.*` /
  `session.*`, with the `sessionId` filter) onto the shared hook and retire `/events`
  for the UI — needs care because `/events` has other consumers (embed pages); audit
  first. Fold `/stt/events` only after `stt.*` topics are actually published on the bus
  (currently deferred).

## Auth

The browser's existing JWT (user/project/session) works on `/events/stream` — the
`events:read` `requiredScope` gate only applies to external `lcytmcp_` tokens, so JWT
members get full access. No token minting, same `?token=` pattern the bespoke SSE
routes use today.

## Verification

- Backend flat-mode unit test.
- `/verify`-style browser drive: open the operator UI logged in; confirm **one**
  `/events/stream` connection in the Network tab (and that `/variables/events` /
  `/roles/:roleCode/events` are no longer opened); change a variable and a role event
  elsewhere and see both update live off the single stream; confirm reconnect works
  (drop the connection, EventSource retries, all consumers resume).
- Multi-session sanity (if applicable): a second session's caption events don't leak
  into the first session's UI (the `sessionId` filter holds).

## Summary

| Aspect | Decision |
|---|---|
| UI event transport | one `EventSource` on `/events/stream?...&flat=1`, demuxed by topic |
| New surface | `?flat=1` delivery mode + a shared `useEventStream` hook |
| Snapshots | unchanged (`GET /variables`, etc.) |
| Session events | client-side `sessionId` filter (project-scoped stream) |
| Public overlay/viewer/music SSE | unchanged — can't move to the authed stream |
| Bespoke authed SSE (`/variables/events`, `/roles/:roleCode/events`) | retired after soak (separate PR) |
| Breaking changes | none — flat mode is additive; snapshots/auth unchanged |
