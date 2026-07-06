---
id: plan/mcp_oauth
title: "OAuth Authorization Server for MCP — Deferred Reference Design"
status: draft
summary: "Reference design for LCYT acting as its own OAuth 2.1 authorization server, so a hosted third-party MCP client (e.g. claude.ai's web 'custom connector' flow) can get scoped, revocable, delegated access to a project without ever holding a raw LCYT secret. Explicitly deferred: no concrete driver exists yet — plan/mcp's mcp_tokens (static, hashed, personal bearer tokens for Claude Desktop/Code's local-config model) already covers the near-term audience. Do not build this until a specific hosted-client integration is requested."
related: plan/mcp, plan/ai_roles_framework
---

# OAuth Authorization Server for MCP — Deferred Reference Design

## Status: deferred by design, not by neglect

This is a reference design, not a scheduled deliverable. It exists so that if/when a concrete driver shows up (see "Trigger condition" below), the shape doesn't need to be re-derived from scratch — but nothing here should be built speculatively ahead of that driver, per this repo's own "don't build for hypothetical future requirements" convention.

## Why this is separate from `mcp_tokens` (`plan/mcp`)

`plan/mcp` already specifies `mcp_tokens`: named, hashed, individually-revocable bearer tokens a project owner generates in Setup Hub and pastes into a **local** MCP client config (Claude Desktop's config file, `claude mcp add --header ...` for Claude Code). That fully covers the case where the human generating the credential and the human/process using it are the same, and the credential is stored somewhere the user directly controls (their own machine, their own config file).

OAuth earns its cost in a genuinely different case: a **hosted third party** — a service the user does not control the storage of — needs delegated access without the user ever typing LCYT's raw secret into that third party's own form. Concretely: claude.ai's web "custom connector" UI runs on Anthropic's servers, not the user's machine; adding a remote MCP connector there generally expects an OAuth redirect/consent flow rather than a pasted static header, because the third party (claude.ai) — not just the end user — ends up holding whatever credential is provided. The same distinction would apply to any other hosted service that might one day want delegated LCYT access, not just Claude specifically.

**`mcp_tokens` is not superseded if this is ever built.** An OAuth access token still needs to resolve to *something* scoped and revocable server-side — this plan's authorization server would mint tokens that map to the same `(api_key, scope)` shape `mcp_tokens` already establishes, or sit in front of `mcp_tokens` as an additional issuance path. Building `mcp_tokens` first is not wasted work.

## Trigger condition

Build this when there is a specific, concrete request for a hosted third-party client (most likely: "let me add LCYT as a claude.ai custom connector without pasting a token") — not before. Until then, Claude Desktop/Code's local-config + `mcp_tokens` flow is the complete answer for "bring your own Claude subscription, outside our UI."

## Scope, if/when triggered: v1 is intentionally minimal

Full MCP-spec-compliant OAuth (dynamic client registration per RFC 7591, so *any* MCP client can self-register, plus refresh-token rotation) is real infrastructure and not justified until there's evidence of more than one hosted client wanting to connect. The recommended v1 cuts both:

- **Static, pre-registered client(s)** — a small hardcoded (or DB-seeded) list of `{ client_id, redirect_uri }` pairs (e.g. one entry for claude.ai), not dynamic self-registration. Adding a second known hosted client later is a config-row addition, not new code.
- **Authorization Code + PKCE only** — required regardless of client count, since MCP/Claude-style clients are "public" clients with no safe place to store a client secret. This is the one piece of complexity that isn't optional.
- **No refresh tokens for v1** — issue longer-lived access tokens instead (revocable via the same mechanism as `mcp_tokens`) and defer refresh-token rotation/storage until session-length limits actually become a problem.
- **No dynamic client registration (RFC 7591) for v1** — this is what would let arbitrary, unknown MCP clients self-register; skip it until there's a second real hosted-client driver beyond the first one that triggered building this at all.

### What building v1 actually requires

- `GET /oauth/authorize` — consent screen. Must know which LCYT project is granting access, so it sits behind LCYT's existing web-session login (the user must already be logged into the LCYT web UI, or log in as part of this flow) — this is *not* a new identity system, just a new screen ("`<client>` wants to access project `<X>`'s Setup Hub tools — Allow / Deny") gated on the session that already exists.
- `POST /oauth/token` — exchanges `{ code, code_verifier }` for an access token. Token minting/verification reuses `jsonwebtoken`, already a dependency and already used throughout `lcyt-backend` (`routes/auth.js`, `project-members.js`, `project-features.js`, `device-roles.js`) — an OAuth access token here can just be a scoped JWT (claims: `apiKey`, `scope`, `client_id`, `exp`), not a new token format or a new crypto dependency.
- PKCE verification — S256 challenge/verifier check in `POST /oauth/token`; a small, well-documented, self-contained piece of code, not a library problem.
- Discovery metadata — `GET /.well-known/oauth-authorization-server` and MCP's own `GET /.well-known/oauth-protected-resource`, static JSON once the above exists. Required for spec-compliant auto-discovery; skippable for v1 if the only client is a known, manually-configured one, but cheap to include.
- Revocation — extend the `mcp_tokens`-style list/revoke UI (or a sibling list) to show OAuth-issued grants per project, same shape as the existing revoke flow.
- Scope model — start with one coarse scope (e.g. `setup:tools`) rather than a fine-grained per-tool scope system; narrow later only if a real need for partial-access grants shows up.

### What this is not

Not a general-purpose identity provider, not "sign in with LCYT" for third-party apps unrelated to MCP, not a replacement for the existing JWT session-login or `api_key`/`mcp_tokens` mechanisms — a resource-scoped authorization flow for one specific purpose: letting a hosted MCP client obtain a token to call LCYT's shared tool registry (`plan/mcp`) on a project owner's behalf, with consent, without the owner ever handing that host their raw secret.

## Open Questions (genuinely need a driver before they're answerable)

1. **Which hosted client first.** This plan assumes claude.ai as the illustrative case since it's the one named in the conversation that produced this plan, but the static-client list is generic — the actual first entry depends on which integration is actually requested.
2. **Scope granularity.** Whether one coarse scope per project is sufficient, or whether real usage demands per-tool-group scopes (e.g. "Setup Hub only" vs. "Setup Hub + Production Assistant tools"), isn't answerable without a concrete client and a concrete complaint about over-broad access.
3. **Consent screen ownership/design.** This plan assumes the consent screen lives in `lcyt-web` behind existing session login, but the actual UI (which project, which scopes, how it's presented) is product design work not attempted here.
