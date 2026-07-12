# Plan: Unified External Control & Automation

**Status:** Implemented — Phases 1–3 shipped
**Date:** 2026-07-12
**Context:** We want the LCYT platform to be controllable and observable from
outside the browser UI — by scripts, by third-party integrations, and ultimately
by AI agents that can *run a production from chat* (switch cameras, switch mixer
inputs, start/stop RTMP fanout, edit DSK, even do first-time setup). This plan is
the umbrella that ties together the event bus, the shared tool registry, the token
scope model, and the agent safety gate into **one core with several doors**, all
authorized by the same token scopes. It supersedes the earlier MCP-only framing.

Related plans: `plan_pubsub_event_bus.md` (the bus, Phase 0), `plan_mcp.md` (the
shared tool registry), `plan_authentication_refactor.md` (project access +
scopes), `plan_ai_roles_framework.md` (the agent turn loop + Production Assistant),
`plan_web_ui_event_stream_consolidation.md` (fold the operator UI onto one stream).

---

## The key distinction: commands vs. events

Everything below rests on one separation:

- **Events** = "something happened" (`cue.fired`, `rtmp.stopped`, an external
  signal). Fire-and-forget, one-to-many, no reply. → the **EventBus** / `/events/stream`.
- **Commands** = "do this" (switch camera 2, start fanout, create a mixer). RPC —
  needs a target, a result, an error, authorization. → the **tool registry**.

Driving the system is *commands*, so control goes through **tools**, not through
publishing command-shaped events onto the bus. The bus is the **feedback/observation**
channel that closes the loop (an actor calls a tool, then sees the resulting event).
External bus *writes* are therefore deliberately limited to a fenced `external.*`
*event* namespace (a third party signalling something), never system control.

## The core (Phase 0 — shipped)

| Piece | Role | Where |
|---|---|---|
| **EventBus** | event fabric (pub/sub, SSE, in-process `subscribe()`, audit) | `lcyt/event-bus`, `plan_pubsub_event_bus.md` |
| **`lcyt-tools` registry** | command/action fabric (cameras, mixer, DSK, captions…) | `packages/lcyt-tools`, `plan_mcp.md` |
| **Scope model on `mcp_tokens`** | one authorization vocabulary | `resource:verb` + `events:read/write` + topic patterns; `tokenHasScope`/`tokenAllowsTopic` |
| **Confirm/auto gate** | agent safety | Production Assistant (`plan_ai_roles_framework.md`) |

## The doors (every one authorizes through the same token scopes)

| Door | For | Interaction | Status |
|---|---|---|---|
| **REST** (scoped) | scripts / integrations | request/response CRUD | ✅ shipped |
| **`GET /events/stream`** | any subscriber | subscribe (feedback) | ✅ shipped |
| **`POST /events` (`external.*`)** | third parties emitting signals | push an event in | 🔲 Phase 3 |
| **In-process MCP endpoint** | BYO-harness agent (e.g. Claude Desktop) | interactive tool calls | 🔲 Phase 1 |
| **Hosted operator** | autonomous, event-fed agent | pushed events → reacts | 🔲 Phase 2 |

**The unifying thread:** a token's scopes decide what it can do across *all* doors at
once — which tools (`camera:write`), which topics (`dsk.*`), which REST
(`variable:read`), whether it can stream (`events:read`) or publish (`events:write`).
One token works everywhere it's scoped for; there is no per-door auth system.

## Interaction models (why there are two agent doors)

The "agent gets messages about what's happening and reacts" experience (like the
GitHub-watcher in Claude Code) requires a **runtime that owns the agent loop and
injects events as turns**. That yields two genuinely different shapes:

- **Hosted operator (Phase 2)** — *we* own the loop; it subscribes to the bus, each
  relevant event becomes a turn, it acts via the in-process tool registry with
  confirm/auto. "Bring your own" = **your model/key**, not your harness. This is the
  autonomous, GitHub-style experience — and it's essentially the **deferred
  in-process `subscribe()` consumer** from the event-bus plan, wired to a
  session-long Production-Assistant-style role.
- **BYO harness (Phase 1)** — the user drives from their own MCP client (Claude
  Desktop). MCP is client-initiated, and a chat harness won't autonomously wake and
  act on a pushed event, so this door is **interactive / request-then-act**: the
  human drives; events can *inform* (poll tool or MCP resource-update notifications)
  but don't autonomously trigger action.

They compose: both act on the same registry under the same scopes; the operator can
react to an `external.*` event a third party pushed; a Claude Desktop user observes
the same stream. Different entry points, one system.

---

## Phasing

### Phase 0 — Core (✅ shipped in this PR)
EventBus + `/events/stream` + `/events/topics` catalog + per-variable topics +
`bus_events` audit + the scope model (`resource:verb` REST gating, `events:read`,
`tokenAllowsTopic`) + Setup Hub scope picker. The tool registry and Production
Assistant/confirm-auto already existed.

### Phase 1 — In-process MCP endpoint (BYO-harness door)
Mount an MCP-over-HTTP/SSE transport **inside `lcyt-backend`**, backed by the same
`_toolRegistry` the composition root already builds (`server.js:283` — live
`productionRegistry`/`bridgeManager`/RTMP managers/`AgentEngine`). This resolves the
`CONSIDER.md` "external MCP transport" gap (decision: in-process, not a separate
process proxying HTTP).
- **Auth:** `createProjectAccessMiddleware(..., { requiredScope: 'mcp:connect' })`;
  `apiKey = req.auth.projectId` fed into `callToolAs`.
- **Tool-level authz = the scope model, lifted to tools.** Each tool declares
  required scope(s) (`camera:write`, `mixer:write`, `rtmp:write`, `dsk:write`,
  `caption:send`, `settings:write`); the endpoint **lists only callable tools** and
  enforces on invoke. Null scopes = full delegation. Derive read/write from the
  existing `readOnlyHint`/`destructiveHint` where no explicit scope is set.
- **Tool coverage:** audit registry vs. target verbs; add missing tools (RTMP fanout
  start/stop, encoder/device setup) as thin handlers over managers the composition
  root already holds.
- **Safety:** confirm-by-default — `destructiveHint` tools staged for operator
  confirmation (reuse the Production Assistant confirm/auto gate) unless the
  project/token is explicitly auto; read-only tools run immediately. Audit + rate
  limits.
- **Fate of standalone `lcyt-mcp-http`:** deprecate or redirect live-control clients
  to the in-process endpoint (open Q).

### Phase 2 — Hosted operator (autonomous door)
Wire `eventBus.subscribe(projectId, topics, handler)` to feed a **session-long
Production-Assistant-style operator**: relevant events become turns in its context
(`agent_context`), it decides whether to act (with cooldowns — the Assistant already
has this), and executes via the tool registry with **confirm-by-default**. BYO
model/key via the existing provider registry / per-role model config. The genuinely
new piece is the *persistent, event-fed session* (today the Assistant fires
per-trigger). Optionally run the operator's brain on Claude directly (Anthropic API /
Agent SDK) instead of the OpenAI-compatible `agentic-turn` loop — same architecture,
different engine.

### Phase 3 — `external.*` bus write (third-party-signal door)
Additive `POST /events` publishing to the bus, **fenced** to an `external.*`
namespace (internal domains `caption`/`cue`/`dsk`/`session`/`role`/`variable`/`stt`/
`bridge` can only be published by internal code). Gated on `events:write` (+ optional
topic patterns via `tokenAllowsTopic`); envelope stamped `source:'external'` +
`tokenId`; size/rate limited; always audited. First consumer: an "external event
cue" match type (or an in-process `subscribe()` handler) so `external.*` can drive
internal reactions — opt-in.

### Cross-cutting
Extend the scope picker + catalog with tool/write scopes; production actions emit bus
events (`camera.switched`, `mixer.switched`, `rtmp.started/stopped`) for the feedback
loop; connection UX (Claude Desktop config for Phase 1; operator start/stop for
Phase 2).

---

## Decisions taken

- **MCP transport:** in-process in `lcyt-backend` over the shared registry (not a
  separate process). Resolves the `CONSIDER.md` gap.
- **Safety:** confirm-by-default for destructive tools (reuse the Production Assistant
  gate).
- **Scope granularity:** per-resource (`camera:write`), matching the REST model.
- **Bus writes:** `external.*` events only — never system control.

## Open questions

- MCP transport flavour (Streamable HTTP vs HTTP+SSE) — Streamable HTTP preferred.
- Where the confirmation surface lives (reuse Assistant suggestions queue vs a
  dedicated external-actions tray; which page).
- Operator engine: existing `agentic-turn` vs Claude Agent SDK.
- Fate of standalone `lcyt-mcp-http`.
- Whether "setup" needs a distinct `provision`/`device-manager` scope beyond
  `settings:write`.

## Verification (per phase)

- **Phase 1:** connect a real MCP client with a scoped token → `listTools` returns
  only in-scope tools; a read tool runs immediately; a destructive tool stages →
  operator confirms → executes → the resulting event appears on `/events/stream`; an
  out-of-scope tool is denied; every call audited.
- **Phase 2:** start the operator on a project; publish/trigger events → it reacts,
  staging destructive actions for confirmation; verify cooldowns + audit; kill/restart
  keeps context.
- **Phase 3:** an `events:write`-scoped token POSTs `external.trigger` → delivered to
  subscribers + drives an external-event cue; a POST to an internal topic (`cue.fired`)
  is rejected; provenance + audit recorded.

## Summary

One core (bus + tool registry + scope model + confirm/auto), four doors (REST,
`/events/stream`, `POST /events`, MCP), two agent shapes (hosted-autonomous vs
BYO-interactive) — all sharing the same scoped tokens. Phase 0 is shipped; Phases
1–3 are independent and build only on the shipped core.
