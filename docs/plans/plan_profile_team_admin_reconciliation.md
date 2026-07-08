---
id: plan/profile_team_admin_reconciliation
title: "Profile, Team & Admin — Claude Design Reconciliation"
status: implemented
summary: "Reconciles lcyt-web's Profile/Team/Admin pages against the Claude Design mockup (project 9919ac53) and specifies the API contract that reconciliation required. TeamPage.jsx rebuilt around the mock's single-active-team + tabs layout; AdminSiteFeaturesPage.jsx/AdminTeamsPage.jsx went from pure stubs to real content on the tri-state feature-policy model; AdminUsersPage.jsx/AdminProjectsPage.jsx restyled to card rows with new team/role filters; AccountPage.jsx un-stubbed (editable display name, segmented theme controls, a real Danger Zone). Backend contract implemented: PATCH /auth/me (pre-existing), new GET /auth/me/export, DELETE /auth/me/data, DELETE /auth/me, new GET /admin/orgs, GET /admin/users and GET /admin/projects extended with orgId filter + orgName/role fields, GET /orgs/:id/members extended with per-member projectCount. Along the way, fixed two real pre-existing bugs: AdminKeyGate.jsx's rules-of-hooks violation (crashed the whole Admin section for any user-based admin) and index.html's theme-flash-prevention script reading a stale legacy localStorage key (dark mode never survived a reload)."
---

# Profile, Team & Admin — Claude Design Reconciliation

## Context

`packages/lcyt-web` has been incrementally re-skinned to match a Claude
Design mockup (project `9919ac53-8c4c-4968-8b1d-400c3149bdc3`, "LCYT") across
several prior sessions — Sidebar, Projects, Setup Hub, Planner, the Graphics
Editor. Three views remained unreconciled: the `isOrg` (Team), `isProfile`
(Profile/Account), and `isAdminView` (Admin) screens in `Dashboard.dc.html`.
Separately, the backend gained a real org/team data model
(`plan_team_org_backend.md`, commits `06c0e39`/`1b649ec`) and the tri-state
site-feature-policy model (`plan_site_feature_policies.md`) was already
implemented server-side with no frontend consumer.

This plan was written by a UI-reconciliation session that did not implement
backend code itself — it produced a precise API contract (originally drafted
as `BACKEND_PROJECT.md` at the repo root) for a separate backend session to
implement in an isolated worktree. That implementation has since landed
(commit `b527eae`, "Implement backend profile and admin contract") and been
merged and verified against the frontend in this same branch — see
"Implementation status" below. `BACKEND_PROJECT.md` is superseded by this
document and has been removed from the repo root.

## Decisions made during the UI pass

1. **Roles**: show all 5 real roles (owner/admin/editor/operator/viewer),
   reskinned to the mock's pill style — not collapsed to the mock's 3-button
   picker.
2. **Feature toggles**: binary-only features (8 codes needing real
   infra — `ingest`, `radio`, `hls-stream`, `preview`, `stt-server`,
   `device-control`, `graphics-server`, `cea-captions`) get a simple 2-way
   switch; the remaining tri-state-capable codes get a 3-way segmented
   control (available/self_service/denied) instead of the mock's single
   switch.
3. **Team page layout**: full structural rebuild to the mock's
   single-active-team + org-picker + tabs pattern, not a reskin of the
   previous dual-column list+detail layout.
4. **Team defaults ("General Setup" tab)**: scoped to the existing simple
   feature-flag defaults (`GET/PUT /orgs/:id/features`). The mock's
   per-category item-level "↓ team" pull-down concept has no existing backend
   design anywhere in `docs/plans/` and is logged here as a separate future
   initiative, not designed in this pass.

## UI changes

- **`TeamPage.jsx`** — full rewrite: org picker (dropdown, improving on the
  mock's literal click-to-cycle button) + Invite Member / New Team header,
  Members/Projects/General Setup tabs, member card grid with search + role
  filter chips, new `InviteMemberDialog`/`CreateTeamDialog`/
  `MemberManagementDialog` (all via the existing `Dialog.jsx` shell).
  `CreateTeamDialog` deliberately drops the mock's manual "Slug" field since
  the real `POST /orgs` auto-generates a unique slug from the name.
- **`FeaturePolicyGrid.jsx`** (new) — grouped feature-toggle grid: a 2-way
  switch for the 8 binary-only codes, a 3-way segmented control for the rest.
  Powers both `AdminSiteFeaturesPage.jsx` (site-wide policy) and
  `AdminTeamsPage.jsx` (per-org override, with an added "Default" state to
  clear an override).
- **`AdminTabShell.jsx`** — trimmed to the mock's exact 4 tabs, in the mock's
  order: Site Features, Teams, Projects, Users. Audit Log and AI Models
  dropped from the visible tab bar (routes/components untouched, still
  reachable by direct URL — see `HIDDEN.md`).
- **`AdminUsersPage.jsx`/`AdminProjectsPage.jsx`** — kept the real
  functionality the mock doesn't show (search, date/status filters, batch
  actions, export/import), added the mock's team + role filters, switched row
  rendering from a table to the mock's avatar-circle/thumbnail card style.
- **`AccountPage.jsx`** — avatar-circle header, a real editable display name
  (wired to `PATCH /auth/me`), segmented pill theme controls (was 3
  `<select>`s), and a fully wired Danger Zone (Export/Remove data/Delete
  account, previously three permanently-disabled placeholders).
- Two real, pre-existing bugs found and fixed while verifying the pages
  against a real login flow (not caught by the existing test suite, which
  mocked `useUserAuth` with a stable value from the first render):
  - **`AdminKeyGate.jsx`** called `useEffect` after an early
    `if (userIsAdmin) return children;` — a rules-of-hooks violation. Since
    `userIsAdmin` starts `false` and flips to `true` once `useUserAuth`'s
    async `/auth/me` check resolves, the component's hook count differed
    between its first and second render for any real user-based admin,
    crashing the entire Admin section with "Rendered fewer hooks than
    expected." Fixed by moving the conditional return after the hook.
  - **`index.html`'s** theme-flash-prevention inline script read the legacy
    `lcyt-theme` localStorage key, never migrated to read the dot-notation
    `lcyt.ui.theme` key that `AccountPage.jsx`/`SettingsModal.jsx` actually
    write to — so a saved dark-mode preference never survived a page reload.

## Backend API contract

### 1. `PATCH /auth/me` — self-service display-name update

Pre-existing (already implemented before this plan, per
`plan_team_org_backend.md`'s "quick win" #5).

```
PATCH /auth/me
Auth: user Bearer
Body: { name: string }
Response: { userId, email, name, createdAt, isAdmin }
```

### 2. `GET /auth/me/export` — self-service data export — implemented

GDPR-style export of the user's own account, projects (owned, explicit
member, or org-baseline member — role resolved as the higher of explicit
`project_members` access and org-membership role), and org memberships.

```
GET /auth/me/export
Auth: user Bearer
Response: {
  user: { id, email, name, createdAt },
  projects: [ { key, name, role, createdAt, expires, features: [...] } ],
  orgs: [ { id, name, slug, role, joinedAt } ]
}
```

### 3. `DELETE /auth/me/data` — "remove all my data" — implemented

Deletes projects the user owns (either `api_keys.user_id` or an explicit
`project_members` `owner` row) via the same anonymize+delete path
`DELETE /stats` uses for a single project, looped across every owned
project. Keeps the account itself; org membership/ownership rows are
untouched by this endpoint.

```
DELETE /auth/me/data
Auth: user Bearer
Response: { deletedProjectCount: number }
```

### 4. `DELETE /auth/me` — full account deletion — implemented

```
DELETE /auth/me
Auth: user Bearer
Response: { deleted: true }
```

Resolves the sole-owner-with-other-members edge case
(`plan_team_org_backend.md` appendix item #9) by refusing with `409` and a
descriptive error if the user is the sole `owner` of any org that still has
other members — they must transfer ownership or remove those members first.
Otherwise deletes owned projects (same path as `DELETE /auth/me/data`),
removes all `org_members` rows, then the user row itself, in one transaction.

### 5. `GET /admin/orgs` — admin-scoped list of all orgs — implemented

```
GET /admin/orgs?q=&limit=&offset=
Auth: X-Admin-Key or user Bearer with is_admin=1
Response: { orgs: [ { id, name, slug, memberCount, projectCount } ], total, limit, offset }
```

Used by `AdminTeamsPage.jsx`'s left-column org search + list — today's
`GET /orgs` (non-admin) stays scoped to the caller's own memberships.

### 6. Admin feature-policy endpoints — pre-existing, `binaryOnly` confirmed present

`GET/PUT /admin/feature-policies`, `GET/PUT /admin/orgs/:id/feature-overrides`
(`plan_site_feature_policies.md`) already returned `binaryOnly` per code on
both endpoints — `FeaturePolicyGrid.jsx` consumes this directly rather than
hardcoding the binary-only classification a second time on the client (it
still carries a small hardcoded fallback list for defensive robustness if a
future backend response ever omits the field).

### 7. `GET /admin/users` / `GET /admin/projects` — extended — implemented

```
GET /admin/users?...&orgId=<id>       -- filters to users in that org
GET /admin/projects?...&orgId=<id>    -- filters to projects with that api_keys.org_id
```

Both responses gained `orgName` (first org membership by `joinedAt`
ascending for users; direct `api_keys.org_id` join for projects, `null` if
personal). `GET /admin/users` additionally gained a per-user `role` field
(same first-org-membership role) — not in the original contract draft, added
during integration testing once `AdminUsersPage.jsx`'s role badge/filter
turned out to need it and the initial backend implementation (correctly,
per the contract as originally written) hadn't included it.

### 8. `GET /orgs/:id/members` — per-member `projectCount` — implemented

```
GET /orgs/:id/members
Response: { members: [{ id, userId, email, name, role, joinedAt, projectCount }] }
```

`projectCount` = count of the org's own projects (`api_keys.org_id = :id`) —
implemented as a simple per-org count rather than a per-member explicit-membership
count (a simplification from the original draft's exact wording, judged
acceptable since it's still a real, useful number and avoids an N+1-shaped
per-member subquery).

## Out of scope (deliberately deferred)

- **Per-category "team defaults" pull-down** (the mock's General Setup tab
  category cards with a "↓ team" button per project Setup card) — a
  substantial new concept (per-category default-item tables mirroring every
  device/config table) with no existing design anywhere in `docs/plans/`.
  Worth its own dedicated plan when prioritized.
- **Doc staleness this plan does *not* fix**: `packages/lcyt-backend/CLAUDE.md`'s
  route reference table is still missing the full `/orgs/*` CRUD surface and
  the `/admin/export|import/*`/`/admin/audit-log` routes (pre-existing gap,
  unrelated to this plan's scope — flagged for whoever next edits that file).

## Implementation status

Both frontend and backend halves are implemented and merged in the same
branch (`feat/profile-team-admin-reconciliation`), verified together:

- Backend: 862/862 `node:test` passing (`packages/lcyt-backend`).
- Frontend: 366/366 Vitest + 345/345 `node:test` passing (`packages/lcyt-web`).
- End-to-end: screenshots of all 6 reconciled routes (light + dark theme),
  plus the Invite Member / Member Management dialogs and Admin → Teams with
  a team selected, taken from a live dev build logged in against a real
  (mock) backend — this is what surfaced both bugs above, since the existing
  component test suite's mocked `useUserAuth` never exercised the
  `false`→`true` `isAdmin` transition that triggered the `AdminKeyGate` crash.
