# Plan: Pub/Sub Event Bus — Unified Internal & External Event Distribution

**Status:** Implemented — shared `EventBus` (`lcyt/event-bus`); `DskBus`/`VariablesBus`/`RolesBus` and the per-session event stream migrated onto it (zero wire-shape change); additive `GET /events/stream` with `events:read` + `tokenAllowsTopic` scoping; in-process `subscribe()` shipped and now has a real product consumer — `OperatorManager` (`packages/lcyt-backend/src/operator-manager.js`, `plan_unified_external_control.md` Phase 2) subscribes to project topics to feed the Hosted Operator's turn loop; insert-only `bus_events` audit log with `EVENT_LOG_RETENTION_DAYS` retention. Fixed a latent `session:closed`/`session_closed` spelling mismatch en route.
**Date:** 2026-07-08
**Context:** Companion to `plan_authentication_refactor.md` (this plan depends on it for the external-subscriber auth model) and to `CONSIDER.md`'s "`VariablesBus` duplicates `DskBus`'s SSE subscriber/broadcast logic" finding (2026-07-05) — this plan resolves that duplication by generalizing the deferred extraction into a real event bus rather than a mechanical dedup. Originated from a chat discussion exploring whether `DskBus` was "the" event bus (it isn't — see Background).

---

## Background

`DskBus` (`packages/lcyt-backend/src/dsk-bus.js`) is one of at least **four** independently-implemented, near-identical per-project SSE subscriber registries:

| Bus | File | Keyed by | Events |
|---|---|---|---|
| `DskBus` | `lcyt-backend/src/dsk-bus.js` | `projectId` | `graphics`, `text`, `bindings`, `templates`, `layer_update` |
| `VariablesBus` | `lcyt-connectors/src/variables-bus.js` | `projectId` | `variable_updated` |
| `RolesBus` | `lcyt-agent/src/roles-bus.js` | `` `${projectId}:${roleCode}` `` | `tool_call_started`, `tool_call_result`, `reply`, `staged_action`, `assistant_suggestion`, `assistant_action`, `tracker_update`, `describer_update` |
| `session.emitter` (per-session `EventEmitter`) | `lcyt-backend/src/store.js` | session | `caption_result`, `caption_error`, `mic_state`, `session_closed`, generic `event` (cue/plugin forwarding) |

Plus bespoke SSE routes for STT (`/stt/events`) and cues (`/cues/events`), and `BridgeManager` (`lcyt-production/src/bridge-manager.js`) which runs its own SSE connection-handling for a structurally different consumer (installed hardware agents).

### Problems

1. **No internal pub/sub.** Each plugin only broadcasts to its own private subscriber set. `lcyt-agent`'s Production Assistant can't react to "DSK graphics changed" or "cue fired" without polling — it only sees events it emits onto its own `RolesBus`.
2. **No unified external subscription surface.** A third party wanting "everything happening on project X" needs five separate SSE connections, each with a different auth convention (see `plan_authentication_refactor.md`).
3. **Duplicated connection-handling code.** `VariablesBus`'s own header comment admits it "mirrors" `DskBus`; `RolesBus` is the same shape again with an extra key segment. Already flagged in `CONSIDER.md` as a deferred `SseSubscriberBus` extraction.

---

## Goals

- One in-process `EventBus` that plugins **publish onto** instead of owning a private `Map<apiKey, Set<Response>>`.
- One unified external SSE endpoint with topic filtering, **additive** to the existing bespoke endpoints (no breaking change to any current client).
- Let Production Assistant / vision roles / cue engine subscribe to each other's events in-process — closes the cross-plugin blindness gap.
- Resolve the `CONSIDER.md`-flagged duplication as a side effect of building this properly, rather than a standalone mechanical refactor.
- Keep the existing session-based live-caption routes (`/live`, `/captions`, `/sync`, `/events`, `/stats`, `/file`, `/mic`) as session-bound, while moving project-scoped config/event subscriptions onto the new project-access model.

## Non-Goals

- **Auth mechanism.** Depends on `plan_authentication_refactor.md`'s auth-policy model (project access, scoped `mcp_tokens`, bridge tokens, device tokens) plus its explicit public-route allow-list. The event bus should consume the common identity shape from that plan: a user context with `sub`/`userId`, `siteRole`, `projectRole`, and optional scopes. This plan assumes that lands first or in parallel — it does not re-litigate auth.
- **Delivery guarantees beyond best-effort broadcast.** Already decided: no Last-Event-ID/replay buffer, no reconnect resumption. Gaps of 10–20 seconds are acceptable for every current consumer.
- **A durable, replayable event log.** The persisted log below is an audit trail, explicitly *not* a replay mechanism for reconnecting subscribers.
- **Webhook-style outbound push** to third-party URLs — not requested, not designed here.

---

## Proposed Architecture

### `EventBus` core

New module (e.g. `packages/lcyt-backend/src/event-bus.js`):

```js
export class EventBus {
  constructor() {
    this._subscribers = new Map();   // projectId -> Set<{ res, topics }>
    this._listeners = new Map();     // projectId -> Set<{ topics, handler }>  (in-process, no res)
  }

  publish(projectId, topic, data) {
    const envelope = { topic, projectId, ts: Date.now(), data };
    for (const sub of this._subscribers.get(projectId) ?? []) {
      if (!topicMatches(sub.topics, topic)) continue;
      try { sub.res.write(`event: ${topic}\ndata: ${JSON.stringify(envelope)}\n\n`); }
      catch { this._subscribers.get(projectId)?.delete(sub); }
    }
    for (const l of this._listeners.get(projectId) ?? []) {
      if (topicMatches(l.topics, topic)) l.handler(envelope);
    }
  }

  subscribeSse(projectId, topics, res) { /* add to _subscribers, same prune-on-write-failure pattern as today's buses */ }
  subscribe(projectId, topics, handler) { /* in-process listener, no HTTP */ }
}
```

This is the generalized version of the `SseSubscriberBus` extraction `CONSIDER.md` already deferred — same connection bookkeeping (`Map<projectId, Set<...>>`, write-with-prune-on-failure) as today's four buses, but topic-aware and usable both over SSE and in-process.

### Topic taxonomy

> **See also `plan_metacode_variable_unification.md`.** That plan proposes that these topic
> names be *declared by* the metacode/variable reserved-name registry (each name's `emitsTopic`),
> so `variable.updated` fires on any plain variable assignment and each reserved actionable name
> (`graphics`, `cue`, `audio`, …) owns its domain topic. It doesn't change the taxonomy below —
> it gives it a single authoritative source, and keeps *metacode name ≈ variable name ≈
> event-bus domain* one vocabulary. This plan (the bus mechanism) is independent of that one.

Namespacing convention: `<domain>.<event>`. Mapping from today's ad hoc event names:

| Topic | Publisher | Today's equivalent |
|---|---|---|
| `dsk.graphics_changed` / `dsk.text` / `dsk.bindings` / `dsk.templates_changed` / `dsk.layer_updated` | `lcyt-dsk` | `DskBus`'s `graphics`/`text`/`bindings`/`templates`/`layer_update` |
| `variable.updated` | `lcyt-connectors` | `VariablesBus`'s `variable_updated` |
| `assistant.suggestion` / `assistant.action` | `lcyt-agent` (Production Assistant) | `RolesBus`'s `assistant_suggestion`/`assistant_action` |
| `role.tool_call_started` / `role.tool_call_result` / `role.reply` / `role.staged_action` | `lcyt-agent` (chat-dialog roles) | `RolesBus`'s same-named events |
| `vision.tracker_update` / `vision.describer_update` | `lcyt-agent` (vision roles) | `RolesBus`'s same-named events |
| `cue.fired` | `lcyt-cues` | `/cues/events`, and `session.emitter`'s generic `event` forwarding |
| `stt.transcript` / `stt.started` / `stt.stopped` / `stt.error` | `lcyt-rtmp` (`SttManager`) | `/stt/events`'s same-named events |
| `caption.sent` / `caption.error` / `session.mic_state` / `session.closed` | `lcyt-backend` core | `session.emitter`'s `caption_result`/`caption_error`/`mic_state`/`session_closed` |
| `bridge.status_changed` / `bridge.command_result` | `lcyt-production` (`BridgeManager`) | new — today only visible via `GET /production/bridge/instances` polling |

### External unified endpoint

`GET /events/stream?topics=dsk.*,cue.fired` — one SSE connection, topic-filtered (wildcard suffix matching, since the topic list will keep growing), authenticated per `plan_authentication_refactor.md` using the new project-access model (project membership + scoped tokens, not the old per-api-key assumption).

**Additive, not a replacement.** Every existing bespoke endpoint (`/dsk/:apikey/events`, `/variables/events`, `/roles/:roleCode/events`, `/cues/events`, `/stt/events`) keeps its current URL and exact event-name wire shape — each becomes a thin wrapper that internally calls `eventBus.subscribeSse()` filtered to its own topic(s) and re-emits under its historical event name. Zero client-visible change for any existing consumer (browser tabs, OBS overlays, existing dashboard code).

### Internal cross-plugin subscription (the actual new capability)

```js
// inside lcyt-agent's Production Assistant wiring
eventBus.subscribe(projectId, ['cue.fired'], (envelope) => {
  assistantManager.notePluginEvent(projectId, envelope);
});
```

No HTTP round-trip, no polling — this is what closes the gap where Production Assistant is currently blind to DSK/cue/variable events happening in other plugins. What each role *does* with a given topic (nudge context, trigger a suggestion, ignore) is a product decision per role, not built wholesale by this plan — the mechanism is the deliverable here, not a specific new assistant behavior.

### Persisted audit log (decoupled from live delivery)

Per the explicit decision that replay is unnecessary and 10–20s gaps are fine for live subscribers:

- New table, e.g. `bus_events (id INTEGER PRIMARY KEY, project_id TEXT, topic TEXT, ts INTEGER, payload_json TEXT)`, insert-only.
- **Not wired to reconnect/replay in any way** — purely a queryable history for humans/debugging, decoupled from the live SSE path.
- **Curated allowlist, not every topic.** `better-sqlite3` is synchronous/single-writer; logging high-frequency topics (`caption.sent`, `session.mic_state`, `stt.transcript`) would put a synchronous DB write on the hot path for no real benefit (losing those costs nothing given the accepted gap tolerance). Log only topics with real audit/debug value: `assistant.suggestion`/`assistant.action`, `cue.fired`, `dsk.templates_changed`/`dsk.graphics_changed`, target/translation config changes, `bridge.command_result`.
- **Kept separate from `AgentEngine`'s `agent_context`.** `agent_context` is prompt-shaping (max 50 entries, curated for what the model sees); this log is a human-facing/debug audit trail with different retention and volume needs. Do not couple them.
- **Retention:** new env var (e.g. `EVENT_LOG_RETENTION_DAYS`), cleanup timer mirroring the existing `REVOKED_KEY_TTL_DAYS`/`REVOKED_KEY_CLEANUP_INTERVAL` pattern already used for revoked-key cleanup.
- **No read endpoint in this phase.** Defer `GET /events/log` (or similar) until a concrete consumer needs it — flagged as an open question below, not blocking the rest of this plan.

---

## Migration Plan / Implementation Steps

1. **Build `EventBus` core** (`publish`/`subscribeSse`/`subscribe`, topic-match helper with wildcard support) — this supersedes the `CONSIDER.md`-deferred `SseSubscriberBus` extraction.
2. **Wire pluggable `authenticate()`** per `plan_authentication_refactor.md`'s tiers once that plan lands (hard dependency for the *external* endpoint; internal `subscribe()` needs no auth since it's in-process).
3. **Migrate `DskBus`, `VariablesBus`, `RolesBus` to publish through `EventBus` internally**, one at a time, keeping each class's existing public method signatures as thin wrappers — zero external API change, existing test suites for each must stay green before moving to the next.
4. **Add `GET /events/stream`** unified external endpoint (additive, topic-filtered).
5. **Wire Production Assistant / vision roles to `subscribe()`** to relevant topics in-process — starts closing the cross-plugin blindness gap. Which topics feed which role's behavior is a follow-up product decision, not prescribed here.
6. **Add `bus_events` table**, curated-topic logging on `publish()`, retention cleanup timer.
7. **Tests:**
   - `EventBus` unit tests: publish/subscribe/prune-on-write-failure, topic wildcard matching, in-process listener isolation from SSE subscribers.
   - Regression tests for each migrated bus confirming unchanged external behavior (mirrors the caution already established by `roles-mount-order.test.js` for this exact class of "looks fine in isolation, breaks in the real mount order" bug).
   - `bus_events` retention/cleanup test.

---

## Open Questions

- **Exact audit-log topic allowlist** — the list above is a starting proposal; final scope is a product decision (what's worth keeping a record of), not purely an engineering one.
- **Should `assistant.suggestion`/`assistant.action` be logged unconditionally** (governance-relevant — "what did the autonomous agent actually do") **rather than subject to the same operator-configurable allowlist as everything else?** Recommend yes — these two are the one category where losing the record has a different cost than losing a debug event.
- **Topic-filter syntax for `/events/stream`** — MQTT-style wildcard suffixes (`dsk.*`) vs. an explicit flat list. Recommend wildcard support given the topic count will only grow.
- **Whether/when to build `GET /events/log`** — no consumer needs it yet; revisit once one does.

---

## Summary

| Aspect | Decision |
|---|---|
| Internal pub/sub | New `EventBus`, in-process `subscribe()` — no HTTP for cross-plugin consumption |
| External subscription | New additive `GET /events/stream`, topic-filtered; existing bespoke endpoints become thin wrappers, unchanged wire shape |
| Auth | Deferred to `plan_authentication_refactor.md` (dependency, not re-designed here) |
| Delivery guarantee | Best-effort broadcast only — no replay, no Last-Event-ID, 10–20s gaps acceptable |
| Persisted log | Separate, curated-topic, insert-only `bus_events` table — audit trail, not replay; not coupled to `agent_context` |
| Breaking changes | None — migration keeps every existing external contract identical |
| Resolves | `CONSIDER.md`'s `VariablesBus`/`DskBus` duplication finding (as a byproduct, not the primary goal) |
| Out of scope | Auth design, durable replay, webhooks, `GET /events/log` read endpoint |

This plan is **exploratory** — written to make the bus buildable once `plan_authentication_refactor.md`'s auth tiers are settled; not yet scheduled.
