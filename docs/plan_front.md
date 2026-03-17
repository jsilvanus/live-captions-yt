# Frontend Flow Improvement Plan

**Date:** 2026-03-17
**Scope:** `packages/lcyt-web` — Browser-based React app

---

## Executive Summary

The lcyt-web frontend has grown organically from a simple captioning tool into a full production platform (captioning + RTMP relay + DSK graphics + production control + user accounts). The UI still reflects its captioning-first heritage: a flat two-panel layout with features stacked into modals. As the product scope expanded, several structural issues have emerged that make the tool harder to learn, harder to navigate, and harder to maintain.

This document identifies concrete problems and proposes targeted improvements grouped into themes, followed by a detailed sidebar navigation specification.

---

## 1. Sidebar Navigation — Detailed Specification

### Design Decisions

- **Responsive default:** Expanded (icon + label, 200px) on desktop (>1024px), collapsed (icon-only, 48px) on mobile/tablet. User can toggle either way; preference persisted in localStorage.
- **All sections always visible:** No progressive disclosure — every section is shown regardless of connection state. Disconnected features show inline hints ("Connect to use this feature") rather than being hidden. This avoids confusion about where features went.
- **Hybrid settings approach:** Settings becomes a full routed page (`/settings`). Quick actions (connect/disconnect, sync, heartbeat) stay as a popover accessible from the header.

### Layout Structure

```
┌──────────────────────────────────────────────────────────────┐
│  [≡]  LCYT                           ● [Sync] [Connect] ⚡  │  ← Top bar (48px)
├────────────────┬─────────────────────────────────────────────┤
│                │                                             │
│  ✏ Captions    │                                             │
│                │                                             │
│  🎤 Audio      │          (page content area)                │
│                │                                             │
│  📡 Broadcast  │                                             │
│                │                                             │
│  🖼 Graphics   │                                             │
│    ├ Editor    │                                             │
│    ├ Control   │                                             │
│    └ Viewports │                                             │
│                │                                             │
│  🎬 Production │                                             │
│    ├ Operator  │                                             │
│    ├ Cameras   │                                             │
│    ├ Mixers    │                                             │
│    └ Bridges   │                                             │
│                │                                             │
│  ────────────  │                                             │
│  👤 Account    │                                             │
│  ⚙ Settings    │                                             │
│                │                                             │
└────────────────┴─────────────────────────────────────────────┘
     200px (expanded)          remaining width
      48px (collapsed)
```

### Collapsed State (48px, icon-only)

```
┌──────┬───────────────────────────────────────────┐
│  ≡   │  LCYT                    ● [Connect] ⚡   │
├──────┼───────────────────────────────────────────┤
│  ✏   │                                           │
│  🎤   │                                           │
│  📡   │                                           │
│  🖼   │          (page content)                   │
│  🎬   │                                           │
│ ──── │                                           │
│  👤   │                                           │
│  ⚙   │                                           │
└──────┴───────────────────────────────────────────┘
 48px
```

- Hover on a collapsed icon shows a tooltip with the section name
- Click navigates to that section's default route
- Sections with sub-pages (Graphics, Production): click goes to default sub-page; no expand in collapsed mode

### Mobile (<768px)

```
┌──────────────────────────────────────────────┐
│  [≡]  LCYT                   ● [Connect] ⚡  │
├──────────────────────────────────────────────┤
│                                              │
│           (page content, full width)         │
│                                              │
│                                              │
│                                              │
└──────────────────────────────────────────────┘

Hamburger [≡] opens a slide-over drawer:
┌──────────────────┬───────────────────────────┐
│                  │                           │
│  ✏ Captions      │    (dimmed page behind)   │
│  🎤 Audio        │                           │
│  📡 Broadcast    │                           │
│  🖼 Graphics ▾   │                           │
│    ├ Editor      │                           │
│    ├ Control     │                           │
│    └ Viewports   │                           │
│  🎬 Production ▾ │                           │
│    ├ Operator    │                           │
│    ├ Cameras     │                           │
│    ├ Mixers      │                           │
│    └ Bridges     │                           │
│  ────────────    │                           │
│  👤 Account      │                           │
│  ⚙ Settings      │                           │
│                  │                           │
└──────────────────┴───────────────────────────┘
      280px              backdrop (click to close)
```

Drawer auto-closes on navigation. Swipe-left to dismiss.

### Route Map

All sidebar routes share a common layout shell (`SidebarLayout`) with the top bar + sidebar. Public/embed routes remain standalone.

#### Sidebar routes (inside `SidebarLayout`)

| Sidebar item | Route | Component | Notes |
|---|---|---|---|
| **Captions** | `/` | `CaptionsPage` | Current `App.jsx` two-panel layout (files + input + sent log) |
| **Audio** | `/audio` | `AudioPage` | Current `AudioPanel` promoted to full page; STT engine picker, mic controls, waveform, language |
| **Broadcast** | `/broadcast` | `BroadcastPage` | Current `BroadcastModal` content (Encoder / YouTube / Stream tabs) as a full page |
| **Graphics → Editor** | `/graphics/editor` | `DskEditorPage` | Existing component, now inside sidebar shell |
| **Graphics → Control** | `/graphics/control` | `DskControlPage` | Existing component; `:key` from session context instead of URL |
| **Graphics → Viewports** | `/graphics/viewports` | `DskViewportsPage` | Existing component, now inside sidebar shell |
| **Production → Operator** | `/production` | `ProductionOperatorPage` | Existing component, now inside sidebar shell |
| **Production → Cameras** | `/production/cameras` | `ProductionCamerasPage` | Existing component, now inside sidebar shell |
| **Production → Mixers** | `/production/mixers` | `ProductionMixersPage` | Existing component, now inside sidebar shell |
| **Production → Bridges** | `/production/bridges` | `ProductionBridgesPage` | Existing component, now inside sidebar shell |
| **Account** | `/account` | `AccountPage` | Login/Register (if anonymous) or Projects list (if logged in) |
| **Settings** | `/settings` | `SettingsPage` | Unified settings — all tabs (see Section 3) |

#### Standalone routes (NO sidebar, full-screen)

| Route | Component | Reason |
|---|---|---|
| `/view/:key` | `ViewerPage` | Public viewer — needs full screen, no chrome |
| `/dsk/:key` | `DskPage` | Public green-screen overlay — no chrome, transparent bg |
| `/embed/*` | `Embed*Page` | Iframe widgets — must be minimal, no sidebar |
| `/mcp/:sessionId` | `SpeechCapturePage` | AI-driven session — standalone |
| `/login` | `LoginPage` | Kept as standalone for direct-link access (also accessible via `/account`) |
| `/register` | `RegisterPage` | Kept as standalone for direct-link access (also accessible via `/account`) |

### Top Bar

The top bar (48px) is shared across all sidebar routes:

```
[≡]  LCYT              ● health    [⚡ Quick Actions ▾]    [Connect / Disconnect]
```

| Element | Behavior |
|---------|----------|
| **[≡] Hamburger** | Toggle sidebar expanded/collapsed (desktop); open drawer (mobile) |
| **LCYT** | Brand text; click → navigate to `/` (Captions) |
| **● Health dot** | Green = connected + healthy; Yellow = connected + high latency; Red = disconnected. Hover shows tooltip: "Connected to api.lcyt.fi · 42ms latency · seq #127" |
| **[⚡ Quick Actions]** | Dropdown/popover with: Sync clock, Heartbeat, Reset sequence, Set sequence, Caption codes. These are the current `ControlsPanel` actions — too transient for a full page |
| **[Connect / Disconnect]** | Primary action button; same behavior as current `StatusBar` connect button |

### Sidebar Component Architecture

```
SidebarLayout
├── TopBar
│   ├── HamburgerButton
│   ├── BrandLink
│   ├── HealthDot
│   ├── QuickActionsPopover     ← replaces ControlsPanel modal
│   └── ConnectButton
├── Sidebar
│   ├── SidebarItem (Captions)       → "/"
│   ├── SidebarItem (Audio)          → "/audio"
│   ├── SidebarItem (Broadcast)      → "/broadcast"
│   ├── SidebarGroup (Graphics)
│   │   ├── SidebarItem (Editor)     → "/graphics/editor"
│   │   ├── SidebarItem (Control)    → "/graphics/control"
│   │   └── SidebarItem (Viewports)  → "/graphics/viewports"
│   ├── SidebarGroup (Production)
│   │   ├── SidebarItem (Operator)   → "/production"
│   │   ├── SidebarItem (Cameras)    → "/production/cameras"
│   │   ├── SidebarItem (Mixers)     → "/production/mixers"
│   │   └── SidebarItem (Bridges)    → "/production/bridges"
│   ├── SidebarDivider
│   ├── SidebarItem (Account)        → "/account"
│   └── SidebarItem (Settings)       → "/settings"
└── PageContent                       ← router outlet
```

### Router Choice

Use **`wouter`** (lightweight, ~1.5KB) rather than `react-router` (heavier). It supports:
- Path patterns with params (`/graphics/control` etc.)
- `useLocation()` hook for active-state highlighting
- `<Link>` component for SPA navigation
- Nested routes via `<Router base="...">` or flat route list
- No extra dependencies

### Sidebar State Persistence

| Key | Value | Default |
|-----|-------|---------|
| `lcyt.sidebar.expanded` | `boolean` | `true` on desktop, `false` on mobile |
| `lcyt.sidebar.graphics.open` | `boolean` | `false` (sub-group collapsed) |
| `lcyt.sidebar.production.open` | `boolean` | `false` (sub-group collapsed) |

### Active State Highlighting

- Exact match: `SidebarItem` for `/` only highlights on exact `/`
- Prefix match: `SidebarItem` for `/production/cameras` highlights on that path
- Group auto-open: navigating to `/graphics/editor` auto-expands the Graphics group
- Active item: bold text + left accent border (4px, `var(--color-accent)`)

### Disconnected Hints

When not connected, pages that require a session show an inline banner at the top of the page content:

```
┌─────────────────────────────────────────────────┐
│ ⚠ Not connected. Connect to a backend to use    │
│ this feature.                     [Connect now]  │
└─────────────────────────────────────────────────┘
```

The page content still renders (read-only / skeleton state) so users can explore what's available.

### Migration Path (from current UI)

1. **Phase 1:** Add `wouter` router + `SidebarLayout` shell. Mount current `App.jsx` at `/` inside the shell. All other sidebar routes initially render placeholder "Coming soon" or redirect.
2. **Phase 2:** Move `BroadcastModal` content → `/broadcast` page. Move `AudioPanel` → `/audio` page. Mount existing DSK/Production pages inside sidebar shell.
3. **Phase 3:** Create `/settings` page (merge SettingsModal + CCModal). Replace `ControlsPanel` with `QuickActionsPopover` in top bar.
4. **Phase 4:** Create `/account` page (merge Login/Register/Projects). Remove old standalone `/login` and `/register` (or redirect to `/account`).

---

## 2. Onboarding & First-Run Experience

### Problem

A first-time user lands on the main captioning UI with an empty file viewer, an input bar, and a blocking Privacy modal. After accepting privacy terms, nothing guides them. They must discover that:
1. They need a backend URL and API key (or create an account at `/register`)
2. They need to click "Settings" to enter credentials
3. They need to click "Connect"
4. They need to configure caption targets in the CC modal before captions go anywhere
5. They need to load a file or type text to send captions

There is no wizard, no empty-state guidance, and no contextual help.

### Proposals

**2a. Guided setup flow for new users.** When no config is persisted (`lcyt-config` absent from localStorage), show a step-by-step setup instead of the raw UI:

```
Step 1: Server — Enter backend URL (or use default)
Step 2: Auth — Enter API key, or create account / sign in
Step 3: Target — Add at least one caption target (YouTube / Viewer / Generic)
Step 4: Test — Send a test caption to verify the connection
→ Done — Show main UI
```

Store a `lcyt:onboarded` flag so returning users skip this.

**2b. Empty-state guidance** in the main view. When no file is loaded and no session is active, show contextual cards:
- "Drop a caption file here or create a new one"
- "Connect to start sending captions" (with a Connect button inline)
- Links to documentation / embed setup / DSK editor

**2c. Inline tooltips / help text** on first use of each feature. Use a `lcyt:hints-dismissed` set in localStorage to avoid repeating.

---

## 3. Settings & Configuration Architecture

### Problem

Configuration is split across multiple modals and localStorage keys with no central registry:
- **SettingsModal** — backend URL, API key, theme, text size, advanced mode
- **CCModal** — targets, STT engine, translations, file downloads
- **ControlsPanel** — sequence control, sync, caption codes, file actions, clear config
- **BroadcastModal** — encoder, YouTube OAuth, RTMP relay
- 30+ localStorage keys (`lcyt:*`, `lcyt-*`, `lcyt-config`, etc.)

Users must remember which modal contains which setting. "Clear config" in ControlsPanel is destructive with no undo. There is no settings export/import for migrating between browsers or devices.

### Proposals

**3a. Unified settings page** (a dedicated route, e.g. `/settings`) with a tabbed layout:

| Tab | Contents |
|-----|----------|
| **Connection** | Backend URL, API key, auto-connect, health status |
| **Targets** | YouTube / Viewer / Generic target CRUD (currently in CCModal) |
| **Audio & STT** | STT engine, language, VAD, utterance settings |
| **Translations** | Translation pairs, vendor, format |
| **Broadcast** | Encoder control, RTMP relay, YouTube OAuth |
| **Appearance** | Theme, text size, language, advanced mode |
| **Account** | User info, password change, projects link |
| **Advanced** | Sequence control, sync, caption codes, clear config |

Keep a quick-access "Connect/Disconnect" button in the header — but move all configuration to a single location.

**3b. Settings export/import.** Add "Export settings" (downloads JSON) and "Import settings" (uploads JSON) to the settings page. Useful for:
- Team deployments (share a config JSON with all operators)
- Device migration (laptop to phone)
- Troubleshooting (share config with support)

Exclude sensitive fields (API key, passwords) from export by default, with an opt-in toggle.

**3c. Normalize localStorage keys.** Adopt a consistent naming convention (e.g. all `lcyt.{category}.{key}`) and create a central `storage.js` module that all features use. This makes export/import trivial and prevents key collisions.

---

## 4. Layout & Responsive Design

### Problem

The two-panel layout (file viewer left, sent log right) works well for the captioning use case but doesn't adapt to other modes. When using Audio/STT, the audio panel is hidden on mobile. When managing RTMP relays, the file viewer is irrelevant but still occupies space. The production operator panel is a completely separate page with no access to the caption input.

Panel resize is manual (drag handle) and the resize state is lost when switching between pages.

### Proposals

**4a. Context-aware layout modes.** Let the active section determine the panel layout:

| Mode | Left panel | Right panel |
|------|-----------|-------------|
| **Caption (file)** | File viewer + pointer | Sent log |
| **Caption (audio)** | Audio waveform / STT status | Sent log |
| **Broadcast** | RTMP relay / Encoder config | Stream status + logs |
| **Graphics** | DSK editor canvas | Template list / properties |
| **Production** | Operator surface (camera/mixer grid) | Caption input (mini) |

This avoids showing irrelevant panels and gives each mode the space it needs.

**4b. Detachable panels.** Allow the sent log (and other panels) to be "popped out" into a separate browser window or moved to a different position. The embed page infrastructure (`BroadcastChannel`) already supports this — expose it as a first-class feature with a "Pop out" button on each panel.

**4c. Mobile-first redesign for the caption flow.** The current mobile experience hides the file viewer and shows a `MobileAudioBar` at the bottom. This works for voice input but not for file-based captioning. Consider:
- A swipeable card layout: swipe left for file viewer, center for input, swipe right for sent log
- Bottom sheet for file tabs (pull up to select, swipe down to dismiss)
- Floating action button for quick actions (send, sync, load file)

---

## 5. Feature Discovery & Workflow Integration

### Problem

Power features are hidden:
- **Caption codes** (language override, no-translate, custom metadata) — buried in Controls panel
- **Batch mode** — a checkbox in CC modal with no visual indication until you notice the badge
- **DSK metacodes** (`<!-- graphics:... -->`) — only documented, no UI assistance
- **Embed widgets** — no mention in the main app unless you open Broadcast modal
- **Viewer target** — configured in CC targets but the viewer URL isn't shown prominently
- **Keyboard shortcuts** — not documented anywhere in the UI
- **File pointer semantics** (arrow keys navigate, Enter sends current line) — discovered by accident

### Proposals

**5a. Command palette** (Ctrl/Cmd+K). A searchable command list that surfaces all actions:
- "Send heartbeat", "Sync clock", "Reset sequence"
- "Open DSK editor", "Switch to production mode"
- "Set language to Finnish", "Toggle batch mode"
- "Show keyboard shortcuts"

This is the standard power-user discoverability pattern (VS Code, Figma, Linear).

**5b. Keyboard shortcuts help** — a `?` shortcut (or Ctrl+/) that shows a shortcuts overlay. Current shortcuts (arrows, Enter, Tab, Ctrl+1..9, Ctrl+,) should all be listed.

**5c. Status bar enrichment.** The current status bar only shows connect state. Add:
- Active target count (e.g. "2 targets")
- Current language override indicator
- Batch queue badge
- Mic status (claimed/unclaimed for collaborative sessions)
- A subtle "what's new" indicator when features are added

**5d. Inline DSK metacode helper.** When the cursor is in the input bar and the user types `<!--`, offer an autocomplete dropdown for DSK metacodes with available template names and viewport names fetched from the backend.

**5e. Workflow presets.** Let users save and restore named workflow configurations:
- "Sunday service" — specific API key, file loaded, viewer target, Finnish language
- "Conference" — multiple YouTube targets, English + Finnish translations, batch mode
- "Testing" — localhost backend, viewer target only

Store as JSON in localStorage (and optionally sync to backend per user account).

---

## 6. Error Handling & Resilience

### Problem

- Network errors show a toast and retry silently every 30 seconds. There is no visible indication that the connection is degraded.
- 401 errors auto-disconnect with a toast — but if the user was mid-broadcast, this is catastrophic. No auto-reconnect is attempted.
- File operations (load, save, raw edit) can fail silently on localStorage quota exceeded.
- Batch mode queues captions in memory — a page reload or accidental close loses them.
- The BroadcastChannel coordination for embed pages fails silently cross-origin.

### Proposals

**6a. Connection health indicator** in the header — a colored dot (green/yellow/red) with hover tooltip showing latency and last successful send time. Yellow for degraded (high latency or retries), red for disconnected.

**6b. Auto-reconnect with backoff** on session expiry or network drop. Show a "Reconnecting..." banner with a manual "Reconnect now" button. Preserve the target configuration so the user doesn't have to reconfigure after a reconnect.

**6c. Unsaved work protection.** Before unload (`beforeunload`), check for:
- Pending batch queue items
- Unsaved raw-edit changes
- Active STT session

Show a browser confirmation dialog if any are detected.

**6d. localStorage quota monitoring.** Before writing, check `navigator.storage.estimate()` (where available). If quota is low, warn the user and suggest clearing old sent logs or removing unused files.

---

## 7. Performance

### Problem

- CaptionView already has virtual scrolling for 500+ lines, but sent log (SentPanel) doesn't — it renders all entries and relies on CSS overflow.
- All contexts re-render on any state change (no `useMemo` or selector pattern).
- The full App component tree mounts even when most panels are hidden.

### Proposals

**7a. Virtual scrolling for SentPanel** when entries exceed 100 items (same pattern as CaptionView).

**7b. Context splitting.** Split `SessionContext` (623 lines) into smaller, focused contexts:
- `ConnectionContext` — connected state, health, connect/disconnect
- `CaptionContext` — send, sendBatch, sequence, syncOffset
- `SessionApiContext` — stats, files, RTMP, YouTube config

This prevents caption-send re-renders from triggering settings UI re-renders.

**7c. Lazy-load heavy pages.** Use `React.lazy()` + `Suspense` for:
- DskEditorPage (large canvas + template logic)
- ProductionOperatorPage (camera/mixer grid)
- BroadcastModal (encoder control, YouTube API)

---

## Implementation Priority

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| **P0** | 1 Phase 1: `wouter` router + `SidebarLayout` shell | High — foundation for everything | Medium |
| **P0** | 1 Phase 2: Move Broadcast/Audio/DSK/Production into sidebar | High — unifies navigation | Medium |
| **P0** | 6b. Auto-reconnect | High — prevents mid-broadcast failures | Low |
| **P0** | 6c. Unsaved work protection | High — prevents data loss | Low |
| **P1** | 1 Phase 3: `/settings` page (merge modals) + QuickActions popover | Medium — reduces confusion | Medium |
| **P1** | 1 Phase 4: `/account` page (merge Login/Register/Projects) | Medium — unified auth flow | Low |
| **P1** | 2a. Guided setup flow | High — unblocks new users | Medium |
| **P1** | 6a. Connection health dot in top bar | Low-Medium — operational awareness | Low |
| **P2** | 5a. Command palette | Medium — power user productivity | Medium |
| **P2** | 4a. Context-aware layout modes per section | Medium — better use of screen space | High |
| **P2** | 5b. Keyboard shortcuts help | Low — discoverability | Low |
| **P2** | 7b. Context splitting | Low — performance improvement | Medium |
| **P3** | 4b. Detachable panels | Low — niche use case | Medium |
| **P3** | 4c. Mobile-first redesign | Medium — mobile usability | High |
| **P3** | 3b. Settings export/import | Low — convenience | Low |
| **P3** | 5e. Workflow presets | Low — convenience | Medium |
| **P3** | 5d. DSK metacode helper | Low — niche | Medium |
| **P3** | 7a. Virtual scrolling SentPanel | Low — edge case | Low |
| **P3** | 7c. Lazy-load heavy pages | Low — marginal gains | Low |

---

## Summary

The frontend has solid foundations: clean context-based state management, a flexible embed system, and strong keyboard support. The main gaps are **discoverability** (new users can't find features), **navigation** (features live in disconnected modals and separate pages), and **resilience** (no auto-reconnect, no unsaved-work protection).

The central change is the **sidebar navigation** (Section 1): a responsive collapsible sidebar using `wouter` for SPA routing. It unifies all features — Captions, Audio, Broadcast, Graphics, Production, Account, Settings — into a single navigable shell. All sections are always visible (greyed-out hints when disconnected), the sidebar auto-collapses on mobile into a slide-over drawer, and settings become a full page while quick actions (sync, heartbeat, caption codes) live in a top-bar popover.

The 4-phase migration path allows incremental delivery: Phase 1 (router + shell) → Phase 2 (move existing pages into shell) → Phase 3 (unified settings page) → Phase 4 (unified account page). Combined with auto-reconnect (P0) and a guided setup flow (P1), this transforms the frontend from a captioning tool with bolted-on features into a cohesive production platform.
