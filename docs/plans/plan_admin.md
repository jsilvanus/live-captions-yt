# Admin Panel â€” Web-based User & Project Management

**Status:** implemented (Phase 1 + Phase 2 + Phase 3)

> Conflates and extends the user/projects system from `plan_userprojects.md`.
> This plan covers the **admin dashboard** for managing users, projects (API keys),
> feature flags, and memberships â€” exposed as a feature-gated section within `lcyt-web`.

---

## Decision: Part of `lcyt-web` or Standalone (`lcyt-web-admin`)?

**Decision: Part of `lcyt-web`.**

Rationale:
1. **Shared infrastructure** â€” Auth hooks, API helpers, contexts, and components are reused.
2. **Feature gating** â€” The sidebar already supports `feature`-based visibility; adding `admin` is trivial.
3. **Single deployment** â€” One build, one Docker image, one static bundle.
4. **Consistent UX** â€” Admin uses the same design language, layout, and interaction patterns.
5. **Admin key separation** â€” The `X-Admin-Key` header provides the additional auth layer.
   The admin enters their key in the admin panel; it's stored in `sessionStorage` (not localStorage).

---

## Architecture Overview

### Backend (`lcyt-backend`)

New route file: `src/routes/admin.js`

**Endpoints** (all require `X-Admin-Key` header):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/admin/api/v1/users` | List users (search, pagination) |
| `GET` | `/api/v1/admin/api/v1/users/api/v1/:id` | User detail + projects |
| `POST` | `/api/v1/admin/api/v1/users` | Create user |
| `PATCH` | `/api/v1/admin/api/v1/users/api/v1/:id` | Update user (name, active) |
| `POST` | `/api/v1/admin/api/v1/users/api/v1/:id/api/v1/set-password` | Admin password reset |
| `DELETE` | `/api/v1/admin/api/v1/users/api/v1/:id` | Delete user |
| `GET` | `/api/v1/admin/api/v1/projects` | List projects (search, pagination) |
| `GET` | `/api/v1/admin/api/v1/projects/api/v1/:key` | Project detail + features + members |
| `PATCH` | `/api/v1/admin/api/v1/projects/api/v1/:key` | Update project |
| `PUT` | `/api/v1/admin/api/v1/projects/api/v1/:key/api/v1/features` | Batch update features |
| `POST` | `/api/v1/admin/api/v1/batch/api/v1/users` | Batch user operations |
| `POST` | `/api/v1/admin/api/v1/batch/api/v1/projects` | Batch project operations |

**Health endpoint:** Adds `'admin'` to the features array when `ADMIN_KEY` is set.

### Frontend (`lcyt-web`)

**Admin key flow:**
1. Backend health reports `admin` feature when `ADMIN_KEY` is set.
2. Sidebar shows "Admin" group (gated on `admin` feature).
3. Admin pages prompt for admin key if not yet entered.
4. Key stored in `sessionStorage('lcyt.admin.key')`.
5. All admin API calls include `X-Admin-Key` header.

**Pages:**

| Path | Component | Description |
|------|-----------|-------------|
| `/api/v1/admin/api/v1/users` | `AdminUsersPage` | User list, search, batch actions |
| `/api/v1/admin/api/v1/users/api/v1/:id` | `AdminUserDetailPage` | User detail, projects, features |
| `/api/v1/admin/api/v1/projects` | `AdminProjectsPage` | Project list, search, batch actions |
| `/api/v1/admin/api/v1/projects/api/v1/:key` | `AdminProjectDetailPage` | Project detail, features, members |

**Navigation:**
```js
// navConfig.js â€” new group
{
  id: 'admin',
  icon: 'ðŸ›¡ï¸',
  label: 'Admin',
  feature: 'admin',
  items: [
    { id: 'admin-users',    label: 'Users',    path: '/api/v1/admin/api/v1/users' },
    { id: 'admin-projects', label: 'Projects', path: '/api/v1/admin/api/v1/projects' },
  ],
}
```

---

## Search Capabilities

- **User search:** by email, name, ID â€” query param `?q=`
- **Project search:** by owner, key, user email â€” query param `?q=`
- **Cross-entity search:** "search all projects of user:x and user:y"
  - `?q=user:alice@example.com user:bob@example.com`
  - Backend parses `user:` prefixes and filters projects by those user IDs

---

## Batch Operations

### User batch
```json
POST /admin/batch/users
{
  "ids": [1, 2, 3],
  "action": "deactivate" | "activate" | "delete"
}
```

### Project batch
```json
POST /admin/batch/projects
{
  "keys": ["key1", "key2"],
  "action": "revoke" | "activate" | "delete",
  "features": { "graphics-client": true, "stt-server": false }
}
```
When `features` is included alongside `action`, features are updated for all matching projects.

---

## Phase 1 (current)

- [x] Design plan
- [x] Backend: `GET /admin/users` (list + search)
- [x] Backend: `GET /admin/users/:id` (detail + projects)
- [x] Backend: `POST /admin/users` (create)
- [x] Backend: `PATCH /admin/users/:id` (update)
- [x] Backend: `POST /admin/users/:id/set-password` (password reset)
- [x] Backend: `DELETE /admin/users/:id` (delete)
- [x] Backend: `GET /admin/projects` (list + search)
- [x] Backend: `GET /admin/projects/:key` (detail + features + members)
- [x] Backend: `PATCH /admin/projects/:key` (update)
- [x] Backend: `PUT /admin/projects/:key/features` (batch update features)
- [x] Backend: `POST /admin/batch/users` (batch ops)
- [x] Backend: `POST /admin/batch/projects` (batch ops)
- [x] Backend: Add `admin` to health features
- [x] Backend: Mount admin routes in `server.js`
- [x] Backend: Tests
- [x] Frontend: Admin key entry + storage
- [x] Frontend: `AdminUsersPage`
- [x] Frontend: `AdminUserDetailPage`
- [x] Frontend: `AdminProjectsPage`
- [x] Frontend: `AdminProjectDetailPage`
- [x] Frontend: Navigation config update
- [x] Frontend: Route registration

## Phase 2 (implemented)

### Backend additions

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/v1/admin/api/v1/users` | Enhanced: added `?from=`, `?to=`, `?active=` filters |
| `GET`  | `/api/v1/admin/api/v1/projects` | Enhanced: added `?from=`, `?to=`, `?status=` filters |
| `GET`  | `/api/v1/admin/api/v1/users/api/v1/:id/api/v1/features` | List user feature entitlements |
| `PATCH`| `/api/v1/admin/api/v1/users/api/v1/:id/api/v1/features` | Grant/api/v1/revoke user feature entitlements |
| `GET`  | `/api/v1/admin/api/v1/audit-log` | Query audit log (`?q=`, `?action=`, `?actor=`, `?from=`, `?to=`) |
| `GET`  | `/api/v1/admin/api/v1/export/api/v1/users` | Export all users + features as JSON |
| `GET`  | `/api/v1/admin/api/v1/export/api/v1/projects` | Export all projects + features as JSON |
| `POST` | `/api/v1/admin/api/v1/import/api/v1/users` | Import users from JSON export |
| `POST` | `/api/v1/admin/api/v1/import/api/v1/projects` | Import projects from JSON export |

### Database additions

- `admin_audit_log` table â€” immutable append-only log of admin mutations:
  - `actor` â€” `user:email` or `api-key` label
  - `action` â€” e.g. `user.create`, `project.features.update`, `export.users`
  - `target_type` / `target_id` â€” what was affected
  - `details` â€” JSON payload of the change
  - `ip` â€” client IP address
  - `created_at` â€” timestamp (indexed)

### Frontend additions

- `AdminUsersPage` â€” date range + active/inactive status filters; Export JSON / Import JSON buttons
- `AdminProjectsPage` â€” date range + active/revoked status filters; Export JSON / Import JSON buttons
- `AdminUserDetailPage` â€” "Feature Entitlements" section: checkbox grid for all known feature codes with save
- `AdminAuditLogPage` (`/api/v1/admin/api/v1/audit-log`) â€” full audit log viewer with action /api/v1/ actor /api/v1/ date range filters and click-to-expand details panel
- `navConfig.js` â€” "Audit Log" item added to Admin sidebar group

- [x] Backend: `admin_audit_log` table schema + `db/audit-log.js` helpers
- [x] Backend: Audit logging on all mutating admin endpoints
- [x] Backend: `GET /admin/audit-log` (with filters)
- [x] Backend: `GET /admin/users` enhanced (date range + active filter)
- [x] Backend: `GET /admin/projects` enhanced (date range + status filter)
- [x] Backend: `GET /admin/users/:id/features` + `PATCH /admin/users/:id/features`
- [x] Backend: `GET /admin/export/users` + `GET /admin/export/projects`
- [x] Backend: `POST /admin/import/users` + `POST /admin/import/projects`
- [x] Backend: Tests (55 tests passing)
- [x] Frontend: User feature entitlements editor in `AdminUserDetailPage`
- [x] Frontend: `AdminAuditLogPage` component + route `/api/v1/admin/api/v1/audit-log`
- [x] Frontend: `AdminUsersPage` â€” advanced filters + export/import
- [x] Frontend: `AdminProjectsPage` â€” advanced filters + export/import
- [x] Frontend: `navConfig.js` â€” Audit Log nav item
- [x] Frontend: Build verified

## Phase 3

- [x] Role-based admin access (`full`/`readonly` â€” `tmp_plan_tier3.md` Item 3a): additive
      `users.admin_role` column, `requireFullAdmin()` middleware gates every mutating
      `/api/v1/admin/api/v1/*` route (`X-Admin-Key` always resolves to full access).
- [x] Admin action confirmation dialogs (`tmp_plan_tier3.md` Item 3b): shared
      `ConfirmDialog.jsx` component replaces the native `confirm()` popups in
      `AdminUsersPage.jsx`/`AdminProjectsPage.jsx`/`AdminUserDetailPage.jsx`/`AdminProjectDetailPage.jsx`.
- [x] Real-time live-stats dashboard â€” delivered separately by `plan_metering_audit.md`
      (`AdminMetricsPage.jsx`, `GET /admin/metrics/live`), not this plan.

