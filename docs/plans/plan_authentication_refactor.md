# Plan: Authentication Refactor — Unified Project Access & Scoped External Tokens

**Status:** Draft / Exploratory — not yet scheduled
**Date:** 2026-07-08
**Context:** Surfaced while designing an event-bus/pub-sub layer for external subscribers (chat discussion, not yet its own plan doc). The event bus needs a coherent external-auth story; investigating that exposed pre-existing inconsistencies in how project-scoped routes are gated today. This plan covers **auth only** — it does not cover the bus itself, topic design, or delivery guarantees (event log/audit trail), which remain separate, undocumented discussions.

---

## Background

`lcyt-backend` and its plugins currently use **five independent auth mechanisms**, several of which overlap in ways that aren't obviously intentional:

| Mechanism | Implementation | Payload | Used by |
|---|---|---|---|
| Session JWT Bearer | `middleware/auth.js`'s `createAuthMiddleware` | `{ sessionId, apiKey }` | `/live`, `/captions`, `/sync`, `/events`, `/stats`, `/file`, `/mic` — **and, in practice, every plugin router** (`lcyt-dsk`'s templates/viewports, `lcyt-connectors`'s variables, `lcyt-agent`'s roles, `lcyt-cues`, `/stt/*`, `/targets/*`, `/translation/*`), since `server.js` passes the same `auth` instance into all of them |
| User JWT Bearer | `middleware/user-auth.js`'s `createUserAuthMiddleware` | `{ type: 'user', userId, email }` | `/auth/me`, `/auth/change-password`, `/keys` (user-owned CRUD), `/keys/:key/features`, `/keys/:key/members`, `/orgs/*` |
| Admin API key | `middleware/admin.js` | n/a (constant-time string compare) | `/admin/*` |
| DSK Editor API key | `editorAuthOrBearer` in `lcyt-dsk` | n/a (`X-API-Key` header) | DSK template/image routes — falls back to Session JWT if the header is absent |
| Personal MCP token | `db/mcp-tokens.js` (`mcp_tokens` table, `lcytmcp_<64 hex>`, SHA-256 hashed) | resolves to owning `apiKey` | `lcyt-mcp-http`/`lcyt-mcp-stdio`'s `authenticate()` only |
| Bridge instance token | `BridgeManager.authenticate()` in `lcyt-production` | `prod_bridge_instances.token` | `/production/bridge/*` (SSE command stream + status callback) |
| Public-by-URL | none | raw `apiKey`/`:key` in the path | `/dsk/:apikey/events`, `/dsk/:apikey/images`, `/dsk/:apikey/viewports/public`, `/viewer/:key` |

### Problems this creates

1. **Plugin routes are coupled to an ephemeral live session, not the project.** DSK graphics config, variables, cue rules, roles config, and STT config are all project-level concerns — they're meaningful with no YouTube caption session running. But because they're gated by the Session JWT (`{sessionId, apiKey}`), a team member (`project_members` already models multi-member projects, see `plan_userprojects.md`) has no way to reach them without first starting a `/live` session and holding onto its token. There is currently no "I'm a logged-in member of project X, let me manage its DSK templates" path — only "I have an active caption session for project X."
2. **No scoped, revocable credential exists for external, non-account-holder subscribers.** `mcp_tokens` is the closest primitive (a mintable, labeled, hash-stored, per-project credential) but it's shaped for MCP tool calls, not "read-only access to a specific set of event topics."
3. **Five independently-implemented auth checks for what is conceptually one question** ("is this caller allowed to touch project X, and how much"). This has already produced at least one real bug class: the STT and Variables SSE endpoints' `?token=` verification was at one point an unverified base64 decode rather than a real `jwt.verify` (fixed, but only because both plugins happened to get audited — see `lcyt-backend/CLAUDE.md`'s STT note).
4. **Public-by-URL exposure is a deliberate carve-out for two specific use cases** (OBS/vMix browser sources need an unauthenticated DSK overlay URL; the viewer audience is definitionally anonymous) **but nothing marks it as deliberate.** A future route/topic that "happens" to skip auth looks identical to one that skips it on purpose.

None of this is broken today in the sense of a live vulnerability — session-JWT-gating plugin routes is safe, just needlessly restrictive; public DSK/viewer routes are public by design. The problem is *inconsistency* and the lack of a credential type for external, non-dashboard, non-account consumers, which the event-bus design needs and nothing today provides cleanly.

---

## Proposed Target Model

Three access tiers, plus an explicit public carve-out, replacing "whichever middleware a route happened to be wired to" with one deliberate choice per route:

### Tier 1 — Project access (dashboard / any logged-in project member)

New middleware, additive to (not replacing) the existing Session JWT check:

```js
// middleware/project-access.js
export function createProjectAccessMiddleware({ sessionAuth, userAuth, db }) {
  return function projectAccess(req, res, next) {
    // Fast path: existing session JWT still works unchanged (no DB hit).
    const sessionToken = extractBearer(req);
    const sessionPayload = verifySessionToken(sessionToken, jwtSecret);
    if (sessionPayload?.apiKey) {
      req.session = sessionPayload;
      return next();
    }

    // Fallback: user JWT + project_members membership check.
    const userPayload = verifyUserToken(sessionToken, jwtSecret);
    const apiKey = req.params.apikey ?? req.params.key ?? req.body?.apiKey;
    if (userPayload && apiKey && isProjectMember(db, userPayload.userId, apiKey)) {
      req.session = { apiKey, userId: userPayload.userId };
      return next();
    }

    return res.status(401).json({ error: 'Not authorized for this project' });
  };
}
```

`isProjectMember(db, userId, apiKey)` — new helper in `src/db/project-members.js` (or reuse if an equivalent already exists there for `/keys/:key/members`), a straightforward `SELECT 1 FROM project_members WHERE user_id = ? AND api_key = ?` (project owners implicitly pass via `api_keys.user_id`, checked first).

This is a **superset** of today's behavior: anything that works with a Session JWT keeps working unchanged (checked first, no new DB query on the hot path); a user JWT now additionally works if the user is a member of the target project. No existing client (CLI, current lcyt-web session flow) needs to change.

**Routers to migrate onto this middleware** (replacing their current `auth` — the plain Session-JWT-only middleware): DSK templates/viewports (`lcyt-dsk`), variables + connector CRUD (`lcyt-connectors`), roles config/chat/events (`lcyt-agent`), cue rules/events (`lcyt-cues`), STT config/status (`/stt/config`, `/stt/status`, not the SSE stream — see Tier 2 note below), targets, translation config.

**Not migrated** (stay exactly as-is): `/live`, `/captions`, `/sync`, `/events`, `/stats`, `/file`, `/mic` — these are inherently tied to a live session's lifecycle, not just project membership.

### Tier 2 — External scoped tokens

Extend `mcp_tokens` rather than invent a fourth token type — it already provides the right shape (mintable, labeled, individually revocable, hash-stored, resolves to one `apiKey`):

```sql
ALTER TABLE mcp_tokens ADD COLUMN scopes TEXT; -- nullable JSON array, e.g. ["cue.*", "dsk.graphics_changed"]
```

- `NULL` (default, and every existing token) = unscoped = full access, exactly today's behavior. **No backward-compatibility break.**
- A non-null array restricts the token to the declared topic patterns. Scope-checking logic (`tokenAllowsTopic(scopes, topic)`) is added to `db/mcp-tokens.js` but has no caller yet in this plan — wiring it into an actual bus-subscription route is the event bus's own plan, not this one.
- `verifyMcpToken()` return shape gains `scopes` alongside the existing `{ apiKey, label }`.
- `POST /mcp-tokens` gains an optional `scopes` field; `GET /mcp-tokens` surfaces it (never the hash/raw token, unchanged).

### Tier 3 — Bridge instance tokens

Unchanged. `BridgeManager.authenticate()` / `prod_bridge_instances.token` is a structurally different trust tier (installed hardware, not a human or an account) and should not be folded into Tier 1 or Tier 2.

### Public carve-out

Formalize the existing public routes as a deliberate, named allow-list rather than an implicit property of "whichever route never got a middleware call":

```js
// Explicitly documents intent — reviewed, not accidental.
export const PUBLIC_PROJECT_ROUTES = [
  'GET /dsk/:apikey/events',
  'GET /dsk/:apikey/images',
  'GET /dsk/:apikey/viewports/public',
  'GET /viewer/:key',
];
```

No behavior change — this is a documentation/review artifact so a future route that skips auth has to be added to this list explicitly (and thus reviewed as a deliberate public-exposure decision) rather than silently matching the pattern by omission.

---

## Non-Goals

- The event bus itself (topics, publish/subscribe plumbing, `SseSubscriberBus` extraction) — separate plan, this doc only unblocks its auth story.
- Delivery guarantees / persisted event log / assistant-action audit trail — separate design discussion, not yet written up.
- `lcyt-mcp-http`'s missing in-process tool wiring (`CONSIDER.md`'s existing open item) — unaffected by this plan.
- Changing `/live`/`/captions`/session-lifecycle auth — intentionally left on Session JWT only.

---

## Migration & Compatibility

| Change | Backward compatible? |
|---|---|
| New `createProjectAccessMiddleware` (superset of Session JWT) | Yes — Session JWT path unchanged, checked first |
| `mcp_tokens.scopes` column, default `NULL` | Yes — existing tokens keep full access |
| Public-route allow-list constant | Yes — documentation only, no route behavior changes |
| Router auth swaps (Tier 1) | Yes for existing session-JWT clients; additive capability for user-JWT + membership clients |

No client (CLI, lcyt-web, MCP servers, bridges) needs to change to keep working. The only new *capability* is user-JWT-authenticated project members reaching plugin routes without an active `/live` session.

---

## Implementation Steps

1. **DB migration** — add `mcp_tokens.scopes` (nullable TEXT/JSON) column in `src/db/schema.js`.
2. **`isProjectMember(db, userId, apiKey)`** — add to `src/db/project-members.js` if not already present in an equivalent form; check project ownership (`api_keys.user_id`) first, then `project_members`.
3. **`createProjectAccessMiddleware`** — new file `src/middleware/project-access.js`, tries Session JWT first, falls back to User JWT + `isProjectMember`.
4. **Migrate plugin routers one at a time**, each with its own test run before moving to the next (per-router regression risk — see `roles-mount-order.test.js` for why mount-order/auth changes in this codebase get their own integration test rather than trusting unit tests alone):
   a. `lcyt-dsk` templates/viewports
   b. `lcyt-connectors` variables/connectors
   c. `lcyt-agent` roles config/chat/events
   d. `lcyt-cues` rules/events
   e. `/stt/config`, `/stt/status` (not `/stt/events` SSE — leave on Session JWT + `?token=` for now, since that's a live-session-scoped stream, unlike STT's static config)
   f. `/targets/*`, `/translation/*`
5. **Extend `verifyMcpToken()`** to return `scopes`; add `tokenAllowsTopic(scopes, topic)` helper. No caller yet.
6. **`PUT/GET /mcp-tokens`** — accept/surface optional `scopes` field.
7. **Document `PUBLIC_PROJECT_ROUTES`** as a code constant plus a short note in `lcyt-backend/CLAUDE.md`'s Authentication section.
8. **Tests:**
   - `isProjectMember`: owner, member, non-member, revoked-member cases.
   - `createProjectAccessMiddleware`: Session-JWT-only (unchanged), User-JWT + member (new), User-JWT + non-member (401), neither (401).
   - `mcp_tokens` migration: existing rows get `scopes = NULL`, `verifyMcpToken()` still resolves them to full access.
   - Per-router regression pass after each migration in step 4 (existing test suites for that plugin, run to green before moving to the next router).

---

## Summary

| Aspect | Decision |
|---|---|
| Session JWT (`/live`, `/captions`, etc.) | Unchanged |
| Plugin routes (DSK, variables, roles, cues, STT config, targets, translation) | Move to `createProjectAccessMiddleware` — Session JWT still works, User JWT + `project_members` now also works |
| External/third-party subscribers | Reuse `mcp_tokens`, add nullable `scopes` column — existing tokens unaffected |
| Bridges | Unchanged — separate trust tier, own token table |
| Public routes (`/dsk/:apikey/events`, `/viewer/:key`, etc.) | Unchanged behavior, now named explicitly as `PUBLIC_PROJECT_ROUTES` |
| Breaking changes | None |
| Out of scope | Event bus plumbing, delivery guarantees/audit log, `lcyt-mcp-http` tool wiring |

This plan is **exploratory** — written so the decision (and the follow-on event-bus/topic-scoping work that depends on it) can be made with the full picture, not yet scheduled or accepted.
