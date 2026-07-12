# Plan — Viewer Icon Toggle + Icons Setup-Hub Card

**Status:** pending
**Scope:** `lcyt-backend` (caption_targets schema/db/routes), `lcyt-web` (TargetRow, Setup Hub, i18n)

## Motivation

Icons brand the public viewer page (`/view/:key`). Today an operator picks
*which* icon in **CC → Targets → Viewer** (`TargetRow.jsx`): a dropdown with a
"None" option, whose `iconId` is baked into the generated viewer URL as
`?icon=<id>` and rendered by `ViewerPage.jsx`.

Two problems:

1. **No explicit enable/disable.** "None" implicitly means off, but toggling
   branding off loses the chosen icon — you must re-pick it to turn it back on.
   The operator wants a clear "show icon" toggle *plus* the which-icon picker.

2. **`iconId` doesn't persist server-side.** The config is edited in two places
   that share `TargetRow` but persist differently:
   - **CCModal / TargetsPanel** → `targetConfig.js` (localStorage, whole-array
     `JSON.stringify`) — `iconId` survives (no field whitelist).
   - **CaptionTargetsManager + Setup-hub "Caption targets" card** → server
     `/targets` (`caption_targets` table) — **`iconId` is silently dropped**;
     the table has no icon column and `createTarget`/`updateTarget` ignore it.

   So the icon selection only sticks in the localStorage editor and evaporates
   in the server-backed one. A reliable toggle requires fixing the server path.

Separately, icon management currently only lives in `SettingsModal`'s "Icons"
tab; there is no Setup-Hub card for it. We want an **Icons** hub card.

## Decisions (settled with the user)

- **Operator config only.** No viewer-page end-user control, no public
  icon-list endpoint. The toggle lives in the operator's Targets → Viewer editor.
- Add the Setup-Hub **Icons** card as part of this work.

## A. Backend — persist icon config on `caption_targets`

1. `src/db/schema.js`: additive migration adding to `caption_targets`:
   - `icon_id INTEGER` (nullable)
   - `icon_enabled INTEGER NOT NULL DEFAULT 0`
   Existing rows are unaffected (nullable / defaulted).
2. `src/db/caption-targets.js`:
   - `formatRow()` exposes `iconId` / `iconEnabled`.
   - `createTarget` / `updateTarget` accept and write both (meaningful only for
     `type='viewer'`, mirroring how `viewerKey` is gated).
3. `src/routes/targets.js`: pass the two fields through the request body.
4. Test: round-trip `iconId` / `iconEnabled` through create → get → update in
   `test/targets.test.js`.

## B. Frontend — operator toggle in `TargetRow` (viewer section)

1. Add a **"Show icon on viewer page"** toggle bound to `entry.iconEnabled`,
   above the existing which-icon dropdown.
2. Gate the dropdown on the toggle (disabled/dimmed when off) and **preserve
   `iconId`** when toggled off, so re-enabling keeps the choice.
3. Viewer-URL builder: append `&icon=` only when `iconEnabled && iconId`
   (currently keys off `iconId` alone).
4. i18n: `settings.targets.viewerIconEnabled` label + hint in `en` / `fi` / `sv`.
5. Both editors then round-trip the fields (localStorage already generic;
   server covered by A).

## C. Setup Hub — new "Icons" card

1. `setup-hub/icons.jsx`: add an `IconsIcon` (stroke, 16×16, matching the set).
2. New `setup-hub/IconsSection.jsx`, modeled on `StorageSection`: a `SetupCard`
   + `Dialog` that lists icons (`session.listIcons()` → `GET /icons`), uploads
   (`POST /icons`, PNG/SVG ≤ 200 KB), and deletes (`DELETE /icons/:id`) —
   reusing the logic already in `SettingsModal`'s icons tab. Summary row shows
   the icon count.
3. `SetupHubPage.jsx`: import + render `{isVisible('icons') && <IconsSection />}`
   in the appropriate category group. Icons aren't feature-gated, so the card is
   always visible; left out of `cardIdsForEnabledFeatures` ("Workflow") unless a
   feature tie is requested. `/setup/icons` deep-linking works from the card id.
4. Update `packages/lcyt-web/CLAUDE.md` (setup-hub section list + note).

## Out of scope

- Viewer-page end-user icon control and any public icon-list endpoint (per the
  "operator config only" decision).

## Test / verification

- Backend: `caption-targets` icon-field round-trip; `/targets` route passthrough.
- Frontend: `TargetRow` toggle behavior — viewer URL includes `&icon=` only when
  enabled *and* an icon is selected; toggling off preserves `iconId`.
