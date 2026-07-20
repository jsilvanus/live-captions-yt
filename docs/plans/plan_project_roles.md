---
id: plan/project_roles
title: "Project Roles & Visibility — Setup/Assets/Production Access Tiers"
status: draft
summary: "Follow-up to plan_team_org_backend.md: replaces the flat org-baseline 'member' access level with a real per-project role model (owner/admin/editor/viewer, unifying explicit project_members and org-baseline access into one vocabulary), a per-project visibility setting (private vs. team-visible), and a page-scoped write gate (Setup Hub = admin-only, Assets = editor+, Production = open question). Captures a design discussion from 2026-07-20's PR #289 code-review, where an interim fix (explicit-owner/admin-only gating on /mcp-tokens and /ai/providers) shipped ahead of this full model. Nothing beyond that interim fix is built yet."
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
2. **A configurable ceiling on the team-visible baseline**: today the baseline is hardcoded to `'member'`. The target model makes it a per-project choice between `'viewer'` (read-only) and `'editor'` (can write in Assets) — **never `'admin'`**, regardless of the project's setting. This needs a new column (e.g. `api_keys.org_baseline_role TEXT DEFAULT 'viewer'`, constrained to `viewer`/`editor`).
3. **A unified role vocabulary.** Explicit `project_members.access_level` (today: `owner`/`admin`/`member`) should gain the same `editor`/`viewer` tiers used by the org-baseline ceiling above, so there is one role vocabulary used throughout — not two overlapping ones (see "Open questions" below for what happens to the existing `'member'` value).
4. **Page-scoped write gates**, per the project owner's own framing:
   - **Setup** (the Setup Hub page and everything it configures — DSK templates/viewports, MCP tokens, AI providers, connectors, radio/ingestion/egress config, caption targets, STT config, storage config, camera/mixer/encoder/bridge CRUD, device roles, etc.) — write requires **explicit** `project_members` `owner`/`admin`. Org-baseline access (even at `editor` ceiling) must never be enough — this is the one hard rule stated twice ("no admin [via org baseline]", "explicit access to Setup is necessary").
   - **Assets** (the `/assets` page — image/graphics uploads, cue rules) — write requires `editor` or above, explicit or org-baseline-granted.
   - **Production** (live-operate: camera/mixer switching, PTZ preset recall, i.e. the day-to-day "run the show" actions, as distinct from *configuring* cameras/mixers, which is Setup) — **explicitly still undecided**. The project owner is weighing whether a fifth `operator` role is needed here, separate from `editor`. Do not build Production's gate as part of this plan without a follow-up decision.
   - **Read** (`viewer` and above) — no write rights anywhere, but can see everything the project's visibility/membership already grants read access to.

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

## Open questions (unresolved as of 2026-07-20)

1. **Does `project_members.access_level` literally gain `editor`/`viewer` as new column values**, with `'member'` retired/migrated, or does `'member'` stay as-is and `editor`/`viewer` only exist as the org-baseline ceiling's own vocabulary (not assignable via explicit invite)? The project owner's answer to this exact question was "unify" — so the former — but the migration shape (rename `'member'` rows to `'editor'`? Add a separate `'viewer'` tier below it? Does every existing `'member'` become `'editor'` or `'viewer'`?) isn't decided.
2. **The Production/operator role.** Explicitly still being weighed by the project owner. Needs its own follow-up conversation before `lcyt-production`/`lcyt-rtmp`'s live-operate routes get touched.
3. **Exact page→route mapping for "Setup" vs "Assets".** The list above is a first-pass mapping from the Setup Hub/Assets page card lists as they exist today (`packages/lcyt-web/src/components/setup-hub/SetupHubPage.jsx`, `packages/lcyt-web/src/components/AssetsPage.jsx`) — needs a careful per-card pass, not an assumption, before building the gate for each one (the same mistake pattern already caught twice in this session's resolver sweep: don't trust a first grep, verify against actual route bodies).
4. **Does the org-baseline ceiling column (`viewer`/`editor` per project) also need an admin-facing UI** (a Setup Hub "Team visibility" card) to set it, or does it start DB/admin-CLI-only like `restricted` did?
5. **What happens to `PATCH /keys/:key/org`'s existing org-membership-based move logic** (`routes/keys.js`, already implemented — requires destination-org membership) once org roles compose with the new ceiling — does moving a project into an org also require setting its initial visibility/ceiling, or does it default to `private`/`viewer` until explicitly opened up?

## Suggested next step

A `/phase-planning` pass once questions 1–2 above have real answers — this is materially bigger than a single-session lane (touches `lcyt-backend`'s schema + every plugin's Setup-shaped routes + a new Setup Hub "team visibility" UI), and per `plan_team_org_backend.md`'s own precedent, should not be started speculatively ahead of those two decisions.
