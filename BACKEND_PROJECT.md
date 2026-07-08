# Backend project: Profile / Team / Admin API contract

This document is the API contract the reconciled `lcyt-web` Profile, Team, and
Admin pages require. It was written by a UI-only reconciliation session (see
`docs/plans/plan_team_org_backend.md` and `docs/plans/plan_site_feature_policies.md`
for the design docs it builds on) that did **not** implement any backend
code — this is the handoff for a separate backend session.

The frontend already codes defensively against these endpoints not existing
yet (fails soft, shows an empty/disabled state) — same "ships ahead of
backend" precedent as the Ingestion/Web Radio Setup Hub cards. None of this
blocks a frontend deploy; it unblocks the *real* functionality once built.

---

## 1. New: `PATCH /auth/me` — self-service display-name update

Already flagged as a trivial "quick win" in `plan_team_org_backend.md`
appendix item #5 — `users.name` already exists as a column, no schema change.

```
PATCH /auth/me
Auth: user Bearer
Body: { name: string }
Response: { userId, email, name }
```

Used by: `AccountPage.jsx`'s Account card "Save changes" button.

---

## 2. New: `GET /auth/me/export` — self-service data export

GDPR-style export of the current user's own data. Read-only aggregation, no
schema change.

```
GET /auth/me/export
Auth: user Bearer
Response: {
  user: { id, email, name, createdAt },
  projects: [ { key, name, role, createdAt, expires, features: [...] } ],
  // role = the caller's effective access level on that project (owner/admin/
  // editor/operator/viewer via org baseline, or their explicit project_members
  // role — either source, whichever is higher, same resolver as
  // getEffectiveProjectAccessLevel() in plan_team_org_backend.md)
  orgs: [ { id, name, slug, role, joinedAt } ]
}
```

Notes:
- Include projects the user has access to via **either** explicit
  `project_members` rows **or** org-baseline membership — not just projects
  they directly own.
- Used by: `AccountPage.jsx`'s Danger Zone "Export my data" button, which
  downloads the JSON response as a file client-side.

---

## 3. New: `DELETE /auth/me/data` — "remove all my data"

Deletes the user's **owned** projects (and their files/history) but keeps the
account itself. This is destructive but scoped — the account survives.

```
DELETE /auth/me/data
Auth: user Bearer
Response: { deletedProjectCount: number }
```

**Scope to define precisely during implementation:**
- Only cascade-delete projects where this user is the explicit **owner**
  (`project_members.access_level = 'owner'`, or `api_keys.user_id` for
  personal projects) — projects they're merely a member/editor/viewer of
  should be untouched (removing this user's own membership row on those is
  reasonable, but the project itself belongs to someone else).
- Does not touch org membership rows or org ownership — that's a separate,
  bigger question, see `DELETE /auth/me` below. A user who owns projects
  inside an org they don't own should have just those projects' data wiped,
  the org itself is unaffected.
- Should reuse whatever cascade/anonymization logic `DELETE /stats`
  (per-key GDPR erasure, see `plan_files3.md`) already has for a single
  project, just looped across every project this user owns.

Used by: `AccountPage.jsx`'s Danger Zone "Remove all data" button, behind a
confirmation dialog client-side (destructive, irreversible).

---

## 4. New: `DELETE /auth/me` — full account deletion

```
DELETE /auth/me
Auth: user Bearer
Response: { deleted: true }
```

Cross-reference `plan_team_org_backend.md` appendix item #9 ("Account
deletion (GDPR)") — this needs a deliberate design for the edge case where the
user is the **sole owner of an org with other members still in it**. Options
to choose between during implementation (not decided by this contract):
- Refuse with a 409 and a clear error telling the user to transfer ownership
  or remove other members first.
- Require an explicit `?force=true` that also deletes the org and removes all
  its members.
- Auto-transfer ownership to the org's next most senior member (by role
  order) if one exists.

Whichever is chosen, it must also handle the simpler case (sole personal
projects, no org involvement) which should just work like `DELETE /auth/me/data`
plus deleting the user row itself.

Used by: `AccountPage.jsx`'s Danger Zone "Delete account" button, behind a
confirmation dialog, redirects to `/login` on success.

---

## 5. New: `GET /admin/orgs` — admin-scoped list of all orgs

Today's `GET /orgs` (see `packages/lcyt-backend/src/routes/orgs.js`) is
scoped to orgs the calling user is a member of. There is currently **no**
endpoint that gives a site admin the full list of orgs on the deployment.

```
GET /admin/orgs?q=<search>&limit=&offset=
Auth: X-Admin-Key or user Bearer with is_admin=1 (same pattern as every other
      /admin/* route, createAdminMiddleware)
Response: { orgs: [ { id, name, slug, memberCount, projectCount } ], total, limit, offset }
```

`q` searches org name/slug (same convention as `GET /admin/users`'s `q` param).

Used by: `AdminTeamsPage.jsx`'s left-column org search + list.

---

## 6. Already implemented — document precisely, one required addition

`plan_site_feature_policies.md` is already implemented server-side:

```
GET  /admin/feature-policies
PUT  /admin/feature-policies/:code
GET  /admin/orgs/:id/feature-overrides
PUT  /admin/orgs/:id/feature-overrides/:code
```

**Required addition:** confirm `GET /admin/feature-policies`'s response
includes a `binaryOnly` boolean per feature code (the plan doc's own spec
already calls for this: *"binaryOnly is computed from a hardcoded
classification table... not stored"*). The frontend's new `FeaturePolicyGrid.jsx`
component needs this field to decide whether to render a 2-way switch
(binary-only: `ingest`, `radio`, `hls-stream`, `preview`, `stt-server`,
`device-control`, `graphics-server`, `cea-captions`) or a 3-way segmented
control (`available`/`self_service`/`denied`) for every other code — it should
not have to hardcode that classification list a second time on the client. If
this field isn't actually present in the current implementation, add it;
verify before assuming it's missing.

`GET /admin/orgs/:id/feature-overrides` should also expose `binaryOnly`
per code (or the frontend can reuse the same lookup from the site-wide
endpoint — either is fine, whichever is less duplicative to implement).

Used by: `AdminSiteFeaturesPage.jsx` and `AdminTeamsPage.jsx`'s per-org
override panel, both via the new shared `FeaturePolicyGrid.jsx` component.

---

## 7. Extend: `GET /admin/users` and `GET /admin/projects`

For the mock's team filter dropdown + org-name display column:

```
GET /admin/users?...&orgId=<id>       -- NEW query param, filters to users who
                                          are members of that org
GET /admin/projects?...&orgId=<id>    -- NEW query param, filters to projects
                                          with that api_keys.org_id
```

Both list responses should also include an `orgName` field per row:
- **Users**: the name of the user's **first** org membership (by `joined_at`
  ascending), or `null` if they belong to none. The mock's user-row card shows
  a single org-name value per user, so pick one deterministically rather than
  trying to show a multi-org list inline — a user in several orgs is an edge
  case, not the common path.
- **Projects**: unambiguous — direct join via `api_keys.org_id`, `null` if the
  project is personal (no org).

Used by: `AdminUsersPage.jsx`/`AdminProjectsPage.jsx`'s new team-filter
dropdown and org-name column, restyled to the mock's card-row layout.

---

## 8. Extend: `GET /orgs/:id/members` — add per-member `projectCount`

Today's shape (per `plan_team_org_backend.md`): `{ members: [{ userId, email,
name, role, joinedAt }] }`. The mock's member card additionally shows a
project count per member.

```
GET /orgs/:id/members
Response: { members: [{ userId, email, name, role, joinedAt, projectCount }] }
```

`projectCount` = count of the org's own projects (`api_keys.org_id = :id`)
where this member has an **explicit** `project_members` row (not just
org-baseline access — that would make every member's count equal the org's
total project count, which isn't useful information).

Used by: `TeamPage.jsx`'s Members tab member-card grid.

---

## 9. Doc staleness (not a code change — flag for whoever picks this up)

Two documents are stale relative to already-shipped code and should be
refreshed alongside this work, not left further out of date:

- `packages/lcyt-backend/CLAUDE.md`'s route reference table is missing the
  entire `/orgs/*` CRUD surface (commits `06c0e39`, `1b649ec`) and the
  `/admin/export/users`, `/admin/export/projects`, `/admin/import/users`,
  `/admin/import/projects`, `/admin/audit-log` routes (all implemented and
  actively called by the frontend today, just undocumented).
- `docs/plans/plan_team_org_backend.md` (`status: in-progress`, summary says
  org CRUD/membership routes "remain unimplemented") and
  `docs/plans/plan_site_feature_policies.md` (says admin frontend UI
  "Remaining... no page yet") should both have their frontmatter/status
  updated once this session's Admin/Team frontend work lands — the second one
  in particular becomes fully resolved once `AdminSiteFeaturesPage.jsx` and
  `AdminTeamsPage.jsx` are real.

---

## Out of scope for this contract (explicitly deferred)

- **Per-category "team defaults" pull-down** (the mock's General Setup tab
  category cards with a "↓ team" button per project Setup card) — a
  substantial new concept (per-category default-item tables mirroring every
  device/config table: cameras, mixers, encoders, bridges, viewports,
  languages, STT, storage, connectors) with no existing design anywhere in
  `docs/plans/`. This session's Team page ships the General Setup tab scoped
  to the existing simple feature-flag defaults (`GET/PUT /orgs/:id/features`,
  already real) instead. Worth its own dedicated plan doc when prioritized.
