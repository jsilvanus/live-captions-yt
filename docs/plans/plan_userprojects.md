---
id: plan/userprojects
title: "Richer Projects System: Feature Flags, Membership, and Device Roles"
status: implemented
summary: "Normalize per-project feature flags into a dedicated table, add user entitlement tiers, project membership with access levels, per-member permission overrides, and pin-code device roles (camera/mic/mixer) for production devices. Phases 1–3 implemented."
---

# Richer Projects System

## Overview

The project system was a thin CRUD wrapper around `api_keys` rows. Feature flags were scattered as individual boolean columns (`relay_allowed`, `hls_enabled`, etc.), there was no concept of who can do what within a project, and there was no way to give a device (camera tablet, mic station, mixer panel) a scoped login without a full user account.

This plan adds:

1. **Normalized feature flags** — `project_features` table; legacy boolean columns remain for backward compat
2. **User entitlement tier** — `user_features` controls which features a user may enable on their projects
3. **Project membership** — `project_members` + `project_member_permissions` (access levels: owner / admin / member)
4. **Device roles** — `project_device_roles` with two-level PIN auth (project code + role PIN) for physical production devices

### Design constraints

- Fully additive — no existing columns removed; all existing calls to `api_keys` continue working unchanged
- Idempotent back-fill migration runs on startup; zero-downtime upgrade
- No enforcement middleware in Phase 1 — gates are data only; Phase 2 adds `requireFeature` middleware with `FEATURE_GATE_ENFORCE` soft switch

---

## Feature Codes (26 codes)

| Category | Code | Description |
|---|---|---|
| Core | `captions` | Send captions to YouTube and other targets |
| Core | `viewer-target` | Public caption viewer SSE stream (`/viewer/:key`) — separate from device control |
| Core | `mic-lock` | Collaborative soft mic for multi-operator sessions |
| Core | `stats` | Usage history and analytics |
| Core | `collaboration` | Multi-operator concurrent captioning |
| Content | `file-saving` | Save captions to files for download |
| Content | `translations` | Multilingual caption delivery |
| Content | `planning` | Scripting and rundown *(coming soon)* |
| Graphics | `graphics-client` | DSK overlay viewer page (public, no auth) |
| Graphics | `graphics-server` | DSK template editor, renderer, and image upload |
| Streaming | `ingest` | RTMP ingest/relay slot management |
| Streaming | `radio` | Audio-only HLS stream output |
| Streaming | `hls-stream` | Video + audio HLS stream output |
| Streaming | `preview` | Live JPEG thumbnail from RTMP ingest |
| Streaming | `restream-fanout` | Generic HTTP POST targets alongside YouTube |
| Streaming | `cea-captions` | CEA-608/708 broadcast-standard caption encoding |
| Intelligence | `stt-server` | Server-side automatic speech-to-text |
| Production | `device-control` | Cameras, mixers, **and bridge instances** (bridge creation = device-control write right) |
| Integration | `embed` | Embeddable caption/viewer widgets with per-project CORS policy |

> **`viewer-target` vs `device-control`**: The viewer SSE stream (`/viewer/:key`) is for caption viewers (audience), not production operators. It is a separate feature code. Bridge instance management falls under `device-control`.

### Default features for new self-service projects

`captions`, `viewer-target`, `file-saving`, `translations`, `stats`, `mic-lock`, `embed`

### Legacy column → feature code mapping (back-fill)

| Legacy column | Feature code |
|---|---|
| `relay_allowed = 1` | `ingest` |
| `radio_enabled = 1` | `radio` |
| `hls_enabled = 1` | `hls-stream` |
| `backend_file_enabled = 1` | `file-saving` |
| `graphics_enabled = 1` | `graphics-server` |
| `cea708_delay_ms > 0` | `cea-captions` (config: `{ delay_ms }`) |
| `embed_cors` | `embed` (config: `{ cors }`) |
| Always | `captions`, `viewer-target`, `mic-lock`, `stats`, `translations`, `embed` |

---

## Permission Codes (12 codes)

Permissions control what a project member (full user account) can do within a project.

| Code | Allows |
|---|---|
| `captioner` | Send captions, sync clock, mic lock, use viewer targets |
| `file-manager` | Caption file upload/download/delete |
| `graphics-editor` | Create/edit DSK templates, upload images |
| `graphics-broadcaster` | Activate templates, broadcast live data, start/stop renderer |
| `production-operator` | Switch mixer sources, trigger camera presets |
| `stream-manager` | RTMP relay slots, HLS/radio/preview provisioning |
| `stt-operator` | Start/stop server-side STT, configure STT |
| `planner` | Read/write planning/rundown data |
| `stats-viewer` | Read usage stats |
| `device-manager` | Create/delete cameras, mixers, bridge instances |
| `member-manager` | Invite/remove members, change permissions (cannot promote to owner) |
| `settings-manager` | Rename project, change feature flags |

### Access level bundles

Project membership uses three access levels (distinct from device roles):

| Access level | Included permissions |
|---|---|
| `owner` | All 12 permissions; sole holder of delete-project right; only one per project |
| `admin` | All 12 permissions; cannot delete project |
| `member` | `captioner` only by default; admin grants more via `project_member_permissions` |

---

## Device Roles

Device roles provide **pin-code scoped logins** for physical production devices without requiring full user accounts. These are not access levels — they are a separate concept.

### Role types

| Type | Purpose | Auto-navigates to |
|---|---|---|
| `camera` | Tally display, camera preset control | `/production/camera/:key` |
| `mic` | Auto-connect with mic lock, captioner interface | `/` (main captioning UI) |
| `mixer` | Mixer source switching | `/production/lcyt-mixer/:key` |
| `custom` | Configurable permission set | `/` |

### Two-level PIN scheme

1. **Project device code** — 6-digit code on `api_keys.device_code`; identifies the project on the login page
2. **Role PIN** — 6-digit code hashed with bcrypt on `project_device_roles.pin_hash`; identifies the specific role

Login flow: `/device-login` → enter project code (6 digits) → enter role PIN (6 digits) → auto-connect

**Session lifetime**: indefinite (no JWT `exp`); revoke by deactivating/deleting the device role or regenerating its PIN.

**Device JWT payload**: `{ type: 'device', apiKey, roleId, roleType, permissions: [...] }`

---

## DB Schema Changes

### New tables (all additive)

```sql
-- Feature flags per API key
CREATE TABLE IF NOT EXISTS project_features (
  api_key      TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
  feature_code TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  config       TEXT,              -- JSON: per-feature config (embed cors, cea delay_ms, etc.)
  granted_by   INTEGER REFERENCES users(id),
  granted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (api_key, feature_code)
);

-- User entitlement tier: controls which features a user may enable on their projects
CREATE TABLE IF NOT EXISTS user_features (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_code TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  config       TEXT,
  granted_by   INTEGER REFERENCES users(id),
  granted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, feature_code)
);

-- Project membership (full user accounts)
CREATE TABLE IF NOT EXISTS project_members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key      TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT    NOT NULL DEFAULT 'member',   -- 'owner' | 'admin' | 'member'
  invited_by   INTEGER REFERENCES users(id),
  joined_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (api_key, user_id)
);

-- Per-member permission overrides on top of access_level bundle
CREATE TABLE IF NOT EXISTS project_member_permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES project_members(id) ON DELETE CASCADE,
  permission  TEXT    NOT NULL,
  granted     INTEGER NOT NULL DEFAULT 1,   -- 1=grant, 0=explicit revoke
  UNIQUE (member_id, permission)
);

-- Pin-code device roles for physical production devices
CREATE TABLE IF NOT EXISTS project_device_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key     TEXT    NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
  role_type   TEXT    NOT NULL,             -- 'camera' | 'mic' | 'mixer' | 'custom'
  name        TEXT    NOT NULL,
  pin_hash    TEXT    NOT NULL,             -- bcrypt hash of 6-digit role PIN
  permissions TEXT    NOT NULL DEFAULT '[]', -- JSON array of permission codes
  config      TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### New column on `api_keys`

```sql
ALTER TABLE api_keys ADD COLUMN device_code TEXT;  -- 6-digit project device code
```

### Back-fill migration (idempotent, runs in `initDb()`)

- For each `api_keys` row with no `project_features` rows: insert defaults + legacy column mappings
- For each `api_keys` row where `user_id IS NOT NULL`: insert owner as `access_level='owner'` if no `project_members` row exists
- For each `users` row with no `user_features` rows: insert default entitlements

---

## New Backend Files

### DB helpers

| File | Exports |
|---|---|
| `src/db/project-features.js` | `getProjectFeatures`, `getEnabledFeatureSet`, `hasFeature`, `setProjectFeature`, `setProjectFeatures`, `getUserFeatureSet`, `getUserFeatures`, `setUserFeature`, `provisionDefaultUserFeatures`, `provisionDefaultProjectFeatures` |
| `src/db/project-members.js` | `addMember`, `getMember`, `getMembers`, `removeMember`, `updateMemberAccessLevel`, `transferOwnership`, `setMemberPermission`, `getEffectivePermissions`, `memberHasPermission`, `getMemberAccessLevel`, `getMemberCount` |
| `src/db/device-roles.js` | `generatePin`, `generateDeviceCode`, `setProjectDeviceCode`, `getKeyByDeviceCode`, `createDeviceRole`, `getDeviceRole`, `getDeviceRoles`, `getActiveDeviceRolesForKey`, `updateDeviceRole`, `resetDeviceRolePin`, `deactivateDeviceRole` |

### Route modules

| File | Routes |
|---|---|
| `src/routes/project-features.js` | `GET/PUT/PATCH /keys/:key/features`, `PATCH /keys/:key/features/:code` |
| `src/routes/project-members.js` | `GET/POST /keys/:key/members`, `DELETE/PATCH /keys/:key/members/:userId`, `POST /keys/:key/members/:userId/transfer-ownership` |
| `src/routes/device-roles.js` | `GET/POST /keys/:key/device-roles`, `PATCH/DELETE /keys/:key/device-roles/:id`, `POST /keys/:key/device-roles/:id/reset-pin`, `GET/POST /keys/:key/device-code` |

### Modified files

| File | Change |
|---|---|
| `src/db/index.js` | 5 new tables + indexes + back-fill migration; new module re-exports |
| `src/routes/auth.js` | `POST /auth/device-login` (placed before `loginEnabled` guard; always available); new user registration provisions `user_features` |
| `src/routes/keys.js` | `_userListKeys` returns `features[]`, `memberCount`, `myAccessLevel`; `_userCreateKey` provisions features + adds owner member |
| `src/server.js` | Mounts `createProjectFeaturesRouter`, `createProjectMembersRouter`, `createDeviceRolesRouter` on `/keys/:key` |

---

## API Reference

### Project features

```
GET    /keys/:key/features
  Auth: user Bearer (any member) or X-Admin-Key
  Response: { features: [{ code, enabled, config, grantedAt }] }

PUT    /keys/:key/features
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Body: { features: { 'radio': true, 'file-saving': false } }
  Notes: user path validates requested codes against user_features entitlements
  Response: { features: [...] }

PATCH  /keys/:key/features/:code
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Body: { enabled: true, config?: { cors: "https://mysite.com" } }
  Response: { code, enabled, config, grantedAt }
```

### Project members

```
GET    /keys/:key/members
  Auth: user Bearer (any member) or X-Admin-Key
  Response: { members: [{ userId, email, name, accessLevel, permissions, joinedAt }], total }

POST   /keys/:key/members
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Body: { email, accessLevel?: 'admin'|'member', permissions?: [] }
  Notes: invitee must have existing account; phase 1 has no email invite flow
  Response: 201 { memberId, userId, email, accessLevel, joinedAt }

DELETE /keys/:key/members/:userId
  Auth: user Bearer (owner/admin, or self-remove) or X-Admin-Key
  Notes: cannot remove owner
  Response: { removed: true }

PATCH  /keys/:key/members/:userId
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Body: { accessLevel?: 'admin'|'member', permissions?: ['+captioner', '-file-manager'] }
  Notes: delta format for permissions; cannot change owner's level without transfer-ownership
  Response: { userId, accessLevel }

POST   /keys/:key/members/:userId/transfer-ownership
  Auth: user Bearer (current owner only)
  Body: { confirm: true }
  Notes: transfers owner; requester becomes admin
  Response: { ok: true }
```

### Device roles

```
GET    /keys/:key/device-code
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Response: { deviceCode: '123456' | null }

POST   /keys/:key/device-code
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Notes: generates or regenerates the 6-digit project code
  Response: { deviceCode: '654321' }

GET    /keys/:key/device-roles
  Auth: user Bearer (any member) or X-Admin-Key
  Response: { deviceRoles: [{ id, roleType, name, permissions, active, createdAt }] }

POST   /keys/:key/device-roles
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Body: { roleType: 'camera'|'mic'|'mixer'|'custom', name, permissions?: [], config?: {} }
  Response: 201 { ...role, pin: '123456' }  ← plain PIN returned exactly once

PATCH  /keys/:key/device-roles/:id
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Body: { name?, permissions?, config? }
  Response: updated role (no pin)

DELETE /keys/:key/device-roles/:id
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Response: { deactivated: true }

POST   /keys/:key/device-roles/:id/reset-pin
  Auth: user Bearer (owner/admin) or X-Admin-Key
  Response: { pin: '789012' }  ← new plain PIN, shown once
```

### Device login (on /auth router)

```
POST   /auth/device-login
  Auth: none (always available regardless of USE_USER_LOGINS)
  Body: { deviceCode: '123456', pin: '654321' }
  Response: { token, apiKey, roleId, roleType, name, permissions }
  Notes: token has no exp; revoke by deleting/deactivating the device role
```

### Extended existing endpoints

```
GET /keys  (user Bearer)
  Now returns per key: features[], memberCount, myAccessLevel

POST /keys (user Bearer)
  Now accepts: { name, features?: string[] }
  features are validated against the user's user_features entitlements
```

---

## Frontend Files

### New components (`packages/lcyt-web/src/components/`)

| File | Route / Purpose |
|---|---|
| `FeaturePicker.jsx` | Grouped toggle grid; 26 feature codes in 7 categories; disabled/coming-soon states |
| `ProjectDetailModal.jsx` | 4-tab modal: Settings (feature toggles) / Members / Device roles / Danger zone |
| `MemberRow.jsx` | Email, access level badge, permission chips, remove button |
| `InviteMemberForm.jsx` | Email + access level → `POST /keys/:key/members` |
| `DeviceRoleRow.jsx` | Role type badge, name, "New PIN" + "Remove" buttons; one-time PIN reveal |
| `CreateDeviceRoleForm.jsx` | Role type selector + name → `POST /keys/:key/device-roles`; one-time PIN display |
| `DeviceLoginPage.jsx` | `/device-login` — three-step: server URL → project code (6 digits) → role PIN (6 digits) |

### New hook (`packages/lcyt-web/src/hooks/`)

| File | Purpose |
|---|---|
| `useProjectFeatures.js` | Fetch + update project feature flags; exposes `hasFeature(code)`, `featureSet`, `featureConfig(code)`, `updateFeature()` |

### Modified files

| File | Change |
|---|---|
| `ProjectsPage.jsx` | Feature badge row on `ProjectCard`; "Manage" button opening `ProjectDetailModal`; `FeaturePicker` in `CreateProjectForm` (collapsible); `handleDelete` moved into modal Danger Zone tab |
| `main.jsx` | `/device-login` added as standalone path; `DeviceLoginPage` lazy-loaded |

---

## Current Status

All three core phases (data model, enforcement middleware, and admin user feature management) are implemented. Phase 4 (future device role enhancements) remains pending.

### Implemented checklist

- [x] Phase 1: DB tables (`project_features`, `user_features`, `project_members`, `project_member_permissions`, `project_device_roles`) + `device_code` column on `api_keys`
- [x] Phase 1: Idempotent back-fill migration on startup
- [x] Phase 1: DB helpers (`project-features.js`, `project-members.js`, `device-roles.js`)
- [x] Phase 1: Route modules mounted in `account.js` at correct paths (`/keys/:key/features`, `/keys/:key/members`, `/keys/:key/device-roles`, `/keys/:key/device-code`)
- [x] Phase 1: `POST /auth/device-login` device JWT handler
- [x] Phase 1: Extended `GET /keys` and `POST /keys` responses (features[], memberCount, myAccessLevel)
- [x] Phase 1: Frontend components (FeaturePicker, ProjectDetailModal, MemberRow, InviteMemberForm, DeviceRoleRow, CreateDeviceRoleForm)
- [x] Phase 1: `DeviceLoginPage` at `/device-login`
- [x] Phase 1: `useProjectFeatures` hook
- [x] Phase 2: `src/middleware/feature-gate.js` — `createRequireFeature` + `createRequireKeyFeature` + `isEnforced()`
- [x] Phase 2: Feature-gate applied to `/captions` (`captions` feature) and `/mic` (`mic-lock` feature)
- [x] Phase 2: Feature-gate applied to `GET /stats` (`stats` feature)
- [x] Phase 2: `FEATURE_GATE_ENFORCE` env var (default off; set to `1` to enable enforcement)
- [x] Phase 3: `GET /admin/users/:id/features` — list user entitlement tiers
- [x] Phase 3: `PATCH /admin/users/:id/features` — grant/revoke user entitlements
- [x] Tests: `packages/lcyt-backend/test/feature-gate.test.js` (28 tests)

### Remaining (Phase 4 — future enhancements)

- [ ] QR code generation for device PINs (scannable from web UI)
- [ ] Tally light display on the camera device role view
- [ ] Device role JWT verification middleware (check `active=1` on each request that uses a device token)
- [ ] Time-limited device role sessions (optional expiry field)
- [ ] Admin CLI `lcyt-backend-admin users features [list|grant|revoke]` commands
- [ ] Web UI for admin user feature management in admin panel

---

## Phased Implementation

### Phase 1 — Data model + UI (implemented)

- All 5 new DB tables + `device_code` column
- Back-fill migration
- All DB helper modules (`project-features.js`, `project-members.js`, `device-roles.js`)
- Route modules (`project-features.js`, `project-members.js`, `device-roles.js`) mounted at `/keys/:key/features`, `/keys/:key/members`, `/keys/:key` (device-roles + device-code)
- `POST /auth/device-login` device login handler
- Extended `GET /keys` + `POST /keys` responses
- All frontend components (FeaturePicker, ProjectDetailModal and its sub-components)
- `DeviceLoginPage` at `/device-login`
- `useProjectFeatures` hook

### Phase 2 — Enforcement middleware (implemented)

`src/middleware/feature-gate.js` exports:
- `createRequireFeature(db, featureCode)` — for session-based routes; reads `req.session.apiKey`
- `createRequireKeyFeature(db, featureCode)` — for project-param routes; reads `req.params.key`
- `isEnforced()` — returns `true` when `FEATURE_GATE_ENFORCE=1` or `FEATURE_GATE_ENFORCE=true`

Both middlewares are no-ops when `FEATURE_GATE_ENFORCE` is unset or `0`, making deployment safe.

**Applied gates:**

| Route | Feature code |
|---|---|
| `POST /captions` | `captions` |
| `POST /mic` | `mic-lock` |
| `GET /stats` | `stats` |

Additional gates (DSK, STT, RTMP, production) can be added in follow-up PRs once rollout is confirmed stable.

**Soft-enforcement period:** deploy with `FEATURE_GATE_ENFORCE=0` (default), monitor, then set `=1` to enable gates. The back-fill migration ensures all existing keys already have their correct features populated before enforcement goes live.

### Phase 3 — Admin user feature management (implemented)

Admin HTTP endpoints (require `X-Admin-Key` or admin user JWT):

```
GET  /admin/users/:id/features    — list user entitlement tiers
PATCH /admin/users/:id/features   — grant/revoke user entitlements
  Body: { features: { 'stt-server': true, 'radio': false } }
```

### Phase 4 — Future device role enhancements (pending)

- QR code generation for device PINs (scannable from web UI)
- Tally light display on the camera device role view
- Device role JWT verification middleware (check `active=1` on each request that uses a device token)
- Time-limited device role sessions (optional expiry field)
- Admin CLI `lcyt-backend-admin users features [list|grant|revoke]` commands
- Web UI for admin user feature management in admin panel

---

## Key Design Decisions

**Normalized table vs JSON blob**: `project_features` table (chosen) allows indexed lookups, `ON DELETE CASCADE`, per-feature config, and audit trail. A JSON blob on `api_keys` would be simpler but not queryable.

**Keep legacy columns**: Removing them would break `formatKey()`, `createKey()`, `updateKey()`, and any external integrations. The additive approach keeps all existing calls working unchanged.

**`viewer-target` separate from `device-control`**: Viewer SSE (`/viewer/:key`) serves the audience; device control manages cameras/mixers/bridges. Separate feature codes allow enabling viewer output without production hardware.

**Bridge under `device-control`**: Creating/managing bridge instances is a production-control action and requires `device-control` feature + `device-manager` permission. No separate `cameras-mixers` code.

**Device roles ≠ access levels**: Owner/admin/member = project membership for full user accounts. Camera/mic/mixer = scoped pin-code sessions for hardware devices. These are orthogonal systems.

**Two-level PIN**: Project code identifies the project (shared with all devices); role PIN identifies the specific role (per-device secret). This prevents guessing an active PIN without knowing the project code first.

**Indefinite device session**: Physical devices (camera tablets, mixer panels) are fixed installations — forcing re-login after 12h would disrupt a live production. Sessions are revoked by deactivating the device role or regenerating the PIN. This can be made time-limited later (Phase 4).

**User entitlement tier**: `user_features` rows control which features a user is allowed to enable on their projects. When a user tries to enable a feature, the backend validates it against `user_features`. This supports subscription-style tiering without a separate billing system.

**`FEATURE_GATE_ENFORCE` flag**: Allows staging Phase 2 enforcement independently of the code deployment. All existing keys are back-filled before enforcement can be enabled, so no legitimate traffic is broken on flip.
