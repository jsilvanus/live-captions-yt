---
id: plan/project_roles
title: "Project Roles & Visibility — Setup/Assets/Production Access Tiers"
status: implemented
summary: "Follow-up to plan_team_org_backend.md: replaces the flat org-baseline 'member' access level with a real per-project role model (owner/admin/editor/operator/viewer — a project-scoped vocabulary kept separate from the org-scoped owner/admin/member vocabulary, not unified with it), a per-project visibility setting (private vs. team-visible, with a configurable viewer/editor ceiling for ordinary org members and an unconditional admin override for org admins/owners), and a page-scoped write gate (Setup Hub = explicit admin/owner only, Assets = editor+, Production = the new operator role). Captures a design discussion from 2026-07-20's PR #289 code-review, where an interim fix (explicit-owner/admin-only gating on /mcp-tokens and /ai/providers) shipped ahead of this full model, plus a 2026-07-26 follow-up conversation that resolved all five open questions and set the UI home (ProjectSettingsPage, not Setup Hub). Implemented 2026-07-26–2026-07-31 via the phase plan (`docs/plans/tmp_plan_project_roles.md`): schema/resolver/gate middleware, per-plugin route gating across lcyt-backend/lcyt-dsk/lcyt-connectors/lcyt-production (lcyt-rtmp and two lcyt-files/icons.js routes deliberately left ungated — auth-model blocker, logged in CONSIDER.md), and the ProjectSettingsPage.jsx UI (visibility toggle, ceiling picker, 5-role member picker). **Not done:** `GET /keys`'s user-scoped listing only returns projects the caller directly owns and hardcodes `myAccessLevel: 'owner'`, so a non-owner member currently can't see a project they've been granted access to via `/projects`/`/projects/:key` at all — logged in CONSIDER.md, a separate backend change."
related: plan/team_org_backend, plan/site_feature_policies
---

# Project Roles & Visibility — Setup/Assets/Production Access Tiers

## Context

`plan_team_org_backend.md` shipped `getEffectiveProjectAccessLevel()`: org membership now grants a flat project-baseline of `'member'` to every project under the org (unless the project is `restricted`). That resolver is wired into the single shared `middleware/project-access.js` gate, so it reaches **every** `scopedAuth('<resource>')`-mounted router — not just the handful of routes that motivated the plan (captions, DSK, cues). This is by design (the whole point of centralizing the fix), but it surfaced a real gap during PR #289's code-review: two routes reachable through that same broad gate — `POST /mcp-tokens` (mint a personal, exportable MCP access token) and `POST/PUT/DELETE /ai/providers` (add a credentialed AI provider) — do no further role check beyond "the middleware let me through." An org member with only baseline access (even the `viewer`-tier org role) could mint a durable, exportable credential for a project they were never explicitly invited to.

That specific gap is fixed (see "What shipped as the interim fix" below). This document is the fuller design it was scoped out of, captured from a conversation with the project owner on 2026-07-20 so the reasoning isn't lost before the next pass picks it up.

## The target model (as specified 2026-07-20)

> Only org admin and project owner/admin should be able to write in Setup. Project Editor should be able to write in Assets. Project Viewer: no write rights. A project can be set as private or visible to team; when visible to team, the project has a variable for which rights to give org members: viewer or editor (never admin). Explicit access to Setup is necessary.

Unpacking this into concrete pieces:

1. **Per-project visibility**: `private` (org membership grants zero baseline access — today's `api_keys.restricted = 1`, already implemented) vs. `team` (org membership grants a baseline role, today's `restricted = 0` / default). This part already exists via `plan_team_org_backend.md`'s `restricted` column.
2. **A configurable ceiling on the team-visible baseline**: today the baseline is hardcoded to `'member'`. The target model makes it a per-project choice between `'viewer'` (read-only, the default) and `'editor'` (can write in Assets) — **never `'admin'`** for ordinary org members, regardless of the project's setting. This needs a new column (e.g. `api_keys.org_baseline_role TEXT DEFAULT 'viewer'`, constrained to `viewer`/`editor`). **Exception, decided 2026-07-26:** an org `owner`/`admin` always resolves to project `admin` on any team-visible project, unconditionally — the ceiling only caps ordinary org members, it never caps org admins/owners. See "Decided" below.
3. **Two separate role vocabularies, kept apart — decided 2026-07-26.** Org-scoped roles (`owner`/`admin`/`member`, `plan_team_org_backend.md`) and project-scoped roles (`owner`/`admin`/`editor`/`operator`/`viewer`, this plan) are **not** unified into one enum. `project_members.access_level` gains `editor`/`operator`/`viewer` as real values alongside its existing `owner`/`admin`; existing explicit `'member'` rows migrate to `'editor'`. The org vocabulary is untouched. See "Decided" below.
4. **Page-scoped write gates**, per the project owner's own framing:
   - **Setup** (the Setup Hub page and everything it configures — DSK templates/viewports, MCP tokens, AI providers, connectors, radio/ingestion/egress config, caption targets, STT config, storage config, camera/mixer/encoder/bridge CRUD, device roles, etc.) — write requires **explicit** `project_members` `owner`/`admin` (or an org owner/admin's unconditional admin override, per point 2 above). Ordinary org-baseline access (even at `editor` ceiling) must never be enough — this is the one hard rule stated twice ("no admin [via org baseline]", "explicit access to Setup is necessary").
   - **Assets** (the `/assets` page — image/graphics uploads, cue rules) — write requires `editor` or above, explicit or org-baseline-granted.
   - **Production** (live-operate: camera/mixer switching, PTZ preset recall, i.e. the day-to-day "run the show" actions, as distinct from *configuring* cameras/mixers, which is Setup) — **decided 2026-07-26:** a fifth role, `operator`, gates this tier — full live-operate/command rights, distinct from `editor` (Assets) and `admin` (Setup config).
   - **Read** (`viewer` and above) — no write rights anywhere; can see Assets and produced files (videos, caption files) but not Setup Hub settings.

## What shipped as the interim fix (2026-07-20, PR #289)

Rather than build the full model above under merge-timeline pressure, a narrow, well-tested interim fix shipped instead, closing the concrete finding without redesigning the role system:

- `packages/lcyt-backend/src/routes/mcp-tokens.js` — `requireExplicitAdmin(db)` middleware, applied to `POST`/`PATCH`/`DELETE` (not `GET`): requires `getMemberAccessLevel(db, apiKey, userId) ∈ {owner, admin}` for the authenticated user, ignoring org-baseline access entirely for these three verbs.
- `packages/plugins/lcyt-agent/src/routes/ai-providers-project.js` — same shape (`requireExplicitAdmin`), but since `lcyt-agent` has no direct access to `lcyt-backend`'s `project_members` table (plugin boundary), the check is injected as `deps.isExplicitProjectAdmin(apiKey, userId)`, built in `server.js` from `getMemberAccessLevel` and passed into `createProjectAiProvidersRouter`'s `deps`.
- Both fail closed: no injected/resolvable check ⇒ 403, not silent pass-through.
- Test coverage: `packages/lcyt-backend/test/mcp-tokens.test.js`, `packages/plugins/lcyt-agent/test/ai-providers-routes.test.js` — org-baseline/no-membership 403 on write, explicit `member` (not owner/admin) still 403, explicit owner/admin succeeds, GET unaffected.

**Deliberately not touched by the interim fix** — these still rely purely on the broad `getEffectiveProjectAccessLevel()` gate today, with no additional role check, and need the same treatment once this plan's model is built:

- `lcyt-dsk`'s `dskRouter`/`dskTemplatesRouter`/`dskViewportsRouter` (all three share one `scopedAuth('dsk')` instance — Setup Hub's "viewports" card, DSK template CRUD)
- `lcyt-connectors`' `createConnectorsRouter` (API Connector CRUD — can hold `auth_config` credentials, same risk class as `ai/providers`)
- `lcyt-production`'s camera/mixer/encoder/bridge CRUD (Setup Hub's cameras/mixers/encoders/bridges cards) — **and** the live switch/preset-trigger routes on the same routers, which are Production-tier, not Setup-tier; these two concerns are currently the same Express router and will need to be split or method-scoped once the Production/operator question above is resolved
- `lcyt-rtmp`'s egress/ingestion/radio config routes (Setup Hub's egress/ingestion/radio cards) — same router-mixing concern as production (`/stream`, `/rtmp` slot management is arguably Setup-tier config, but toggling ingest on/off during a live show reads as Production-tier)
- `routes/targets.js`, `routes/translation.js`, `routes/stt.js`'s config routes, `icons`, `stt/source-languages`, `lcyt-files`' storage config — lower risk (no credential-minting), not urgent, but still in scope for "configuring anything in Setup = admin" once this ships
- `roles/:roleCode/config` (the `ai-roles` Setup Hub card, `plan_ai_model_registry.md` Phase 3's UI) — picks a provider/model per role, not itself credential-bearing, but still a Setup-page action

## Decided (resolved 2026-07-26, follow-up conversation)

All five original open questions are now resolved. Nothing below is speculative — this is the model to build.

1. **Vocabulary: kept separate, not unified.** Org roles (`owner`/`admin`/`member`) and project roles (`owner`/`admin`/`editor`/`operator`/`viewer`) are two distinct vocabularies scoped to two distinct things; the name overlap on `owner`/`admin` is fine and intentional (same conceptual tier, different scope). `project_members.access_level` gains `editor`, `operator`, `viewer` as new values. **Migration:** every existing explicit `'member'` row becomes `'editor'`.
2. **Production/operator role: yes, build it.** A fifth project role, `operator` — full production-view / live-command rights (camera/mixer switching, PTZ preset recall). Distinct from `editor` (Assets-tier) and `admin` (Setup-tier config of the same cameras/mixers).
3. **Page→route mapping**, confirmed:
   - **Setup** (Setup Hub and everything it configures) — explicit `project_members` `owner`/`admin` only (see point 5 below for the org-admin exception). No org-baseline ceiling ever satisfies this, full stop.
   - **Assets** (`/assets` — uploads, cue rules, produced files/videos/caption files) — `editor`+ to write; `viewer`+ to read.
   - **Production** (live-operate) — `operator`+.
   - **Read-only baseline** (`viewer`) — sees Assets and produced files (videos, caption files), does **not** see Setup Hub settings at all.
4. **UI home: `ProjectSettingsPage.jsx`, not Setup Hub — and no new page needed.** `ProjectSettingsPage` already exists, already sits as the top sidebar item for an active project (reachable at `/` and `/projects/:key`), and already has Summary/Features/**Team**/Device roles/Danger zone tabs with a working per-project `TeamTab` (member list/invite/remove). Extend it:
   - **Summary tab** gains the visibility toggle (`private` / `team`) and, when `team`, the org-baseline ceiling picker (`viewer`/`editor`, default `viewer`) — the level ordinary org members get automatically on opening the project, unless individually invited to something higher.
   - **Team tab** gains the 5-role picker for explicit per-project invites.
   - Setup Hub gets no team/access card — confirmed consistent with its own docblock, which already disclaims holding membership UI.
   - The separate, already-existing `/team` page (`TeamPage.jsx`) stays exactly as-is: org-wide invite/ownership/role management across all of an org's projects. It is not touched by this plan beyond consuming the new project-role vocabulary in whatever cross-project view it already has.
5. **Org-admin override (new rule, not in the original five questions but decided alongside them):** an org `owner`/`admin` always resolves to project `admin` on any **team-visible** project, unconditionally — this is on top of the ceiling, not gated by it. The `viewer`/`editor` ceiling only caps ordinary org `member`s; it was never meant to cap the org's own admins/owners.
6. **`PATCH /keys/:key/org` (move-into-org): unchanged, and deliberately decoupled from visibility.** Moving a project into an org is pure membership bookkeeping and does not touch the project's visibility or ceiling at all — a project moved into an org keeps whatever visibility it already had (stays `private` by default, since `private` is the existing default). Making a project team-visible is a separate, explicit action on the Summary tab (point 4 above), and that action is what requires setting the ceiling — defaulting to `viewer` if the actor doesn't change it.

## Suggested next step

Ready for a `/phase-planning` pass now that all decisions above are final — this is still materially bigger than a single-session lane (schema change in `lcyt-backend` + every plugin's Setup-shaped routes + `ProjectSettingsPage.jsx` UI work + the org-admin-override resolver change + migration of existing `project_members` rows), so it should be broken into phases/lanes before implementation starts, not built as one shot.
