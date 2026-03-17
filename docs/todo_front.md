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

## Phase 1b — Dashboard dockable panel grid ⬜ To Do

Install `react-grid-layout` and implement the draggable/resizable dashboard widget grid.

| Task | Status |
|------|--------|
| Install `react-grid-layout` | ⬜ To Do |
| `DashboardCard.jsx` — card wrapper (header, collapse, remove, drag handle) | ⬜ To Do |
| `StatusWidget.jsx` | ⬜ To Do |
| `SentLogWidget.jsx` | ⬜ To Do |
| `InputWidget.jsx` — mini text input + send | ⬜ To Do |
| `FilePreviewWidget.jsx` | ⬜ To Do |
| `AudioMeterWidget.jsx` | ⬜ To Do |
| `ViewerWidget.jsx` — independent SSE to `/viewer/:key` | ⬜ To Do |
| `BroadcastWidget.jsx` | ⬜ To Do |
| `PanelPicker.jsx` — `[+ Add]` checkbox dropdown | ⬜ To Do |
| `useDashboardConfig.js` — panels[], layouts{}, localStorage persistence | ⬜ To Do |
| `dashboard.css` — grid + card + widget styles | ⬜ To Do |
| Empty dashboard state (no panels configured) | ⬜ To Do |
| Default panels: `status`, `sent-log`, `input` | ⬜ To Do |

---

## Phase 2 — Move content into sidebar pages ⬜ To Do

Replace stub pages with real implementations. Move modal content to full pages.

| Task | Status |
|------|--------|
| `/audio` page — promote `AudioPanel` to full page | ⬜ To Do |
| `/broadcast` page — move `BroadcastModal` content here | ⬜ To Do |
| Remove old `BroadcastModal` (or keep as deprecated fallback) | ⬜ To Do |
| Remove duplicate topbar on `/captions` (Phase 2 cleanup) | ⬜ To Do |

---

## Phase 3 — Unified settings page + QuickActionsPopover ⬜ To Do

| Task | Status |
|------|--------|
| `/settings` page — Connection, Targets, Audio & STT, Translations, Broadcast, Appearance, Account, Advanced tabs | ⬜ To Do |
| Merge `SettingsModal` + `CCModal` content into `/settings` | ⬜ To Do |
| `QuickActionsPopover` in TopBar — replaces `ControlsPanel` modal | ⬜ To Do |
| Remove `SettingsModal`, `CCModal`, `ControlsPanel` (or keep as deprecated) | ⬜ To Do |

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
| 2a | Guided setup wizard for first-time users | P1 | ⬜ To Do |
| 2b | Empty-state guidance in captions view | P1 | ⬜ To Do |
| 3b | Settings export/import (JSON) | P3 | ⬜ To Do |
| 3c | Normalize localStorage keys (`lcyt.{category}.{key}`) | P3 | ⬜ To Do |
| 5a | Command palette (Ctrl/Cmd+K) | P2 | ⬜ To Do |
| 5b | Keyboard shortcuts help overlay | P2 | ⬜ To Do |
| 5c | Status bar enrichment (target count, language badge, batch badge) | P2 | ⬜ To Do |
| 6a | Connection health dot in topbar (latency tooltip) | P1 | ⬜ To Do |
| 6b | Auto-reconnect with backoff on session expiry | P0 | ⬜ To Do |
| 6c | Unsaved work protection (`beforeunload` guard) | P0 | ⬜ To Do |
| 7a | Virtual scrolling for `SentPanel` | P3 | ⬜ To Do |
| 7b | Context splitting (`SessionContext` → Connection/Caption/SessionApi) | P2 | ⬜ To Do |
| 7c | Lazy-load heavy pages (`DskEditorPage`, `ProductionOperatorPage`) | P3 | ⬜ To Do |

---

## Known issues / follow-up

- **Duplicate header on `/captions`**: The SidebarLayout TopBar and the old `StatusBar` (from `AppLayout`) both render. This is expected for Phase 1. Phase 2/3 will unify them — the `StatusBar` will be removed once its buttons (Settings, CC, Controls) move to the sidebar pages and `QuickActionsPopover`.
- **Mobile drawer aria**: The `MobileDrawer` renders the sidebar even when closed (off-screen via `transform`). This adds a second nav to the accessibility tree. Solution: add `aria-hidden="true"` to the closed drawer.
- **`/graphics/control` in sidebar**: The original `DskControlPage` reads the API key from the URL (`/dsk-control/:apikey`). The sidebar route reads no URL param — it uses the session API key from context. Currently this uses the existing `DskControlPage` which may show an empty state if not accessed via the original URL.
