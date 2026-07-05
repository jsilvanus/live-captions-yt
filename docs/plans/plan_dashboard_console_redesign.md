---
id: plan/dashboard-console-redesign
title: "Dashboard / Console Redesign"
status: implemented
summary: "Restructures lcyt-web's information architecture around a Claude Design mockup: Broadcast becomes the operate surface (Live + Settings tabs), root route becomes a contextual project summary, /setup becomes a persistent device/service catalog, plus new Team/Assets pages and extended Account/Admin. Frontend-only — zero backend changes; every real gap is a visible, disabled 'Coming soon' element."
---

# Plan: Dashboard / Console Redesign

## Context

A Claude Design mockup (`Dashboard.dc.html`, project `LCYT`) proposed a new IA: a
"Projects" hub, a per-project device/service "Setup" catalog, a "Team"/Org screen,
a richer "Profile", an "Assets" library, and a restyled Admin panel. This plan
implements that IA against the real app, making every mockup category visible —
while clearly flagging (not faking) anything where the backend doesn't support it
yet.

Key finding from the codebase survey: **no "Organization/Team" data model exists
anywhere in the backend** (all membership is per-project, via `project_members`).
This is the largest structural gap between the mockup (which assumes an org
owning multiple projects) and reality. Much of the rest of the mockup is
**already implemented, just scattered across separate pages** — Cameras/Mixers/
Encoders/Bridges (`lcyt-production`), Egress/stream targets (`lcyt-rtmp`),
Viewports (`lcyt-dsk`), STT config, per-key Storage override — these needed
**consolidation**, not new backend work.

## Routing model (supersedes the mockup's literal nesting)

- The widget-grid operator console (Status/SentLog/Audio/Quick-Send/File/Viewer/
  Viewports/Metacode widgets), formerly at `/` as `DashboardPage`, is now the
  **Live** tab of `/broadcast` (`broadcast/LiveTab.jsx`), with a thin preset
  layer (`BROADCAST_PRESETS`) on top of the existing fully-customizable
  drag/resize edit mode. The old Encoder/YouTube/Stream-relay config
  (`BroadcastModal`) becomes the **Settings** tab of the same page.
- **Root route `/` is now contextual**: an active/connected project → that
  project's summary view (`ProjectSettingsPage`, Summary tab, implicit active
  session key); no active project + `login` feature present → redirect to
  `/projects`; no active project + no `login` feature (minimal-mode backend,
  no multi-project concept) → render the Live tab directly.
- The "Dashboard" nav item is removed — its destination and meaning are fully
  absorbed by `/` (project summary) and `/broadcast` (live operate).
- The Broadcast nav item is no longer gated on `feature:'rtmp'` (it now hosts
  the always-relevant caption-operate surface); only the RTMP-relay portion of
  Settings stays conditioned on the `rtmp` feature internally.

## Design ⇄ Implementation Gap Matrix

| Design category | Backend status | Treatment in this pass |
|---|---|---|
| Projects list | Exists (`ProjectsPage.jsx`) | Kept; "Manage" now navigates to `/projects/:key` |
| Project Settings (summary/features/team/danger) | Exists, nested in a modal | Un-nested into routed `ProjectSettingsPage`; also serves as `/`'s contextual summary |
| Setup: Cameras/Mixers/Encoders/Bridges | Fully implemented | Consolidated into `SetupHubPage`; CRUD logic extracted into `*Manager` components reused by both the existing standalone routes and the hub |
| Setup: Egress (stream targets) | Fully implemented (4-slot) | Summary card linking to Broadcast → Settings |
| Setup: Ingestion | Implicit flag only, no dedicated entity | Visible, status-only card, "Coming soon" for dedicated config |
| Setup: Web Radio | Flag + read-only status only | Visible, status-only card, "Coming soon" for config |
| Setup: Viewports | Fully implemented | Summary card linking to Graphics → Viewports |
| Setup: Caption targets | No backend (localStorage only) | Visible card linking to CC → Targets, flagged client-only |
| Setup: Languages/translation | No backend (localStorage only) | Visible card linking to Translations page, flagged client-only |
| Setup: STT service | Fully implemented (`GET/PUT /stt/config`) | Embeds existing `SttPanel` wired to the real per-key config endpoint |
| Setup: Storage (S3/WebDAV) | Real endpoint (`GET/PUT /file/storage-config`), feature-gated, no prior frontend | New minimal panel wired to the real endpoint |
| Setup: AI Models (tracker/describer/assistant) | Partial — one embedding slot only (`/ai/config`) | Current slot shown; 3-role split marked "Coming soon" |
| Setup: API Connectors | No backend at all | Visible, disabled, "Coming soon" |
| Setup: Workflows | No backend; mockup itself stubs this | Visible, disabled, "Coming soon" |
| Assets (captions/rundowns/graphics/translations/broadcasts/thumbnails) | No counting backend except Graphics (`GET /dsk/:key/templates`) | New `AssetsPage`; real count for Graphics, "not tracked yet" elsewhere (no fabricated 0s) |
| Broadcast | Mockup is a stub; real Encoder/YouTube/Stream tabs already exist | Home of the Live widget grid (default) + Settings (existing config tabs) |
| Graphics editor entry | Exists (`/graphics/*`) | Unchanged, linked from the new hub |
| Team/Org (members/projects/general) | No org entity; real team feature is planned separately | Single "Coming soon" placeholder + link to per-project Members tab; no aggregation logic built |
| Profile (name edit, themes, danger zone) | Name edit / account deletion: no endpoint. Password change: exists. | Theme pickers added (client-only); name edit + danger zone shown as "Coming soon" |
| Admin: Site Features / Teams / Users / Projects / Audit log | Users/Projects/Audit-log exist; "Site Features"/"Teams" don't | Existing 3+1 admin pages kept, wrapped in a tab shell; two new stub tabs added |

## Key Architecture Decisions

1. **No per-project route nesting.** The app operates on one "active session"
   project at a time. `ProjectSettingsPage` is the one exception that takes an
   explicit `:key` (to manage *any* project from the list) — Setup/Assets/
   Broadcast/Graphics stay keyed to the active session, as before.
2. **`/setup` is repurposed** from the one-time onboarding wizard to the
   persistent device/service catalog (`SetupHubPage`). The wizard is not
   deleted — reachable from the hub via "Run setup wizard".
3. **Old standalone Production CRUD routes are kept working, not deleted.**
   Camera/Mixer/Encoder/Bridge list+dialog logic was extracted into `*Manager`
   components (`CamerasManager`, `MixersManager`, `EncodersManager`,
   `BridgesManager`) used both at their existing routes and inside the new
   Setup catalog.
4. **`ProjectDetailModal` was un-nested into `ProjectSettingsPage`**, reused for
   both `/` (implicit active key) and `/projects/:key` (explicit key from the
   list's "Manage" button).
5. **`Team` page is a deliberate placeholder, not an aggregation hack.** Real
   team/org functionality is planned as its own future feature (proper org
   data model, backend-driven). `/team` ships as a single "Coming soon" screen
   with a link to the existing per-project Members tab. No membership
   aggregation code was written.
6. **Zero backend changes in this pass.** Every real gap is a clearly-marked
   disabled "Coming soon" UI element, matching the pattern already shipped for
   the OAuth buttons on login/signup.

## Deferred / Follow-up Work

The following require backend changes and were intentionally **not** built in
this pass (every corresponding UI element is visibly marked "Coming soon"):

- Name-edit endpoint for user accounts (`AccountPage` Profile section).
- Account deletion / data export endpoints (`AccountPage` danger zone).
- Dedicated Ingestion entity and Web Radio config endpoints (today both are
  implicit flags/read-only status only).
- Multi-role AI Models (tracker/describer/assistant) — only a single
  embedding-provider slot exists today (`ai_config` table / `/ai/config`).
- API Connectors backend (no entity exists at all).
- Real org/Team data model spanning multiple projects with shared roles and
  org-wide defaults — the single biggest structural gap identified; `/team`
  and the Admin "Teams" tab are placeholders pending this work.
- Admin "Site Features" — no global (cross-project) feature-flag concept
  exists server-side; today's feature flags are always per-project or
  per-user.

## Files touched

See the individual phase commits on `feat/signup-redesign` for the full diff;
in summary: `BroadcastPage.jsx` + `broadcast/LiveTab.jsx` + presets,
`main.jsx` root-route resolver, `setup-hub/*` (new), `ProjectSettingsPage.jsx`
(new, replacing `ProjectDetailModal.jsx`), `TeamPage.jsx` (new),
`AssetsPage.jsx` (new), `AccountPage.jsx` (extended), Admin tab shell +
`AdminSiteFeaturesPage.jsx` / `AdminTeamsPage.jsx` (new stubs), `navConfig.js`.
