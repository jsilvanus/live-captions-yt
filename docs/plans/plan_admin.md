# Admin Panel — Web-based User & Project Management

**Status:** in-progress (Phase 1)

> Conflates and extends the user/projects system from `plan_userprojects.md`.
> This plan covers the **admin dashboard** for managing users, projects (API keys),
> feature flags, and memberships — exposed as a feature-gated section within `lcyt-web`.

---

## Decision: Part of `lcyt-web` or Standalone (`lcyt-web-admin`)?

**Decision: Part of `lcyt-web`.**

Rationale:
1. **Shared infrastructure** — Auth hooks, API helpers, contexts, and components are reused.
2. **Feature gating** — The sidebar already supports `feature`-based visibility; adding `admin` is trivial.
3. **Single deployment** — One build, one Docker image, one static bundle.
4. **Consistent UX** — Admin uses the same design language, layout, and interaction patterns.
5. **Admin key separation** — The `X-Admin-Key` header provides the additional auth layer.
   The admin enters their key in the admin panel; it's stored in `sessionStorage` (not localStorage).

---

## Architecture Overview

### Backend (`lcyt-backend`)

New route file: `src/routes/admin.js`

**Endpoints** (all require `X-Admin-Key` header):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/users` | List users (search, pagination) |
| `GET` | `/admin/users/:id` | User detail + projects |
| `POST` | `/admin/users` | Create user |
| `PATCH` | `/admin/users/:id` | Update user (name, active) |
| `POST` | `/admin/users/:id/set-password` | Admin password reset |
| `DELETE` | `/admin/users/:id` | Delete user |
| `GET` | `/admin/projects` | List projects (search, pagination) |
| `GET` | `/admin/projects/:key` | Project detail + features + members |
| `PATCH` | `/admin/projects/:key` | Update project |
| `PUT` | `/admin/projects/:key/features` | Batch update features |
| `POST` | `/admin/batch/users` | Batch user operations |
| `POST` | `/admin/batch/projects` | Batch project operations |

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
| `/admin/users` | `AdminUsersPage` | User list, search, batch actions |
| `/admin/users/:id` | `AdminUserDetailPage` | User detail, projects, features |
| `/admin/projects` | `AdminProjectsPage` | Project list, search, batch actions |
| `/admin/projects/:key` | `AdminProjectDetailPage` | Project detail, features, members |

**Navigation:**
```js
// navConfig.js — new group
{
  id: 'admin',
  icon: '🛡️',
  label: 'Admin',
  feature: 'admin',
  items: [
    { id: 'admin-users',    label: 'Users',    path: '/admin/users' },
    { id: 'admin-projects', label: 'Projects', path: '/admin/projects' },
  ],
}
```

---

## Search Capabilities

- **User search:** by email, name, ID — query param `?q=`
- **Project search:** by owner, key, user email — query param `?q=`
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

## Phase 2 (planned)

- [ ] User feature entitlement management in admin UI
- [ ] Audit log viewer (admin actions)
- [ ] Export/import user and project data
- [ ] Advanced filtering (date ranges, usage stats)

## Phase 3 (planned)

- [ ] Role-based admin access (super-admin vs. read-only admin)
- [ ] Admin action confirmation dialogs
- [ ] Real-time admin dashboard with live stats
