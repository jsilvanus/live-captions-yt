---
id: plan/backend_actions
title: "Backend Cue & Action Execution — Production Commands, Action Runner, Arming"
status: draft
summary: "Gives cues and named actions a real backend side effect. A shared `ProductionCommands` service (lcyt-production) becomes the single path to cameras/mixers/crop for HTTP routes, AI tools and actions (direct adapter or lcyt-bridge). `cue.fired` is published on the EventBus (today only `plugin.cue_fired` reaches it, and only with a caption session). An `ActionExecutor` (lcyt-actions) runs composite actions server-side (device steps by camera/mixer label, connector/graphics/wait steps) via `POST /actions/run` and an `action.run` tool, emitting `action.*` events. A `CueActionDispatcher` subscribes to `cue.fired` behind safety rails: a per-broadcast armed switch (disarmed by default, auto-arms on go-live), cooldowns, a loop guard and role checks. Decisions (2026-10-04) are at the end."
related: plan/named_actions, plan/cues, plan/prod, plan/vertical_crop, plan/pubsub_event_bus, plan/project_roles
---

# Backend Cue & Action Execution

2026-10-04. Status: draft (design agreed). Based on `main` at `5343c51`.

## Summary

The bridge and the event bus both take part, with different jobs:

- **The bridge is the hardware transport.** Cameras and mixers on the church LAN are reached through `lcyt-bridge`; that does not change. Actions never talk to the bridge directly; they go through one production command service that decides "direct adapter or bridge" per device.
- **The event bus is the trigger and the record, not the command channel.** Cues firing, actions starting/finishing and device results are published on the bus. The command itself is a direct function call, because it needs a return value, an auth context and a timeout, and the bus has none of those (it is fire-and-forget, and it also fans out to SSE clients).

```
caption / STT / music / tracker / operator button / AI tool / MCP
        │
   cue engine ──publish──▶ EventBus  'cue.fired'
                              │ (in-process subscriber)
                              ▼
                     CueActionDispatcher  ── armed? cooldown? loop depth?
                              │
                              ▼
   POST /actions/run ─▶  ActionExecutor  (lcyt-actions)   ◀── tool action.run (AI/MCP)
                              │  expands @refs, runs atoms in order
            ┌─────────────────┼──────────────────┬──────────────┐
            ▼                 ▼                  ▼              ▼
   ProductionCommands     connectors         DSK graphics   client atoms
   (lcyt-production)      refresh            activate       (returned to UI:
     │  ownership check                                      audio, goto, section)
     ├─ direct adapter (VISCA/AMX/ATEM/OBS)
     └─ bridgeManager.sendCommand ──SSE──▶ lcyt-bridge ──TCP/HTTP──▶ device
                                   ◀── POST /bridge/status (result)
     │
     └─ notifyProgramChanged / notifyCameraPresetRecalled  → crop follow
     └─ publish 'production.command_result'
```

## What exists today (and what is in the way)

- **Named actions run only in the browser** (`lcyt-web/src/lib/metacode-actions.js` `applyAtoms`). The backend (`lcyt-actions`) only stores `action_defs.definition` strings. Known atoms: `api:`, `audio:`, and variable/graphics/section assignments. No device atom.
- **Cue actions are descriptive.** `cue-processor.js` parses `rule.action` JSON and attaches it to a `cue_fired` SSE event for the frontend (rundown jump). No backend side effect.
- **Device control is written twice.** The camera preset logic (bridge vs direct, preset lookup, `\r\n` payload) exists in `lcyt-production/src/routes/cameras.js:290` and again in `lcyt-tools/src/tools/cameras.js:72`; same for mixers. The tool copy skips the ownership check and the `notifyCameraPresetRecalled`/`notifyProgramChanged` calls, which is why AI-driven switches don't make the vertical crop follow.
- **Bug: `cue.fired` is never published.** Cue fires reach the bus only as `plugin.cue_fired`, re-emitted from a caption session's emitter (`lcyt-backend/src/store.js:89`), and only if a session exists. But the event catalog, `bus-events.js`, MCP token scopes and the Hosted Operator (`operator-manager.js:20`) all subscribe to `cue.fired`. So today the Operator never sees cues, and a cue fired with no caption session open (server STT, production-only use) reaches nobody.
- **The bridge is already a good transport:** request/response correlation (`requestId`, `POST /bridge/status`), per-call timeouts, typed commands (`tcp_send`, `http_request`, `atem_switch`, `obs_switch`, `model_call`) and IP allow/deny security rules. No new bridge command types are needed for cameras and mixers.

## Proposed building blocks

### 1. `ProductionCommands` (in `lcyt-production`)

One service that every caller uses for device side effects:

```js
const result = await productionCommands.execute(apiKey, {
  kind: 'camera.preset', cameraId, presetId,
}, { source: 'cue', causation });
// kinds: camera.preset, mixer.switch, crop.activate_preset (via injected crop hook), obs.scene
// → { ok, kind, transport: 'direct'|'bridge', durationMs, error? }
```

It does the ownership check (`owner_api_key`), picks direct adapter vs `bridgeManager.sendCommand`, fails fast if the bridge is offline (a camera move that arrives 30 s late is worse than none, so no queueing), fires the production-follow notifications, and publishes `production.command_result`. The HTTP routes and the `lcyt-tools` camera/mixer/crop tools become thin wrappers. This alone fixes the crop-follow gap and removes the duplication, and is useful even if nothing else ships.

### 2. `ActionExecutor` (in `lcyt-actions`)

Runs a composite action on the server:

- Move `parseActionItems`/`expandActionItems` into a pure shared module (`lcyt/actions` export in the core package, like `lcyt/event-bus`) so the web client and the backend parse identically.
- An **atom registry**: each atom key has a handler and a `where` of `server` or `client`.
  - Server atoms: `camera:<camera>.<preset>`, `mixer:<mixer>.<input>`, `crop:<preset>`, `obs:<scene>`, `api:<connector>.<request>` (call the connectors refresh function directly), `graphics:` (DSK activate), and `wait:2s` for timing between steps.
  - Client atoms (`audio`, `goto`, `section`, plain variables) are returned in the result for whichever UI started the run; when a cue starts the run, they go out on the bus for connected UIs.
- Device names in atoms use the camera/mixer `label` slug, falling back to id, so `camera:pulpit.wide` reads well in a rundown.
- Steps run in order; each step has its own timeout; the default is to continue on error and report per-step results (`stopOnError` per run).
- Entry points: `POST /actions/run { ref | expr }` (production tier) and an AI/MCP tool `action.run`, so the Production Assistant and the Hosted Operator can run named actions too.
- Publishes `action.started`, `action.step`, `action.completed`, `action.failed`. The existing audit tap records them automatically.

### 3. Cues trigger actions through the bus

- `cue-processor.js` publishes canonical `cue.fired` straight onto the injected `EventBus` (keep the legacy session `cue_fired` event for existing SSE clients). This fixes the bug above.
- `cue_rules.action` gets an executable form, for example `{ "run": "@intro | camera:pulpit.wide" }`. Existing descriptive actions keep working unchanged.
- A small `CueActionDispatcher` subscribes in process to `cue.fired` and hands `run` to the `ActionExecutor`. Keeping it a subscriber (not a call inside the cue engine) keeps `lcyt-cues` free of production dependencies, and lets other event sources (tracker `camera.track_state`, `external.*` webhooks, music state) be wired the same way later.

### 4. Safety rails (needed before cues can move cameras)

- **Armed switch per project** (or per active broadcast): when disarmed, cue-triggered runs are logged as `action.skipped` and do nothing. Manual runs from the operator UI always work. Recommend **disarmed by default**, armed from the Production header together with the broadcast going live.
- **Cooldown** per rule and per device, so a phrase repeated three times doesn't fire three moves.
- **Loop guard:** a mixer switch can trigger an event cue that triggers another switch. Carry a `causation { rootId, depth }` in bus envelope meta and refuse runs past depth 3.
- **Permissions:** authoring an action or cue that contains device atoms needs Setup tier; running one manually needs Production tier (operator). Cue-triggered runs act as the project, gated by the armed switch.
- Bridge security rules still apply on the bridge side, as today.

## Phases

1. **ProductionCommands** + migrate the camera/mixer routes and `lcyt-tools` tools onto it. Fixes AI crop-follow. Small, low risk.
2. **Publish `cue.fired`** on the bus and move the action parser to `lcyt/actions`. Fixes the Hosted Operator bug.
3. **ActionExecutor** with server atoms, `POST /actions/run`, the `action.run` tool and lifecycle events.
4. **CueActionDispatcher** with the armed switch, cooldowns and loop guard.
5. **Web UI:** named-action send path calls `/actions/run` for server atoms; cue rule editor gets a "Run action" field with device pickers; Production header shows armed state and a live action log fed from `action.*` events.

Phases 1 and 2 are independent and can be done in parallel. 3 needs 1. 4 needs 2 and 3.

## PR sequence

1. This plan doc. 2. `ProductionCommands` service and migration of routes/tools. 3. Publish `cue.fired` on the bus. 4. `ActionExecutor`, `POST /actions/run`, `action.run` tool. 5. `CueActionDispatcher` + arming. 6. Web UI (badge, cue-editor "Run action", device pickers, action log).

## Decisions

- **Arming: accepted by Juha 2026-10-04.** One switch per project, stored on the active broadcast; disarmed by default, auto-arms when the broadcast goes live and disarms when it ends, with a manual override; ARMED/SAFE badge in the Production header (operator+ may toggle); changes published on the bus.
- **Device atoms: agreed 2026-10-04.** Steps are written with the camera/mixer label (unique per project, enforced by the editor); the id is stored behind the scenes on save so renames don't break saved actions; typing an id directly still works.
- **Status: plan ready to implement.** No open design questions.
