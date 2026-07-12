# Plan: External Frontier-Agent Control — In-Process MCP over the Shared Tool Registry

**Status:** Draft — not yet scheduled
**Date:** 2026-07-12
**Context:** We want an external, bring-your-own-harness frontier agent (e.g. someone
running Claude Desktop) to drive the whole production from chat — switch cameras,
switch mixer inputs, start/stop RTMP fanout, edit DSK, and even do first-time
setup. The natural interface for that is **MCP tools**, not the event bus: driving
the system is *commands* (RPC — target, result, error, authorization), while the
bus is for *events* (fire-and-forget notifications). The bus is the agent's
**feedback** channel (`/events/stream`), not its control channel.

The shared tool registry already exists (`packages/lcyt-tools`, `createToolRegistry`,
`createInProcessMcpBridge`) and the internal agent already drives the system
through it in-process. The missing half — an **external-facing MCP transport with
live access to the production managers** — is the open architecture question logged
in `CONSIDER.md` ("expose a new MCP-reachable endpoint inside lcyt-backend … new
route, new auth model for external MCP clients"). **This plan makes that decision:**
mount the MCP endpoint **in-process inside `lcyt-backend`**, authorized by scoped
`mcp_tokens`, with **confirm-by-default** safety.

This builds directly on the just-landed scope model (resource:verb gating,
`/events/stream`, `tokenHasScope`).

---

## Decisions taken (from review)

- **Transport location:** in-process in `lcyt-backend` — reuse the tool registry the
  composition root already builds (`server.js:283`, direct handles to
  `productionRegistry`/`bridgeManager`/RTMP managers/`AgentEngine`). No separate
  process, no HTTP-proxy round-trip, one auth model. (Resolves the `CONSIDER.md`
  gap; the standalone `lcyt-mcp-http` can be redirected or deprecated — open Q.)
- **Safety posture:** confirm-by-default — destructive tools require operator
  confirmation unless the project/token is explicitly set to auto.

## Non-Goals

- Driving the system through event-bus **writes** — explicitly rejected (commands ≠
  events). External bus write stays fenced to `external.*` *events* (separate,
  smaller feature).
- Webhook-style outbound push (already out of scope in `plan_pubsub_event_bus.md`).
- A new tool-schema format — reuse `lcyt-tools`'s existing schemas + hints.

---

## Architecture

### 1. In-process MCP endpoint

Mount an MCP transport route inside the `lcyt-backend` Express app, backed by the
**same `_toolRegistry`** already constructed at `server.js:283` (which holds live
`production.registry`/`bridgeManager`, camera/mixer CRUD + `buildSwitchCommand`,
`agent`, `assets`, `captionTargets`). Options for the transport (open Q below):
- **Streamable HTTP** MCP transport (current MCP standard) mounted at e.g.
  `POST/GET /mcp` — preferred, matches modern clients.
- The existing `createInProcessMcpBridge` proves the registry works over a real MCP
  `Server`; the new work is attaching an **external** transport (not `InMemoryTransport`)
  to a per-connection `Server` instance, scoped to the caller's project + scopes.

Per-connection context: the tool handlers already run "as" an api key
(`callToolAs(apiKey, name, args)`), so the endpoint resolves `apiKey = req.auth.projectId`
and calls tools in that project's scope — exactly like the internal agent.

### 2. Auth — scoped `mcp_tokens`, reusing the new model

- The `/mcp` endpoint is gated by `createProjectAccessMiddleware(db, jwtSecret, { requiredScope: 'mcp:connect' })`
  (or accepts a project JWT too, for our own UI to embed an agent).
- **Tool-level authorization = the resource:verb scope model, lifted to tools.**
  Each tool declares its required scope(s); the endpoint (a) **lists only the tools
  the token can call** (so an out-of-scope tool is invisible, not just denied) and
  (b) enforces the scope on invoke. Examples:
  | Tool | Required scope |
  |---|---|
  | `camera.preset`, camera CRUD | `camera:write` (CRUD read → `camera:read`) |
  | `mixer.switch`, mixer CRUD | `mixer:write` / `mixer:read` |
  | RTMP fanout start/stop | `rtmp:write` |
  | `dsk_template.*` | `dsk:write` / `dsk:read` |
  | caption send | `caption:send` |
  | setup (create camera/mixer/encoder, config) | `settings:write` / `device-manager` |
  - Null-scope token = full delegation (all tools). This mirrors `tokenHasScope`'s
    empty-scopes-is-full rule; the tool `requiredScope` check is exactly
    `tokenHasScope(scopes, req)`.
  - Reuse the existing `readOnlyHint`/`destructiveHint` annotations to derive
    read-vs-write where a tool doesn't declare an explicit scope.

### 3. Safety — confirm-by-default (reuse the Production Assistant gate)

The Production Assistant already implements exactly the needed gate
(`lcyt-agent`: `effectiveMode(harnessConfig)` = auto only when `mode:'auto'` AND
`autoConfirmed:true`; `agentic-turn.js`'s `shouldExecute`; the suggestion queue).
Apply the same to external tool calls:
- **Read-only tools** (`readOnlyHint`) execute immediately and return the result.
- **Destructive tools** (`destructiveHint` — camera/mixer/rtmp/setup) are **staged**
  as a pending action requiring operator confirmation, unless the project/token is
  explicitly in auto mode. The MCP call returns a "staged, awaiting confirmation"
  result (with an id); the operator confirms in the UI (reuse/extend the Assistant
  suggestions queue → `assistant.action`/a new `external.action` topic), then the
  action executes and emits its event.
- **Every external tool call is audited** (who/token, tool, args, staged/executed,
  result) — via the `bus_events` audit trail (curated topic e.g. `mcp.tool_call`).
- **Rate limits** per token.

### 4. Feedback loop — the bus closes it

The agent *acts* via MCP tools and *observes* via `GET /events/stream`
(`events:read` + topics). For this to work, production actions must **emit events**
so the agent sees results: `camera.switched`, `mixer.switched`, `rtmp.started`/`stopped`,
plus the existing `bridge.command_result`, `dsk.*`, `cue.fired`. Audit which
production actions already publish and wire the missing ones onto the `EventBus`
(one-line `eventBus.publish(...)` at each manager's state change). So the agent's
loop is: call tool → (maybe confirm) → observe the resulting event on the stream.

### 5. Token & UX

- Setup Hub "MCP access" card: add the write/tool scopes (`camera:write`, `mixer:write`,
  `rtmp:write`, `dsk:write`, `caption:send`, `settings:write`, `mcp:connect`) to the
  scope picker, sourced from an extended `/events/topics`-style catalog (or a new
  `/mcp/tools` catalog listing tools + their required scopes).
- Show the connection URL + a copy-paste MCP client config (Claude Desktop) for the
  minted token.

---

## Implementation sketch (phased)

1. **MCP endpoint in-process:** new `routes/mcp-endpoint.js` (or in `lcyt-mcp-http`
   refactored to export a router) mounting the chosen MCP transport over a
   per-connection `Server` built from `_toolRegistry`; auth via project-access
   (`mcp:connect`). Wire `apiKey = req.auth.projectId` into `callToolAs`.
2. **Tool-scope map:** add a `requiredScope` (or derive from hints) to each tool in
   `lcyt-tools`; add `scope`-aware `listTools`/`callTool` filters in the endpoint.
3. **Tool coverage:** audit the registry vs the target verbs (camera/mixer/rtmp/
   setup); add missing tools (RTMP fanout start/stop, encoder/device setup) as thin
   handlers over the managers the composition root already holds.
4. **Confirm-by-default:** route `destructiveHint` tools through the Assistant-style
   staging gate; add the confirm UI hook + audit.
5. **Event emission:** ensure camera/mixer/rtmp actions publish bus events for the
   feedback loop.
6. **UX:** scope picker + tool catalog + connection instructions.
7. **Deprecate/redirect** the standalone `lcyt-mcp-http` process to the in-process
   endpoint (open Q — may keep for non-live tools).

## Open questions

- **Transport:** Streamable HTTP vs legacy HTTP+SSE MCP transport (pick per client
  support; Streamable HTTP preferred).
- **Confirmation surface:** reuse the Production Assistant suggestions queue, or a
  dedicated "external actions" queue/topic? Where does the operator see/approve
  (Broadcast page? a notifications tray?).
- **Scope granularity:** per-resource (`camera:write`) vs per-tool (`camera.preset:call`).
  Recommend per-resource to match the REST model.
- **Fate of `lcyt-mcp-http`:** deprecate, or keep for stateless tools and point
  live-control clients at the in-process endpoint?
- **Setup scope:** is `settings:write` enough for "do the setup", or does creating
  devices/encoders warrant a distinct `device-manager`/`provision` scope?

## Verification

- Connect a real MCP client (or Claude Desktop) to the in-process `/mcp` endpoint
  with a scoped token; confirm `listTools` returns **only** the tools the scope
  allows (out-of-scope tools hidden).
- Call a read-only tool (e.g. list cameras) → immediate result.
- Call a destructive tool (e.g. `mixer.switch`) with a confirm-mode token → returns
  "staged"; approve in the UI → executes; observe `mixer.switched` on
  `/events/stream`.
- Call a tool the token isn't scoped for → denied.
- Confirm every call is in the audit log.
- End-to-end: from a chat harness, run a short "switch to camera 2, start fanout"
  sequence and watch it drive the real managers + surface events back.

## Summary

| Aspect | Decision |
|---|---|
| Control channel | MCP tools (commands), **not** event-bus writes |
| Where | In-process MCP endpoint in `lcyt-backend` over the shared `_toolRegistry` (resolves the `CONSIDER.md` gap) |
| Auth | Scoped `mcp_tokens` — resource:verb lifted to tool-level; null scopes = full |
| Safety | Confirm-by-default for destructive tools (reuse Production Assistant gate); audit + rate limits |
| Feedback | Agent observes results via `/events/stream`; production actions emit bus events |
| Event-bus write | Separate, fenced to `external.*` events only — not system control |
| Breaking changes | None — additive; `lcyt-mcp-http` fate is an open question |
