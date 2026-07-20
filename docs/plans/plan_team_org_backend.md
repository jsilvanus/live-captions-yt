---
id: plan/team_org_backend
title: "Team/Org Data Model — Backend Design"
status: implemented
summary: "Design for a real multi-project Team/Org data model (organizations, org_members, api_keys.org_id) to replace the /team 'Coming soon' placeholder. Resolves the org-vs-project access precedence question with a baseline-plus-override model. Implemented: schema (`organizations`, `org_members`, `api_keys.org_id`, `api_keys.restricted`), full org CRUD + membership routes (`/orgs/*`), the `/team` frontend page (see `plan_profile_team_admin_reconciliation.md`), and the `getEffectiveProjectAccessLevel()` org-baseline-plus-project-override access resolver (`src/db/project-members.js`) — `org_members.role` shipped as a 5-tier `owner/admin/editor/operator/viewer` vocabulary (`ROLE_ORDER` in `src/routes/orgs.js`), not this doc's proposed 3-tier `owner/admin/member`, so the resolver treats any org membership (regardless of which of the 5 roles) as a flat project-baseline of `'member'` rather than cascading org owner/admin into a higher project baseline — this matches the doc's own 'Future extension (not in scope now)' section, not a deviation. The resolver is wired into every genuine access-decision caller of the old `getMemberAccessLevel()`: `src/middleware/project-access.js` (JWT project-role resolution), `src/routes/project-features.js`, `src/routes/device-roles.js`, `src/routes/project-slug.js`, `src/routes/project-observability.js`, and `src/routes/auth.js`'s `POST /auth/project-token` (this last one matters because the middleware trusts a JWT's baked-in `projectRole` claim and only falls back to a DB lookup when that claim is absent — so project-token issuance had to resolve org baseline too, or org-only members would 403 before ever reaching the middleware). `src/routes/project-members.js` (membership management) and `src/routes/keys.js` (no actual `getMemberAccessLevel` call site — `_userUpdateKey`/`_userDeleteKey` check literal `api_keys.user_id` identity, not project_members) are deliberately unchanged. Remaining, not in this task's scope: an admin-facing `PATCH` route to toggle `api_keys.restricted` (the column exists and the resolver reads it, but nothing sets it yet besides direct DB/admin-export access), and the 'Future extension' org-role-to-project-role cascade described above."
---

# Team/Org Data Model — Backend Design

## Context

LCYT has no organization/team data model today. Confirmed by inspecting every `db*.js`/`schema.js` file in the repo (`packages/lcyt-backend/src/db/schema.js`, `packages/lcyt-backend/src/db/project-members.js`, and the plugin `db.js` files under `packages/plugins/*`): the only membership concept that exists is **per-project**, via `project_members` (`api_key` ↔ `user_id` ↔ `access_level`, one row per membership) plus `project_member_permissions` for fine-grained overrides on top of the `owner`/`admin`/`member` role bundles. There is no table, column, or route anywhere that groups multiple projects (`api_keys` rows) under a shared entity. A user with five projects today has five completely independent membership lists — inviting a colleague to all five means five separate invite calls, and there is no way to see "everyone on my team" in one place.

This plan is the direct follow-up to a just-shipped frontend change: the new `/team` sidebar page shipped as a deliberate "Coming soon" placeholder rather than client-side aggregation logic that fakes team membership by unioning `project_members` across a user's keys. That was the right call — building throwaway aggregation UI ahead of a real data model would have been wasted work once this plan lands. This document is that real design.

**No backward-compatibility burden.** LCYT has no released users yet, so this design does not need to hedge for existing production data, gradual rollout, or zero-downtime migration. Where the existing `project_members` design added defensive complexity for those reasons (see `plan_userprojects.md`'s back-fill migration), this plan can skip it. Standard nullable/additive schema (e.g. `api_keys.org_id` as a nullable FK) is kept anyway because it is simply good schema design — projects genuinely can exist without an org — not because of any compat requirement.

---

## Proposed Schema

Three additions, all additive to the existing schema in `packages/lcyt-backend/src/db/schema.js`:

```sql
-- An organization: a named container for one or more projects (api_keys).
CREATE TABLE IF NOT EXISTS organizations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  slug          TEXT    NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Org-level membership. Mirrors project_members' shape/conventions for consistency
-- (same three-tier role vocabulary, same invited_by/joined_at pattern).
CREATE TABLE IF NOT EXISTS org_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL DEFAULT 'member',   -- 'owner' | 'admin' | 'member'
  invited_by  INTEGER REFERENCES users(id),
  joined_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org  ON org_members(org_id);

-- Projects gain an optional org owner. NULL = personal project (owned directly
-- by a user via api_keys.user_id, exactly as today). This is purely additive:
-- every existing project stays personal until explicitly moved into an org.
ALTER TABLE api_keys ADD COLUMN org_id INTEGER REFERENCES organizations(id);

-- Per-org override of the site-wide feature availability policy (site admin only).
-- Full design, resolution order, and rationale: see plan_site_feature_policies.md.
-- Listed here because of its FK dependency on organizations(id); this table cannot
-- ship before the org schema above exists.
CREATE TABLE IF NOT EXISTS org_feature_overrides (
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_code TEXT    NOT NULL,
  mode         TEXT    NOT NULL,                    -- 'available' | 'self_service' | 'denied'
  set_by       INTEGER REFERENCES users(id),
  set_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, feature_code)
);
CREATE INDEX IF NOT EXISTS idx_org_feature_overrides_org ON org_feature_overrides(org_id);
```

`organizations.owner_user_id` denormalizes the single-owner invariant the same way `project_members.access_level = 'owner'` does today — one row per org must have `role = 'owner'` in `org_members`, and that user_id must match `organizations.owner_user_id`. Keeping both is deliberate: `owner_user_id` gives O(1) "who owns this org" lookups (e.g. for billing, deletion confirmation) without a join, mirroring the existing `api_keys.owner`/`api_keys.user_id` pattern of keeping a denormalized pointer alongside the membership table.

**Cross-reference:** `org_feature_overrides` is consumed by the site-wide feature-policy resolver designed in `plan_site_feature_policies.md` — that document owns the full tri-state (`available`/`self_service`/`denied`) model, the companion `site_feature_policies` table, the resolution order (`org_feature_overrides` > `site_feature_policies` > `'denied'`), and how it composes with `getEffectiveProjectAccessLevel()` below. It is listed here only because of the schema's FK dependency on `organizations`.

`org_members.role` intentionally reuses the exact `owner`/`admin`/`member` vocabulary from `project_members.access_level` (see `packages/lcyt-backend/src/db/project-members.js`) rather than inventing new terms — same mental model for users, and it lets the combined access resolver (below) treat both role sources uniformly.

---

## Central Design Decision: Does Org Membership Grant Automatic Project Access?

This is the one decision this plan has to make and defend, not leave open.

**Two options considered:**

1. **`project_members` remains the sole source of project access, even for org projects.** Joining an org gives you visibility into the org's project *list* and metadata, but zero access to any individual project's captions/settings until someone explicitly adds you to that project's `project_members`.
2. **Org membership grants a baseline access level to every project under the org, automatically.** `project_members` still exists and can grant an *elevated* role on top of that baseline for a specific project, but org membership alone is enough to get in.

**Recommendation: Option 2 — org membership grants baseline `member` access to every project in the org, with `project_members` able to elevate on a per-project basis.**

Rationale:

- **Option 1 defeats the purpose of an org.** The entire value proposition of grouping projects under a team is "invite someone once, they can work across the team's projects." If every project still needs its own explicit invite, an org is just a label on a list — it adds a `GET /orgs/:id/projects` view and nothing else. Teams don't onboard a new operator by having them wait for N separate invite emails for N shows/events; they want "welcome to the org, you can caption anything the team runs."
- **Option 2 still lets an owner lock down a sensitive project.** Because `project_members` is still consulted, an org owner can put a project under stricter control by *not* wanting baseline access to apply — but note this requires an explicit demotion mechanism (see "Restricting a project from org baseline access" below), not just silence, since the default baseline applies automatically.
- **The elevation half is symmetrical with how permission overrides already work.** `project_member_permissions` already lets a `member`-level user get elevated permissions on top of their role bundle (see `getEffectivePermissions()` in `project-members.js`). Org-baseline-plus-project-override is the same pattern one level up: baseline from the broader scope, explicit override for the narrower scope. Reusing a pattern the codebase already has is lower-risk than inventing a new one.
- **`member` (not `admin`) as the baseline keeps the blast radius small.** Automatic access should not be enough to change project settings, delete a project, or manage members — those still require an explicit elevated `project_members` row. This mirrors the intentionally-minimal `member` bundle (`captioner` permission only) already defined in `ROLE_BUNDLES` in `project-members.js`.

**Restricting a project from org baseline access:** an org project can be marked `restricted = 1` (new column on `api_keys` or a per-project `org_project_settings` row — a single boolean is enough to start) so that org-baseline access does not apply to it and only explicit `project_members` rows grant access. This gives owners an escape hatch for a project that shouldn't have team-wide visibility (e.g. a project holding a sensitive client's stream) without abandoning the "org membership = default access" model for everything else.

### What this means for the access-check code path

Today, every route that needs to know "can this user touch this project" does an inline lookup against `project_members` — see the repeated `getMemberAccessLevel(db, req.params.key, user.userId)` calls in `packages/lcyt-backend/src/routes/project-members.js`, and equivalent patterns in `project-features.js`, `keys.js`, etc. That pattern does not disappear; it gets one more source to check.

**New combined resolver** (lives in `src/db/project-members.js` or a new `src/db/access.js`, the org design doesn't require a new plugin/package):

```js
/**
 * Resolve the *effective* access level a user has on a project, combining
 * org-membership baseline with explicit project membership. Returns the
 * higher of the two, or null if the user has neither.
 *
 * @returns {'owner'|'admin'|'member'|null}
 */
function getEffectiveProjectAccessLevel(db, apiKey, userId) {
  const explicit = getMemberAccessLevel(db, apiKey, userId);       // existing lookup, unchanged
  const project = getKey(db, apiKey);                              // existing lookup, unchanged
  if (!project?.org_id || project.restricted) return explicit;

  const orgRole = getOrgMemberRole(db, project.org_id, userId);     // new lookup
  if (!orgRole) return explicit;

  // Higher of (org baseline, explicit project role); org baseline is always 'member'
  // unless the resolver is later extended to let org admin/owner roles cascade higher —
  // see "Future extension" below.
  const ORDER = { member: 1, admin: 2, owner: 3 };
  const orgBaseline = 'member';
  if (!explicit) return orgBaseline;
  return ORDER[explicit] >= ORDER[orgBaseline] ? explicit : orgBaseline;
}
```

Every call site that currently does `getMemberAccessLevel(db, key, userId)` for an *access* decision (not an *ownership* decision — see below) should switch to `getEffectiveProjectAccessLevel()`. That is a mechanical, if wide-reaching, find-and-replace across:
- `src/routes/project-members.js`
- `src/routes/project-features.js`
- `src/routes/keys.js` (`_userUpdateKey`, `_userDeleteKey` — though deletion should probably still require *explicit* project ownership, not org baseline; see note below)
- `src/routes/stt.js`, `src/routes/device-roles.js`, and anywhere else per-project auth is checked once those routes grow user-Bearer auth paths

**One place this must NOT apply:** irreversible/ownership-only actions (transfer ownership, delete project, revoke a key) should keep checking `project_members.access_level === 'owner'` directly (`getMemberAccessLevel`, unchanged), not the combined resolver — an org-wide baseline of `member` should never be able to escalate into "can delete this project." The resolver is for *day-to-day operational access*, not destructive rights.

**Future extension (not in scope now):** a later iteration could let org `admin`/`owner` roles cascade to a higher project-level baseline (e.g. org owners get project-`admin` everywhere by default) rather than always flattening to `member`. Deferred because it adds another decision axis (should org owner also get delete rights on every project?) that doesn't need answering to ship v1.

---

## Routes Needed

All under a new `/orgs` prefix, following the existing route-module + DB-helper pattern (`src/routes/*.js` + `src/db/*.js`) used by `project-members.js`.

### Org CRUD

```
POST   /orgs
  Auth: user Bearer
  Body: { name }
  Effect: creates organizations row (owner_user_id = requester), creates org_members
          row (role='owner'), auto-generates slug from name (dedupe with suffix if taken)
  Response: 201 { id, name, slug, ownerUserId, createdAt }

GET    /orgs
  Auth: user Bearer
  Response: { orgs: [{ id, name, slug, role, memberCount, projectCount }] }
  Notes: lists orgs the requester is a member of (any role)

GET    /orgs/:id
  Auth: user Bearer (any org member)
  Response: { id, name, slug, ownerUserId, createdAt, memberCount, projectCount }

PATCH  /orgs/:id
  Auth: user Bearer (org owner/admin)
  Body: { name? }
  Notes: renaming updates name only; slug is immutable after creation (referenced
         in URLs/links) — regenerating it would break saved links
  Response: updated org

DELETE /orgs/:id
  Auth: user Bearer (org owner only)
  Notes: refuses if the org has any projects still assigned to it (org_id must be
         cleared/moved first) — see "Project lifecycle" below; this avoids a
         cascade-delete footgun that would take down live projects
  Response: { deleted: true }
```

### Org member CRUD/invite

Mirrors the existing project-invite pattern in `packages/lcyt-backend/src/routes/project-members.js` (`_inviteMember`, `_removeMember`, `_updateMember` — invite-by-email against an existing account, no separate invite-token flow in v1):

```
GET    /orgs/:id/members
  Auth: user Bearer (any org member)
  Response: { members: [{ userId, email, name, role, joinedAt }], total }

POST   /orgs/:id/members
  Auth: user Bearer (org owner/admin)
  Body: { email, role?: 'admin'|'member' }
  Notes: invitee must have an existing account (same v1 limitation as project
         invites); 404 if no account found with that email, 409 if already a member
  Response: 201 { userId, email, role, joinedAt }

PATCH  /orgs/:id/members/:userId
  Auth: user Bearer (org owner/admin)
  Body: { role: 'admin'|'member' }
  Notes: cannot change the owner's role this way — use transfer-ownership
  Response: { userId, role }

DELETE /orgs/:id/members/:userId
  Auth: user Bearer (org owner/admin, or self-remove) or the member themself
  Notes: cannot remove the owner; removing a member does not touch their
         explicit project_members rows on individual projects (those are
         independent and must be cleaned up separately if desired)
  Response: { removed: true }

POST   /orgs/:id/members/:userId/transfer-ownership
  Auth: user Bearer (current org owner only)
  Body: { confirm: true }
  Response: { ok: true }
```

### Listing/creating projects under an org

```
GET    /orgs/:id/projects
  Auth: user Bearer (any org member)
  Response: { projects: [{ key, name, createdAt, restricted, myAccessLevel }] }
  Notes: myAccessLevel is the effective resolved level (org baseline or higher)

POST   /orgs/:id/projects
  Auth: user Bearer (org owner/admin)
  Body: { name, features?: string[] }
  Effect: same as today's POST /keys (via _userCreateKey), but sets org_id on
          creation instead of leaving it personal; creator still gets an
          explicit project_members 'owner' row (org membership is a baseline,
          not a replacement for having a real owner on record per project)
  Response: 201 { ...key, orgId }
```

### Project lifecycle: moving between orgs / becoming personal again

A project's `org_id` is not fixed at creation. Sensible default:

```
PATCH  /keys/:key/org
  Auth: user Bearer — requires ownership of the project (explicit project_members
        'owner', not just org baseline — moving a project's org affiliation is an
        ownership-tier action) AND membership in the destination org (or no
        destination, to go personal)
  Body: { orgId: number | null }
  Notes:
    - orgId: null → project becomes personal again; explicit project_members
      rows are untouched (nothing is lost — org-baseline access simply stops
      applying)
    - orgId: <id> → project moves to that org; requester must already be a
      member of the destination org (prevents assigning a project into an org
      you don't belong to as a backdoor org-hop)
    - Moving away from an org does not delete or alter that org's own
      org_members — only the project's org_id pointer changes
  Response: { key, orgId }
```

This makes org affiliation a property of the project that can be freely changed by its owner, symmetric with how `project_members` ownership can already be transferred independently. No project is ever "trapped" in an org.

---

## Frontend Impact (brief)

Once this ships, `/team` (currently "Coming soon") gets real content:
- **Org switcher** — if a user belongs to more than one org (or has personal projects plus org projects), a switcher in the sidebar/top bar to scope the current view.
- **Member list** — `GET /orgs/:id/members`, with invite form (mirrors the existing `InviteMemberForm.jsx` pattern from the per-project members UI in `plan_userprojects.md`).
- **Org-scoped project list** — `GET /orgs/:id/projects`, replacing whatever placeholder is currently rendered.
- **Org-wide default settings** — not in this plan's v1 API surface above, but a natural next step (e.g. default feature flags applied to new projects created under the org) once the core model is proven.

This document does not attempt to spec the frontend UI in detail — that is its own follow-up once the backend lands.

---

## Effort Estimate

This is the single largest backend item in the current gap analysis (see appendix below for the rest). Realistically a multi-day build:

- Schema + migration (small — three additive pieces, no back-fill complexity since there's no legacy data to reconcile)
- `db/organizations.js` + `db/org-members.js` helpers (mirrors `db/project-members.js` closely — most of the logic already has a working template to copy)
- Combined access resolver + the mechanical sweep of existing per-project auth checks to use it (the wide-reaching, easy-to-get-subtly-wrong part)
- `routes/orgs.js` + `routes/org-members.js` (mirrors `routes/project-members.js`)
- `PATCH /keys/:key/org` lifecycle endpoint + ownership/membership validation
- Full test coverage: org CRUD, member CRUD, the resolver's precedence logic (org baseline vs. explicit override, restricted projects, non-member fallthrough), project lifecycle moves
- No frontend work is included in this estimate — that is separate, follow-on work once the API is stable

None of this should start before frontend work on `/team` beyond the current placeholder — the placeholder was shipped specifically to avoid building throwaway aggregation logic ahead of this real design.

---

## Other Backend Gaps (Prioritized, for Later)

Recorded here so the reasoning isn't lost, even though none of these are being built now.

1. **Caption targets + translation config → server-persisted** (medium effort, high value). Currently 100% client-side `localStorage` (`packages/lcyt-web/src/lib/targetConfig.js`, `translationConfig.js`). New `caption_targets` / `translation_config` tables, same shape as the existing `stt_config` (`packages/plugins/lcyt-rtmp`) and `key_storage_config` (`packages/plugins/lcyt-files/src/db.js`) tables — both are good templates for a per-API-key config table with a JSON payload column. Enables multi-device sync of target/translation setup instead of it being tied to one browser's localStorage.

2. **Ingestion as a first-class entity** (low-medium effort). Today just `relay_allowed`/`relay_active` boolean flags on `api_keys`, toggled only by an admin. A self-service `GET/PATCH /ingestion/config` would mostly wrap existing state rather than requiring new schema — low risk, modest value.

3. **Web Radio config CRUD** (low-medium effort). New `radio_config` table (title/description/cover art/autoplay) plus a self-service enable toggle (currently admin-only via `radio_enabled`).

4. **Site Features (admin global flags)** — **resolved and fully designed in `plan_site_feature_policies.md`**: a tri-state policy per feature code (`available` / `self_service` / `denied`), a site-wide default (`site_feature_policies`) plus the per-org override (`org_feature_overrides`, schema listed above) that can tighten or loosen it, an explicit binary-only-vs-tri-state-capable classification of every current feature code, and a worked example (custom storage). No longer an open product question — small-to-medium effort, ready to schedule once (or alongside) the org schema work it depends on.

5. **Quick win: `PATCH /auth/me` name edit** (trivial — a few lines in `packages/lcyt-backend/src/routes/auth.js` + `packages/lcyt-backend/src/db/users.js`; no schema change, `users.name` already exists).

6. **Storage self-service** (trivial — policy change only). The `key_storage_config` CRUD in `lcyt-files` already exists end-to-end; it's just gated behind the `files-custom-bucket`/`files-webdav` feature codes that nothing currently grants by default. Turning this on is a feature-flag default change, not new code.

7. **AI Models — tracker/describer/assistant multi-role** (medium effort, but needs a product spec first). The schema change to support multiple named AI "roles" per key is mechanical (extend `ai_config` or add a role column), but what these roles actually *do* behaviorally has never been specified — the idea came from a design mockup, not a real spec. Don't start the schema work until the behavior is defined, or it will need reshaping anyway.

8. **API Connectors (outbound webhook templates)** (large effort, needs a product spec first). Nothing analogous exists in the codebase today except `lcyt-cues`'s internal action types, none of which currently have an HTTP-POST action implemented. A real trigger/action definition (what fires a webhook, what payload shape, retry/backoff policy, auth) needs to be designed before any schema or route work starts.

9. **Account deletion (GDPR)** (small code footprint, but treat as its own project despite that). `DELETE /stats` already does per-key anonymization/erasure (see `plan_files3.md`), but a *full account* deletion needs correct cascading across every project a user owns or is a member of, plus (once this plan ships) every org they belong to or own — an org with only-one-owner-who-wants-to-leave is a real edge case worth designing deliberately rather than discovering via bug report. Worth its own careful review despite the small line count.
