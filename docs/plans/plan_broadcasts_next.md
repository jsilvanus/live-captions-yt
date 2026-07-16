---
id: plan/broadcasts_next
title: "Broadcasts — "
status: draft
summary: "Next step after broadcasts entity: Activatable broadcast + unified Planner file-management panel + DSK graphics browser, header context, production status controls"
related: plan/broadcasts
---

# Activatable broadcast + unified Planner file-management panel

## Context

The project already has a mature `broadcasts` entity (schema, CRUD routes, an assets-linking table `broadcast_assets`, and a files-linking table `broadcast_files`) plus a `BroadcastsManager.jsx` scheduler page and a read-only "Broadcasts" card on the Assets page. What's missing is the concept the user asked for: a per-project **pointer** to "the broadcast I'm currently curating assets/files for" — independent of the broadcast's on-air lifecycle status (draft/scheduled/live/completed/archived) — surfaced through the project JWT so any part of the app can know the current context without extra round-trips, and a **list of broadcasts on the project summary page** where that pointer can be toggled.

Once that pointer exists, the Planner's file management gets rebuilt around it: a **hard scope** (all of the project's rundown files) and a **soft scope** (the subset pinned to the currently active broadcast, via the already-existing `broadcast_files` link table). The user confirmed this file-management panel should be unified — one shared component used on both the desktop left column and the mobile "Files" swipeable page (built last session) — rather than two divergent implementations.

Two prior explore rounds + a Plan agent pass (with direct verification of every referenced file/function) produced the design below. All function/variable names quoted here were checked against the actual source, not assumed.

---

## Feature A — Activatable broadcast, embedded in the project JWT

### A1. Schema migration
`packages/lcyt-backend/src/db/schema.js` — reuse the `existingCols` set already computed for `api_keys` (~line 135, used for the `email`/`daily_limit`/etc. additive columns). Add:
```js
if (!existingCols.has('active_broadcast_id')) {
  db.exec('ALTER TABLE api_keys ADD COLUMN active_broadcast_id TEXT');
}
```
No index (only ever queried by `WHERE key = ?`), no FK (SQLite `ALTER TABLE ADD COLUMN` can't add one — same convention already used for `sessions.broadcast_id` etc.).

### A2. DB helpers
**`packages/lcyt-backend/src/db/keys.js`** — raw getter/setter, same shape as the existing `getRequiredSlugPrefix`/`setPublicSlug` pair:
```js
export function getActiveBroadcastId(db, key) {
  const row = db.prepare('SELECT active_broadcast_id FROM api_keys WHERE key = ?').get(key);
  return row?.active_broadcast_id ?? null;
}
export function setActiveBroadcastId(db, key, broadcastId) {
  return db.prepare('UPDATE api_keys SET active_broadcast_id = ? WHERE key = ?').run(broadcastId, key).changes > 0;
}
```
Add `activeBroadcastId: row.active_broadcast_id ?? null` to `formatKey()` (~line 8) — free bonus, since `GET /keys` already feeds `ProjectsPage`/`ProjectSettingsPage`'s `projects` list.

**`packages/lcyt-backend/src/db/broadcasts.js`** — import the two helpers above, add:
```js
export function getActiveBroadcast(db, apiKey) {
  const id = getActiveBroadcastId(db, apiKey);
  return id ? getBroadcast(db, apiKey, id) : null; // null if pointer is stale
}
export function activateBroadcast(db, apiKey, id) {
  const existing = getRow(db, apiKey, id);
  if (!existing) return { ok: false, error: 'Broadcast not found', status: 404 };
  if (existing.status === 'archived') return { ok: false, error: 'Cannot activate an archived broadcast', status: 409 };
  setActiveBroadcastId(db, apiKey, id);
  return { ok: true, broadcast: getBroadcast(db, apiKey, id) };
}
export function deactivateBroadcast(db, apiKey) {
  setActiveBroadcastId(db, apiKey, null);
  return { ok: true };
}
```
Also add a two-line guard at the end of `archiveBroadcast()` and the hard-delete transaction in `deleteBroadcast()`: `if (getActiveBroadcastId(db, apiKey) === id) setActiveBroadcastId(db, apiKey, null);` — so the pointer can't go stale when its target is archived/deleted.

### A3. Routes — `packages/lcyt-backend/src/routes/broadcasts.js`
Register **before** the existing `GET/DELETE /:id` routes (literal path vs. `:id` param collision — Express matches in registration order):
```js
router.get('/active', auth, (req, res) => {
  const broadcast = getActiveBroadcast(db, req.session.apiKey);
  res.json({ activeBroadcastId: broadcast?.id ?? null, broadcast });
});
router.delete('/active', auth, (req, res) => {
  deactivateBroadcast(db, req.session.apiKey);
  res.json({ ok: true, activeBroadcastId: null });
});
router.post('/:id/activate', auth, (req, res) => {
  const result = activateBroadcast(db, req.session.apiKey, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json({ ok: true, activeBroadcastId: result.broadcast.id, broadcast: result.broadcast });
});
```
Update the router's docstring route list at the top of the file.

### A4. `auth.js` + `project-access.js`
**`packages/lcyt-backend/src/routes/auth.js`**: extend `issueProjectToken()` to accept/embed `activeBroadcastId`; in `POST /auth/project-token`, look it up via `getActiveBroadcastId(db, trimmedId)` and both embed it in the signed token AND return it in the plain JSON response (`res.json({ token, projectId, projectRole, accessLevel, activeBroadcastId })`) — the client never decodes JWTs, so the plain field is what the UI actually reads.

**`packages/lcyt-backend/src/middleware/project-access.js`**: in the `payload.kind === 'project'` branch, pass `activeBroadcastId: payload.activeBroadcastId ?? null` into `authInfo`; in `attachProjectContext()`, set `req.session.activeBroadcastId` and `req.project.activeBroadcastId` from it. This is plumbing only — no route reads it yet, kept minimal for future backend-side filtering.

### A5. Client-side plumbing
- **`packages/lcyt-web/src/lib/projectSession.js`**: `activateProject()` already spreads `opts` into persisted config — add `...(opts.activeBroadcastId !== undefined ? { activeBroadcastId: opts.activeBroadcastId } : {})`.
- **`packages/lcyt-web/src/hooks/useUserAuth.js`**: `requestProjectAccessToken()` return value should explicitly include `activeBroadcastId: data.activeBroadcastId ?? null`.
- **`packages/lcyt-web/src/hooks/useSession.js`**: add `const [activeBroadcastId, setActiveBroadcastId] = useState(null)`; extend `connect()`'s destructured parameters to include `activeBroadcastId` and call `setActiveBroadcastId(activeBroadcastId ?? null)` alongside the existing `setProjectAccessToken` call. **No `App.jsx` edit needed** — verified `App.jsx:189` already calls `session.connect(cfg)` with the *entire* persisted config object, so extending `connect()`'s param list is sufficient for the auto-connect-on-boot path to pick it up from `cfg.activeBroadcastId`.
- New function **`refreshProjectToken(requestProjectAccessToken)`** on `useSession.js`, returned from the hook: re-calls the passed-in `requestProjectAccessToken(projectId)`, updates `projectAccessToken`/`activeBroadcastId` state, and re-persists via `savePersistedSessionConfig`. Takes the fetcher as a parameter (rather than importing `useUserAuth` internally) to avoid coupling two independent hooks. Callers: `const { requestProjectAccessToken } = useUserAuth(); const { refreshProjectToken } = useSessionContext(); await refreshProjectToken(requestProjectAccessToken);`

### A6. UI — Broadcasts list on the project summary
`packages/lcyt-web/src/components/ProjectSettingsPage.jsx`, `SummaryTab` (~line 141-204): add a `BroadcastsSection` component inserted after `<PublicSlugSection />` (line 190), before "Quick links". Fetches `GET /broadcasts` using the **user JWT** (`token` prop, from `useUserAuth()` at line 498 — confirmed this is what `SummaryTab` already receives) plus an `X-Project-Id: project.key` header — confirmed `resolveProjectId()` in `project-access.js` checks this header before body/query, so no project-scoped token needs to be minted just to view/toggle this section. This also correctly matches the page's job of managing *any* project the user belongs to, not just the connected one.

Reuse `SetupItemRow` (`./setup-hub/SetupCard.jsx`) for each row: `name={title}`, `meta="Scheduled <date>"`, `badge={status.toUpperCase()}`, `toggleOn={project.activeBroadcastId === b.id}`, `onToggle={...}` → `POST /broadcasts/:id/activate` or `DELETE /broadcasts/active` depending on current state. After a successful toggle, call an `onActivated` callback prop wired to the parent page's existing `load()` (~line 509-526, the `GET /keys` refetch) rather than tracking separate local state — this refreshes `project.activeBroadcastId` through the same data path the rest of the page already uses.

---

## Feature B — Unified Planner file-management panel

No new backend routes needed — `GET /broadcasts/active` (A3) plus the pre-existing `GET/POST/DELETE /broadcasts/:id/files[...]` and `/file` routes cover everything.

### B1. New component — `packages/lcyt-web/src/components/planner/PlannerFilesPanel.jsx`
Renders, top to bottom:
1. **Icon button row** acting on the currently-open file: New, Import, Export, Save, Delete (delete requires `window.confirm`).
2. **Broadcast files** (soft scope) — the active broadcast's pinned files (`broadcast_files` join, via `GET /broadcasts/:id/files`). Empty/prompt state when there's no active broadcast.
3. **Project files** (hard scope) — the full `serverRundowns` list (`GET /file?type=rundown`, already fetched today). Each row gets a pin-toggle button; pinned state = file id present in the active broadcast's linked-files set. Toggle disabled when there's no active broadcast.

Structure/heading outline is **not** owned by this component — `PlannerOutline` keeps it (see B6), since the user's explicit instruction to preserve "file top, structure bottom" ordering from the prior turn is satisfied by composing `PlannerFilesPanel` as a child rendered above `PlannerOutline`'s existing Structure list, not by moving Structure into the new component.

Build file rows as a small local element reusing the existing `setup-item-row*` CSS classes directly, rather than the `SetupItemRow` component — `SetupItemRow`'s built-in click-to-navigate behavior is disabled whenever `onToggle` is present, which conflicts with needing both a stateful "open into editor" row click *and* a separate pin button in the same row.

**Bug to avoid:** `formatBroadcastFile()` in `db/broadcasts.js` returns `{ id: <broadcast_files link-row id>, fileId: <caption_files.id>, ... }`. The pinned-id `Set` must be built from `.fileId`, not `.id` — `.id` is the join-table row id and won't match `serverRundowns[].id`.

### B2. Fetch active broadcast + pinned files — `PlannerPage.jsx`
Add `activeBroadcast`, `broadcastFiles`, `broadcastFilesLoading` state and a `loadActiveBroadcast()` loader (mirrors the existing `loadServerRundowns`, confirmed at line 748, using the same `sessionToken = session?.getSessionToken?.()` already used there — confirmed at line 713 — this is correct for `PlannerPage` since it operates on the currently-connected project). Fetch `GET /broadcasts/active`; if a broadcast comes back, follow with `GET /broadcasts/:id/files`. Derive `pinnedFileIds = useMemo(() => new Set(broadcastFiles.map(f => String(f.fileId))), [broadcastFiles])`.

### B3. `handleDeleteCurrentFile()` — `PlannerPage.jsx`
New handler: `window.confirm(...)` → `DELETE /file/:id` (the existing, currently-unused backend route, confirmed present at `packages/plugins/lcyt-files/src/routes/files.js`) using `selectedServerRundownId`; on success, remove from `serverRundowns`, clear `selectedServerRundownId`, `showToast` (confirmed pattern at line 707/858/876/etc.), and refresh `loadActiveBroadcast()` since the deleted file might have been pinned. Add `projectDeleting` state alongside the existing `projectSaving`/`projectLoading`. `canDelete = Boolean(backendUrl && sessionToken && selectedServerRundownId)`.

### B4. `handleTogglePin(fileId)` and `handleOpenFile(fileId)` — `PlannerPage.jsx`
`handleTogglePin`: `POST /broadcasts/:activeBroadcastId/files` (body `{fileId}`) to pin, `DELETE /broadcasts/:activeBroadcastId/files/:fileId` to unpin; refresh `loadActiveBroadcast()` after. Track `pinBusyFileId` for per-row disabling.

`handleOpenFile(fileId)`: parameterized version of the existing `handleOpenFromProject()` (confirmed at line 929, using `normalizeProjectFilename` at line 885) — since Feature B's rows call "open" directly per-row instead of via the old dropdown+button, replace `handleOpenFromProject` with this rather than keeping both.

### B5. Trim `PlannerToolbar` (lines 569-655)
Remove `serverRundowns`, `selectedServerRundownId`, `onSelectedServerRundownChange`, `onSaveToProject`, `onOpenFromProject`, `projectSaving`, `projectLoading`, `projectReady` props and the `<select>` + Open/Save button block (lines 617-639). Confirmed via grep: `projectReady` (line 578) is used *only* inside that removed block (lines 621/633/636) — safe to drop entirely, not needed elsewhere in the insert-block bar. Keep filename edit, normalize/dashboard buttons, insert-block bar unchanged.

### B6. Trim `PlannerOutline` (lines 514-565)
Remove `showActions` state and the `planner-outline__actions-wrap` block (lines 549-562) and the `onNew`/`onImport`/`onExport` props. Add a `children` prop rendered between the header and the Structure list, so callers compose:
```jsx
<PlannerOutline filename={filename} totalLines={totalLines} dirty={dirty} outline={outline} onJumpTo={jumpToHeading}>
  <PlannerFilesPanel isNarrow={...} ... />
</PlannerOutline>
```

### B7. Wire into `PlannerPage.jsx` render
**Desktop** (~lines 1196-1229): wrap the existing `<PlannerOutline>` call to pass `<PlannerFilesPanel isNarrow={false} .../>` as its child (props: file handlers from B3/B4, `activeBroadcast`, `broadcastFiles`, `broadcastFilesLoading`, `serverRundowns`, `pinnedFileIds`, `onOpenFile`, `onTogglePin`, `pinBusyFileId`, `selectedServerRundownId`). Strip the now-removed props from the `<PlannerToolbar>` call site.

**Mobile "Files" page** (~lines 1051-1079): replace the current stub button row + bare `<PlannerOutline>` with the same `<PlannerOutline><PlannerFilesPanel isNarrow /></PlannerOutline>` composition, `isNarrow={true}` driving collapsible sections (each of Broadcast files / Project files wrapped in a toggle-header, matching how the old `showActions` behavior worked). Strip the same removed props from the mobile `<PlannerToolbar>` call site.

### B8. Icons
16×16 stroke style matching `packages/lcyt-web/src/components/setup-hub/icons.jsx`:
- **Delete**: reuse `TrashIcon` directly (confirmed exists, line 206) — don't redraw it.
- **New/Import/Export/Save/Pin**: new small inline SVGs in `PlannerFilesPanel.jsx` (or co-located `planner/plannerFileIcons.jsx` if that keeps the component file more readable) — New (page + "+"), Import (tray, arrow in), Export (tray, arrow out — local disk semantics), Save (cloud + up-arrow — distinct metaphor from Export, since Save persists server-side), Pin (thumbtack, filled/outline toggle like `StarIcon`'s `filled` prop pattern, confirmed line 215).

---

## Feature C — DSK broadcast-scoped graphics browser

Mirror of Feature B for graphics: the DSK Control page gets a panel showing which templates are pinned to the active broadcast, with pin/unpin toggles.

- **No new tables/routes** — reuses `broadcast_assets` (`assetType: 'graphic'`, `assetRef: String(templateId)`) via the existing `POST /broadcasts/:id/assets` and `DELETE /broadcasts/:id/assets/:rowId`. Pinned state and asset row ids come from `GET /broadcasts/active` (its `broadcast.assets` array — `getBroadcast()` embeds them).
- **New component** `packages/lcyt-web/src/components/DskBroadcastAssetPanel.jsx`, rendered in `DskControlPage.jsx` above the template grid. Shows: active broadcast title (or empty state), each template row with pinned status + Pin/Unpin button.
- **Auth caveat:** `/broadcasts/*` requires a Bearer JWT (session/user/device) — raw `X-API-Key` is not enough. The panel therefore renders only when `session?.getSessionToken?.()` is available (sidebar mode `/graphics/control`); standalone `/dsk-control/:key` shows nothing extra.

## Feature D — Project + broadcast names in the header

- **Backend:** `GET /broadcasts/active` additionally returns `projectName` (`api_keys.owner` — the field the Projects UI already displays as the project name). New helper `getProjectName(db, key)` in `db/keys.js`.
- **Shared hook** `packages/lcyt-web/src/hooks/useActiveBroadcast.js`: fetches `/broadcasts/active` given `{ backendUrl, token, projectKey? }`, exposes `{ broadcast, activeBroadcastId, projectName, loading, reload }`, and re-fetches on a `lcyt:active-broadcast-changed` window event (exported `notifyActiveBroadcastChanged()` fired by every mutation site: Summary-tab toggle, production status control, DSK/planner pin panels don't need it — they don't change the pointer).
- **UI:** `TopBar` (`sidebar/Sidebar.jsx`) renders `projectName · broadcastTitle` (+ status badge) next to the brand when a session is connected. New `top-bar__context*` classes in `styles/sidebar.css`.

## Feature E — Broadcast status controls in the Production view

- `useProductionData.js`: load `GET /broadcasts/active` alongside the other auth-gated extras; expose `broadcast` and a `setBroadcastStatus(status)` action → `PUT /broadcasts/:id { status }`, then reload + `notifyActiveBroadcastChanged()`.
- `Chrome.jsx` `ProductionHeader`: broadcast chip (title) + a status `<select>` (draft / scheduled / live / completed; archived shown read-only if current — archiving stays in the Broadcasts manager). Status colors: live = red family, scheduled = blue, completed = grey.

## Fixes to the initial PR implementation

- `PlannerBroadcastFilePanel.jsx` builds `pinnedFileIds` from `file.id` — the `broadcast_files` join-row id — instead of `file.fileId` (the `caption_files` id), so pinned files never display as pinned (the §B1 bug this plan explicitly warned about). Fix to `file.fileId`.
- The Summary-tab activate/deactivate toggle should fire `notifyActiveBroadcastChanged()` so the header, planner panel, DSK panel, and production header refresh without a reload.

## Build order
1. A1 → A2 → A3 → A4 (backend; testable standalone via curl before touching the frontend).
2. A5 (client plumbing).
3. A6 (Summary tab UI — exercises A1-A5 end to end).
4. B2/B3/B4 (PlannerPage data + handlers — depends only on A3's `/broadcasts/active` plus pre-existing routes).
5. B1 (PlannerFilesPanel component).
6. B5/B6 (trim PlannerToolbar/PlannerOutline).
7. B7 (wire into PlannerPage's render, desktop + mobile).
8. B8 (icons — can run in parallel with B1 once the component shell exists).
9. Backend `projectName` on `GET /broadcasts/active` + `useActiveBroadcast` hook (D).
10. TopBar context label (D).
11. `useProductionData` broadcast state + `setBroadcastStatus`, `ProductionHeader` controls (E).
12. `DskBroadcastAssetPanel` + `DskControlPage` wiring (C).
13. PR fixes: planner `fileId` bug, `notifyActiveBroadcastChanged()` wiring.

## Verification
- Backend: after A1-A4, manually curl `POST /broadcasts/:id/activate`, `GET /broadcasts/active`, `DELETE /broadcasts/active`, and `POST /auth/project-token` to confirm `activeBroadcastId` round-trips through the JWT payload (decode with `jwt.io` or a throwaway script) and the plain JSON response.
- Run `npm test -w packages/lcyt-backend` (or repo-root `npm test`) to catch any regression in existing broadcasts/auth tests.
- Frontend: start the dev server (`npm run web`), log in, open a project's Summary page — confirm the new Broadcasts list renders with working activate/deactivate toggles reflected immediately (no reload).
- Open Planner (desktop): confirm the left column shows the new file panel above Structure, with New/Import/Export/Save/Delete icons, a Broadcast files section (empty state if nothing active), and a Project files list where pin toggles work and reflect in the Broadcast files section above after refresh.
- Resize to mobile width / open Planner on a phone-sized viewport: confirm the "Files" swipeable page shows the same panel with collapsible sections, and Structure still appears at the bottom, unchanged from last session's ordering.
- Delete a file via the confirm-gated Delete button; verify it disappears from Project files and, if it was pinned, also disappears from Broadcast files.

