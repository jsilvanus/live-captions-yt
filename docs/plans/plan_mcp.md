---
id: plan/mcp
title: "MCP Tools for lcyt"
status: in-progress
summary: "Model Context Protocol servers for stdio and Streamable HTTP transports exposing caption, production, and DSK graphics tools to AI assistants. The original caption/production/DSK tool surface is implemented and unchanged; this plan now also specifies a shared tool-schema module (packages/lcyt-tools) that both the MCP servers and lcyt-agent's agentic_chat roles (plan/ai_roles_framework) register the same tools against — over real MCP transport for external clients, over an in-process linked transport for lcyt-agent — plus a destructiveHint/readOnlyHint annotation convention and a personal mcp_tokens credential so people can drive LCYT from their own Claude subscription outside the LCYT UI."
related: plan/ai_roles_framework, plan/agent
---

## Current implementation (unchanged by this plan)

MCP support is implemented in the repository. The current surface area is:

- `python-packages/lcyt-mcp/` — Python server
- `packages/lcyt-mcp-stdio/` — Node.js stdio server
- `packages/lcyt-mcp-http/` — Node.js Streamable HTTP server

### Tool groups

1. Caption tools — start, send, sync, and stop caption sessions directly with `YoutubeLiveCaptionSender`.
2. Production tools — list cameras and mixers, trigger presets, and switch sources through the backend.
3. Graphics/DSK tools — manage templates and renderer state through the backend.

### Transport and authentication (current)

- Stdio transports are intended for local AI clients.
- Streamable HTTP is intended for remote integrations.
- Production and graphics tools use the backend URL plus the existing admin/API key headers:
  - `X-Admin-Key` for production tools
  - `X-API-Key` for DSK tools
- `lcyt-mcp-http`'s own `authenticate()` also accepts `X-Api-Key` directly against `api_keys`, scoping every tool call to that connection's project (`createMcpServer(apiKey)`) — confirmed as the existing, already-working per-project auth model this plan's `mcp_tokens` addition extends rather than replaces.

## Planned: a shared tool-schema module, used by both MCP and in-app chat

`plan/ai_roles_framework` gives `lcyt-agent` five chat-with-tools roles (Setup Assistant, Asset Control Assistant, Planner Assistant, Graphics Editor Assistant, Production Assistant) that each need a tool-calling LLM turn against a project's real data (Setup Hub CRUD, `prod_cameras`/`prod_mixers`, DSK templates). Rather than that plan defining its own second tool-invocation mechanism alongside this one, every tool used by any `agentic_chat` role is defined **once**, here, and reused by both surfaces.

### `packages/lcyt-tools` — schema + handler registry

A new top-level workspace package (not under `packages/plugins/` — it's a schema/handler library with no Express router or DB migration of its own, so it doesn't fit this repo's plugin contract). Exports:

```js
export function createToolRegistry({ db, store, auth, relayManager, /* other injected deps, mirrors plugin init() */ }) {
  // returns an object shaped for direct MCP SDK registration:
  //   { tools: [{ name, description, inputSchema, annotations }], callTool(name, args, { apiKey }) }
}
```

Tool ids match `ai_roles.available_tools`/`harness_config.toolAllowlist` from `plan/ai_roles_framework` exactly: `caption_target.create/update/delete`, `camera.create/update/delete/preset`, `mixer.create/update/delete/switch`, `dsk_template.generate/edit/suggest_styles`, `asset.upload/update/delete`, etc. Every handler closes over the caller's `apiKey` (never a client-supplied project id) — the same per-connection scoping convention `lcyt-mcp-http`'s existing tools already use, extended to the new tool set.

### Registration: one real MCP `Server`, two kinds of client

The tool registry is registered on **one real `@modelcontextprotocol/sdk` `Server` instance**:

- `lcyt-mcp-stdio` / `lcyt-mcp-http` register it exactly as they register today's caption/production/DSK tools, reachable over stdio/Streamable HTTP by external clients (Claude Desktop, Claude Code, etc.).
- `lcyt-agent` connects to the **same server object** as an MCP **`Client`**, over `InMemoryTransport.createLinkedPair()` (already available — `@modelcontextprotocol/sdk` resolves to `1.29.0` in this repo's `node_modules`, well past the `^1.0.0` floor in `package.json`, and ships full `Client` + `inMemory` transport support). No subprocess, no network hop, no new npm dependency (only a new declared dependency edge in `lcyt-agent/package.json`) — but real `tools/list`/`tools/call` semantics, so the schema `lcyt-agent`'s turn loop sees is *exactly* the schema an external MCP client sees. This is why the module isn't just a plain function import: a plain import risks the in-process shape and the externally-registered shape drifting apart; going through the same `Server` object for both consumers makes that structurally impossible.

This directly answers the original design question this plan chain started from: build the tool-calling mechanism once, as real MCP, and both "in-app agentic chat" and "external AI client, outside our UI" get it for free, rather than needing a second bespoke JSON-step-plan protocol that only the in-app chat could ever use.

### Tool annotations: the external-client equivalent of a confirm dialog

Every tool in the shared registry sets MCP's standard annotations:
- `destructiveHint: true` on every `delete`/`switch`/`preset`/state-changing tool.
- `readOnlyHint: true` on every `list`/`get`/`status` tool.

Claude Desktop and Claude Code already surface `destructiveHint: true` as an approval prompt before calling. This is the natural external-client analogue of `plan/ai_roles_framework`'s in-app `confirm` mode and the Setup Hub's own confirm-delete dialog — for a caller outside the LCYT UI, MCP's own annotation convention *is* the safety gate, and it comes from the same schema definition rather than a separately-built mechanism.

## Planned: personal MCP access tokens (`mcp_tokens`)

Today's `X-Api-Key` is the same shared per-project secret used for caption ingestion — workable for a single project owner, but not "personalized tokens for outside-AI": named, individually-revocable credentials for e.g. "Alice's Claude Desktop" vs. "Bob's Claude Code." This doesn't fit the existing `api_keys.ingest_stream_key` precedent either (a single rotatable slot, "replacing any previous value") — it needs its own table, closer to a GitHub personal-access-token list:

```sql
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key      TEXT NOT NULL,                          -- api_keys.key, unenforced FK (matches existing convention)
  label        TEXT NOT NULL,                           -- e.g. "Alice's Claude Desktop"
  token_hash   TEXT NOT NULL UNIQUE,                     -- hash only; raw token is shown once at creation, never stored
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_key ON mcp_tokens(api_key);
```

Lives in `lcyt-backend`'s core schema (`schema.js`) — the same DB `lcyt-mcp-http` already connects to via `DB_PATH` and already checks `api_keys` against in `authenticate()`.

Routes (`lcyt-backend`, session JWT auth):
```
POST   /mcp-tokens          — { label } → { id, token } (raw token returned once)
GET    /mcp-tokens          — list, hash/raw never returned, label + created_at + last_used_at + revoked_at
DELETE /mcp-tokens/:id      — revoke (through the existing Setup Hub confirm-delete dialog, same as every other delete)
```

`lcyt-mcp-http`'s `authenticate()` extends to also hash-check the provided credential against `mcp_tokens` (in addition to raw `api_keys.key`), resolving to the same per-connection `apiKey` closure every existing and new tool handler already scopes off of — no changes needed to any tool handler itself.

**UI home:** its own Setup Hub card, not folded into `AiModelsSection.jsx`. Despite the `*Section.jsx` naming convention, every existing "Section" (`AiModelsSection`, `ConnectorsSection`, etc.) renders exactly one `<SetupCard>` — one tile in `SetupHubPage.jsx`'s flat CSS grid; the "── AI & integrations ──"-style headers there are plain JSX comments grouping sibling cards, not container components that hold more than one card. So a new `McpAccessSection.jsx` — its own `<SetupCard id="mcp-access">`, mounted next to `<AiModelsSection />`/`<ConnectorsSection />` under that same grouping comment — is exactly consistent with how every other card in this page already works, not a special case. Content: a token list, "Generate token" (reveal-once + copy), revoke (through the existing confirm-delete dialog), and a ready-to-paste Claude Desktop/Code MCP config snippet (server URL + header).

**Deliberately out of scope here — OAuth.** `mcp_tokens` covers the near-term audience (Desktop/Code, a human pasting a token into their own local config file they control). A hosted third-party connector flow (e.g. claude.ai's web "custom connector" UI, which generally expects OAuth rather than a static header) is real but distinct additional infrastructure with no concrete driver yet — see `plan_mcp_oauth.md`, which this plan defers to rather than duplicates.

## Primary integration points

- `python-packages/lcyt-mcp/`
- `packages/lcyt-mcp-stdio/`
- `packages/lcyt-mcp-http/`
- `packages/lcyt-backend/` for the routes used by the non-caption tools, and the new `mcp_tokens` table/routes
- `packages/lcyt-tools/` (new) — the shared tool-schema/handler registry
- `packages/plugins/lcyt-agent/` — connects to the shared registry's MCP `Server` as an in-process `Client` for the `agentic_chat` turn loop (see `plan/ai_roles_framework`)
