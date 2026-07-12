# Plan: Migrate lcyt-web `useVariables` onto `/events/stream`

**Status:** Draft — not yet scheduled
**Date:** 2026-07-12
**Context:** `plan_pubsub_event_bus.md` added the unified `GET /events/stream` and
per-variable topics (`variable.<name>.changed`, payload carries the value). The
`useVariables` hook (`packages/lcyt-web/src/hooks/useVariables.js`) still consumes
the bespoke `GET /variables/events` SSE. Migrating it onto `/events/stream`
consolidates the frontend onto the one subscription surface, lets the same
connection later carry other topics (DSK, cues, …), and moves `/variables/events`
from "load-bearing" to "removable".

---

## The blocker: EventSource can't wildcard-listen

`/events/stream` currently emits **per-topic named SSE events** (`event: variable.section.changed`).
`EventSource.addEventListener(name, …)` needs a **known** event name, and named
events do **not** fire the default `onmessage` handler — so a client subscribing
to `variable.*` can't catch dynamically-named `variable.<name>.changed` events.
`/variables/events` sidesteps this by using one fixed event name (`variable_updated`).

**Decision:** add a **flat delivery mode** to `/events/stream` so EventSource
clients can consume dynamic topic sets.

- `GET /events/stream?topics=variable.*&flat=1` emits every matching event under a
  single constant SSE event name (`message`), with the full canonical envelope
  `{ topic, projectId, ts, data }` in `data`. The client dispatches on
  `envelope.topic` and reads `envelope.data`.
- Default (no `flat`) keeps today's per-topic named events (nice for OBS-style
  consumers that listen for one specific event). Additive, no breaking change.
- Implementation is tiny — `subscribeSse` already supports `rename`; flat mode is
  `rename: () => 'message'` with `envelope: true` (the existing default envelope).

## Auth — no token minting needed

`/events/stream` project-access accepts the user/project JWT and treats it as
**full access** (the `events:read` `requiredScope` gate only applies to external
`lcytmcp_` tokens, not JWTs). So the browser's existing user JWT works via
`?token=<userJWT>` exactly like `/variables/events` does today. `GET /variables`
requires `variable:read` for a scoped external token; a JWT member has full
access and gets the whole snapshot.

---

## Steps

1. **Backend — flat mode** (`packages/lcyt-backend/src/routes/events-stream.js`):
   parse `?flat=1`; when set, pass `{ rename: () => 'message' }` to
   `eventBus.subscribeSse(...)` so the frame is `event: message\ndata: <envelope>`.
   Keep the `connected`/heartbeat frames as-is. Add an `events-stream.test.js`
   case asserting flat mode delivers `event: message` with the envelope.

2. **Frontend — `useVariables.js`**:
   - Keep the initial `GET /variables` snapshot fetch (unchanged).
   - Replace `new EventSource('${backendUrl}/variables/events?token=${token}')`
     with `new EventSource('${backendUrl}/events/stream?token=${token}&topics=variable.*&flat=1')`.
   - Replace `es.addEventListener('variable_updated', handler)` with
     `es.onmessage = (e) => { const env = JSON.parse(e.data); if (env.topic?.startsWith('variable.')) applyChange(env.data); }`
     where `applyChange(row)` sets `variables[row.name] = { value, source, … }`
     (same shape the old handler consumed — the envelope's `data` **is** the
     serialized row).
   - Keep `refresh()` (`POST /variables/refresh`) and `writeFileCode()`
     (`PUT /variables/:name`) unchanged.

3. **Tests**: extend `packages/lcyt-web/test/components/*` (Vitest) if a
   `useVariables` test exists (none today — matches the existing gap); otherwise a
   backend flat-mode test plus a manual/`/verify` browser drive of the live
   variables UI is the acceptance bar.

4. **Retire `/variables/events` (follow-up, not this change)**: once nothing else
   consumes it (grep confirms only `useVariables`), delete the route in
   `packages/plugins/lcyt-connectors/src/routes/variables.js` and
   `VariablesBus.addSubscriber`/`removeSubscriber`. Leave `emitVariableUpdated`
   (still the publish path). Do this as a separate small PR after the migration
   has soaked, so a rollback doesn't require touching the bus.

---

## Verification

- Backend flat-mode unit test green.
- `/verify`-style browser drive: open the app logged in, watch the variables
  panel, change a variable elsewhere (or `POST /variables/refresh`), confirm the
  value updates live — now sourced from `/events/stream`, with `/variables/events`
  no longer opened (check Network tab / server logs).
- Confirm reconnection still works (kill the connection, EventSource auto-retries).

## Summary

| Aspect | Decision |
|---|---|
| Delivery shape | Add `?flat=1` (constant `message` event + envelope) so EventSource can consume dynamic `variable.*` topics |
| Snapshot | Unchanged — `GET /variables` (now scope-hardened; JWT = full access) |
| Auth | Existing user JWT via `?token=` (JWTs bypass the external-token scope gate) |
| Legacy endpoint | Keep `/variables/events` until migration soaks, then remove in a follow-up |
| Breaking changes | None — flat mode is additive; snapshot/refresh/write paths unchanged |
