# `packages/lcyt-web` — Web UI (v1.0.0, private)

Browser-based React app using Vite and **wouter** for routing. Uses sidebar navigation as the primary layout. Sends captions via the `lcyt-backend` relay.

**Build:** `npm run build:web` → `packages/lcyt-web/dist/`
**Dev:** `npm run web`

**Source (`src/`):**
- `main.jsx` — React entry point; wouter-based routing for sidebar pages and standalone pages
- `App.jsx` — legacy two-panel caption layout (mounted at `/legacy` and `/captions`)
- `components/` — React JSX components (see routing table below). Key subdirectories: `sidebar/` (Sidebar, TopBar, StatusPopover, QuickActionsPopover), `dashboard/` (DashboardCard, StatusWidget, SentLogWidget, etc.), `broadcast/` (EncoderTab, StreamTab, YouTubeTab), `dsk-editor/` (TemplatePreview, AnimationEditor, LayerPropertyEditor), `dsk-viewports/` (TextLayersEditor, ImageSettingsTable), `panels/` (TargetsPanel, TranslationPanel, RelayPanel, ServicePanel, DetailsPanel, CeaCaptionsPanel, EmbedPanel, SttPanel, VadPanel, ReviewSummary), `production/` (ConnectionDot + `workspace/` — the `/production` tileable operator console: `layout.js` pure view/column/row/pane engine + localStorage persistence, `useWorkspaceLayout.js` state/resize hook, `useProductionData.js` real-backend data+actions hook (also exports `jfetch`, the authenticated-fetch helper, for reuse by other production pages; also surfaces `variables` from the shared `VariablesContext` and `connectorRequests` — a flattened list built from one `GET /connectors` call (the backend embeds each connector's `requests` in that response — no per-connector follow-up fetch), refreshed alongside DSK templates/cue rules — plus an `actions.togglePoll(connectorSlug, requestSlug, enabled)` optimistic-update action), `Chrome.jsx` header/pills (includes the "Vertical Crop" link to `/production/crop`), `WorkspaceGrid.jsx`, and `panes/` for all 16 pane types — cameras/thumbnails/mixer/mixerbtns/monitors/program/youtube/ytpreview/ytmonitor/sent/rundown/chat/controls/lowerthirds/variables/connectorPolls — wired to `production/cameras`+`production/mixers`, DSK templates+broadcast, `/cues/rules`, STT, RTMP relay, sent-log, and the `/roles/assistant` prompt. `variables` is a per-instance-configurable key→value watchlist widget (add/remove variable names to watch, live values from `D.variables`) — the first pane type needing per-instance settings, which extended `layout.js`'s pane model from a bare type string to `{ type, settings }` (`paneType()`/`paneSettings()` normalizers + `changePaneSettings()`, additive — no storage-version bump, old saved layouts unaffected; plan_live_variables.md §2). `connectorPolls` is the live start/stop control for **constant poll** (a session-long, pointer-independent connector-refresh loop, `packages/plugins/lcyt-connectors/src/poll-scheduler.js`) — deliberately placed here rather than the Setup Hub Connectors card (which only shows a read-only "● polling" status) because starting/stopping a poll is a live operational decision, not connector config: "+ Add API call" opens a `Dialog` (`<select>` over `D.connectorRequests`, keyed/valued by each request's stable `requestId`) to watch one in this widget instance (`settings.calls`, an array of `requestId`s — the same per-instance-settings mechanism as `variables`, but keyed by stable id rather than a `connectorSlug.requestSlug` composite string so a saved layout survives a connector/request rename), and each watched call renders as a button that highlights solid green with a live-dot when polling and toggles via `D.actions.togglePoll` on click; both `variables` and `connectorPolls` share a `useWatchlist(settings, onSettingsChange, field)` hook (`panes/index.jsx`, returns `{watched, add, remove}`) for the add/remove-from-a-settings-array logic, and `connectorPolls` additionally uses `resolveWatchedEntry(known, key)` to look a watched key up by `requestId` first, falling back to the legacy `connectorSlug.requestSlug` composite-string match so layouts saved before this change keep resolving their watched entries; `ProductionCropPage.jsx` + `crop/` — the `/production/crop` Vertical Crop operator page (plan_vertical_crop.md Phase 3): `useCropEditor.js` (wraps `useProductionData` for creds/cameras/`jfetch`, adds `/crop/*` config+sets+presets+source-map state, camera-centric source list, throttled live-drag `POST /crop/position`), `CropPresetPanel.jsx` (left column — set tabs + preset library), `CropCanvas.jsx` (center — draggable WYSIWYG crop box over the incoming preview using `lib/cropGeometry.js`'s pure geometry helpers, plus an hls.js vertical monitor tile for the live `{key}-crop` output), `CropSourcePanel.jsx` (right column — camera/PTZ-preset source picker with bind/unbind); a three-column layout chosen over the plan's original sources×sets matrix-grid sketch — see the plan's Phase 3 note), `audio/` (AudioLevelMeter), `planner/` (`PlannerAssistPanel.jsx` — the Planner's right-column "📋 Cues"/"⚡ Actions" tabs (embedded `CuesManager`/`NamedActionsManager`) above the AI assistant chat; shared by `PlannerPage.jsx`'s desktop 3-column layout and its narrow/mobile "Cues & AI" swipeable page)
- `contexts/` — React context providers: AppProviders, AudioContext, CaptionContext, ConnectionContext, FileContext, LangContext, SentLogContext, SessionApiContext, SessionContext, ToastContext, VariablesContext. Notably: `ConnectionContext` (connection state, health, connect/disconnect), `CaptionContext` (send, sendBatch, sequence, syncOffset), `AudioContext` (audio/STT state and controls), `LangContext` (i18n language provider). `VariablesContext` (`useVariablesContext`) is the single app-wide `{{ }}` variable snapshot — one `useVariables()` instance provided in `AppProviders` (its Provider `value` is memoized on `variables.variables`, matching `connectionValue`/`captionValue`'s pattern, so unrelated `AppProviders` re-renders don't fan out to every consumer), consumed by `InputBar.jsx` (send-time resolution), `CaptionView.jsx` (live chip rendering — bus-pushed, no polling), and the Production workspace's `variables` pane; `FileContext.jsx` reads it optionally (`useContext`, not the hook) to expand `{{name[N]}}` blocks. `useVariablesContext()` never throws — outside a `VariablesContext.Provider` it returns a no-op fallback snapshot (`{variables:{}, snapshot:()=>({}), ...}`), so `InputBar` and any other consumer stay usable standalone (e.g. README.md's manual provider-wiring example) without crashing (plan_live_variables.md).
- `hooks/` — Custom React hooks: useActiveBroadcast, useBrowserFileSaving, useDashboardConfig, useEscapeKey, useEventStream, useFileStore, useProjectFeatures, useSentLog, useSession, useToast, useUserAuth, useVariables, useWebSpeech, useWindowEvent. Notably: `useSession` (`BackendCaptionSender` session lifecycle hook; `onConnected` payload includes `token`), `useDashboardConfig` (dashboard panel/layout CRUD, localStorage persistence), `useWebSpeech` (WebSpeech recognition state machine: start, stop, error recovery), `useProjectFeatures` (project feature flag hook), `useUserAuth` (user authentication hook), `useEventStream` (shared authenticated `/events/stream?flat=1` EventSource multiplexer), `useVariables` (`{{ }}` variable snapshot: `GET /variables` + shared `/events/stream` topic subscription + `POST /variables/refresh`, from `lcyt-connectors`). `useActiveBroadcast` (shared `GET /broadcasts/active` snapshot — broadcast + projectName; re-fetches on the `lcyt:active-broadcast-changed` window event via `notifyActiveBroadcastChanged()`, fired by every active-broadcast/status mutation site; plan/broadcasts_next).
- `lib/` — Utilities: activeCodes.js, api.js, cropGeometry.js, device.js, dskEditorAnimation.js, dskEditorGeometry.js, dskEditorPresets.js, fileUtils.js, formatting.js, googleCredential.js, i18n.js, inputLang.js, normalizeLines.js, plannerUtils.js, relayConfig.js, settings.js, settingsIO.js, storageKeys.js, sttConfig.js, targetConfig.js, translate.js, translationConfig.js, viewerUtils.js, youtubeApi.js, youtubeAuth.js. `cropGeometry.js` is a pure client-side mirror of `crop-manager.js`'s `computeCropGeometry()`/`normToPixels()` (plan_vertical_crop.md), used by `CropCanvas.jsx` to draw the draggable crop box in container-fraction space. Notably: `storageKeys.js` (normalized localStorage key registry, `lcyt.{category}.{key}` convention), `settingsIO.js` (settings export/import: `downloadSettings`, `importSettings`), `i18n.js` (i18n framework: locale loading, `useLang` hook).
- `lib/metacode-*` — Metacode helpers: metacode-parser.js, metacode-active.js, metacode-planner.js, metacode-runtime.js, metacode-variables.js, metacode-varblocks.js, metacode-registry.js, metacode-ttl.js (frontend metacode logic; `fileUtils.js`, `activeCodes.js`, and `plannerUtils.js` keep compatibility re-exports). `metacode-registry.js` is the single source of truth for **reserved metacode names** (`RESERVED_METACODES` + `isReservedName`/`isReservedActionable`/`BOOLEAN_CODES`) — the parser dispatches through it instead of hardcoded `if (key === …)` branches; unknown names fall through to a plain variable assignment. `metacode-ttl.js` provides `parseValueTtl` (the `=>` variable-TTL annotation) and `parseDuration` (shared by `timer:` and TTL). `metacode-parser.js` also parses the `!api:`/`api:`/`api!:` connector-trigger metacodes into `lineCodes[i].apiTriggers`; `metacode-variables.js` provides `interpolateVariables()` for client-side `{{name}}` insertion. `metacode-varblocks.js` implements `{{name[N]}}`/`{{name[N*]}}` variable-backed text blocks (plan_live_variables.md §3): `parseVarBlockMarker()` (block-only marker detection, used by `metacode-parser.js`), `wrapValue()` (soft/hard wrap), `expandVarBlocks()` (pure post-parse pass producing virtual `lines[]`/`lineCodes[]`/`lineNumbers[]` entries — applied by `hooks/useFileStore.js` via its optional `getVariablesSnapshot` option, fed by `FileContext.jsx` from `VariablesContext`; one-shot codes on the marker line — `timer`/`goto`/`apiTriggers`/`cue`/`actions` — are only kept on the first wrapped segment via `stripOneShotCodes`, so they fire once per block rather than once per virtual line), `hasVarBlocks()` (any pending block present) and `pendingVarBlockNames()` (the specific variable names a file's pending blocks are waiting on — lets `FileContext.jsx` reparse only when one of THOSE names resolves, not on every unrelated `variable.*` tick). `expandVarBlocks()` also accepts `opts.previous = { lines, lineCodes, lineNumbers }` — the file's own already-expanded arrays from before the reparse — and reuses any already-materialized virtual run verbatim (matched by raw source line number, via an internal `buildFrozenMap(previous)`) instead of recomputing it, so resolving one `{{name[N]}}` block doesn't silently reflow or refreeze a *sibling* block on another line that already resolved earlier; a block still pending in `previous` gets a fresh resolve attempt as normal. `hooks/useFileStore.js` also exposes `refreshVarBlocks(id)` — re-expands a file using its already-stored `rawText`, passes the file's current `{lines, lineCodes, lineNumbers}` as `opts.previous`, and remaps the pointer by raw source line number (via `metacode-runtime.js`'s `findLineIndexForRaw`) rather than clamping the same array index, so a block resolving in the background can't silently move the pointer onto unrelated content; `FileContext.jsx`'s reactive effect uses this instead of `updateFileFromRawText` (which keeps its original index-clamp behavior and a fully fresh expansion with no `previous`, correct for user-initiated raw-text edits). See `packages/plugins/lcyt-connectors/CLAUDE.md` and `docs/plans/plan_metacode_variable_unification.md`.
- `locales/` — i18n translation files: en.js, fi.js, sv.js
- `styles/` — reset.css, layout.css, components.css, dashboard.css

**URL routing** (wouter-based):

#### Sidebar routes (inside `SidebarLayout`)

| Path | Component | Notes |
|---|---|---|
| `/` | `DashboardPage` | Dockable mini-panel grid (react-grid-layout) |
| `/captions` | `AppLayout` | Classic two-panel caption layout (files + input + sent log) |
| `/audio` | `AudioPage` | Full-page audio/STT controls |
| `/broadcast` | `BroadcastPage` | Encoder, YouTube OAuth, RTMP relay tabs |
| `/graphics/editor` | `DskEditorPage` | Visual DSK template editor |
| `/graphics/control` | `DskControlPage` | DSK broadcast control panel |
| `/graphics/viewports` | `DskViewportsPage` | DSK viewport management |
| `/production` | `ProductionOperatorPage` | Tileable operator console (`components/production/workspace/`) — Pre-flight/Live Relay/Live Mixer/Captions + custom views |
| `/production/cameras` | `ProductionCamerasPage` | Camera management. Control types: `none`/`amx`/`visca-ip`/`webcam`/`mobile`/`rtmp` — the last three (`HAS_CAMERA_KEY_TYPES`) get a `camera_key` field; `rtmp` (plan_ingest_feeds.md §1a/§3) is a named feed pushed in externally, no browser "Open camera" WHIP link like `webcam`/`mobile` get |
| `/production/mixers` | `ProductionMixersPage` | Mixer management |
| `/production/bridges` | `ProductionBridgesPage` | Bridge instance management |
| `/production/devices` | `ProductionDevicesPage` | Device role management |
| `/production/visual` | `ProductionVisualPage` | Video/audio signal-flow diagram of the production setup (Mermaid) |
| `/production/crop` | `ProductionCropPage` | Vertical Crop operator page — draggable preset editor, preset-set tabs, camera/PTZ-preset source binding, live `{key}-crop` vertical monitor (linked from the `/production` console header) |
| `/planner` | `PlannerPage` | Event/service planner |
| `/cues` | `CuesPage` | Cue rules + Named Conditions CRUD editor (`GET/POST/PUT/DELETE /cues/rules` and `/cues/defs`) — linked from the Assets page's "Global cues" card (plan_cues.md Phase 10). Rules editor covers `phrase`/`regex`/`section`/`fuzzy`/`track`/`composite` (the last via the shared `ConditionTreeEditor` component); remaining types (`semantic`, `event_cue`, sound-cue types) list/toggle/delete but lock their edit form. Named Conditions section (`ConditionTreeEditor` again) includes the inline-sourced "Detach" action. Thin wrapper around `CuesManager` (embeddable core, `embedded` prop — also used by the Planner's `PlannerAssistPanel`). |
| `/actions` | `NamedActionsPage` | Named action macros CRUD editor (`GET/POST/PUT/DELETE /actions`) — linked from the Assets page's "Global actions" card (plan_named_actions.md). Wraps `NamedActionsManager` (embeddable core, `embedded` prop — also used by `PlannerAssistPanel`'s "Actions" tab); built early but not mounted anywhere until 2026-07-18. |
| `/translations` | `TranslationsPage` | Translation management |
| `/projects` | `ProjectsPage` | User project (API key) management |
| `/projects/:key` | `ProjectSettingsPage` | Per-project settings page (Summary, Features, Team, Device roles, Danger zone tabs — `ProjectDetailModal` un-nested) |
| `/assets` | `AssetsPage` | Cross-content library view (DSK template counts are real; thumbnails, stored videos, other kinds listed as real/produced cards) |
| `/broadcasts` | `BroadcastsManager` | Broadcast scheduler & manager — plan/schedule broadcasts, set metadata (title, description, thumbnail URL), link YouTube, enable recording |
| `/videos` | `StoredVideosManager` | Recorded broadcast playback (HLS) & management — produced by the recording pipeline, not authored here |
| `/team` | `TeamPage` | Organization/team management (backed by the `/orgs` backend routes: members, roles, org projects) |
| `/setup` | `SetupHubPage` | Persistent device/service catalog — every card has an `id` and is deep-linkable. Notably: `IngestionSection.jsx` (`id="ingestion"`) lists every `camera_key`-bearing camera alongside the Video/DSK slots — one referenced by a `GET /stream` relay's `sourceCameraId` renders active, one referenced by none renders greyed out as "Monitor" (computed client-side, not a stored flag — plan_ingest_feeds.md §3); `EgressSection.jsx` (`id="egress"`) lets each relay slot pick a source (Program / Vertical Crop / any named feed camera) via `RelaySlotRow`'s `feedCameras` prop |
| `/setup/wizard` | `SetupWizardPage` | Guided one-time setup wizard (superseded by the hub as the default `/setup` destination, still reachable) |
| `/setup/:card` | `SetupHubPage` | Deep link — same page as `/setup`, with the card whose `id` matches `:card` (e.g. `connectors`, `cameras`, `stt`, `storage`, `icons`) scrolled into view and highlighted for 10s |
| `/setup/:card/page` | `SetupStandalonePage` | Full-page equivalent of a card (`cameras`\|`mixers`\|`encoders`\|`bridges`\|`viewports`\|`caption-targets` only) with a banner linking back to the hub card — device/config-manager cards render the same manager component non-embedded; `viewports` renders the full `DskViewportsPage` editor (text layers, present-to-screen) since those don't fit the card's item-row model. Cards without a real standalone-page duplicate (Egress — `/broadcast` covers more than just relay targets — Storage, STT, etc.) don't route here. |
| `/account` | `AccountPage` | Login/register or user profile |
| `/settings` | `SettingsPage` | Unified settings (General, CC, I/O tabs) |
| `/ai` | `AiSettingsPage` | AI/embedding provider config (feature-gated: `ai`) |
| `/admin/users` | `AdminUsersPage` | User list, search, batch actions (feature-gated: `admin`) |
| `/admin/users/:id` | `AdminUserDetailPage` | User detail, projects, password reset (feature-gated: `admin`) |
| `/admin/projects` | `AdminProjectsPage` | Project list, search, batch actions (feature-gated: `admin`) |
| `/admin/projects/:key` | `AdminProjectDetailPage` | Project detail, features, members (feature-gated: `admin`) |
| `/admin/audit-log` | `AdminAuditLogPage` | Admin audit log (feature-gated: `admin`; removed from sidebar nav, route still live) |
| `/admin/ai-models` | `AdminAiModelsPage` | MCP personal access token management (`McpAccessSection`, same card as `/setup`'s "MCP access"); route name is a holdover from a deleted AI-models card (feature-gated: `admin`) |
| `/admin/ai-observability` | `AiObservabilityPage` | AI Observability / prompt-sculpting page (`plan_ai_observability.md` Stage 1) — live canvas overlay of `tracker_update`/`describer_update` over the polled preview-JPEG feed (subscribes directly to `role.tracker.*`/`role.describer.*` on `/events/stream`, no new backend for the overlay itself), a capture browser against the backend's per-role ring buffer (`GET /roles/:roleCode/captures[/:id/frame]`), and a prompt-edit/replay diff sandbox (`POST /roles/:roleCode/captures/:id/replay`, never persisted). Gated like `/admin/ai-models` (`AdminKeyGate` + `useProjectRequired`); nav entry gated on the `admin` feature (feature-gated: `admin`) |
| `/admin/site-features` | `AdminSiteFeaturesPage` | Tri-state site feature policies + per-org overrides (feature-gated: `admin`) |
| `/admin/teams` | `AdminTeamsPage` | All orgs on the deployment (`GET /admin/orgs`), feature overrides (feature-gated: `admin`) |

#### Standalone routes (no sidebar)

| Path | Component | Notes |
|---|---|---|
| `/view/:key` | `ViewerPage` | Full-screen caption viewer (public) |
| `/dsk/:slugOrKey[/:viewport]` | `DskPage` | DSK green-screen overlay (public, transparent bg). Path segment is the project public slug (preferred) or raw api key (legacy); viewport from the path or `?viewport=` |
| `/dsk-control/:key` | `DskControlPage` | DSK control (standalone mode) |
| `/mcp/:sessionId` | `SpeechCapturePage` | MCP speech session |
| `/embed/audio` | `EmbedAudioPage` | Mic / STT capture widget |
| `/embed/input` | `EmbedInputPage` | Text input + sent log widget |
| `/embed/sentlog` | `EmbedSentLogPage` | Read-only delivery log (BroadcastChannel) |
| `/embed/file-drop` | `EmbedFileDropPage` | Drop-one-file player widget |
| `/embed/files` | `EmbedFilesPage` | Full file management widget |
| `/embed/settings` | `EmbedSettingsPage` | Settings widget |
| `/embed/rtmp` | `EmbedRtmpPage` | RTMP relay-only widget |
| `/embed/viewer` | `EmbedViewerPage` | Embeddable viewer widget |
| `/login` | `LoginPage` | Two-phase login: backend selection → feature discovery → auth/API key |
| `/register` | `RegisterPage` | User registration (standalone access) |
| `/device-login` | `DeviceLoginPage` | Device pin-code login |
| `/production/camera/:key` | `CameraStreamPage` | Camera stream view |
| `/production/lcyt-mixer/:key` | `LcytMixerPage` | LCYT software mixer view |
| `/legacy` | `App` | Legacy two-panel layout |

**Embed pages** (`/embed/*`) accept `?server=`, `?apikey=`, and `?theme=` URL params and auto-connect when credentials are present. All session-owning embed pages (`/embed/audio`, `/embed/input`, `/embed/file-drop`, `/embed/files`) operate in `embed` mode: they broadcast the JWT token (`lcyt:session`) and each sent caption (`lcyt:caption`) on `BroadcastChannel('lcyt-embed')` so a sibling `/embed/sentlog` can subscribe without owning a session. See `docs/guide/embed.md` for full documentation.

**`AppProviders` props** (`src/contexts/AppProviders.jsx`):

| Prop | Type | Description |
|---|---|---|
| `initConfig` | `{ backendUrl, apiKey, streamKey? }` | Pre-populate credentials (overrides localStorage); used by embed pages to pass URL params |
| `autoConnect` | `boolean` | Call `session.connect(initConfig)` on mount when credentials are valid |
| `embed` | `boolean` | Enable BroadcastChannel broadcasting for cross-widget coordination |

## Two-Phase Login & Feature-Based UI

lcyt-web uses a **two-phase login** flow that adapts to backend capabilities:

**Phase 1 — Backend Selection:** The login page (`/login`) presents a dropdown with backend presets:
- **Normal** (`https://api.lcyt.fi`) — full-featured Node.js backend
- **Minimal** (`https://minimal.lcyt.fi`) — Python minimal backend (captions only)
- **Custom** — user enters a self-hosted URL

After selection, the frontend probes `GET /health` to discover the backend's feature list.

**Phase 2 — Authentication:** Based on the features returned:
- If `login` is in the features list → show email/password login form (user account mode)
- If `login` is NOT in the features list → show API key entry only (minimal mode, no user account needed)

**Feature-based UI gating:** Backend features from `GET /health` are stored in `localStorage` (`lcyt.backend.features`) and exposed via `ConnectionContext.backendFeatures`. Sidebar navigation items have an optional `feature` property in `navConfig.jsx` that controls visibility:

| Feature | Controls | Hidden when missing |
|---------|----------|-------------------|
| `graphics` | DSK Editor | Sidebar "Graphics" item |
| `login` | User account pages | Sidebar "Assets", "Projects", "Team", "Account" items |
| `admin` | Admin panel | Sidebar "Admin" item |

The sidebar is now a flat list (`NAV_ITEMS` + `NAV_BOTTOM`, no groups — `NAV_GROUPS` is empty) matching the icon set and ordering of the Claude Design mockup (project `9919ac53`, `Sidebar.dc.html`/`Dashboard.dc.html`). Pages with no counterpart in that mockup (Captions, Audio, Translations, Planner, AI, Settings, the Production group, DSK Control/Viewports, Admin Audit Log) were removed from the sidebar nav — their routes and components are untouched, so they're still reachable by direct URL. See `HIDDEN.md` at the repo root for the full list and how to bring each one back.

**AuthGate** (`main.jsx`) supports two modes:
1. **User login mode** — checks `lcyt-user` localStorage for `{ token, backendUrl }`
2. **Minimal mode** — checks `lcyt.backend.features` (no `login` feature) + `lcyt.session.config` (has `backendUrl` + `apiKey`)

## Embed Widget Coordination

Embed pages that own a session (`/embed/audio`, `/embed/input`, `/embed/file-drop`, `/embed/files`) broadcast state via `BroadcastChannel('lcyt-embed')`. `/embed/sentlog` listens on the same channel without owning a session. All iframes must share the same origin.

| Message type | Sender | Receiver | Payload |
|---|---|---|---|
| `lcyt:session` | session-owning embed | sentlog | `{ token, backendUrl }` — emitted on connect and in response to `lcyt:request_session` |
| `lcyt:caption` | session-owning embed | sentlog | `{ requestId, text, timestamp }` — emitted per caption sent |
| `lcyt:request_session` | sentlog | session-owning embed | _(no payload)_ — emitted on sentlog mount so it gets the token even if already connected |

`useSession.onConnected` payload includes `token: sender._token` so `AppProviders` (embed mode) can broadcast it without accessing the sender ref directly.

## Test Coverage

**Test commands:**
- `npm test -w packages/lcyt-web` → `node --test test/*.test.js` — pure utility functions (461 tests)
- `npm run test:components -w packages/lcyt-web` → `vitest run` — React hooks/components (437 tests via jsdom)

**Test files (node:test):** `test/api.test.js`, `test/formatting.test.js`, `test/viewer.test.js`, `test/fileUtils.test.js` (includes `describe('parseFileContent() — API connector triggers')`, added alongside `lcyt-connectors`; and `describe('parseFileContent() — {{name[N]}} variable block markers')`, plan_live_variables.md), `test/i18n.test.js`, `test/metacode-variables.test.js` (added alongside `lcyt-connectors` — `interpolateVariables()`), `test/metacode-varblocks.test.js` (`parseVarBlockMarker`/`wrapValue`/`expandVarBlocks`/`hasVarBlocks`/`pendingVarBlockNames`, incl. one-shot-code stripping on non-first segments — plan_live_variables.md §3), `test/cropGeometry.test.js` (pure geometry: window derivation, container-fraction conversion + its inverse, clamping, zero-travel edge case — `lib/cropGeometry.js`).
**Test files (Vitest):** `test/components/useSession.test.jsx` (25 tests), `test/components/useFileStore.test.jsx` (35 tests), `test/components/AppProviders.test.jsx` (15 tests) — all added 2026-03-16.

**Vitest setup (added 2026-03-16):**
- `vitest.config.js` — `mergeConfig(viteConfig, ...)` inherits `lcyt/*` alias resolution from `vite.config.js` automatically; no manual mapper needed.
- `test/setup.vitest.js` — `@testing-library/jest-dom`, localStorage/sessionStorage clear between tests, `EventSource` + `BroadcastChannel` global stubs.
- Mock pattern: `vi.fn(function() { return mockSender; })` (regular function, not arrow, so `new` works).

**Added 2026-03-16 (Vitest):**
- `test/components/useSession.test.jsx` — initial state, persistence helpers (`getPersistedConfig`, `getAutoConnect`/`setAutoConnect`, `clearPersistedConfig`), `connect()` (sets connected/backendUrl/apiKey/healthStatus, fires `onConnected` with token, persists config, throws on no token), `disconnect()` (sets connected=false, calls `end()`, fires `onDisconnected`, resets sequence, no-op when not connected), `send()` and `sendBatch()` (delegation + callbacks).
- `test/components/useFileStore.test.jsx` — initial state, `loadFile()` (file parsing, active tracking, `onFileLoaded`/`onActiveChanged` callbacks, localStorage persistence), `removeFile()`, `setActive()`/`cycleActive()`, `setPointer()`/`advancePointer()` (clamping, localStorage, callbacks), `createEmptyFile()`, `updateFileFromRawText()`, `refreshVarBlocks()` (pointer remap by raw line number when a background block resolution changes the file's line count), localStorage restore on remount.
- `test/components/AppProviders.test.jsx` — smoke render, `autoConnect` behaviour (connects when valid config, no-op otherwise), embed mode (`BroadcastChannel` opened/closed, `lcyt:session` broadcast on connect, responds to `lcyt:request_session`).

**Added 2026-03-17 (Vitest):**
- `test/components/useSentLog.test.jsx` (30 tests) — initial state, localStorage restore on mount (invalid JSON, non-array), `add()` (prepend order, pending flag, timestamp, localStorage persistence), `confirm()` (string + object arg, sequence update, no-op for unknown), `markError()` (error flag, clears pending, no-op for unknown, not persisted), `updateRequestId()`, `clear()` (empties entries + storage).
- `test/components/useToast.test.jsx` (18 tests) — `useToast`: initial state, `showToast()` (type default, custom type, unique IDs, auto-dismiss timer, no-dismiss when duration=0), `dismissToast()` (removes matching, partial, no-op for unknown); `ToastContainer`: no-crash empty, renders messages, CSS class, multiple toasts, click-to-dismiss with 200ms fade.

**Added 2026-07-18 (Vitest):**
- `test/components/CuesPage.test.jsx` (20 tests) — `CuesManager`/`CuesPage` (`/cues`, plan_cues.md Phase 10, extended same day with Phase 9's frontend): the original 9 (connect prompt, list/empty states from `GET /cues/rules`, create via dialog, client-side invalid-regex rejection, edit-dialog prefill + save, delete with confirmation, optimistic enable/disable toggle, locked-edit-form notice for non-editable match types e.g. `music_start`) plus 11 more — composite rule list rendering (`summarizeConditionTree()` in the meta line), building and creating a composite rule via `ConditionTreeEditor` in the dialog, the track-type cooldown auto-suggestion, and a full Named Conditions describe block (list with source badge, empty state, create, 409 duplicate-name error, delete, the inline-sourced "Detach" notice + action, locked name field on edit, and the composite rule form's `ref`-leaf dropdown being populated from `GET /cues/defs`).
- `test/components/ConditionTreeEditor.test.jsx` (16 tests) — the shared leaf/group/ref tree editor (`ConditionTreeEditor.jsx`): empty-state add buttons, adding a leaf/group from empty, nesting children inside an existing group, editing a leaf's pattern, removing a child vs. removing the root (clears back to empty), the `ref` leaf's named-conditions dropdown, switching a group's op to `not` (truncates to one child, disables further adds), and the `not`+async-leaf warning (shown for `semantic`, not for sync leaf types); plus `summarizeConditionTree()` unit tests (leaf prefixes, ref, group joins, `not`).
- `test/components/NamedActionsManager.test.jsx` (7 tests) — first tests this component has ever had (it existed but was unmounted before this pass): connect prompt, list/empty states from `GET /actions`, create via dialog with auto-slugging (`POST /actions` body shape), edit-dialog prefill with a locked slug field + save (`PUT /actions/:slug`), delete with confirmation dialog (`DELETE /actions/:slug`), compact chrome in `embedded` mode.
- `test/components/PlannerAssistPanel.test.jsx` (4 tests) — the Planner right-column panel: Cues tab active by default, switching to the Actions tab swaps rendered content, the AI assistant chat renders below the active tab and stays visible across tab switches.
- `test/fileUtils.test.js` additions (15 new cases) — the multi-line composite `cue:`/`cue-def:` block grammar (`parseFileContent()`): explicit `or:`, implicit top-level or (flat leaf list), nested `and:` inside `or:`, `not:` + bare `@ref`, `track:`/`event:` leaves, a bare no-prefix leaf line, `cue*:`/`cue**:` block modifiers, a single-leaf block, a `cue-def:` block feeding later `@ref` cues, single-line `cue-def:` falling back to the compact expression parser for non-JSON values (and still accepting raw JSON), plus `track:`/`regex:` keyword terms in the pre-existing compact `|`-pipe syntax.
- `test/metacode-runtime.test.js` additions (4 new cases, plus 2 existing `buildCueMap()` assertions updated for the new field) — `checkCueMatch()` skips `composite` entries the same way it skips `semantic`/`events`; `buildCueMap()` marks `composite: true`/`false` correctly.

**Added 2026-07-20 (Vitest):**
- `test/components/AiRoleModelsSection.test.jsx` (5 tests) — the Setup Hub "AI role models" card (`AiRoleModelsSection.jsx`, plan_ai_model_registry.md Phase 3 frontend): connect prompt when disconnected, listing only `agentic_chat` roles (continuous_vision roles like Tracker excluded) with a provider/model summary per row (`GET /roles/catalog` + `GET /ai/providers` + one `GET /roles/:roleCode/config` per role), the row's quick enable/disable toggle (`PUT /roles/:roleCode/config` with just `{enabled}`), the settings-dialog full save path (pick a provider, free-text model name for an `api`-kind provider, `PUT /roles/:roleCode/config` with `{enabled, providerId, modelName}`), and the discovered-model dropdown that appears for an `ollama`-kind provider (`GET /ai/providers/:id/models`) instead of free text.
- `test/components/SetupHubPage.test.jsx` — added the new section to the mocked-section list and the "renders every device/service section" assertion.

**Gaps (Low):**
- **React components** — 30+ leaf components (App, panels, modals, all pages) have no tests.
- **`PlannerPage.jsx` itself** — no component test exists for the 1300+-line page component (`test/planner.test.js` only covers the pure `serializePlan`/`deserializePlan` helpers); the desktop-vs-narrow layout switch and the new `PlannerAssistPanel` wiring inside it are exercised only indirectly, via `PlannerAssistPanel.test.jsx` in isolation.
- **Embed pages** — BroadcastChannel cross-iframe caption coordination.
- **Production pages** — `/production/*` device-manager pages. The `/production` operator console's pure layout engine is covered by `test/production-layout.test.js`; its data hook and pane components are not yet unit-tested. Same gap applies to the new `/production/crop` page — `useCropEditor.js` and the three `Crop*Panel`/`CropCanvas` components have no component tests yet, only the pure `lib/cropGeometry.js` math (`test/cropGeometry.test.js`).

---

See root `CLAUDE.md` for the Caption Target Architecture and Metacode Organization conventions that this package participates in.
