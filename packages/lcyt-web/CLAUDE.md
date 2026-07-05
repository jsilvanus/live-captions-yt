# `packages/lcyt-web` — Web UI (v1.0.0, private)

Browser-based React app using Vite and **wouter** for routing. Uses sidebar navigation as the primary layout. Sends captions via the `lcyt-backend` relay.

**Build:** `npm run build:web` → `packages/lcyt-web/dist/`
**Dev:** `npm run web`

**Source (`src/`):**
- `main.jsx` — React entry point; wouter-based routing for sidebar pages and standalone pages
- `App.jsx` — legacy two-panel caption layout (mounted at `/legacy` and `/captions`)
- `components/` — React JSX components (see routing table below). Key subdirectories: `sidebar/` (Sidebar, TopBar, StatusPopover, QuickActionsPopover), `dashboard/` (DashboardCard, StatusWidget, SentLogWidget, etc.), `broadcast/` (EncoderTab, StreamTab, YouTubeTab), `dsk-editor/` (TemplatePreview, AnimationEditor, LayerPropertyEditor), `dsk-viewports/` (TextLayersEditor, ImageSettingsTable), `panels/` (TargetsPanel, TranslationPanel, RelayPanel, ServicePanel, DetailsPanel, CeaCaptionsPanel, EmbedPanel, SttPanel, VadPanel, ReviewSummary), `production/` (ConnectionDot), `audio/` (AudioLevelMeter)
- `contexts/` — React context providers: AppProviders, AudioContext, CaptionContext, ConnectionContext, FileContext, LangContext, SentLogContext, SessionApiContext, SessionContext, ToastContext. Notably: `ConnectionContext` (connection state, health, connect/disconnect), `CaptionContext` (send, sendBatch, sequence, syncOffset), `AudioContext` (audio/STT state and controls), `LangContext` (i18n language provider).
- `hooks/` — Custom React hooks: useBrowserFileSaving, useDashboardConfig, useEscapeKey, useFileStore, useProjectFeatures, useSentLog, useSession, useToast, useUserAuth, useVariables, useWebSpeech, useWindowEvent. Notably: `useSession` (`BackendCaptionSender` session lifecycle hook; `onConnected` payload includes `token`), `useDashboardConfig` (dashboard panel/layout CRUD, localStorage persistence), `useWebSpeech` (WebSpeech recognition state machine: start, stop, error recovery), `useProjectFeatures` (project feature flag hook), `useUserAuth` (user authentication hook), `useVariables` (`{{ }}` variable snapshot: `GET /variables` + `GET /variables/events` SSE + `POST /variables/refresh`, from `lcyt-connectors`).
- `lib/` — Utilities: activeCodes.js, api.js, device.js, dskEditorAnimation.js, dskEditorGeometry.js, dskEditorPresets.js, fileUtils.js, formatting.js, googleCredential.js, i18n.js, inputLang.js, normalizeLines.js, plannerUtils.js, relayConfig.js, settings.js, settingsIO.js, storageKeys.js, sttConfig.js, targetConfig.js, translate.js, translationConfig.js, viewerUtils.js, youtubeApi.js, youtubeAuth.js. Notably: `storageKeys.js` (normalized localStorage key registry, `lcyt.{category}.{key}` convention), `settingsIO.js` (settings export/import: `downloadSettings`, `importSettings`), `i18n.js` (i18n framework: locale loading, `useLang` hook).
- `lib/metacode-*` — Metacode helpers: metacode-parser.js, metacode-active.js, metacode-planner.js, metacode-runtime.js, metacode-variables.js (frontend metacode logic; `fileUtils.js`, `activeCodes.js`, and `plannerUtils.js` keep compatibility re-exports). `metacode-parser.js` also parses the `!api:`/`api:`/`api!:` connector-trigger metacodes into `lineCodes[i].apiTriggers`; `metacode-variables.js` provides `interpolateVariables()` for client-side `{{name}}` insertion. See `packages/plugins/lcyt-connectors/CLAUDE.md`.
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
| `/production` | `ProductionOperatorPage` | Production operator control surface |
| `/production/cameras` | `ProductionCamerasPage` | Camera management |
| `/production/mixers` | `ProductionMixersPage` | Mixer management |
| `/production/bridges` | `ProductionBridgesPage` | Bridge instance management |
| `/production/devices` | `ProductionDevicesPage` | Device role management |
| `/planner` | `PlannerPage` | Event/service planner |
| `/translations` | `TranslationsPage` | Translation management |
| `/projects` | `ProjectsPage` | User project (API key) management |
| `/setup` | `SetupWizardPage` | Guided setup wizard |
| `/account` | `AccountPage` | Login/register or user profile |
| `/settings` | `SettingsPage` | Unified settings (General, CC, I/O tabs) |
| `/ai` | `AiSettingsPage` | AI/embedding provider config (feature-gated: `ai`) |
| `/setup/connectors` | `SetupHubPage` | Deep link — same page as `/setup`, with the "API connectors" card pre-expanded and scrolled into view (`ConnectorsSection`, see below) |
| `/admin/users` | `AdminUsersPage` | User list, search, batch actions (feature-gated: `admin`) |
| `/admin/users/:id` | `AdminUserDetailPage` | User detail, projects, password reset (feature-gated: `admin`) |
| `/admin/projects` | `AdminProjectsPage` | Project list, search, batch actions (feature-gated: `admin`) |
| `/admin/projects/:key` | `AdminProjectDetailPage` | Project detail, features, members (feature-gated: `admin`) |

#### Standalone routes (no sidebar)

| Path | Component | Notes |
|---|---|---|
| `/view/:key` | `ViewerPage` | Full-screen caption viewer (public) |
| `/dsk/:key` | `DskPage` | DSK green-screen overlay (public, transparent bg) |
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

**Feature-based UI gating:** Backend features from `GET /health` are stored in `localStorage` (`lcyt.backend.features`) and exposed via `ConnectionContext.backendFeatures`. Sidebar navigation items and groups have an optional `feature` property in `navConfig.js` that controls visibility:

| Feature | Controls | Hidden when missing |
|---------|----------|-------------------|
| `rtmp` | Broadcast page | Sidebar "Broadcast" item |
| `graphics` | Graphics group | Sidebar "Graphics" group (Editor, Control, Viewports) |
| `production` | Production group | Sidebar "Production" group (Operator, Devices) |
| `login` | User account pages | Sidebar "Projects" and "Account" items |
| `ai` | AI settings page | Sidebar "AI" item |
| `admin` | Admin panel | Sidebar "Admin" group (Users, Projects) |

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
- `npm test -w packages/lcyt-web` → `node --test test/*.test.js` — pure utility functions (325 tests)
- `npm run test:components -w packages/lcyt-web` → `vitest run` — React hooks/components (336 tests via jsdom)

**Test files (node:test):** `test/api.test.js`, `test/formatting.test.js`, `test/viewer.test.js`, `test/fileUtils.test.js` (includes `describe('parseFileContent() — API connector triggers')`, added alongside `lcyt-connectors`), `test/i18n.test.js`, `test/metacode-variables.test.js` (added alongside `lcyt-connectors` — `interpolateVariables()`).
**Test files (Vitest):** `test/components/useSession.test.jsx` (25 tests), `test/components/useFileStore.test.jsx` (35 tests), `test/components/AppProviders.test.jsx` (15 tests) — all added 2026-03-16.

**Vitest setup (added 2026-03-16):**
- `vitest.config.js` — `mergeConfig(viteConfig, ...)` inherits `lcyt/*` alias resolution from `vite.config.js` automatically; no manual mapper needed.
- `test/setup.vitest.js` — `@testing-library/jest-dom`, localStorage/sessionStorage clear between tests, `EventSource` + `BroadcastChannel` global stubs.
- Mock pattern: `vi.fn(function() { return mockSender; })` (regular function, not arrow, so `new` works).

**Added 2026-03-16 (Vitest):**
- `test/components/useSession.test.jsx` — initial state, persistence helpers (`getPersistedConfig`, `getAutoConnect`/`setAutoConnect`, `clearPersistedConfig`), `connect()` (sets connected/backendUrl/apiKey/healthStatus, fires `onConnected` with token, persists config, throws on no token), `disconnect()` (sets connected=false, calls `end()`, fires `onDisconnected`, resets sequence, no-op when not connected), `send()` and `sendBatch()` (delegation + callbacks).
- `test/components/useFileStore.test.jsx` — initial state, `loadFile()` (file parsing, active tracking, `onFileLoaded`/`onActiveChanged` callbacks, localStorage persistence), `removeFile()`, `setActive()`/`cycleActive()`, `setPointer()`/`advancePointer()` (clamping, localStorage, callbacks), `createEmptyFile()`, `updateFileFromRawText()`, localStorage restore on remount.
- `test/components/AppProviders.test.jsx` — smoke render, `autoConnect` behaviour (connects when valid config, no-op otherwise), embed mode (`BroadcastChannel` opened/closed, `lcyt:session` broadcast on connect, responds to `lcyt:request_session`).

**Added 2026-03-17 (Vitest):**
- `test/components/useSentLog.test.jsx` (30 tests) — initial state, localStorage restore on mount (invalid JSON, non-array), `add()` (prepend order, pending flag, timestamp, localStorage persistence), `confirm()` (string + object arg, sequence update, no-op for unknown), `markError()` (error flag, clears pending, no-op for unknown, not persisted), `updateRequestId()`, `clear()` (empties entries + storage).
- `test/components/useToast.test.jsx` (18 tests) — `useToast`: initial state, `showToast()` (type default, custom type, unique IDs, auto-dismiss timer, no-dismiss when duration=0), `dismissToast()` (removes matching, partial, no-op for unknown); `ToastContainer`: no-crash empty, renders messages, CSS class, multiple toasts, click-to-dismiss with 200ms fade.

**Gaps (Low):**
- **React components** — 30+ leaf components (App, panels, modals, all pages) have no tests.
- **Embed pages** — BroadcastChannel cross-iframe caption coordination.
- **Production pages** — `/production/*` operator control surface.

---

See root `CLAUDE.md` for the Caption Target Architecture and Metacode Organization conventions that this package participates in.
