# Plan: Authentication Refactor — Unified Project Access & Scoped External Tokens

**Status:** Draft / Exploratory — not yet scheduled
**Date:** 2026-07-08
**Context:** Surfaced while designing an event-bus/pub-sub layer for external subscribers. The event bus needs a coherent external-auth story; investigating that exposed pre-existing inconsistencies in how project-scoped routes are gated today. This plan covers **auth only** — it does not cover the bus itself, topic design, or delivery guarantees (event log/audit trail), which remain separate discussions.

---

## Review Notes / Refinements to This Draft

The initial draft is directionally correct, but it should be strengthened in four places before implementation:

1. **Introduce an explicit auth-policy model.** Rather than treating each route as “whatever middleware happened to be wired in,” define a small route-policy registry with values such as `session-only`, `project-access`, `public`, `admin`, `bridge`, and `external-token`.
2. **Make project identity resolution explicit.** The current sketch assumes the selected project can be found from route params or `req.body.projectId`. That is too implicit for routes like variables/connectors/roles that do not always expose a project identifier in the URL. The plan should define a single resolver that can look in headers, route params, and request body in a predictable order.
3. **Avoid overloading `req.session` for both live-session and project-access contexts.** A dedicated `req.auth` or `req.projectAccess` object is cleaner and avoids conflating “I am in a live caption session” with “I am allowed to manage project X.”
4. **Make scoped-token semantics concrete.** The `mcp_tokens.scopes` idea is good, but the plan needs a simple, documented scope grammar now (e.g. `resource:verb` + `*` wildcard), otherwise future usage will expand into another ad hoc auth system.

This revision also removes the legacy API-key framing from the plan. Project access is now defined as membership-based: if a user belongs to a project and has the necessary rights, they can access that project’s resources. The old API-key model is no longer part of the target design for the user/project web app.

These refinements are reflected below.

---

## Background

`lcyt-backend` and its plugins currently use **six independent auth mechanisms**, several of which overlap in ways that are not obviously intentional:

| Mechanism | Implementation | Payload | Used by |
|---|---|---|---|
| Session JWT bearer | `middleware/auth.js`'s `createAuthMiddleware` | `{ sessionId, projectId }` | `/live`, `/captions`, `/sync`, `/events`, `/stats`, `/file`, `/mic` — and, in practice, most plugin routers because `server.js` passes the same `auth` instance into them |
| User JWT bearer | `middleware/user-auth.js`'s `createUserAuthMiddleware` | `{ type: 'user', userId, email }` | `/auth/me`, `/auth/change-password`, user-owned project routes, `/orgs/*` |
| Admin API key | `middleware/admin.js` | n/a (constant-time string compare) | `/admin/*` |
| DSK Editor credential | `editorAuthOrBearer` in `lcyt-dsk` | n/a (`X-Project-Id` header) | DSK template/image routes — this is being replaced by project membership-based auth in the refactor |
| Personal external token | `db/mcp-tokens.js` (`mcp_tokens` table, `lcytmcp_<64 hex>`, SHA-256 hashed) | resolves to a project context and scopes | `lcyt-mcp-http`/`lcyt-mcp-stdio`'s `authenticate()` only |
| Bridge instance token | `BridgeManager.authenticate()` in `lcyt-production` | `prod_bridge_instances.token` | `/production/bridge/*` (SSE command stream + status callback) |
| Public-by-URL | none | project identifier in the path | `/dsk/:projectId/events`, `/dsk/:projectId/images`, `/dsk/:projectId/viewports/public`, `/viewer/:id` |

### Problems this creates

1. **Plugin routes are coupled to an ephemeral live session, not the project.** DSK graphics config, variables, cue rules, roles config, and STT config are all project-level concerns — they are meaningful even when no YouTube caption session is running. Because they are gated by the Session JWT (`{sessionId, projectId}`), a logged-in team member has no way to reach them without first starting a `/live` session and holding onto its token.
2. **No scoped, revocable credential exists for external, non-account-holder subscribers.** The existing external-token store is the closest primitive, but it is currently shaped around the old MCP terminology rather than a general-purpose “read-only access to a specific set of event topics.”
3. **Too many independently implemented auth checks are answering the same conceptual question:** “Is this caller allowed to touch project X, and how much?” This has already produced at least one real bug class: the STT and Variables SSE endpoints' `?token=` verification used to be an unverified base64 decode rather than a real `jwt.verify` (fixed, but only because those paths were audited).
4. **Public-by-URL exposure is a deliberate carve-out but not a documented one.** A future route that skips auth looks identical to one that skips it on purpose.

None of this is broken today in the sense of an active vulnerability; the current behavior is safe but needlessly restrictive and inconsistent. The real issue is that the codebase lacks a cohesive auth-policy model for project-scoped access and external subscribers.

---

## Proposed Target Model

The refactor should replace the current “whichever middleware a route happened to be wired to” behavior with an explicit auth-policy model for each route family.

### Auth policy types

Define a small policy registry for route families:

- `session-only` — current `/live`, `/captions`, `/sync`, `/events`, `/stats`, `/file`, `/mic` behavior
- `project-access` — project-scoped config routes (DSK, connectors/variables, roles, cues, STT config/status, targets, translation)
- `public` — explicitly allow-listed public routes
- `admin` — `/admin/*` and other server-admin routes
- `bridge` — production bridge / installed-device trust tier
- `external-token` — scoped tokens for external subscribers (future event-bus consumers)
- `device-token` — short-lived JWTs issued after device login for project-bound resources such as cameras, microphones, and mixers

For external access, the token should be a first-class delegated credential rather than an anonymous key. Every external token should be bound to:

- a specific user (`userId`/`sub`)
- a specific project (`projectId`)
- a declared scope set (for example `dsk:read`, `cue:write`, `events:stream`)

The token should be revocable, and its effective permissions should be derived from the user’s membership and role in that project plus the token’s own scope list.

The refactor should also make the identity model explicit. The plan should use three credential families:

1. **Identity JWT / identity cookie** — long-lived enough for the browser session, carrying the user’s stable identity and site-level role. Suggested claims: `sub`/`userId`, `siteRole`, `exp`.
2. **Project-scoped access JWT / cookie** — short-lived, minted after the user selects a project, carrying the user identity plus project-specific role and context. Suggested claims: `sub`/`userId`, `siteRole`, `projectRole`, `projectId`, `exp`.
3. **Device JWT** — short-lived, minted after device login, carrying project context and device-specific role. Suggested claims: `projectId`, `deviceRole`, `exp`; optionally also `sub`/`userId` if the device is linked to a specific user or owner.

This is the shared identity shape behind the user cookie, the project-scoped access token, and any user-issued service tokens. The site-role and project-role claims should be checked independently: site role answers “can this user act at the platform level?”, while project role answers “can this user act inside this project?”

This makes intent explicit and avoids “auth by omission.”

### Tier 1 — Project access (dashboard / any logged-in project member)

Introduce a new middleware, additive to (not replacing) the existing Session JWT check. The preferred browser-oriented model is:

- an HttpOnly identity cookie (e.g. `lcyt_identity`) for the user login/session, with a 3-hour lifetime, carrying the user’s identity and site-level role
- a short-lived, project-scoped access cookie (also HttpOnly, e.g. `lcyt_project`) for browser clients, minted server-side after the user selects a project, carrying the user identity plus project role and project context
- for non-browser clients, the same project-scoped claims can be issued as a bearer token instead of a cookie
- the project-scoped credential carries both user identity and project context (for example `userId`, `siteRole`, `projectRole`, `projectId`, `scopes`, `exp`)
- user-issued service tokens and browser sessions should use the same claim vocabulary so authorization code can be shared across the stack

This keeps the browser session simple while ensuring project-scoped requests are explicitly bound to one project and one user.

If a user has the necessary project rights, they should also be able to create or manage ingestion endpoints in MediaMTX for that project; that permission should be resolved from the same project-membership and role model rather than from a legacy API-key credential.

The same pattern also applies to the device-login flow: after a device completes the two-pin login step, the backend issues a short-lived device JWT scoped to the project and the specific resource role (for example camera, mic, or mixer). That token is distinct from the user identity cookie and from the project-scoped web session token, but it should still carry the same core identity claims (`userId`/`sub`, `siteRole`, `projectRole`) where relevant, with the device-specific role or resource claim layered on top.

```js
// middleware/project-access.js
export function createProjectAccessMiddleware({ sessionAuth, userAuth, db, jwtSecret }) {
  return function projectAccess(req, res, next) {
    // Fast path: existing session JWT still works unchanged (no DB hit).
    const sessionToken = extractBearer(req);
    const sessionPayload = verifySessionToken(sessionToken, jwtSecret);
    if (sessionPayload?.projectId) {
      req.auth = {
        kind: 'session',
        projectId: sessionPayload.projectId,
        sessionId: sessionPayload.sessionId,
      };
      return next();
    }

    // Fallback: user JWT + project membership check.
    const userPayload = verifyUserToken(sessionToken, jwtSecret);
    const projectId = resolveProjectId(req);
    if (userPayload && projectId && isProjectMember(db, userPayload.userId, projectId)) {
      req.auth = {
        kind: 'user',
        projectId,
        userId: userPayload.userId,
        email: userPayload.email,
      };
      return next();
    }

    return res.status(401).json({ error: 'Not authorized for this project' });
  };
}
```

`resolveProjectId(req)` should be defined once and used consistently across the backend. Recommended precedence:

1. `X-Project-Id` header
2. route param such as `:projectId` or `:id`
3. `req.body.projectId` / `req.query.projectId`
4. a router-provided context field (for future nested routes)

This is more robust than the earlier sketch’s implicit `req.params.projectId ?? req.params.id ?? req.body?.projectId` fallback.

`isProjectMember(db, userId, projectId)` should live in `src/db/project-members.js` and should check project ownership (`projects.owner_id`) first, then `project_members`.

This is a **superset** of today's behavior: anything that works with a Session JWT keeps working unchanged; a user JWT additionally works if the user is a member of the target project. No existing client needs to change for backward compatibility.

**Routers to migrate onto this middleware**:

- DSK templates/viewports (`lcyt-dsk`)
- variables + connector CRUD (`lcyt-connectors`)
- roles config/chat/events (`lcyt-agent`)
- cue rules/events (`lcyt-cues`)
- STT config/status (`/stt/config`, `/stt/status`)
- targets and translation config

**Not migrated** (stay exactly as-is): `/live`, `/captions`, `/sync`, `/events`, `/stats`, `/file`, `/mic` — these remain tied to life-cycle/session semantics rather than simple project membership.

```js
// middleware/project-access.js
export function createProjectAccessMiddleware({ sessionAuth, userAuth, db, jwtSecret }) {
  return function projectAccess(req, res, next) {
    // Fast path: existing session JWT still works unchanged (no DB hit).
    const sessionToken = extractBearer(req);
    const sessionPayload = verifySessionToken(sessionToken, jwtSecret);
    if (sessionPayload?.projectId) {
      req.auth = {
        kind: 'session',
        projectId: sessionPayload.projectId,
        sessionId: sessionPayload.sessionId,
      };
      return next();
    }

    // Fallback: user JWT + project membership check.
    const userPayload = verifyUserToken(sessionToken, jwtSecret);
    const projectId = resolveProjectId(req);
    if (userPayload && projectId && isProjectMember(db, userPayload.userId, projectId)) {
      req.auth = {
        kind: 'user',
        projectId,
        userId: userPayload.userId,
        email: userPayload.email,
      };
      return next();
    }

    return res.status(401).json({ error: 'Not authorized for this project' });
  };
}
```

`resolveProjectId(req)` should be defined once and used consistently across the backend. Recommended precedence:

1. `X-Project-Id` header
2. route param such as `:projectId` or `:id`
3. `req.body.projectId` / `req.query.projectId`
4. a router-provided context field (for future nested routes)

This is more robust than the earlier sketch’s implicit `req.params.projectId ?? req.params.id ?? req.body?.projectId` fallback.

`isProjectMember(db, userId, projectId)` should live in `src/db/project-members.js` and should check project ownership (`projects.owner_id`) first, then `project_members`.

This is a **superset** of today's behavior: anything that works with a Session JWT keeps working unchanged; a user JWT additionally works if the user is a member of the target project. No existing client needs to change for backward compatibility.

**Routers to migrate onto this middleware**:

- DSK templates/viewports (`lcyt-dsk`)
- variables + connector CRUD (`lcyt-connectors`)
- roles config/chat/events (`lcyt-agent`)
- cue rules/events (`lcyt-cues`)
- STT config/status (`/stt/config`, `/stt/status`)
- targets and translation config

**Not migrated** (stay exactly as-is): `/live`, `/captions`, `/sync`, `/events`, `/stats`, `/file`, `/mic` — these remain tied to life-cycle/session semantics rather than simple project membership.

### Tier 2 — External scoped tokens

Extend `mcp_tokens` rather than invent a fourth token type. It already provides the right shape: mintable, labeled, individually revocable, hash-stored, and resolved to one project context. Each token must be bound to a user, a project, and a scope set.

```sql
ALTER TABLE mcp_tokens ADD COLUMN user_id TEXT;
ALTER TABLE mcp_tokens ADD COLUMN project_id TEXT;
ALTER TABLE mcp_tokens ADD COLUMN scopes TEXT; -- nullable JSON array, e.g. ["cue.*", "dsk.graphics_changed"]
```

Proposed scope semantics:

- `NULL` (default, and every existing token) = unscoped = full access, preserving today's behavior.
- A non-null array restricts the token to the declared scope patterns.
- Scope syntax should be simple and predictable, for example:
  - `resource:verb` (e.g. `dsk:read`, `cue:write`)
  - `resource:*` (wildcard for all verbs)
  - `*:read` (wildcard resource)
- `tokenAllowsTopic(scopes, topic)` should be implemented in `src/db/mcp-tokens.js` and should clearly treat missing/empty scopes as full access.

`verifyMcpToken()` should return `{ userId, projectId, label, scopes }` (or similar), and `POST /external-tokens` / `GET /external-tokens` should accept/surface the optional `userId`, `projectId`, and `scopes` fields.

### Tier 3 — Bridge instance tokens

Unchanged. `BridgeManager.authenticate()` / `prod_bridge_instances.token` is a structurally different trust tier (installed hardware, not a human or an account) and should not be folded into Tier 1 or Tier 2.

### Public carve-out

Formalize the existing public routes as a deliberate, named allow-list rather than an implicit property of “whichever route never got a middleware call”:

```js
// Explicitly documents intent — reviewed, not accidental.
export const PUBLIC_PROJECT_ROUTES = [
  'GET /dsk/:projectId/events',
  'GET /dsk/:projectId/images',
  'GET /dsk/:projectId/viewports/public',
  'GET /viewer/:id',
];
```

No behavior change is required; the point is that a future route that skips auth must be added to this list explicitly and reviewed as a deliberate public-exposure decision.

---

## Non-Goals

- The event bus itself (topics, publish/subscribe plumbing, `SseSubscriberBus` extraction) — separate plan, this doc only unblocks its auth story.
- Delivery guarantees / persisted event log / assistant-action audit trail — separate design discussion, not yet written up.
- `lcyt-mcp-http`'s missing in-process tool wiring (`CONSIDER.md`'s existing open item) — unaffected by this plan.
- Changing `/live` / `/captions` / session-lifecycle auth — intentionally left on Session JWT only.

---

## Migration & Compatibility

| Change | Backward compatible? |
|---|---|
| New `createProjectAccessMiddleware` (superset of Session JWT) | Yes — Session JWT path unchanged, checked first |
| `mcp_tokens.scopes` column, default `NULL` | Yes — existing tokens keep full access |
| Public-route allow-list constant | Yes — documentation only, no route behavior changes |
| Router auth swaps (Tier 1) | Yes for existing session-JWT clients; additive capability for user-JWT + membership clients |

No client (CLI, lcyt-web, MCP servers, bridges) needs to change to keep working. The only new capability is that user-JWT-authenticated project members can reach project-scoped routes without an active `/live` session.

### Frontend / UX note

The backend capability above is real, but the current UI may still need a follow-on change if it wants to use user JWTs directly for project-scoped routes rather than relying on a prior `/live` session. That work is out of scope for this auth plan, but it should be called out so the feature is not treated as “done” purely from the server side.

---

## Implementation Steps

1. **DB migration** — add `mcp_tokens.scopes` (nullable TEXT/JSON) in `src/db/schema.js`.
2. **Introduce a shared resolver** — add `resolveProjectId(req)` plus any router-local overrides in a new helper module (for example `src/auth/project-context.js`). This will be the one place that decides how a route identifies the target project.
3. **`isProjectMember(db, userId, projectId)`** — add to `src/db/project-members.js` if not already present in equivalent form; check project ownership (`projects.owner_id`) first, then `project_members`.
4. **`createProjectAccessMiddleware`** — add `src/middleware/project-access.js`, try Session JWT first, then User JWT + `isProjectMember`, and attach a normalized `req.auth` object.
5. **Migrate plugin routers one at a time**, each with its own test run before moving to the next:
   a. `lcyt-dsk` templates/viewports
   b. `lcyt-connectors` variables/connectors
   c. `lcyt-agent` roles config/chat/events
   d. `lcyt-cues` rules/events
   e. `/stt/config`, `/stt/status` (not `/stt/events` SSE — leave on Session JWT + `?token=` for now, since that is a live-session-scoped stream)
   f. `/targets/*`, `/translation/*`
6. **Extend `verifyMcpToken()`** to return `scopes`; add `tokenAllowsTopic(scopes, topic)` helper. No caller yet.
7. **`PUT/GET /external-tokens`** — accept/surface optional `scopes` field.
8. **Document `PUBLIC_PROJECT_ROUTES`** as a code constant plus a short note in `lcyt-backend/CLAUDE.md`'s Authentication section.
9. **Tests:**
   - `resolveProjectId` / auth-policy routing: header, route-param, body, and missing-project cases.
   - `isProjectMember`: owner, member, non-member, revoked-member cases.
   - `createProjectAccessMiddleware`: Session-JWT-only (unchanged), User-JWT + member (new), User-JWT + non-member (401), neither (401).
   - `mcp_tokens` migration: existing rows get `scopes = NULL`; `verifyMcpToken()` still resolves them to full access.
   - Per-router regression pass after each migration in step 5 (existing plugin test suites should be run to green before moving to the next router).

---

## Summary

| Aspect | Decision |
|---|---|
| Session JWT (`/live`, `/captions`, etc.) | Unchanged |
| Plugin routes (DSK, variables, roles, cues, STT config, targets, translation) | Move to `createProjectAccessMiddleware` — Session JWT still works, User JWT + `project_members` now also works |
| External/third-party subscribers | Reuse `mcp_tokens`, add nullable `scopes` column — existing tokens unaffected |
| Bridges | Unchanged — separate trust tier, own token table |
| Public routes (`/dsk/:projectId/events`, `/viewer/:id`, etc.) | Unchanged behavior, now named explicitly as `PUBLIC_PROJECT_ROUTES` |
| Breaking changes | None |
| Out of scope | Event bus plumbing, delivery guarantees/audit log, `lcyt-mcp-http` tool wiring |

This plan is **exploratory** — written so the decision (and the follow-on event-bus/topic-scoping work that depends on it) can be made with the full picture, not yet scheduled or accepted.
