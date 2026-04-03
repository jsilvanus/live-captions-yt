# Frontend To-Do: Sidebar Navigation & UI Improvements

**Plan reference:** `docs/plan_front.md`
**Last updated:** 2026-03-17

---

## Phase 1 — Router + SidebarLayout shell ✅ Done

| Task | Status | Notes |
|------|--------|-------|
| Install `wouter` router (~1.5KB) | ✅ Done | v3.9.0, added to `packages/lcyt-web` |
| `SidebarLayout.jsx` — full-page shell | ✅ Done | TopBar + Sidebar + content area |
| `TopBar` — hamburger, brand, health dot, connect button | ✅ Done | Health dot changes colour with connection state |
| `Sidebar` — nav items with active-state highlighting | ✅ Done | Prefix-match active state, left accent border |
| `SidebarGroup` — collapsible groups (Graphics, Production) | ✅ Done | Auto-opens on child route navigation; persisted in localStorage |
| Expanded (200px) / collapsed (48px) toggle | ✅ Done | Transition animated; state persisted in `localStorage` |
| Mobile drawer (slide-over, < 768px) | ✅ Done | Backdrop, auto-close on navigation |
| Update `main.jsx` — wouter routing inside sidebar shell | ✅ Done | Sidebar routes use shared `AppProviders`; standalone routes unchanged |
| Mount `App.jsx` (caption UI) at `/captions` | ✅ Done | Full two-panel layout inside sidebar content area |
| `DashboardPage` at `/` | ✅ Done | Status card, Recent Captions card, Quick Links card |
| Stub pages for `/audio`, `/broadcast`, `/account`, `/settings` | ✅ Done | Placeholder with icon + description |
| DSK pages (`/graphics/editor`, `/graphics/control`, `/graphics/viewports`) | ✅ Done | Existing `DskEditorPage`, `DskControlPage`, `DskViewportsPage` inside shell |
| Production pages (`/production`, `/production/cameras`, `/production/mixers`, `/production/bridges`) | ✅ Done | Existing pages inside sidebar shell |
| `/projects` inside sidebar shell | ✅ Done | Existing `ProjectsPage` |
| Legacy URL aliases (`/dsk-editor` → `/graphics/editor`, `/dsk-viewports` → `/graphics/viewports`) | ✅ Done | Redirect via wouter `<Redirect>` |
| `sidebar.css` — sidebar, topbar, stub page, dashboard card styles | ✅ Done | Responsive, dark/light theme compatible |
| Update `layout.css` — migrate `#app` grid to `.captions-page` | ✅ Done | Allows sidebar shell to take over the root container |
| `App.jsx` — export `AppLayout` separately; rename wrapper to `.captions-page` | ✅ Done | Backward-compatible: `App` export still works standalone |
| Build passes | ✅ Done | `npm run build:web` — no errors |
| Existing tests still pass | ✅ Done | 59/59 `node:test` pass; Vitest failures are pre-existing |

**Sidebar routes (Phase 1):**

| Route | Component | State |
|-------|-----------|-------|
| `/` | `DashboardPage` | ✅ Done |
| `/captions` | `AppLayout` (caption UI) | ✅ Done |
| `/audio` | stub | ✅ Stub |
| `/broadcast` | stub | ✅ Stub |
| `/graphics/editor` | `DskEditorPage` | ✅ Done |
| `/graphics/control` | `DskControlPage` | ✅ Done |
| `/graphics/viewports` | `DskViewportsPage` | ✅ Done |
| `/production` | `ProductionOperatorPage` | ✅ Done |
| `/production/cameras` | `ProductionCamerasPage` | ✅ Done |
| `/production/mixers` | `ProductionMixersPage` | ✅ Done |
| `/production/bridges` | `ProductionBridgesPage` | ✅ Done |
| `/projects` | `ProjectsPage` | ✅ Done |
| `/account` | stub | ✅ Stub |
| `/settings` | stub | ✅ Stub |

**Standalone routes (unchanged):**

| Route | Component | Status |
|-------|-----------|--------|
| `/mcp/:id` | `SpeechCapturePage` | ✅ Unchanged |
| `/embed/*` | `Embed*Page` | ✅ Unchanged |
| `/dsk/:key` | `DskPage` | ✅ Unchanged |
| `/dsk-control/:key` | `DskControlPage` | ✅ Unchanged (standalone URL still works) |
| `/view/:key` | `ViewerPage` | ✅ Unchanged |
| `/login` | `LoginPage` | ✅ Unchanged |
| `/register` | `RegisterPage` | ✅ Unchanged |

---

## Phase 1b — Dashboard dockable panel grid ✅ Done

Install `react-grid-layout` and implement the draggable/resizable dashboard widget grid.

| Task | Status |
|------|--------|
| Install `react-grid-layout` | ✅ Done |
| `DashboardCard.jsx` — card wrapper (header, collapse, remove, drag handle) | ✅ Done |
| `StatusWidget.jsx` | ✅ Done |
| `SentLogWidget.jsx` | ✅ Done |
| `InputWidget.jsx` — mini text input + send | ✅ Done |
| `FileWidget.jsx` / `FilePreviewWidget.jsx` | ✅ Done |
| `AudioWidget.jsx` / `AudioMeterWidget.jsx` | ✅ Done |
| `ViewerWidget.jsx` — independent SSE to `/viewer/:key` | ✅ Done |
| `BroadcastWidget.jsx` | ✅ Done |
| `PanelPicker.jsx` — `[+ Add]` checkbox dropdown | ✅ Done |
| `useDashboardConfig.js` — panels[], layouts{}, localStorage persistence | ✅ Done |
| `dashboard.css` — grid + card + widget styles | ✅ Done (in `sidebar.css`) |
| Empty dashboard state (no panels configured) | ✅ Done |
| Default panels: `status`, `sent-log`, `input` | ✅ Done |

**Evidence:** `packages/lcyt-web/src/components/DashboardPage.jsx` + `packages/lcyt-web/src/components/dashboard/` — all widgets implemented with `react-grid-layout`; `packages/lcyt-web/src/hooks/useDashboardConfig.js` handles persistence.

---

## Phase 2 — Move content into sidebar pages ✅ Done

Replace stub pages with real implementations. Move modal content to full pages.

| Task | Status | Notes |
|------|--------|-------|
| `/audio` page — promote `AudioPanel` to full page | ✅ Done | `AudioPage.jsx` — renders `AudioPanel` with `visible=true` |
| `/broadcast` page — move `BroadcastModal` content here | ✅ Done | `BroadcastPage.jsx` — inline mode (no backdrop/close button) |
| Remove old `BroadcastModal` (or keep as deprecated fallback) | ✅ Done | Kept as fallback for embed pages; not rendered from sidebar |
| Remove duplicate topbar on `/captions` (Phase 2 cleanup) | ✅ Done | `StatusBar` uses wouter `useLocation` for navigation |

---

## Phase 3 — Unified settings page + QuickActionsPopover ✅ Done

| Task | Status | Notes |
|------|--------|-------|
| `/settings` page — Connection, Targets, Audio & STT, Translations, Broadcast, Appearance, Account, Advanced tabs | ✅ Done | `SettingsPage.jsx` — General (SettingsModal inline) + Captions & Targets (CCModal inline) tab switcher |
| Merge `SettingsModal` + `CCModal` content into `/settings` | ✅ Done | Both rendered inline (no modal backdrop/close) |
| `QuickActionsPopover` in TopBar — replaces `ControlsPanel` modal | ✅ Done | ⚡ button: sync, heartbeat, reset/set sequence, language picker, no-translate |
| Remove `SettingsModal`, `CCModal`, `ControlsPanel` (or keep as deprecated) | ✅ Done | Kept as internal components rendered inline by sidebar pages |

---

## Phase 4 — Account page ✅ Done

| Task | Status | Notes |
|------|--------|-------|
| `/account` page — login/register links (anonymous) or user profile + password change (logged in) | ✅ Done | `AccountPage.jsx` — two states: anonymous (links to /login, /register) and logged-in (email, name, server, Projects link, change password form, sign out) |
| `/login` and `/register` kept as standalone deep-link routes | ✅ Done | Per plan: both still work standalone |
| `AccountPage.test.jsx` — loading, anonymous, logged-in, password change | ✅ Done | 25 tests |

---

## Other improvements from plan (backlog)

| # | Item | Priority | Status |
|---|------|----------|--------|
| 2a | Guided setup wizard for first-time users | P1 | ✅ Done |
| 2b | Empty-state guidance in captions view | P1 | ✅ Done |
| 3b | Settings export/import (JSON) | P3 | ✅ Done |
| 3c | Normalize localStorage keys (`lcyt.{category}.{key}`) | P3 | ✅ Done |
| 5a | Command palette (Ctrl/Cmd+K) | P2 | ✅ Done |
| 5b | Keyboard shortcuts help overlay | P2 | ✅ Done |
| 5c | Status bar enrichment (target count, language badge, batch badge) | P2 | ✅ Done |
| 6a | Connection health dot in topbar (latency tooltip) | P1 | ✅ Done |
| 6b | Auto-reconnect with backoff on session expiry | P0 | ✅ Done |
| 6c | Unsaved work protection (`beforeunload` guard) | P0 | ✅ Done |
| 7a | Virtual scrolling for `SentPanel` | P3 | ✅ Done |
| 7b | Context splitting (`SessionContext` → Connection/Caption/SessionApi) | P2 | ✅ Done |
| 7c | Lazy-load heavy pages (`DskEditorPage`, `ProductionOperatorPage`) | P3 | ✅ Done |

### Evidence notes

- **2a**: `packages/lcyt-web/src/components/setup-wizard/SetupWizardPage.jsx` — full wizard at `/setup`; lazy-loaded in `main.jsx`.
- **2b**: `packages/lcyt-web/src/components/CaptionView.jsx` lines 223-243 — shows "No file loaded. Drop a .txt file to begin." and "No caption lines found in this file.". Also virtual rendering window (VIRTUAL_THRESHOLD/VIRTUAL_BUFFER) guides users through large files.
- **3b**: `packages/lcyt-web/src/lib/settingsIO.js` — `exportSettings()`, `downloadSettings()`, `importSettings()` functions; integrated into `SettingsPage.jsx`.
- **3c**: `packages/lcyt-web/src/lib/storageKeys.js` — canonical `KEYS` registry with dot-notation keys (`lcyt.{category}.{key}`); `migrateStorageKeys()` runs from `main.jsx` on every load.
- **5a**: `packages/lcyt-web/src/components/CommandPalette.jsx` — modal palette mounted in `SidebarLayout`; Ctrl/Cmd+K opens it; filters all nav items; ArrowUp/Down/Enter/Esc navigation; does not activate while in text inputs.
- **5b**: `packages/lcyt-web/src/components/KeyboardShortcutsHelp.jsx` — overlay mounted in `SidebarLayout`; `?` key opens it (when not in text input); `⌘` and `?` buttons in topbar also trigger it.
- **5c**: `packages/lcyt-web/src/components/sidebar/Sidebar.jsx` — `TopBarBadges` component renders inline badges for YouTube target count, Viewer target count, active input language, and batch interval in the topbar. Responds to `storage`, `lcyt:active-codes-changed`, and `lcyt:input-lang-changed` events.
- **6a**: `packages/lcyt-web/src/components/sidebar/Sidebar.jsx` — `HealthDot` component with latency tooltip, clicking opens `StatusPopover` (`StatusPopover.jsx`) showing full session details including targets and batch info.
- **6b**: `packages/lcyt-web/src/hooks/useSession.js` — `_scheduleReconnect()` with exponential backoff (2 s → 4 s → 8 s → 16 s → 30 s max); triggered by `session_closed` SSE event; `reconnecting` state drives `ReconnectBanner` in `SidebarLayout.jsx`.
- **6c**: `packages/lcyt-web/src/contexts/AppProviders.jsx` lines 113-126 — `beforeunload` listener checks `getQueuedCount()`; fires native browser dialog only when there are pending queued captions.
- **7a**: `packages/lcyt-web/src/components/SentPanel.jsx` — windowed rendering using scroll position; renders only visible rows ± OVERSCAN (10) buffer; activates above VIRTUAL_THRESHOLD (100) entries; uses padding spacers to maintain full scroll height.
- **7b**: `packages/lcyt-web/src/contexts/AppProviders.jsx` — `ConnectionContext`, `CaptionContext`, `SessionApiContext` each expose a focused slice of session state; consumers re-render only when their slice changes.
- **7c**: `packages/lcyt-web/src/main.jsx` lines 15-57 — every sidebar page (`DskEditorPage`, `ProductionOperatorPage`, `DashboardPage`, etc.) is wrapped in `React.lazy()` with `<Suspense fallback={null}>`.

---

## Known issues / follow-up

- **Duplicate header on `/captions`**: The SidebarLayout TopBar and the old `StatusBar` (from `AppLayout`) both render. This is expected for Phase 1. Phase 2/3 will unify them — the `StatusBar` will be removed once its buttons (Settings, CC, Controls) move to the sidebar pages and `QuickActionsPopover`.
- **Mobile drawer aria**: The `MobileDrawer` renders the sidebar even when closed (off-screen via `transform`). This adds a second nav to the accessibility tree. Solution: add `aria-hidden="true"` to the closed drawer.
- **`/graphics/control` in sidebar**: The original `DskControlPage` reads the API key from the URL (`/dsk-control/:apikey`). The sidebar route reads no URL param — it uses the session API key from context. Currently this uses the existing `DskControlPage` which may show an empty state if not accessed via the original URL.
