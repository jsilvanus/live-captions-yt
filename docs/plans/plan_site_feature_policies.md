---
id: plan/site_feature_policies
title: "Site Feature Policies — Tri-State Availability Model"
status: implemented
summary: "Site-wide feature availability policy (available / self_service / denied per feature code), with per-org overrides, sitting alongside the existing user_features (per-user entitlement) and project_features (actual per-project toggle state) tables. Resolves the 'Site Features (admin global flags)' open question from plan_team_org_backend.md's appendix with a concrete recommendation. Worked example: custom storage (files-custom-bucket / files-webdav). Implemented: `site_feature_policies`/`org_feature_overrides` schema, `resolveFeaturePolicy()` baseline-plus-override resolver wired into the self-service project-features route, `GET/PUT /admin/feature-policies` + `GET/PUT /admin/orgs/:id/feature-overrides` admin routes (both include `binaryOnly` per code), and the admin frontend UI — `AdminSiteFeaturesPage.jsx`/`AdminTeamsPage.jsx` + shared `FeaturePolicyGrid.jsx` (see `plan_profile_team_admin_reconciliation.md`)."
---

# Site Feature Policies — Tri-State Availability Model

## Context

`docs/plans/plan_team_org_backend.md`'s gap appendix flagged "Site Features (admin global flags)" as blocked on a product decision: does flipping a global flag set the *default* for new users/projects, or does it *hard-override* everyone immediately? This plan resolves that with a concrete answer — neither, exactly; a **three-state policy** in between, described below — and designs it in full, including how it interacts with the org override mechanism from the team/org plan.

This plan does **not** replace `user_features` (per-user entitlement tier) or `project_features` (actual per-project toggle state). Both already exist and both keep doing exactly what they do today. This plan adds a third, orthogonal axis: **is this feature available to self-service-enable at all, on this deployment (or this org)** — a question neither existing table can currently answer, which is why today's self-service route (`PATCH/PUT /keys/:key/features`) can be tricked into looking safer than it is.

---

## The Gap in the Current Code (confirmed by reading the actual route)

`packages/lcyt-backend/src/routes/project-features.js`, `_batchUpdateFeatures` and `_patchFeature` (the non-admin, user-Bearer path):

```js
if (user) {
  const entitled = getUserFeatureSet(db, user.userId);
  for (const code of Object.keys(features)) {
    const val = features[code];
    const enabling = typeof val === 'boolean' ? val : val?.enabled;
    if (enabling && !entitled.has(code)) {
      return res.status(403).json({ error: `You are not entitled to enable feature '${code}'` });
    }
  }
}
```

This is the **only** gate on enabling a feature via self-service. There is no per-feature-code policy check at all — if a user is *entitled* (present in their `user_features` row set), they can flip any feature to `enabled: true` on any project they own or administer, with zero further restriction. `hasAdmin` (the `X-Admin-Key` path) skips this check entirely, exactly as it should.

The catch is `user_features` entitlements are **never granted by default** beyond a small baseline set. `provisionDefaultUserFeatures()` (`packages/lcyt-backend/src/db/project-features.js`) grants exactly `['captions', 'viewer-target', 'mic-lock', 'stats', 'translations', 'embed']` to every newly registered user. Everything else — including `files-custom-bucket` and `files-webdav` — requires a site admin to grant it first, one user at a time, via `PATCH /admin/users/:id/features`. There is no in-product UI or route through which a user can request it.

So today, "self-service" for anything outside that baseline set doesn't actually exist — it's admin-grant-only, dressed up as if it were self-service because the *code path* for enabling it is technically the ungated user route. This plan closes that gap by making the availability of each feature code an explicit, admin-controlled policy, rather than an implicit function of who happens to have been granted `user_features` entitlement.

---

## The Tri-State Model

Every feature code has an **effective policy mode**, resolved per project:

| Mode | Meaning |
|---|---|
| `available` | On for everyone, no gating. New projects get it enabled by default; the self-service route accepts `enabled: true` unconditionally (subject to the existing `user_features` entitlement check, unchanged — see "Relationship to `user_features`" below). |
| `self_service` | Off by default, but the project owner/admin can turn it on themselves via the existing `PATCH/PUT /keys/:key/features` route, without needing a site admin to act on their behalf. |
| `denied` | Hard off. The self-service route rejects `enabled: true` with 403 regardless of who is asking or what they're entitled to. Only a site admin can override it — either per-project via the existing raw `X-Admin-Key` bypass (unchanged, still works exactly as today), or per-org via `org_feature_overrides` (new, see below). |

**Only enabling is policy-gated.** Turning a feature *off* (`enabled: false`) is always allowed regardless of the resolved mode — nobody needs permission to disable something on their own project. This mirrors the existing entitlement check's asymmetry (`if (enabling && !entitled.has(code))` — the check only fires when turning something on).

---

## Binary-Only vs. Tri-State-Capable Features

Not every feature code can meaningfully be `self_service`. Some require the *operator* to have already provisioned a real backend resource or hardware integration before the feature could do anything at all, even if a project "enables" it — for those, `self_service` is a lie: flipping the bit doesn't make the capability work, so the only honest states are `available` (operator has provisioned it and is comfortable leaving it open) and `denied` (operator hasn't, or wants to gate it manually per-project/per-org).

Classified against the current catalog (`FEATURE_LABELS` in `AdminUserDetailPage.jsx` / `AdminProjectDetailPage.jsx`, cross-checked against `FEATURE_DEPS` in `packages/lcyt-backend/src/db/project-features.js`):

### Binary-only (`available` / `denied` only — no `self_service` tier)

| Code | Why self-service doesn't make sense |
|---|---|
| `ingest` | RTMP ingest slot provisioning is real media-relay capacity (nginx-rtmp/MediaMTX + a stream-key allocation). Today it's a raw admin-toggled column (`relay_allowed`) for exactly this reason — see `plan_team_org_backend.md` appendix item #2. Flipping a per-project bit doesn't create ingest capacity. |
| `radio`, `hls-stream`, `preview` | All three declare `ingest` as a hard dependency in `FEATURE_DEPS`. They inherit ingest's binary-only nature — none of them function without the ingest resource actually running. |
| `stt-server` | Requires a real STT backend already configured at the operator level (`GOOGLE_APPLICATION_CREDENTIALS`/`GOOGLE_STT_KEY`, `WHISPER_HTTP_URL`, or `OPENAI_STT_API_KEY` — all server env vars with real API cost/quota behind them). A project can't self-enable a speech-to-text provider that doesn't exist. |
| `device-control` | Requires physical AV hardware (AMX controllers, Roland/ATEM mixers) and, for remote sites, a running `lcyt-bridge` agent on-premises. Meaningless without hardware wired up first. |
| `graphics-server` | Depends on the shared headless-Chromium DSK renderer + an ffmpeg push per active key — real, ongoing CPU/RAM cost on the server for every key that turns it on, not a stateless toggle. `FEATURE_DEPS` also chains it through `ingest`. |
| `cea-captions` | CEA-608/708 encoding is a mode within the RTMP relay's ffmpeg tee-muxer pipeline (`plan_cea.md`) — only meaningful once `ingest` is actually running, and the encoding step needs correct per-deployment wiring (SRT stdin pipe, etc.). |

### Tri-state-capable (`available` / `self_service` / `denied` all meaningful)

| Code | Why self-service is meaningful |
|---|---|
| `captions`, `viewer-target`, `mic-lock`, `stats`, `collaboration`, `translations`, `embed` | Pure software toggles operating on state the platform already has (sessions, SSE, DB rows). No backend resource is provisioned by enabling them. |
| `graphics-client` | Public, read-only DSK overlay page — no renderer process involved (that's `graphics-server`); just a viewer page. |
| `file-saving`, `files-local` | Writes to the server's already-running local filesystem (`FILES_DIR`), which the operator configured once at deployment time, not per-project. |
| `files-managed-bucket` | Uses the *platform's own* S3 bucket (`S3_BUCKET`/`S3_*` env vars), a one-time operator setup; turning it on for one more project costs the operator nothing extra to provision. |
| `files-custom-bucket`, `files-webdav` | **The worked example below.** The user supplies their *own* credentials (their own bucket, their own WebDAV server) via `PUT /file/storage-config` — the operator provisions nothing at all. This is the clearest possible case for `self_service`. |
| `files-browser-local` | 100% client-side (browser File System Access API) — no backend involvement whatsoever. |
| `restream` (generic HTTP POST fan-out targets) | Pure software — no backend resource. (An operator may still *choose* a conservative default of `self_service` or even `denied` here for outbound-request/SSRF risk-management reasons, but that's a policy choice, not a technical requirement — the mode itself is meaningful either way.) |

---

## Worked Example: Custom Storage

This is exactly the gap identified above, modeled concretely:

- **`available`** — every project can bring its own S3 bucket or WebDAV server with zero gating at all; `files-custom-bucket`/`files-webdav` ship enabled by default on new projects and the toggle route accepts `enabled: true` unconditionally. Appropriate for an operator who has no concerns about users routing caption files to arbitrary third-party storage.
- **`self_service`** *(recommended default)* — off by default; a project owner/admin can enable it themselves from their own project settings (`PATCH /keys/:key/features/files-custom-bucket { enabled: true }`), then configure their bucket via the pre-existing `PUT /file/storage-config`. No admin involvement needed. This is the fix for the gap: today this requires an admin to first grant `user_features` entitlement per user with no self-service path; under this plan, the operator instead sets one row (`site_feature_policies.files-custom-bucket = 'self_service'`) once, for everyone.
- **`denied`** — must use the platform's default storage (local filesystem or managed bucket), no exceptions, unless a site admin grants a per-org override (e.g. an enterprise customer who requires their own storage for compliance reasons — see below) or force-enables it for one specific project via the existing raw admin bypass.

---

## Interaction with Org Overrides

A site admin can tighten or loosen the site-wide default for a specific org:

- **Tighten**: site default is `self_service` for `files-custom-bucket`, but a specific org (e.g. one on a restricted/managed-only plan) gets an override forcing `denied` — none of that org's projects may bring their own storage, even though the platform generally allows it.
- **Loosen**: site default is `denied` for `stt-server` (operator hasn't opened server-side STT to the general public), but an enterprise deal grants one org an override of `self_service` (or `available`) — that org's projects can use server-side STT even though nobody else on the platform can.

**Resolution order, made explicit:**

```
effective_mode(project, feature_code) =
    org_feature_overrides[project.org_id][feature_code]   -- if project.org_id is set AND a row exists
    ?? site_feature_policies[feature_code]                 -- otherwise
    ?? 'denied'                                             -- safe fallback for any code with no explicit row
```

Org override wins outright when present — it is not merged or averaged with the site default, it replaces it entirely for that org's projects. A project with no `org_id` (a personal project, per `plan_team_org_backend.md`) only ever sees the site-wide default; there is no org layer to consult.

### How this composes with the org-membership access cascade

`plan_team_org_backend.md` defines `getEffectiveProjectAccessLevel()` — resolving *who* has what role (owner/admin/member) on a project, combining org-membership baseline with explicit `project_members` rows. That is a **different axis** from this plan's `effective_mode()` — one answers "is this actor allowed to act on this project at all, and at what level," the other answers "is this feature allowed to be turned on for this project at all, regardless of who's asking." A self-service feature-enable request must pass **both**, independently:

1. The actor's effective access level (via `getEffectiveProjectAccessLevel`) must be `owner` or `admin` — unchanged from today's check in `project-features.js` (`if (level !== 'owner' && level !== 'admin') return 403`), just now resolved through the combined org+project resolver instead of a raw `project_members` lookup.
2. The feature's `effective_mode()` for that project must not be `denied` — the new check this plan adds.

Neither check is a substitute for the other. An org-baseline `member` cannot enable an `available` feature (fails check 1); an org `owner` cannot enable a site-`denied` feature just by virtue of being owner (fails check 2, unless their org has an override).

---

## Relationship to `user_features` (unchanged, kept as a separate axis)

`user_features` and `site_feature_policies`/`org_feature_overrides` answer different questions and both remain in force, combined with **AND**:

| Table | Question it answers | Who sets it | Scope |
|---|---|---|---|
| `user_features` | Is *this user's account* entitled to touch this feature code at all? (subscription-tier / plan lever) | Site admin, per user (`PATCH /admin/users/:id/features`) | Per user |
| `site_feature_policies` / `org_feature_overrides` | Is this feature code *available for self-service at all* on this deployment / this org? (platform-availability lever) | Site admin, per feature code (globally or per org) | Global, or per org |
| `project_features` | Is this feature *actually turned on right now* for this specific project? | Whoever successfully calls the toggle route (subject to both gates above) | Per project |

Nothing about `user_features` changes in this plan — `provisionDefaultUserFeatures()`, `getUserFeatureSet()`, and the entitlement check in `project-features.js` all stay exactly as they are. The new policy check is inserted as an *additional* precondition alongside the existing entitlement check, not a replacement for it. This does mean that, going forward, granting broad `user_features` entitlement to a user no longer alone controls whether they can self-enable something outside the baseline set — the feature also has to be policy-`available`/`self_service`, either site-wide or for their org. That is the intended effect: entitlement says "this user's plan allows it," policy says "this deployment currently allows it at all." A future simplification could consider whether `user_features` remains necessary for tri-state-capable codes once policy exists, but that is out of scope here — no existing behavior is removed by this plan.

---

## Proposed Schema

```sql
-- Site-wide default policy per feature code. One row per feature code with an
-- explicit policy; the migration seeds every currently-known code (see below).
-- Codes with no row (e.g. a future feature added before its policy is set)
-- resolve to 'denied' — safe-by-default rather than accidentally-open.
CREATE TABLE IF NOT EXISTS site_feature_policies (
  feature_code TEXT    PRIMARY KEY,
  mode         TEXT    NOT NULL DEFAULT 'denied',   -- 'available' | 'self_service' | 'denied'
  updated_by   INTEGER REFERENCES users(id),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Per-org override of the site-wide default. Set only by a site admin
-- (X-Admin-Key) — org owners/admins cannot set their own overrides, otherwise
-- an org could unilaterally grant itself access to a site-denied feature.
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

**Note:** `organizations` is defined in `plan_team_org_backend.md`; `org_feature_overrides` has an FK dependency on it and is therefore recorded as a schema addition in that plan's schema section too (cross-referenced, not duplicated — see the amendment noted there). The two tables described here (`site_feature_policies`, `org_feature_overrides`) are canonically specced in this document; `plan_team_org_backend.md` only lists `org_feature_overrides` in its own schema block for completeness and points back here for the full design.

### Seed values at rollout (migration-time, explicit — not a runtime fallback)

Since LCYT has no released users yet, the migration can simply insert one row per known feature code with the mode that matches today's *actual* de facto behavior, rather than needing a phased rollout:

| Mode | Codes |
|---|---|
| `available` | `captions`, `viewer-target`, `mic-lock`, `stats`, `translations`, `embed`, `files-local`, `files-browser-local` — the codes `provisionDefaultProjectFeatures()` already auto-enables for every new project today |
| `self_service` | `collaboration`, `file-saving`, `files-managed-bucket`, `files-custom-bucket`, `files-webdav`, `graphics-client`, `restream` |
| `denied` | `ingest`, `radio`, `hls-stream`, `preview`, `stt-server`, `device-control`, `graphics-server`, `cea-captions` |

This seed makes `files-custom-bucket`/`files-webdav` policy-`self_service` from day one — closing the gap this plan exists to close — while everything that today genuinely requires operator-provisioned infrastructure stays `denied` until an admin (or an org override) says otherwise.

---

## Route / Validation Changes (spec only)

### New admin routes (mirroring the existing `/admin/*` pattern in `packages/lcyt-backend/src/routes/admin.js`)

```
GET  /admin/feature-policies
  Auth: X-Admin-Key
  Response: { policies: [{ code, mode, binaryOnly, updatedBy, updatedAt }] }
  Notes: binaryOnly is computed from a hardcoded classification table (see above),
         not stored — it's a property of the feature code, not configurable state

PUT  /admin/feature-policies/:code
  Auth: X-Admin-Key
  Body: { mode: 'available'|'self_service'|'denied' }
  Notes: 400 if code is binary-only and mode='self_service'
         404 if code is not a recognized feature code
  Response: { code, mode, updatedAt }

GET  /admin/orgs/:id/feature-overrides
  Auth: X-Admin-Key
  Response: { overrides: [{ code, mode, setBy, setAt }] }

PUT  /admin/orgs/:id/feature-overrides/:code
  Auth: X-Admin-Key
  Body: { mode: 'available'|'self_service'|'denied'|null }   -- null removes the override row,
                                                               falling back to the site-wide default
  Notes: same binary-only validation as the site-wide route
  Response: { code, mode }  (mode: null if removed)
```

### Modified: `packages/lcyt-backend/src/routes/project-features.js`

`_batchUpdateFeatures` and `_patchFeature` (non-admin path only — `hasAdmin` continues to bypass everything, unchanged) gain one more precondition when `enabling` is true, inserted alongside the existing entitlement check:

```js
if (user) {
  const entitled = getUserFeatureSet(db, user.userId);
  for (const code of Object.keys(features)) {
    const val = features[code];
    const enabling = typeof val === 'boolean' ? val : val?.enabled;
    if (!enabling) continue;

    if (!entitled.has(code)) {
      return res.status(403).json({ error: `You are not entitled to enable feature '${code}'` });
    }

    // NEW: resolve effective policy (org override > site default > 'denied')
    const mode = resolveFeaturePolicy(db, req.params.key, code);
    if (mode === 'denied') {
      return res.status(403).json({
        error: `Feature '${code}' is not available on this deployment`,
        feature: code,
        policyMode: mode,
      });
    }
  }
}
```

`resolveFeaturePolicy(db, apiKey, featureCode)` is a new export, likely in `src/db/project-features.js` alongside the tables it reads:

```js
export function resolveFeaturePolicy(db, apiKey, featureCode) {
  const project = getKey(db, apiKey);
  if (project?.org_id) {
    const override = getOrgFeatureOverride(db, project.org_id, featureCode);
    if (override) return override.mode;
  }
  const policy = getSiteFeaturePolicy(db, featureCode);
  return policy?.mode ?? 'denied';
}
```

### Modified: `packages/lcyt-backend/src/db/project-features.js`

New exports: `getSiteFeaturePolicy(db, code)`, `getSiteFeaturePolicies(db)`, `setSiteFeaturePolicy(db, code, mode, updatedBy)`, `getOrgFeatureOverride(db, orgId, code)`, `getOrgFeatureOverrides(db, orgId)`, `setOrgFeatureOverride(db, orgId, code, mode, setBy)`, `clearOrgFeatureOverride(db, orgId, code)`, `resolveFeaturePolicy(db, apiKey, code)`. A hardcoded `BINARY_ONLY_FEATURES` `Set` (the eight codes classified above) lives alongside `FEATURE_DEPS` for the admin route's validation.

### Provisioning defaults at project/org creation time

`provisionDefaultProjectFeatures()` should additionally consult `site_feature_policies`/`org_feature_overrides` for codes in `available` mode and include them in the auto-enabled default set for newly created projects — not just the hardcoded list it uses today. This keeps "new project gets `available` features on by default" true without needing to hardcode the seed list twice.

---

## What This Plan Does Not Cover

- **Frontend UI** for the admin feature-policy editor was not specced here originally — it shipped as a follow-up, see `plan_profile_team_admin_reconciliation.md` (`AdminSiteFeaturesPage.jsx`/`AdminTeamsPage.jsx` + shared `FeaturePolicyGrid.jsx`).
- **Per-user overrides** (as opposed to per-org) are not introduced — if a single user (not an org) needs an exception to a `denied` site policy, the existing raw `X-Admin-Key` admin bypass on `PUT /admin/projects/:key/features` already covers that case without new schema.
- **Whether `user_features` should eventually be simplified or merged with this model** is explicitly deferred (see "Relationship to `user_features`" above) — both stay as they are for now.

---

## Effort Estimate

Small-to-medium: two new tables (no migration complexity — greenfield, no existing data to reconcile), one new resolver function, one new precondition inserted into an existing route, four new admin routes following an existing well-established pattern (`/admin/*`), and a fixed classification table that only needs writing once. Materially smaller than the Team/Org plan itself — this can reasonably be built as a follow-on to (or in parallel with) the org schema work, since `org_feature_overrides` has an FK on `organizations` and therefore cannot ship before that table exists.
