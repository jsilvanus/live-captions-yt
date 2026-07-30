---
status: reference
summary: "Phase plan for implementing plan_project_roles.md's 2026-07-26 'Decided' design (5-role project vocabulary, org-baseline ceiling + org-admin override, page-scoped Setup/Assets/Production gates, ProjectSettingsPage.jsx UI). Produced via /phase-planning, grounded against actual current code (db/project-members.js, middleware/project-access.js, schema.js, and every route file the interim fix left untouched)."
---

# Phase Plan: Project Roles & Visibility (plan_project_roles.md)

## Overview

Five phases. The critical path runs through the backend foundation (schema →
resolver + shared gate middleware) before either of the two big parallel
efforts — per-plugin route gating and the `ProjectSettingsPage.jsx` UI — can
start, since both consume the same resolver/API contract. Once that
foundation lands, route-gating (5 streams, grouped by package per this repo's
own collision-avoidance convention) and the frontend work are genuinely
independent of each other and can run at the same time. Biggest risk is
`lcyt-production`'s route-gating stream: its four route files interleave
Setup-tier CRUD and Production-tier live-control verbs on the *same* router,
so gating is per-route, not per-router — materially more complex than the
other four streams.

**Grounded against current code** (2026-07-26 read, not assumption):
- `project_members.access_level` is `'owner' | 'admin' | 'member'` today;
  `PROJECT_ROLE_ORDER = { member: 1, admin: 2, owner: 3 }`
  (`packages/lcyt-backend/src/db/project-members.js` ~line 232).
- `getEffectiveProjectAccessLevel()` lives in that same file (line 234), not
  in `middleware/project-access.js` — the middleware just imports and calls
  it (line ~157). It checks explicit `getMemberAccessLevel()` first
  (owner/admin short-circuits), else falls back to org baseline (today
  hardcoded `'member'`) via `getOrgMembership()`, gated by `project.restricted`.
- `api_keys.restricted` (schema.js line 158, guarded `ALTER TABLE` idiom) is
  **already** the private/team-visible toggle the plan calls for — no new
  visibility column needed, just a UI surface for the existing column and a
  new ceiling column alongside it.
- `ProjectSettingsPage.jsx` (`packages/lcyt-web/src/components/`, 599 lines,
  all tabs inline): `SummaryTab` (line 142), `TeamTab` (line 276).

---

## Phase 0: Schema, data migration, and role-order foundation

**Mode:** Sequential
**Depends on:** none
**Goal:** New column exists, existing `'member'` rows are `'editor'`, and the
5-role order is defined in code — nothing downstream can start without this.

1. `packages/lcyt-backend/src/db/schema.js`: add
   `api_keys.org_baseline_role TEXT NOT NULL DEFAULT 'viewer'` via the same
   guarded `existingCols.has(...)` → `ALTER TABLE` idiom already used for
   `restricted`/`relay_allowed` (line ~158-161). App-level constrain to
   `'viewer'`/`'editor'` (SQLite has no enum type; enforce in code, not DB).
2. One-time data migration: `UPDATE project_members SET access_level =
   'editor' WHERE access_level = 'member'` — run as part of the same
   migration pass schema.js already does at startup, guarded so it only runs
   once (e.g. check for any remaining `'member'` rows before running, or a
   migration-version marker if this repo has one).
3. Update `PROJECT_ROLE_ORDER` in `db/project-members.js` to the full 5-tier
   order: `{ viewer: 1, editor: 2, operator: 3, admin: 4, owner: 5 }`.
   **Implementation decision, not explicitly specified in the source
   conversation:** operator ranks above editor (higher operational trust —
   live command access) and below admin. Flag this ordering choice back to
   the user/reviewer during Phase 0 review since it wasn't a stated ladder.
4. Update `ROLE_BUNDLES` (or equivalent) wherever `db/project-members.js`
   enumerates valid `access_level` values so `editor`/`operator`/`viewer`
   are accepted, not just tolerated.
5. Verify (don't assume) the exact route that currently accepts a role value
   on invite/role-change — grep `project_members` write sites in
   `packages/lcyt-backend/src/routes/` before touching it. Not confirmed
   during grounding; this repo has twice already caught "trusted a first
   grep" mistakes on this exact resolver, so re-verify here too.

**Sync point:** `npm test -w packages/lcyt-backend` passes with new fixtures
covering explicit `editor`/`operator`/`viewer` values; migration script
tested against a DB copy with pre-existing `'member'` rows and confirmed
idempotent (running it twice doesn't error or double-migrate).

---

## Phase 1: Resolver change + shared gate middleware + role-assignment API

**Mode:** Sequential
**Depends on:** Phase 0
**Goal:** `getEffectiveProjectAccessLevel()` implements the org-admin
override and configurable ceiling; a reusable, tier-aware gate middleware
exists for Phase 2 to apply; the API surface for setting
`org_baseline_role` and assigning the 5 project roles is real and tested.

1. `db/project-members.js`'s `getEffectiveProjectAccessLevel()`: before the
   existing org-baseline fallback, add the **org-admin override** — if
   `getOrgMembership()` returns `'owner'`/`'admin'` (org-level) and
   `!project.restricted` (team-visible), return `'admin'` (project-level)
   unconditionally, skipping the ceiling entirely. Otherwise, replace the
   hardcoded `'member'` baseline with `project.org_baseline_role` (default
   `'viewer'`), and return `max(explicit, baseline)` under the new
   `PROJECT_ROLE_ORDER`.
2. Generalize the 2026-07-20 interim fix's `requireExplicitAdmin(db)`
   pattern (`packages/lcyt-backend/src/routes/mcp-tokens.js`, and the
   `deps.isExplicitProjectAdmin` injection shape used in
   `lcyt-agent/src/routes/ai-providers-project.js`) into a single reusable
   `requireProjectRole(tier)` helper with three tiers:
   - `'setup'` — explicit `owner`/`admin` only, **or** the org-admin
     override from step 1. Ceiling never satisfies this, full stop (the
     plan's one hard rule).
   - `'assets'` — `editor`+ , ceiling-eligible.
   - `'production'` — `operator`+ (ceiling never grants `operator` per the
     plan, so this only ever resolves via explicit assignment or the
     org-admin override, but write it generically off
     `PROJECT_ROLE_ORDER`, not as a special case).
   Keep the same fail-closed behavior as the interim fix (no
   resolvable check ⇒ 403). Export it somewhere every plugin can reach —
   the `lcyt-agent` precedent (dependency-injected `deps.isExplicitProjectAdmin`
   built in `server.js`) is the template for plugins that can't reach
   `lcyt-backend`'s DB directly; extend that same `deps` injection to cover
   all three tiers, not just the one interim-fix boolean.
3. Extend the member invite/role-update route(s) found in Phase 0 step 5 to
   accept the 5-role vocabulary end to end.
4. Add read/write for `api_keys.org_baseline_role` — likely a new field on
   whatever route already returns/updates project settings (check
   `routes/keys.js` first). Gate the *write* at `'setup'` tier once step 2
   exists.

**Sync point:** unit tests for `getEffectiveProjectAccessLevel()` covering
all four cases (explicit only, org-baseline-member under both ceiling
values, org-admin override on both restricted and unrestricted projects,
explicit beats lower baseline and vice versa); `requireProjectRole()` has
its own middleware-level tests mirroring the existing
`mcp-tokens.test.js`/`ai-providers-routes.test.js` shape (403 on
under-tier, 200 on at/above-tier, GET unaffected).

---

## Phase 2: Apply page-scoped gates across every Setup-shaped route

**Status: done, 2026-07-26** (all 5 streams — A, C first; B, D, E in a
second pass after a subagent doing B/D/E hit a session limit mid-Stream-E
verification with everything uncommitted but passing; the orchestrating
session reviewed the uncommitted diff, fixed one real bug it found (see
below), finished Stream D itself, and committed all of Phase 2 together).
See each stream's own note below for what actually shipped vs. what got
deliberately left ungated and logged to `CONSIDER.md` instead.

**Real bug found and fixed during review, not by the original streams:**
Stream B's first pass gated DSK template/viewport writes on `req.user.userId`
unconditionally — but `DskEditorPage.jsx` (the real production DSK editor UI)
authenticates via `X-API-Key`, which never populates `req.user` at all. As
written, this would have 403'd DSK template/viewport editing for every user,
including real owners. Stopgapped by having `editorAuth`
(`lcyt-dsk/src/middleware/editor-auth.js`) mark the request
(`req.session.authKind = 'apikey'`) and having `requireSetup` in both
`dsk-templates.js`/`dsk-viewports.js` exempt that specific path, while a
plain session JWT lacking `req.user` (a different case) still 403s normally.
**This is a stopgap, not a design decision** — `plan_authentication_refactor.md`
already intended to retire DSK's `X-API-Key` credential entirely in favor of
project-membership JWTs, and that migration was simply never finished on the
frontend (user-flagged 2026-07-26). See `CONSIDER.md`'s corrected entry for
the real fix (migrate `DskEditorPage.jsx` onto project tokens, then delete
this exemption).

**Mode:** Parallel (5 streams)
**Depends on:** Phase 1
**Goal:** Every route the 2026-07-20 interim fix deliberately left
untouched now uses `requireProjectRole()` at the correct tier.

**Stream A — `lcyt-backend` + `lcyt-files` misc config — done, with two
items deliberately skipped.**
- Done: `targets.js`, `translation.js`, `stt.js` (`PUT /config`,
  `POST`/`PUT`/`DELETE /source-languages` only — `/start`/`/stop`/`/status`/
  `/events`/`/config/source-language` stay ungated, Production-tier operate
  actions), `lcyt-agent`'s `roles/:roleCode/config` PUT.
- **Skipped, logged to `CONSIDER.md`:** `icons.js` and `lcyt-files`'
  `/file/storage-config` — both mounted with the plain session-only
  `createAuthMiddleware`, which never populates `req.user`, so
  `requireProjectRole()` can never resolve a role there without a broader
  auth-model migration.

**Stream B — `lcyt-dsk` — done, with live-graphics-operate routes
deliberately left ungated (logged to `CONSIDER.md`).**
- Done: `dsk-templates.js`/`dsk-viewports.js` template + viewport CRUD +
  thumbnail CRUD, gated at `'setup'`, with the X-API-Key exemption above.
  `dsk-rtmp.js` untouched (nginx-rtmp callbacks only, nothing to gate).
- **Left ungated:** `activate`, one-off `template` render, `broadcast`,
  `graphics` push, `renderer/start`/`renderer/stop` — live graphics-operate
  actions on the same router; the `/graphics` page's own access tier was
  never decided by `plan_project_roles.md` at all (only Setup/Assets/
  Production are named).

**Stream C — `lcyt-connectors` — done.**
- `connectors.js` gated at `'setup'` tier via the mount-site double-auth
  pattern in `server.js` (plugin boundary, no router-internal changes
  needed since GET auto-exempts).

**Stream D — `lcyt-rtmp` — assessed, left entirely ungated (logged to
`CONSIDER.md`), same root cause as Stream A's `icons.js`/`lcyt-files` skip.**
- `ingestion.js`/`radio.js`/`stream.js`'s config routes were in scope, but
  the whole router group (`/ingestion`, `/stream`, `/radio`, `/preview`,
  `/crop`, `/rtmp`, `/feed-rtmp`, `/stream-hls`) is mounted in `server.js`
  with the plain session-only `auth` (`createAuthMiddleware`), not
  `scopedAuth()` — identical blocker to Stream A's two skips, just
  discovered here instead. Migrating that router group's auth model is a
  bigger, separate change (several of those routes are public/kiosk/nginx-
  callback and must keep working unauthenticated) — out of scope for this
  pass. The live-ingest-toggle-vs-config ambiguity the original plan
  flagged turned out to be moot — nothing in this router group got gated
  either way.

**Stream E — `lcyt-production` — done**, including a real pre-existing gap
found and fixed along the way (not part of the original scope, logged for
the record): `encoders.js`/`bridge.js` had **no** session/user/device auth
wired in at all before this pass (unlike `cameras.js`/`mixers.js`, which
already had it from earlier plans) — `createProductionRouter` now threads
`opts.auth`/`opts.deps` through all four sub-routers uniformly.
- `cameras.js`, `mixers.js`, `encoders.js`, `bridge.js` — per-route split:
  CRUD/config → `'setup'`; live verbs (`/preset/:presetId`,
  `/switch/:inputNumber`, `/:id/start|stop|test`, `/instances/:id/command`)
  → `'production'`. WHIP/thumbnail/bridge-agent-channel kiosk routes stay
  unauthenticated as before (`route-access.js`'s gate fails *open* when
  `req.session?.apiKey` is absent — i.e. when `opts.auth` never ran at all
  for one of those carve-out routes — and fails *closed* once a real
  session exists but lacks the tier).
- **Left ungated, logged:** `cameras.js`'s `POST /:id/thumbnail/capture`
  and `perception/start`/`perception/stop` (genuinely ambiguous tier);
  `bridge.js`'s `GET /instances/:id/env` (a credential-disclosing read,
  exempt from write-gating by the blanket read/write policy, but arguably
  deserves its own exception — flagged, not fixed here).

**Sync point:** every touched package's own test suite passes
(`npm test -w packages/<name>` per stream) and a full `npm test` from repo
root is green with no cross-stream regressions.

---

## Phase 3: `ProjectSettingsPage.jsx` UI

**Mode:** Sequential (single 599-line file — low value in splitting across
agents, real risk of merge conflict if split)
**Depends on:** Phase 1 (needs the resolver + role-assignment API contract
stable; does **not** need Phase 2's route gates to be done first — the UI
consumes the roles/ceiling API, not the individual Setup routes it will
later gate). **Runs in parallel with Phase 2.**
**Goal:** Project owners/admins can set visibility + ceiling and assign the
5 project roles without touching Setup Hub.

1. `SummaryTab` (line 142): add a visibility toggle wired to the *existing*
   `api_keys.restricted` column (private ↔ team) — reframe/relabel, don't
   duplicate it with a new column. When set to team-visible, reveal the
   ceiling picker (`viewer`/`editor`, default `viewer`) wired to the new
   `org_baseline_role` field from Phase 1.
2. `TeamTab` (line 276): extend whatever role-select UI `MemberRow`/
   `InviteMemberForm` currently render to the 5-role vocabulary
   (owner/admin/editor/operator/viewer), replacing the old
   owner/admin/member set.
3. No Setup Hub changes — confirmed out of scope per the plan's decision.

**Sync point:** manual verification in the running dev server (per this
repo's UI-change convention — start the dev server, exercise the golden
path): toggle visibility, set ceiling, assign each of the 5 roles to a
test member, confirm `SummaryTab`'s `myAccessLevel` reflects an org-admin
override correctly on a team-visible project.

---

## Phase 4: Verification, docs, and cleanup

**Mode:** Sequential
**Depends on:** Phase 2 (all 5 streams) and Phase 3
**Goal:** Green test suite repo-wide, decisions/ambiguities logged, plan
docs reflect reality.

1. Full `npm test` from repo root.
2. Log Stream D's live-toggle ambiguity (and any other judgment calls made
   during Phase 2) to `CONSIDER.md`, per this repo's convention for
   skipped/deferred review findings.
3. Update `docs/plans/plan_project_roles.md`'s frontmatter `status` from
   `draft` to `implemented` (with a `**Not done:**` note for anything
   genuinely deferred, e.g. Production's operator-role UI polish if it
   turns out thin), and update `docs/PLANS.md`'s summary row + status
   section to match.

---

## Critical Path

Phase 0 → Phase 1 → Phase 2 Stream E (`lcyt-production`, the long pole) →
Phase 4.

Phase 3 is off the critical path (parallel with Phase 2) unless it slips
past Phase 2 Stream E's completion.

## Risk Register

- **SQLite enforces no enum/CHECK on `access_level`** — role values are only
  as valid as every call site's own validation. Mitigation: grep every
  `PROJECT_ROLE_ORDER`/role-bundle reference before *and* after Phase 0/1,
  don't trust a single search pass (this exact mistake pattern was already
  caught twice in this codebase's history on this same resolver).
- **Phase 2 Stream E (`lcyt-production`) is materially riskier than the
  other four streams** — per-route splitting inside shared router files,
  not a mechanical whole-file gate. Budget it more review time; don't let
  it silently become the Phase 4 blocker.
- **The `'member'` → `'editor'` migration is a one-way permission change**
  for every existing explicit project member — verify against a copy of
  real data shape before running for real, not just a fresh test DB.
- **Two ambiguous verb classes** (lcyt-rtmp's live ingest toggle;
  `lcyt-backend/routes/stt.js`'s `/start`/`/stop` vs. `/config`) don't have
  a stated answer from the source conversation. Default to `'setup'` for
  config-shaped verbs, log the live-operate question rather than guessing
  silently.
- **Phase 0 step 5 and Phase 1 step 3/4's exact route files were not
  confirmed during grounding** (member role-assignment endpoint,
  project-settings PATCH route) — first action in Phase 0 must be to find
  and confirm these, not assume a filename.

## Recommended Starting Point

Phase 0, step 1 — the schema column and data migration gate every other
phase, and are small/isolated enough to land in one sitting before Phase 1's
resolver logic depends on them existing.
