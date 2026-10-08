# Frontend To-Do: Sidebar Navigation & UI Improvements

**Plan reference:** `docs/plan_front.md`
**Last updated:** 2026-03-17

---

## Phase 1 â€” Router + SidebarLayout shell âœ… Done

| Task | Status | Notes |
|------|--------|-------|
| Install `wouter` router (~1.5KB) | âœ… Done | v3.9.0, added to `packages/lcyt-web` |
| `SidebarLayout.jsx` â€” full-page shell | âœ… Done | TopBar + Sidebar + content area |
| `TopBar` â€” hamburger, brand, health dot, connect button | âœ… Done | Health dot changes colour with connection state |
| `Sidebar` â€” nav items with active-state highlighting | âœ… Done | Prefix-match active state, left accent border |
| `SidebarGroup` â€” collapsible groups (Graphics, Production) | âœ… Done | Auto-opens on child route navigation; persisted in localStorage |
| Expanded (200px) / collapsed (48px) toggle | âœ… Done | Transition animated; state persisted in `localStorage` |
| Mobile drawer (slide-over, < 768px) | âœ… Done | Backdrop, auto-close on navigation |
| Update `main.jsx` â€” wouter routing inside sidebar shell | âœ… Done | Sidebar routes use shared `AppProviders`; standalone routes unchanged |
| Mount `App.jsx` (caption UI) at `/api/v1/captions` | âœ… Done | Full two-panel layout inside sidebar content area |
| `DashboardPage` at `/` | âœ… Done | Status card, Recent Captions card, Quick Links card |
| Stub pages for `/audio`, `/broadcast`, `/account`, `/settings` | âœ… Done | Placeholder with icon + description |
| DSK pages (`/graphics/editor`, `/graphics/control`, `/graphics/viewports`) | âœ… Done | Existing `DskEditorPage`, `DskControlPage`, `DskViewportsPage` inside shell |
| Production pages (`/api/v1/production`, `/api/v1/production/api/v1/cameras`, `/api/v1/production/api/v1/mixers`, `/api/v1/production/api/v1/bridges`) | âœ… Done | Existing pages inside sidebar shell |
| `/projects` inside sidebar shell | âœ… Done | Existing `ProjectsPage` |
| Legacy URL aliases (`/api/v1/dsk-editor` â†’ `/api/v1/graphics/api/v1/editor`, `/api/v1/dsk-viewports` â†’ `/api/v1/graphics/api/v1/viewports`) | âœ… Done | Redirect via wouter `<Redirect>` |
| `sidebar.css` â€” sidebar, topbar, stub page, dashboard card styles | âœ… Done | Responsive, dark/light theme compatible |
| Update `layout.css` â€” migrate `#app` grid to `.captions-page` | âœ… Done | Allows sidebar shell to take over the root container |
| `App.jsx` â€” export `AppLayout` separately; rename wrapper to `.captions-page` | âœ… Done | Backward-compatible: `App` export still works standalone |
| Build passes | âœ… Done | `npm run build:web` â€” no errors |
| Existing tests still pass | âœ… Done | 59/59 `node:test` pass; Vitest failures are pre-existing |

**Sidebar routes (Phase 1):**

| Route | Component | State |
|-------|-----------|-------|
| `/` | `DashboardPage` | âœ… Done |
| `/api/v1/captions` | `AppLayout` (caption UI) | âœ… Done |
| `/audio` | stub | âœ… Stub |
| `/broadcast` | stub | âœ… Stub |
| `/graphics/editor` | `DskEditorPage` | âœ… Done |
| `/graphics/control` | `DskControlPage` | âœ… Done |
| `/graphics/viewports` | `DskViewportsPage` | âœ… Done |
| `/api/v1/production` | `ProductionOperatorPage` | âœ… Done |
| `/api/v1/production/api/v1/cameras` | `ProductionCamerasPage` | âœ… Done |
| `/api/v1/production/api/v1/mixers` | `ProductionMixersPage` | âœ… Done |
| `/api/v1/production/api/v1/bridges` | `ProductionBridgesPage` | âœ… Done |
| `/projects` | `ProjectsPage` | âœ… Done |
| `/account` | stub | âœ… Stub |
| `/settings` | stub | âœ… Stub |

**Standalone routes (unchanged):**

| Route | Component | Status |
|-------|-----------|--------|
| `/mcp/:id` | `SpeechCapturePage` | âœ… Unchanged |
| `/embed/*` | `Embed*Page` | âœ… Unchanged |
| `/api/v1/dsk/api/v1/:key` | `DskPage` | âœ… Unchanged |
| `/api/v1/dsk-control/api/v1/:key` | `DskControlPage` | âœ… Unchanged (standalone URL still works) |
| `/view/:key` | `ViewerPage` | âœ… Unchanged |
| `/login` | `LoginPage` | âœ… Unchanged |
| `/register` | `RegisterPage` | âœ… Unchanged |

---

## Phase 1b â€” Dashboard dockable panel grid âœ… Done

Install `react-grid-layout` and implement the draggable/resizable dashboard widget grid.

| Task | Status |
|------|--------|
| Install `react-grid-layout` | âœ… Done |
| `DashboardCard.jsx` â€” card wrapper (header, collapse, remove, drag handle) | âœ… Done |
| `StatusWidget.jsx` | âœ… Done |
| `SentLogWidget.jsx` | âœ… Done |
| `InputWidget.jsx` â€” mini text input + send | âœ… Done |
| `FileWidget.jsx` / `FilePreviewWidget.jsx` | âœ… Done |
| `AudioWidget.jsx` / `AudioMeterWidget.jsx` | âœ… Done |
| `ViewerWidget.jsx` â€” independent SSE to `/viewer/:key` | âœ… Done |
| `BroadcastWidget.jsx` | âœ… Done |
| `PanelPicker.jsx` â€” `[+ Add]` checkbox dropdown | âœ… Done |
| `useDashboardConfig.js` â€” panels[], layouts{}, localStorage persistence | âœ… Done |
| `dashboard.css` â€” grid + card + widget styles | âœ… Done (in `sidebar.css`) |
| Empty dashboard state (no panels configured) | âœ… Done |
| Default panels: `status`, `sent-log`, `input` | âœ… Done |

**Evidence:** `packages/lcyt-web/src/components/DashboardPage.jsx` + `packages/lcyt-web/src/components/dashboard/` â€” all widgets implemented with `react-grid-layout`; `packages/lcyt-web/src/hooks/useDashboardConfig.js` handles persistence.

---

## Phase 2 â€” Move content into sidebar pages âœ… Done

Replace stub pages with real implementations. Move modal content to full pages.

| Task | Status | Notes |
|------|--------|-------|
| `/audio` page â€” promote `AudioPanel` to full page | âœ… Done | `AudioPage.jsx` â€” renders `AudioPanel` with `visible=true` |
| `/broadcast` page â€” move `BroadcastModal` content here | âœ… Done | `BroadcastPage.jsx` â€” inline mode (no backdrop/close button) |
| Remove old `BroadcastModal` (or keep as deprecated fallback) | âœ… Done | Kept as fallback for embed pages; not rendered from sidebar |
| Remove duplicate topbar on `/api/v1/captions` (Phase 2 cleanup) | âœ… Done | `StatusBar` uses wouter `useLocation` for navigation |

---

## Phase 3 â€” Unified settings page + QuickActionsPopover âœ… Done

| Task | Status | Notes |
|------|--------|-------|
| `/settings` page â€” Connection, Targets, Audio & STT, Translations, Broadcast, Appearance, Account, Advanced tabs | âœ… Done | `SettingsPage.jsx` â€” General (SettingsModal inline) + Captions & Targets (CCModal inline) tab switcher |
| Merge `SettingsModal` + `CCModal` content into `/settings` | âœ… Done | Both rendered inline (no modal backdrop/close) |
| `QuickActionsPopover` in TopBar â€” replaces `ControlsPanel` modal | âœ… Done | âš¡ button: sync, heartbeat, reset/set sequence, language picker, no-translate |
| Remove `SettingsModal`, `CCModal`, `ControlsPanel` (or keep as deprecated) | âœ… Done | Kept as internal components rendered inline by sidebar pages |

---

## Phase 4 â€” Account page âœ… Done

| Task | Status | Notes |
|------|--------|-------|
| `/account` page â€” login/register links (anonymous) or user profile + password change (logged in) | âœ… Done | `AccountPage.jsx` â€” two states: anonymous (links to /login, /register) and logged-in (email, name, server, Projects link, change password form, sign out) |
| `/login` and `/register` kept as standalone deep-link routes | âœ… Done | Per plan: both still work standalone |
| `AccountPage.test.jsx` â€” loading, anonymous, logged-in, password change | âœ… Done | 25 tests |

---

## Other improvements from plan (backlog)

| # | Item | Priority | Status |
|---|------|----------|--------|
| 2a | Guided setup wizard for first-time users | P1 | âœ… Done |
| 2b | Empty-state guidance in captions view | P1 | âœ… Done |
| 3b | Settings export/import (JSON) | P3 | âœ… Done |
| 3c | Normalize localStorage keys (`lcyt.{category}.{key}`) | P3 | âœ… Done |
| 5a | Command palette (Ctrl/Cmd+K) | P2 | âœ… Done |
| 5b | Keyboard shortcuts help overlay | P2 | âœ… Done |
| 5c | Status bar enrichment (target count, language badge, batch badge) | P2 | âœ… Done |
| 6a | Connection health dot in topbar (latency tooltip) | P1 | âœ… Done |
| 6b | Auto-reconnect with backoff on session expiry | P0 | âœ… Done |
| 6c | Unsaved work protection (`beforeunload` guard) | P0 | âœ… Done |
| 7a | Virtual scrolling for `SentPanel` | P3 | âœ… Done |
| 7b | Context splitting (`SessionContext` â†’ Connection/Caption/SessionApi) | P2 | âœ… Done |
| 7c | Lazy-load heavy pages (`DskEditorPage`, `ProductionOperatorPage`) | P3 | âœ… Done |

### Evidence notes

- **2a**: `packages/lcyt-web/src/components/setup-wizard/SetupWizardPage.jsx` â€” full wizard at `/setup`; lazy-loaded in `main.jsx`.
- **2b**: `packages/lcyt-web/src/components/CaptionView.jsx` lines 223-243 â€” shows "No file loaded. Drop a .txt file to begin." and "No caption lines found in this file.". Also virtual rendering window (VIRTUAL_THRESHOLD/VIRTUAL_BUFFER) guides users through large files.
- **3b**: `packages/lcyt-web/src/lib/settingsIO.js` â€” `exportSettings()`, `downloadSettings()`, `importSettings()` functions; integrated into `SettingsPage.jsx`.
- **3c**: `packages/lcyt-web/src/lib/storageKeys.js` â€” canonical `KEYS` registry with dot-notation keys (`lcyt.{category}.{key}`); `migrateStorageKeys()` runs from `main.jsx` on every load.
- **5a**: `packages/lcyt-web/src/components/CommandPalette.jsx` â€” modal palette mounted in `SidebarLayout`; Ctrl/Cmd+K opens it; filters all nav items; ArrowUp/Down/Enter/Esc navigation; does not activate while in text inputs.
- **5b**: `packages/lcyt-web/src/components/KeyboardShortcutsHelp.jsx` â€” overlay mounted in `SidebarLayout`; `?` key opens it (when not in text input); `âŒ˜` and `?` buttons in topbar also trigger it.
- **5c**: `packages/lcyt-web/src/components/sidebar/Sidebar.jsx` â€” `TopBarBadges` component renders inline badges for YouTube target count, Viewer target count, active input language, and batch interval in the topbar. Responds to `storage`, `lcyt:active-codes-changed`, and `lcyt:input-lang-changed` events.
- **6a**: `packages/lcyt-web/src/components/sidebar/Sidebar.jsx` â€” `HealthDot` component with latency tooltip, clicking opens `StatusPopover` (`StatusPopover.jsx`) showing full session details including targets and batch info.
- **6b**: `packages/lcyt-web/src/hooks/useSession.js` â€” `_scheduleReconnect()` with exponential backoff (2 s â†’ 4 s â†’ 8 s â†’ 16 s â†’ 30 s max); triggered by `session_closed` SSE event; `reconnecting` state drives `ReconnectBanner` in `SidebarLayout.jsx`.
- **6c**: `packages/lcyt-web/src/contexts/AppProviders.jsx` lines 113-126 â€” `beforeunload` listener checks `getQueuedCount()`; fires native browser dialog only when there are pending queued captions.
- **7a**: `packages/lcyt-web/src/components/SentPanel.jsx` â€” windowed rendering using scroll position; renders only visible rows Â± OVERSCAN (10) buffer; activates above VIRTUAL_THRESHOLD (100) entries; uses padding spacers to maintain full scroll height.
- **7b**: `packages/lcyt-web/src/contexts/AppProviders.jsx` â€” `ConnectionContext`, `CaptionContext`, `SessionApiContext` each expose a focused slice of session state; consumers re-render only when their slice changes.
- **7c**: `packages/lcyt-web/src/main.jsx` lines 15-57 â€” every sidebar page (`DskEditorPage`, `ProductionOperatorPage`, `DashboardPage`, etc.) is wrapped in `React.lazy()` with `<Suspense fallback={null}>`.

---

## Known issues / follow-up

- **Duplicate header on `/api/v1/captions`**: The SidebarLayout TopBar and the old `StatusBar` (from `AppLayout`) both render. This is expected for Phase 1. Phase 2/api/v1/3 will unify them â€” the `StatusBar` will be removed once its buttons (Settings, CC, Controls) move to the sidebar pages and `QuickActionsPopover`.
- **Mobile drawer aria**: The `MobileDrawer` renders the sidebar even when closed (off-screen via `transform`). This adds a second nav to the accessibility tree. Solution: add `aria-hidden="true"` to the closed drawer.
- **`/api/v1/graphics/api/v1/control` in sidebar**: The original `DskControlPage` reads the API key from the URL (`/api/v1/dsk-control/api/v1/:apikey`). The sidebar route reads no URL param â€” it uses the session API key from context. Currently this uses the existing `DskControlPage` which may show an empty state if not accessed via the original URL.

