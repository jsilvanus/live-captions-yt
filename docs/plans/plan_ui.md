---
id: plan/ui
title: "Frontend & UI Plans"
status: in-progress
summary: "Four iterations of frontend UI planning: v1 (two-column layout, superseded), v2 (sidebar navigation + dashboard, core implemented), v3 (component split, completed), v4 (two-phase login + feature-based UI, implemented). Remaining P1: guided setup (implemented as /setup wizard), empty-state guidance."
---

# Frontend & UI Plans — `packages/lcyt-web`

This document combines three iterations of frontend UI planning for `packages/lcyt-web`, presented chronologically with the latest version last.

---
---

## v1 — UI Reorganisation (Two-Column Layout)

**Date:** 2026-03-17 (pre-sidebar era)
**Status:** Draft — largely superseded by v2 (sidebar navigation)

---

## Goals

Redesign `packages/lcyt-web` to give desktop and mobile users a cleaner,
purpose-built layout:

- **Desktop**: two-column; audio lives compactly at the bottom of the left
  column; footer holds the input bar and a mic toggle button; Privacy moves
  into the status bar.
- **Mobile**: single column with a fixed audio bar at the very bottom; a
  floating FAB to send the current caption line; status bar wraps into two
  rows (info + buttons); everything else scrolls in between.

---

## Target Layouts

### Desktop / Landscape (≥ 768 px)

```
┌─────────────────────────────────────────────────────────────────┐
│  lcyt-web  ● Connected  Seq: 42  Offset: 0ms   [⟳] [Privacy] [⚙] │  ← header
├──────────────────────────────────┬──────────────────────────────┤
│  ┌── Drop Zone ────────────────┐ │                              │
│  │  📄 Drop text files here    │ │  SENT CAPTIONS               │
│  └─────────────────────────────┘ │  #1 ✓✓ 12:30:01 Hello       │
│  [file.txt ×] [+]  [space] [⇩]  │  #2 ✓  12:30:02 World       │
│  ───────────────────────────────  │  ...                        │
│  Line 1                           │                              │
│  Line 2  ◄  active (bold, border) │                              │
│  Line 3                           │                              │
│  ...  (flex: 1, scrollable)       │                              │
│                                   │                              │
│  ── Audio panel (when 🎵 open) ── │                              │
│  [🎙 Click to Caption]  [======]  │                              │
│  [interim text / hint / error…]   │                              │
├──────────────────────────────────┴──────────────────────────────┤
│  [Caption input field………………………………………………………][▶]  [🎵]        │  ← footer
└─────────────────────────────────────────────────────────────────┘
```

Key points:
- Privacy button is now in the **status bar** (right of ⚙).
- The **audio tab** in FileTabs is removed; audio is opened by `🎵` in the
  footer instead.
- The audio panel expands at the **bottom of the left column** (border-top,
  auto height — no resize handle needed).
- Desktop audio panel shows: toggle button + level meter + live-text box
  (interim in muted colour, placeholder when waiting).
- Caption view and audio panel coexist; caption view takes `flex: 1`.
- Right panel (Sent Captions) is always visible at 40 % width.

### Mobile / Portrait (< 768 px)

```
┌────────────────────────────┐
│  lcyt-web  ● Connected     │  ← status info row
│  [⟳ Sync] [Privacy] [⚙]   │  ← actions row (wraps at < 480 px, already done)
├────────────────────────────┤
│  📄 Drop text files here   │  ← Drop Zone (collapsible)
├────────────────────────────┤
│  [file.txt ×] [+]  [⇩]    │  ← File Tabs (no audio tab)
├────────────────────────────┤
│  Line 1                    │  ← Caption View (max-height: 30vh, scrollable)
│  Line 2  ◄ active          │
│  Line 3                    │
├────────────────────────────┤
│  SENT CAPTIONS             │  ← Sent Panel (flex: 1, scrollable)
│  #1 ✓✓ 12:30:01 Hello      │
│  ...                       │
├────────────────────────────┤  ← fixed bottom bar (replaces desktop footer)
│  [🎵 Audio]                │
└────────────────────────────┘
                          [►]  ← FAB "send current line"
                               only visible when a file is loaded
                               bottom-right by default; side toggleable in Settings

Audio panel (slides up above the fixed bar when 🎵 is pressed):
┌────────────────────────────┐
│ [🎙 Click to Caption] [==] │  ← button + meter only (no live-text box)
├────────────────────────────┤
│  [🎵 Audio]                │
└────────────────────────────┘
```

Key points:
- `#footer` becomes the desktop-only input bar; on mobile it is replaced by a
  `#mobile-audio-bar` (fixed, full-width, height ~52 px).
- The mobile audio panel is a **fixed bottom sheet** that translates into view
  above the bar; it shows only the toggle button and level meter.
- The live-text box is **hidden on mobile** (CSS `display: none` at < 768 px).
- The **FAB** is `position: fixed`, bottom-right (or left), shown only when
  `fileStore.activeFile` is non-null. Pressing it calls
  `inputBarRef.current?.triggerSend()`.
- Caption View is capped at `max-height: 30vh` on mobile to leave room for
  the Sent Panel.
- The `▦` "toggle sent panel" button in the status bar is **removed** — the
  Sent Panel is always in the scroll flow on mobile.

---

## Prerequisite Step

Before any code changes:

```bash
git fetch origin copilot/sub-pr-36
git merge origin/copilot/sub-pr-36
# resolve any conflicts, then continue
```

This brings in:
- `useSession.js` — `CLIENT_ID`, `micHolder`, `claimMic`, `releaseMic`, SSE
  listeners for `connected` and `mic_state`.
- `AudioPanel.jsx` — `iHaveMic`/`otherHasMic` derived state, auto-stop
  effect, `toggle()` with claim/release, `onHoldStart`/`onHoldEnd`
  hold-to-steal (2 s), locked button render path.
- `components.css` — `.audio-caption-btn--locked`,
  `.audio-caption-btn--holding`, `@keyframes mic-hold-fill`.

---

## Files to Change

### 1. `packages/lcyt-web/src/App.jsx`

**State**
- Remove `currentView` / `setCurrentView` state.
- Add `audioOpen` / `setAudioOpen` boolean (default `false`).
- Keep `dropZoneVisible`, `settingsOpen`, `privacyOpen`, `rightPanelVisible`
  (desktop right-panel toggle stays for now; it may become unused).

**Left panel**
- `CaptionView` is always rendered (remove the `display: none` / view-swap).
- `AudioPanel` is always rendered; pass `visible={audioOpen}` (same prop name,
  no AudioPanel refactor needed for visibility gating).

**Footer (desktop)**
- Remove the `<button className="privacy-btn">` — Privacy moves to StatusBar.
- Add an audio toggle `<button>` after `<InputBar>`:
  ```jsx
  <button
    className={`footer__audio-btn${audioOpen ? ' footer__audio-btn--active' : ''}`}
    onClick={() => setAudioOpen(v => !v)}
    title="Toggle microphone / STT"
  >🎵</button>
  ```

**Mobile bottom bar**
- Render `<div id="mobile-audio-bar">` outside `#app`'s normal flow (or as a
  sibling inside `#app`); it is `position: fixed` via CSS on mobile.
- Contains the same audio toggle button and logic.

**FAB**
- Inline `SendLineFAB` component (no separate file needed):
  ```jsx
  function SendLineFAB({ inputBarRef }) {
    const { activeFile } = useFileContext();
    const [side, setSide] = useState(
      () => localStorage.getItem('lcyt:fabSide') || 'right'
    );
    useEffect(() => {
      function onCfg() { setSide(localStorage.getItem('lcyt:fabSide') || 'right'); }
      window.addEventListener('lcyt:stt-config-changed', onCfg);
      return () => window.removeEventListener('lcyt:stt-config-changed', onCfg);
    }, []);
    if (!activeFile) return null;
    return (
      <button
        className={`send-fab send-fab--${side}`}
        onClick={() => inputBarRef.current?.triggerSend()}
        title="Send current line"
      >►</button>
    );
  }
  ```
- Rendered at the bottom of `AppLayout` (after `<ToastContainer />`); CSS
  makes it fixed and visible only on mobile.

**Props passed down**
- `StatusBar` now receives `onPrivacyOpen` in addition to `onSettingsOpen`.
- `FileTabs` no longer receives `currentView` / `onViewChange` (audio-related).
- `FileTabs` still receives `dropZoneVisible` / `onToggleDropZone`.

---

### 2. `packages/lcyt-web/src/components/StatusBar.jsx`

- Add `onPrivacyOpen` prop.
- Add Privacy button inside the existing `.status-bar__actions` div, between
  the ⟳ Sync button and the ⚙ Settings button:
  ```jsx
  <button className="status-bar__btn" onClick={onPrivacyOpen} title="Privacy">
    Privacy
  </button>
  ```
- Remove the mobile-only `▦` "toggle sent panel" button (no longer needed;
  Sent Panel is always in scroll flow on mobile).
- Remove the `isMobile` / `onToggleRightPanel` prop and associated state.

---

### 3. `packages/lcyt-web/src/components/FileTabs.jsx`

- Remove the `currentView` and `onViewChange` props.
- Remove the entire audio tab `<button className="file-tab file-tab--audio">`,
  including the `window.dispatchEvent('lcyt:audio-toggle-request')` logic.
- Active file tab state becomes: `activeId === file.id` (no `currentView`
  dependency needed).
- Keep everything else unchanged.

---

### 4. `packages/lcyt-web/src/components/AudioPanel.jsx`

**Remove from inline UI (move to Settings)**
- The `<div className="audio-field">` block containing the microphone
  `<select>` and Refresh button. The `selectedDeviceId` / `devices` state and
  `enumerateDevices` function move to `SettingsModal`.
- The engine badge (`<div className="audio-engine-badge">`). Engine is already
  selectable in Settings.

**Keep (do not touch)**
- All mic lock logic: `isHolding`, `holdTimerRef`, `iHaveMic`, `otherHasMic`,
  `claimMic`, `releaseMic`, `onHoldStart`, `onHoldEnd`, `toggle()`.
- Auto-stop `useEffect` on `micHolder`.
- `lcyt:audio-toggle-request` / `lcyt:audio-toggle-response` event handlers
  (FileTabs no longer dispatches these, but keeping them is harmless and
  costs nothing).
- The full locked/holding button render path with `onPointerDown/Up/Leave/Cancel`.
- The live-text box (`audio-caption-live`) — CSS will hide it on mobile.

**New compact layout structure**

Replace the current `<div className="audio-panel__scroll"><section …>` tree
with a flat compact row + optional live box:

```jsx
<div className="audio-panel">
  <div className="audio-panel__row">
    {/* Toggle / locked button */}
    {otherHasMic ? (
      <button
        className={`btn audio-caption-btn audio-caption-btn--locked${isHolding ? ' audio-caption-btn--holding' : ''}`}
        disabled={!canStart}
        onPointerDown={onHoldStart}
        onPointerUp={onHoldEnd}
        onPointerLeave={onHoldEnd}
        onPointerCancel={onHoldEnd}
      >
        {isHolding ? '🎙 Hold…' : '🔒 Another mic is active'}
      </button>
    ) : (
      <button
        className={`btn audio-caption-btn${listening ? ' audio-caption-btn--active' : ' btn--primary'}`}
        disabled={!canStart}
        onClick={toggle}
      >
        {listening ? '⏹ Stop' : '🎙 Caption'}
      </button>
    )}

    {/* Level meter — always visible when panel is open */}
    <canvas
      ref={meterCanvasRef}
      className="audio-meter"
      aria-hidden="true"
    />
  </div>

  {/* Hint / error line */}
  {(hint || cloudError) && (
    <p className={`audio-panel__hint${cloudError ? ' audio-panel__hint--error' : ''}`}>
      {cloudError || hint}
    </p>
  )}

  {/* Live transcription box — hidden on mobile via CSS */}
  {listening && (
    <div className="audio-caption-live audio-caption-live--compact">
      {interimText
        ? <span className="audio-caption-interim">{interimText}</span>
        : <span className="audio-caption-placeholder">
            {isWebkit ? 'Listening…' : 'Sending to Google Cloud STT…'}
          </span>
      }
    </div>
  )}
</div>
```

`selectedDeviceId` is still read from `localStorage` in the `startWebkit` /
`startCloud` functions (the value is written there by SettingsModal), so
removing the selector from the panel UI does not break mic selection.

---

### 5. `packages/lcyt-web/src/components/SettingsModal.jsx`

**Add to STT / Audio tab** (insert after the engine selector, before Language):

```jsx
{/* Microphone device */}
<div className="settings-field">
  <label className="settings-field__label">Microphone</label>
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <select
      className="settings-field__input"
      style={{ appearance: 'auto', flex: 1 }}
      value={selectedMicId}
      onChange={e => {
        setSelectedMicId(e.target.value);
        try { localStorage.setItem('lcyt:audioDeviceId', e.target.value); } catch {}
        window.dispatchEvent(new Event('lcyt:stt-config-changed'));
      }}
    >
      <option value="">Default device</option>
      {micDevices.map(d => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || d.deviceId}
        </option>
      ))}
    </select>
    <button type="button" className="btn" onClick={refreshMics}>Refresh</button>
  </div>
</div>
```

State additions at the top of `SettingsModal`:
```js
const [micDevices, setMicDevices] = useState([]);
const [selectedMicId, setSelectedMicId] = useState(
  () => { try { return localStorage.getItem('lcyt:audioDeviceId') || ''; } catch { return ''; } }
);

async function refreshMics() {
  if (!navigator?.mediaDevices?.enumerateDevices) return;
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    setMicDevices(list.filter(d => d.kind === 'audioinput'));
  } catch {}
}

// Enumerate on open
useEffect(() => { if (isOpen) refreshMics(); }, [isOpen]);
```

**Add to Advanced tab** (or Captions tab) — FAB side setting:

```jsx
<div className="settings-field">
  <label className="settings-field__label">Send-line button side (mobile)</label>
  <div className="stt-engine-list">
    {[
      { value: 'right', label: 'Right' },
      { value: 'left',  label: 'Left'  },
    ].map(opt => (
      <label key={opt.value}
        className={`stt-engine-option${fabSide === opt.value ? ' stt-engine-option--active' : ''}`}
      >
        <input type="radio" name="fab-side" value={opt.value}
          checked={fabSide === opt.value}
          onChange={() => {
            setFabSide(opt.value);
            try { localStorage.setItem('lcyt:fabSide', opt.value); } catch {}
            window.dispatchEvent(new Event('lcyt:stt-config-changed'));
          }}
          className="stt-engine-option__radio"
        />
        <div className="stt-engine-option__body">
          <span className="stt-engine-option__name">{opt.label}</span>
        </div>
      </label>
    ))}
  </div>
</div>
```

State addition:
```js
const [fabSide, setFabSide] = useState(
  () => { try { return localStorage.getItem('lcyt:fabSide') || 'right'; } catch { return 'right'; } }
);
```

---

### 6. `packages/lcyt-web/src/styles/layout.css`

**Desktop additions**

```css
/* Audio panel docked at bottom of left column */
.audio-panel {
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Footer audio toggle button */
.footer__audio-btn {
  flex-shrink: 0;
  /* full styles in components.css */
}
```

**Mobile overrides (inside `@media (max-width: 768px)`)**

```css
/* App grid: header auto, main flex:1, no desktop footer */
#app {
  grid-template-rows: auto 1fr 0;   /* footer height = 0; mobile bar is fixed */
}

#footer {
  display: none;   /* hidden on mobile; replaced by #mobile-audio-bar */
}

/* Main area scrolls */
#main {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

/* Left panel: normal flow, no fixed height */
.panel--left {
  flex-shrink: 0;
}

/* Caption view capped on mobile */
#left-panel .caption-view {
  max-height: 30vh;
}

/* Audio panel: hide when panel not open (handled by visible prop),
   but when open on mobile it becomes a fixed bottom sheet */
.audio-panel {
  position: fixed;
  bottom: var(--mobile-bar-height, 52px);
  left: 0;
  right: 0;
  z-index: 50;
  transform: translateY(100%);
  transition: transform 0.25s ease;
  border-top: 1px solid var(--color-border);
  border-radius: 12px 12px 0 0;
  box-shadow: 0 -4px 20px rgba(0,0,0,0.3);
}

.audio-panel--open {
  transform: translateY(0);
}

/* Live text box: hidden on mobile */
.audio-caption-live--compact {
  display: none;
}

/* Right panel: normal flow in scroll area, modest min-height */
.panel--right {
  min-height: 28vh;
  border-top: 1px solid var(--color-border);
}

/* Fixed bottom audio bar */
#mobile-audio-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--mobile-bar-height, 52px);
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  z-index: 60;
}

/* Pad main content so it doesn't hide behind the fixed bar */
#main {
  padding-bottom: var(--mobile-bar-height, 52px);
}

/* FAB — visible only on mobile */
.send-fab {
  position: fixed;
  bottom: calc(var(--mobile-bar-height, 52px) + 16px);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  /* colours in components.css */
}

.send-fab--right { right: 16px; }
.send-fab--left  { left:  16px; }
```

**CSS variable addition (`:root`)**

```css
--mobile-bar-height: 52px;
```

---

### 7. `packages/lcyt-web/src/styles/components.css`

**Audio panel compact row**

```css
.audio-panel__row {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Compact button in the panel row */
.audio-panel .audio-caption-btn {
  flex: 1;
  padding: 8px 12px;
  font-size: 14px;
}

/* Meter fills remaining horizontal space */
.audio-panel .audio-meter {
  flex: 1;
  max-width: 120px;
  height: 20px;
  border-radius: 3px;
  background: var(--color-surface-elevated);
}

.audio-panel__hint {
  font-size: 12px;
  color: var(--color-text-dim);
  margin: 0;
}

.audio-panel__hint--error {
  color: var(--color-error);
}
```

**Footer audio toggle button**

```css
.footer__audio-btn {
  flex-shrink: 0;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-dim);
  font-size: 18px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, color 0.15s;
}

.footer__audio-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.footer__audio-btn--active {
  border-color: var(--color-warning);
  color: var(--color-warning);
}
```

**Mobile audio bar button (full-width on mobile)**

```css
#mobile-audio-bar .footer__audio-btn {
  flex: 1;
  width: auto;
  font-size: 14px;
  gap: 8px;
}
```

**FAB**

```css
/* Desktop: FAB hidden */
.send-fab {
  display: none;
}

@media (max-width: 768px) {
  .send-fab {
    display: flex;
    background: var(--color-accent);
    border: none;
    color: #fff;
    font-size: 18px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    cursor: pointer;
    transition: transform 0.1s, background 0.15s;
  }

  .send-fab:active {
    transform: scale(0.92);
    background: var(--color-accent-dim);
  }
}
```

**Preserve mic lock styles** — the existing blocks below must remain untouched:

```css
.audio-caption-btn--locked { … }
.audio-caption-btn--holding { … }
@keyframes mic-hold-fill { … }
```

---

## What Is Explicitly Not Changed

| Item | Reason |
|---|---|
| `useSession.js` mic lock logic | Already correct from PR #37; no UI work touches it |
| `AudioPanel` `toggle()` claim/release | Must stay atomic; not simplified |
| `AudioPanel` `onHoldStart`/`onHoldEnd` | Hold-to-steal UX stays identical |
| Backend `/mic` route | Server-side only; out of scope |
| Settings modal tab horizontal scroll | Already fixed in `feb1f51`; preserved |
| `CaptionView`, `SentPanel`, `DropZone` | Internal logic unchanged |
| All existing context providers | No changes needed |

---

## Implementation Order

1. Merge `origin/copilot/sub-pr-36` onto feature branch.
2. `SettingsModal.jsx` — add mic device selector + FAB side toggle.
3. `StatusBar.jsx` — add Privacy button, remove ▦ toggle button.
4. `FileTabs.jsx` — remove audio tab and window-event toggle logic.
5. `AudioPanel.jsx` — compact layout, remove inline mic selector/engine badge.
6. `layout.css` — desktop audio panel docking, full mobile restructure.
7. `components.css` — compact audio panel styles, footer button, FAB, mobile bar.
8. `App.jsx` — wire everything together: `audioOpen` state, FAB, mobile bar,
   updated prop passing, Privacy in StatusBar.
9. Smoke-test desktop and mobile layouts, verify mic lock button states still
   render correctly.
10. Commit and push to `claude/reorganize-ui-layout-jE7Rv`.

---
---

## v2 — Frontend Flow Improvement (Sidebar Navigation + Dashboard)

**Date:** 2026-03-17
**Status:** In progress — core sidebar, dashboard, settings page, route restructuring all implemented. Remaining P0/P1 items (auto-reconnect, unsaved work protection) pending.

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
│  🏠 Dashboard  │                                             │
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
│  📁 Projects   │                                             │
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
│  🏠   │                                           │
│  ✏   │                                           │
│  🎤   │                                           │
│  📡   │                                           │
│  🖼   │          (page content)                   │
│  🎬   │                                           │
│ ──── │                                           │
│  📁   │                                           │
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
│  🏠 Dashboard    │    (dimmed page behind)   │
│  ✏ Captions      │                           │
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
│  📁 Projects     │                           │
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
| **Dashboard** | `/` | `DashboardPage` | Dockable mini-panel grid (see Section 1b) |
| **Captions** | `/captions` | `CaptionsPage` | Current `App.jsx` two-panel layout (files + input + sent log) |
| **Audio** | `/audio` | `AudioPage` | Current `AudioPanel` promoted to full page; STT engine picker, mic controls, waveform, language |
| **Broadcast** | `/broadcast` | `BroadcastPage` | Current `BroadcastModal` content (Encoder / YouTube / Stream tabs) as a full page |
| **Graphics → Editor** | `/graphics/editor` | `DskEditorPage` | Existing component, now inside sidebar shell |
| **Graphics → Control** | `/graphics/control` | `DskControlPage` | Existing component; `:key` from session context instead of URL |
| **Graphics → Viewports** | `/graphics/viewports` | `DskViewportsPage` | Existing component, now inside sidebar shell |
| **Production → Operator** | `/production` | `ProductionOperatorPage` | Existing component, now inside sidebar shell |
| **Production → Cameras** | `/production/cameras` | `ProductionCamerasPage` | Existing component, now inside sidebar shell |
| **Production → Mixers** | `/production/mixers` | `ProductionMixersPage` | Existing component, now inside sidebar shell |
| **Production → Bridges** | `/production/bridges` | `ProductionBridgesPage` | Existing component, now inside sidebar shell |
| **Projects** | `/projects` | `ProjectsPage` | Each project = one API key = the session; projects can be shared across multiple users and/or teams. Shows the user's own projects when logged in; prompts login/register when anonymous. |
| **Account** | `/account` | `AccountPage` | Login/Register (if anonymous) or user profile/password when logged in |
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
| **LCYT** | Brand text; click → navigate to `/` (Dashboard) |
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
│   ├── SidebarItem (Dashboard)      → "/"
│   ├── SidebarItem (Captions)       → "/captions"
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
│   ├── SidebarItem (Projects)       → "/projects"      ← each project = one API key = the session
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

- Exact match: `SidebarItem` for `/` (Dashboard) only highlights on exact `/`
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

1. **Phase 1:** Add `wouter` router + `SidebarLayout` shell. Mount current `App.jsx` at `/captions` inside the shell. Create `DashboardPage` at `/`. All other sidebar routes initially render placeholder "Coming soon" or redirect.
2. **Phase 2:** Move `BroadcastModal` content → `/broadcast` page. Move `AudioPanel` → `/audio` page. Mount existing DSK/Production pages inside sidebar shell.
3. **Phase 3:** Create `/settings` page (merge SettingsModal + CCModal). Replace `ControlsPanel` with `QuickActionsPopover` in top bar.
4. **Phase 4:** Move `ProjectsPage` into the sidebar shell at `/projects` (above Account). Create `/account` page for user profile and password management. Projects are the primary entry point — each project is an API key that doubles as the session credential and can be shared by multiple users and/or teams. Remove old standalone `/login` and `/register` (or redirect to `/account`).

---

### 1b. Dashboard Page (`/`) — Dockable Panel Grid

The Dashboard is the landing page. It shows a configurable grid of mini-panels — lightweight, read-mostly versions of the main pages. Users can add, remove, rearrange, and resize panels.

#### Grid Library

Use **`react-grid-layout`** (~40KB) for drag-to-reorder and resize. It provides:
- Drag handles on panel headers
- Responsive breakpoints (lg/md/sm/xs)
- Persisted layouts (serialize to localStorage)
- Collision detection and auto-compaction

Install: `npm install react-grid-layout -w packages/lcyt-web`

#### Dashboard Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Dashboard                                          [+ Add]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Status ──────────┐  ┌─ Sent Log ────────────────────┐   │
│  │ ● Connected       │  │ ✓✓ Hello world        12:01   │   │
│  │ api.lcyt.fi       │  │ ✓  Testing 123        12:02   │   │
│  │ Seq: 127          │  │ ⏳ New caption...      12:03   │   │
│  │ Targets: 2 YT     │  │                               │   │
│  └───────────────────┘  └───────────────────────────────┘   │
│                                                              │
│  ┌─ Quick Send ──────────────────────────────────────────┐   │
│  │ [Type a caption...                        ] [Send]    │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─ File Preview ────┐  ┌─ Broadcast ───────────────────┐   │
│  │ sermon.txt  L42   │  │ Encoder: ● idle               │   │
│  │   41: ...         │  │ Relay: 2/3 slots active       │   │
│  │ > 42: Current ln  │  │ RTMP: receiving               │   │
│  │   43: ...         │  └───────────────────────────────┘   │
│  └───────────────────┘                                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Panels are draggable by their header bar and resizable from the bottom-right corner.

#### Available Widgets

| Widget ID | Title | Content | Min size (grid units) | Default size |
|-----------|-------|---------|----------------------|--------------|
| `status` | Status | Connection dot, backend URL, sequence, sync offset, target count | 2x2 | 3x3 |
| `sent-log` | Sent Log | Last 10 captions with status icons (pending/confirmed/error) | 3x2 | 4x4 |
| `input` | Quick Send | Text input + send button, language badge | 3x1 | 6x1 |
| `file-preview` | File Preview | Active filename, pointer, ~5 lines around cursor with highlight | 2x3 | 3x4 |
| `audio-meter` | Audio | Mic toggle + level meter canvas + interim text | 2x2 | 3x2 |
| `viewer` | Viewer | Subscribe to `/viewer/:key` SSE, show last 5 captions | 3x2 | 4x3 |
| `broadcast` | Broadcast | Encoder status dot, RTMP relay slot count, active/inactive | 2x2 | 3x2 |

#### Panel Card Component (`DashboardCard`)

Each widget is wrapped in a card:

```
┌─ Title ─────────────────── [_] [✕] ─┐
│                                       │  ← drag handle (header)
│  (widget content)                     │
│                                       │
└───────────────────────────── ◢ resize ┘
```

- **Header:** title text (left), collapse `[_]` and remove `[✕]` buttons (right). Header is the drag handle.
- **Body:** widget content. Hidden when collapsed.
- **Resize handle:** bottom-right corner (provided by react-grid-layout).
- **Collapsed state:** header-only, 1 grid row height.

#### Panel Picker (`[+ Add]` button)

Clicking `[+ Add]` in the dashboard header opens a dropdown/popover:

```
┌─ Add panels ─────────────────┐
│ ☑ Status                     │
│ ☑ Sent Log                   │
│ ☑ Quick Send                 │
│ ☐ File Preview               │
│ ☐ Audio                      │
│ ☐ Viewer                     │
│ ☐ Broadcast                  │
└──────────────────────────────┘
```

Checked = currently on dashboard. Toggle to add/remove.

#### "Pin to Dashboard" from Main Pages

Each main page header (when sidebar navigation is implemented) gets a small pin icon:

```
Captions                              [📌]
```

- Unpinned (outline): click → adds the corresponding widget(s) to dashboard
- Pinned (filled): click → removes from dashboard
- Mapping: Captions → `file-preview` + `input`, Audio → `audio-meter`, Broadcast → `broadcast`

The pin state is read from the same `useDashboardConfig()` hook.

#### Config Persistence

**localStorage key:** `lcyt.dashboard`

```json
{
  "panels": ["status", "sent-log", "input"],
  "layouts": {
    "lg": [
      { "i": "status", "x": 0, "y": 0, "w": 3, "h": 3 },
      { "i": "sent-log", "x": 3, "y": 0, "w": 4, "h": 4 },
      { "i": "input", "x": 0, "y": 3, "w": 6, "h": 1 }
    ],
    "md": [...],
    "sm": [...]
  }
}
```

`panels` array controls which widgets are visible. `layouts` is the react-grid-layout serialized layout per breakpoint. Both updated on every layout change and persisted.

**Default panels** (first visit, no config): `status`, `sent-log`, `input`.

#### Data Flow

All widgets share the existing context tree — no separate sessions or connections:

```
AppProviders (SessionContext, FileContext, SentLogContext, ToastContext)
└── SidebarLayout
    └── DashboardPage
        └── ResponsiveGridLayout (react-grid-layout)
            ├── DashboardCard key="status"
            │   └── StatusWidget        → reads SessionContext
            ├── DashboardCard key="sent-log"
            │   └── SentLogWidget       → reads SentLogContext
            ├── DashboardCard key="input"
            │   └── InputWidget         → reads/writes SessionContext
            ├── DashboardCard key="file-preview"
            │   └── FilePreviewWidget   → reads FileContext
            ├── DashboardCard key="audio-meter"
            │   └── AudioMeterWidget    → Web Audio API + SessionContext
            ├── DashboardCard key="viewer"
            │   └── ViewerWidget        → independent EventSource
            └── DashboardCard key="broadcast"
                └── BroadcastWidget     → reads SessionContext
```

Exception: `ViewerWidget` creates its own `EventSource` to `/viewer/:key` (same pattern as `ViewerPage`). The viewer key comes from the target config in `SessionContext`.

#### Empty Dashboard

When no panels are configured:

```
┌──────────────────────────────────────────────┐
│                                              │
│  Welcome to LCYT                             │
│                                              │
│  Add panels to build your dashboard.         │
│                                              │
│  [+ Add panels]       [Go to Captions →]     │
│                                              │
└──────────────────────────────────────────────┘
```

#### New Files

| File | Purpose | ~LOC |
|------|---------|------|
| `src/components/DashboardPage.jsx` | Page: grid layout + panel picker + empty state | ~150 |
| `src/components/dashboard/DashboardCard.jsx` | Card wrapper: header, collapse, remove, drag handle | ~60 |
| `src/components/dashboard/StatusWidget.jsx` | Mini status: connection, seq, targets | ~50 |
| `src/components/dashboard/SentLogWidget.jsx` | Mini sent log: last 10 entries | ~60 |
| `src/components/dashboard/InputWidget.jsx` | Mini input: text field + send button | ~50 |
| `src/components/dashboard/FilePreviewWidget.jsx` | Mini file viewer: name, pointer, 5 lines | ~60 |
| `src/components/dashboard/AudioMeterWidget.jsx` | Mini audio: mic toggle + meter | ~80 |
| `src/components/dashboard/ViewerWidget.jsx` | Mini viewer: SSE, last 5 captions | ~80 |
| `src/components/dashboard/BroadcastWidget.jsx` | Mini broadcast: encoder + relay status | ~50 |
| `src/components/dashboard/PanelPicker.jsx` | Add-panel checkbox dropdown | ~60 |
| `src/hooks/useDashboardConfig.js` | Config CRUD hook (panels, layouts, localStorage) | ~70 |
| `src/styles/dashboard.css` | Dashboard grid, card, widget styles | ~120 |

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

## Implementation Status & Priority

> **Last audited: 2026-03-27**

### ✅ Done

| Item | Notes |
|------|-------|
| **1 Phase 1** — `wouter` router + `SidebarLayout` shell + Dashboard at `/` | `SidebarLayout.jsx` implemented with `HealthDot`, `QuickActionsPopover`, `StatusPopover`, hamburger, connect button, collapse persistence (`lcyt.ui.sidebarExpanded`) |
| **1b** — Dashboard dockable panel grid | `DashboardPage.jsx` + `dashboard/` folder: `DashboardCard`, `StatusWidget`, `SentLogWidget`, `InputWidget`, `FileWidget`, `AudioWidget`, `BroadcastWidget`, `ViewerWidget`, `ViewportsWidget`, `PanelPicker` |
| **1 Phase 2** — All pages moved into sidebar shell | `/captions`, `/audio` (`AudioPage`), `/broadcast` (`BroadcastPage`), `/graphics/editor`, `/graphics/control`, `/graphics/viewports`, `/production`, `/production/cameras`, `/production/mixers`, `/production/bridges` all mounted inside `SidebarLayout` |
| **1 Phase 3** — `/settings` page + `QuickActionsPopover` | `SettingsPage.jsx` with General / CC / I/O tabs. `QuickActionsPopover` in top bar replaces old ControlsPanel modal |
| **1 Phase 4** — `/projects` sidebar entry + `/account` profile | `ProjectsPage` at `/projects`; `AccountPage` at `/account` (login prompt or profile + change-password) |
| **3b** — Settings export/import | `settingsIO.js` + I/O tab in `SettingsPage` (`downloadSettings` / `importSettings`) |
| **3c** — Normalize localStorage keys | `storageKeys.js` — all keys under `lcyt.{category}.{key}` convention |
| **6a** — Connection health dot in top bar | `HealthDot` + `StatusPopover` in `SidebarLayout` (latency, seq, targets, uptime) |
| **6b. Auto-reconnect with backoff** | Exponential backoff (2s → 30s max), "Reconnecting…" banner, preserves target config, `reconnectNow()` for manual retry |
| **6c. Unsaved work protection** | `beforeunload` guard when batch queue has pending items |
| **7b. Context splitting** | `SessionContext` split into `ConnectionContext` / `CaptionContext` / `SessionApiContext` — reduces re-renders |
| **8a. Two-phase login** | `LoginPage` rewritten: backend preset selector (Normal/Minimal/Custom) → probe `/health` → feature-aware auth (login form for full backends, API key for minimal) |
| **8b. Feature-based sidebar** | Sidebar nav items and groups annotated with `feature` property; filtered by `backendFeatures` from `ConnectionContext`. Minimal backends hide Broadcast, Graphics, Production, Projects, Account |

### 🟠 P1 — Next up

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| **P1** | **2a. Guided setup flow** — step-by-step wizard (server → auth → target → test) when no config exists; `lcyt:onboarded` flag skips for returning users | High — unblocks new users | Medium |
| **P1** | **2b. Empty-state guidance** — contextual cards in Dashboard/Captions when no file loaded and no session active | Medium — reduces confusion for new users | Low |

### 🟡 P2 — Nice to have

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| **P2** | **5a. Command palette** (Ctrl/Cmd+K) — searchable action list (sync, heartbeat, language, DSK, shortcuts) | Medium — power user productivity | Medium |
| **P2** | **4a. Context-aware layout modes** — left/right panel content adapts to active section (Caption/Audio/Broadcast/Graphics/Production) | Medium — better screen use | High |
| **P2** | **5b. Keyboard shortcuts help** (`?` or Ctrl+/) — overlay listing all shortcuts | Low — discoverability | Low |

### 🔵 P3 — Backlog

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| **P3** | **4b. Detachable panels** — "Pop out" button on panels using `BroadcastChannel` (infrastructure already exists) | Low — niche use case | Medium |
| **P3** | **4c. Mobile-first redesign** — swipeable card layout for captions, bottom sheet for file tabs, FAB for quick actions | Medium — mobile usability | High |
| **P3** | **5e. Workflow presets** — named localStorage configs (e.g. "Sunday service") | Low — convenience | Medium |
| **P3** | **5d. DSK metacode helper** — `<!--` autocomplete in input bar fetching template/viewport names | Low — niche | Medium |
| **P3** | **7a. Virtual scrolling SentPanel** — only needed when entries > 100 | Low — edge case | Low |
| **P3** | **7c. Lazy-load heavy pages** — `React.lazy()` for DskEditorPage, ProductionOperatorPage, BroadcastModal | Low — marginal gains | Low |
| **P3** | **2c. Inline hints on first use** — `lcyt:hints-dismissed` set, tooltips on feature first touch | Low — nice to have | Low |
| **P3** | **6d. localStorage quota monitoring** — `navigator.storage.estimate()` warning | Low — edge case | Low |

---

## Summary

The frontend has solid foundations: clean context-based state management, a flexible embed system, and strong keyboard support.

**As of 2026-03-27, the structural foundation and feature-based UI are complete.** The two-phase login (backend preset selection → `/health` probe → feature-aware login/API-key flow) gates the entire UI. Backend features (`backendFeatures` from `ConnectionContext`) drive sidebar navigation visibility: minimal backends (Python) show only Dashboard, Captions, Audio, and Settings; full-featured backends (Node.js) show the complete sidebar including Broadcast, Graphics, Production, Projects, and Account. Auto-reconnect with exponential backoff, unsaved-work protection, and context splitting are all shipped. The remaining work is onboarding (guided setup, empty-state cards) and power-user features (command palette, context-aware layouts, keyboard shortcuts help).

---
---

## v3 — Component Split

**Date:** 2026-03-26
**Status:** Completed (all high, medium, and low priority items done)



This document identifies monolithic components in `packages/lcyt-web/src/components/`
that should be split into smaller, potentially shared, pieces. Priorities are ranked
**High / Medium / Low** based on component size, duplication, and testability benefit.

---

## Background: Shared panels already extracted

As of the setup-wizard PR the following shared panels exist under `components/panels/`:

| Panel | Lines | Used in |
|---|---|---|
| `TargetRow.jsx` / `TargetsPanel.jsx` | 130 / 45 | `CCModal`, wizard |
| `TranslationPanel.jsx` | 120 | `CCModal`, wizard |
| `RelaySlotRow.jsx` / `RelayPanel.jsx` | 100 / 80 | `SettingsModal`, wizard |
| `CeaCaptionsPanel.jsx` | 30 | wizard |
| `EmbedPanel.jsx` | 30 | wizard |
| `SttPanel.jsx` | 70 | wizard |
| `ReviewSummary.jsx` | 55 | wizard |

These panels are the **reference pattern**: pure data components with `onChange` props,
no wizard or modal state, no side-effects. New splits should follow this pattern.

---

## 1. `CCModal.jsx` — 1 400 lines → ~600 lines  ⚡ High

CCModal has already been migrated to use shared panels for the Targets and Translation tabs.
Two more sections can be extracted.

### 1a. Service tab → `panels/ServicePanel.jsx` (~280 lines)

The **Service** tab contains the STT engine picker, mic selector, language selector,
on-device local model toggle, utterance-end controls, Google Cloud STT model/options/
confidence/credential fields, and the Server STT section (provider, language, audio
source, confidence threshold, auto-start, start/stop controls).

**Extract:**
```
components/panels/ServicePanel.jsx
```

Props:
```
sttEngine, onSttEngineChange,
selectedMicId, onMicIdChange, micDevices, onRefreshMics,
sttLang, onSttLangChange,
sttLocal, onSttLocalChange, localAvailability,
utteranceEndButton, onUtteranceEndButtonChange,
utteranceEndTimer, onUtteranceEndTimerChange,
cloudModel, onCloudModelChange,
cloudPunctuation, onCloudPunctuationChange,
cloudProfanity, onCloudProfanityChange,
cloudConfidence, onCloudConfidenceChange,
cloudMaxLen, onCloudMaxLenChange,
credential, onCredentialLoad, onCredentialClear, credError,
serverStt: { provider, lang, audioSource, autoStart, confidenceThreshold, running,
             busy, error, whepAvailable },
onServerSttChange, onServerSttStart, onServerSttStop,
advancedMode, connected,
```

**Caller change in `CCModal.jsx`:**
```jsx
{activeTab === 'service' && (
  <div className="settings-panel settings-panel--active">
    <ServicePanel {...serviceProps} />
  </div>
)}
```

**Testability benefit:** ServicePanel can be unit-tested without the full CCModal
state machine. The server STT start/stop logic can be tested with mock session props.

### 1b. Details tab → `panels/DetailsPanel.jsx` (~80 lines)

The **Details** tab contains the batch window slider, transcription offset slider,
and client VAD settings (enable, silence duration, energy threshold).

**Extract:**
```
components/panels/DetailsPanel.jsx
```

Props:
```
batchInterval, onBatchIntervalChange, batchLocked,
transcriptionOffset, onTranscriptionOffsetChange,
vadEnabled, onVadEnabledChange,
vadSilenceMs, onVadSilenceMsChange,
vadThreshold, onVadThresholdChange,
```

---

## 2. `DskEditorPage.jsx` — 1 755 lines → ~350 lines  ⚡ High

The DSK visual editor is the largest file in the codebase. Most of its bulk is in
helper functions and sub-components that can live in their own files.

### 2a. Geometry helpers → `lib/dskEditorGeometry.js`

Pure functions (no React) currently at the top of the file:

- `handleAnchor(handle, layer)`
- `applyResize(handle, startRect, dx, dy)`
- `gridSnap(v)`
- `snapToLayerEdges(tentX, tentY, primaryLayer, allLayers, movingIds)`
- `getLayerViewportPos(layer, selectedViewport)`

**Extract:**
```
lib/dskEditorGeometry.js
```

Benefit: pure functions are trivially unit-testable.

### 2b. Preset templates → `lib/dskEditorPresets.js`

The `PRESETS` array (lines 131–185, ~55 lines) is constant data. Move to a module.

**Extract:**
```
lib/dskEditorPresets.js
```

### 2c. `TemplatePreview` → `dsk-editor/TemplatePreview.jsx`

The `TemplatePreview` component (~245 lines, lines 252–476) renders the live
canvas preview of a template (drag+drop, resize handles, selection, snap lines).
It has its own `useEffect`/`useCallback` hooks and is logically self-contained.

**Extract:**
```
components/dsk-editor/TemplatePreview.jsx
```

Props: `template, selectedIds, onSelect, onLayerUpdate, selectedViewport,
serverUrl, onAddTextLayer` (derive from current usage).

### 2d. `AnimationEditor` → `dsk-editor/AnimationEditor.jsx`

Animation editor sub-component (~65 lines, lines 543–606) with its helper
`parseAnimation`/`buildAnimation` functions.

**Extract:**
```
components/dsk-editor/AnimationEditor.jsx
lib/dskEditorAnimation.js   (parseAnimation, buildAnimation)
```

### 2e. `LayerPropertyEditor` → `dsk-editor/LayerPropertyEditor.jsx`

The property editor panel (~130 lines, lines 657–780) reads and writes individual
layer fields (text content, font, color, border-radius, etc.).

**Extract:**
```
components/dsk-editor/LayerPropertyEditor.jsx
```

### 2f. Resulting `DskEditorPage.jsx` (~350 lines)

After extractions the main component retains: state management (template, selection,
drag state, viewport selection), layer CRUD actions, toolbar JSX, and composition of
the extracted sub-components.

---

## 3. `AudioPanel.jsx` — 1 071 lines → ~350 lines  ⚡ High

A single 1 071-line component with 58 hook calls — the highest hook density in the
codebase. All logic and rendering live in one `export function AudioPanel`.

### 3a. Audio level meter → `audio/AudioLevelMeter.jsx`

The animated audio level bar and peak hold logic. Currently inline; used only inside
`AudioPanel`.

### 3b. STT engine selection UI → reuse `panels/ServicePanel.jsx`

Once `ServicePanel` is extracted from `CCModal` (item 1a), the STT engine picker,
mic selector, language selector, and advanced options can be composed from the same
panel inside the AudioPanel inline settings popover rather than duplicated.

### 3c. WebSpeech recognition state machine → `hooks/useWebSpeech.js`

The `SpeechRecognition` lifecycle (start, stop, error recovery, interim/final results,
`onresult` dispatch, restart-on-error backoff) is ~200 lines of state management. Extract
into a hook.

```js
// hooks/useWebSpeech.js
export function useWebSpeech({ lang, continuous, onInterim, onFinal, enabled })
// Returns: { status, start, stop }
```

### 3d. Resulting `AudioPanel.jsx` (~350 lines)

Retains: UI layout, popover state, record button, progress bar, composition of
`AudioLevelMeter`, `useWebSpeech`.

---

## 4. `BroadcastModal.jsx` — 833 lines  📌 Medium

BroadcastModal already splits content across three tab-level functions
(`EncoderTab`, `StreamTab`, `YouTubeTab`) that live in the same file.

### 4a. Extract tab functions to own files

```
components/broadcast/EncoderTab.jsx    (~165 lines)
components/broadcast/StreamTab.jsx     (~185 lines)
components/broadcast/YouTubeTab.jsx    (~245 lines)
```

Each file becomes an independent component with its own imports and local state.

### 4b. `StreamTab` to use shared `RelayPanel`

`BroadcastModal.StreamTab` (line 202) has a local `RelayRow` that duplicates
`panels/RelaySlotRow.jsx`. Replace:

```jsx
// components/broadcast/StreamTab.jsx
import { RelayPanel } from '../panels/RelayPanel.jsx';
// Remove local RelayRow and RtmpUrlField functions
```

### 4c. `BroadcastModal.jsx` shell (~80 lines)

After extraction, `BroadcastModal.jsx` retains only the tab switcher, modal
open/close logic, and lazy-loaded tab imports.

---

## 5. `SidebarLayout.jsx` — 709 lines  📌 Medium

Already has internal sub-functions but all live in one file. The component
handles both the navigation shell and several complex popovers.

### 5a. `StatusPopover` → `sidebar/StatusPopover.jsx` (~70 lines)

The session-status popover (connection info, API key/URL, disconnect button).

### 5b. `QuickActionsPopover` → `sidebar/QuickActionsPopover.jsx` (~200 lines)

The Quick Actions popover (send commands, file ops, etc.) is large enough to
warrant its own file and test.

### 5c. `TopBar` → `sidebar/TopBar.jsx` (~30 lines)

The horizontal top bar (hamburger menu, logo, popover buttons).

### 5d. `Sidebar` + `SidebarGroup` + `SidebarItem` → `sidebar/Sidebar.jsx`

The navigation list with group collapsing. Includes nav config constant
(move to `sidebar/navConfig.js`).

### 5e. Resulting `SidebarLayout.jsx` (~150 lines)

Retains: layout grid, mobile state, drawer, reconnect banner, composition.

---

## 6. `DskViewportsPage.jsx` — 862 lines  📌 Medium

Already has sub-components defined at the bottom of the file. Extract them:

### 6a. `TextLayersEditor` → `dsk-viewports/TextLayersEditor.jsx` (~130 lines)

The editor for per-viewport static text overlay layers, with its helper
`TextLayerMiniPreview`.

### 6b. `ImageSettingsTable` → `dsk-viewports/ImageSettingsTable.jsx` (~45 lines)

Per-image settings table (z-index, animation, etc.).

### 6c. `ImageRow` → `dsk-viewports/ImageRow.jsx` (~50 lines)

Single image accordion row.

### 6d. Resulting `DskViewportsPage.jsx` (~600 lines)

Retains: viewport CRUD, SSE connection, API calls, composition of extracted
sub-components.

---

## 7. `CaptionsModal.jsx` — 639 lines  🔵 Low

Three tabs: **Model** (STT cloud config), **VAD** (voice activity detection), **Other**
(caption post-processing). Can be split once `ServicePanel` exists.

### 7a. Model tab content

The Model tab overlaps significantly with the cloud section of `ServicePanel` (item 1a).
After `ServicePanel` is extracted, `CaptionsModal`'s Model tab can be refactored to
compose from `ServicePanel` rather than duplicating.

### 7b. VAD tab → `panels/VadPanel.jsx` (~70 lines)

VAD settings (enable, silence duration, energy threshold) are already similar to the
Details tab VAD section in CCModal. Extract to a shared panel.

---

## 8. `ControlsPanel.jsx` — 460 lines  🔵 Low

A single export containing playback controls, file navigation, send controls, and
settings shortcuts. Could be split by function group once patterns emerge, but current
size is borderline. Defer unless a clear reuse opportunity arises.

---

## 9. Production pages — 470–523 lines each  🔵 Low

`ProductionCamerasPage`, `ProductionMixersPage`, `ProductionBridgesPage` all follow a
consistent pattern (Form + Row + Page). Already reasonably structured. Main candidate:

### 9a. Shared `ConnectionDot` → `production/ConnectionDot.jsx`

`ConnectionDot` is defined identically in both `ProductionMixersPage` and
`ProductionBridgesPage`. Extract to a shared component.

### 9b. Forms to own files (optional)

`CameraForm` (225 lines), `MixerForm` (255 lines), `AddBridgeForm` / `SendCommandModal`
are large enough to benefit from extraction but are used only once each. Low priority.

---

## Summary table

| File | Before | After | Priority | Status | Key extractions |
|---|---|---|---|---|---|
| `CCModal.jsx` | 1 400 | 468 | **High** | ✅ Done | `ServicePanel`, `DetailsPanel`, `TargetsPanel`, `TranslationPanel` |
| `DskEditorPage.jsx` | 1 755 | 1 350 | **High** | ✅ Done | geometry lib, presets lib, `TemplatePreview`, `AnimationEditor`, `LayerPropertyEditor` |
| `AudioPanel.jsx` | 1 071 | 1 040 | **High** | ✅ Done | `AudioLevelMeter`, `useWebSpeech` |
| `BroadcastModal.jsx` | 833 | 55 | **Medium** | ✅ Done | `EncoderTab`, `StreamTab` (uses `RelayPanel`), `YouTubeTab` |
| `SidebarLayout.jsx` | 709 | 95 | **Medium** | ✅ Done | `StatusPopover`, `QuickActionsPopover`, `TopBar`, `Sidebar`, `navConfig.js` |
| `DskViewportsPage.jsx` | 862 | 493 | **Medium** | ✅ Done | `TextLayersEditor`, `ImageSettingsTable`, `ImageRow`, `styles.js` |
| `CaptionsModal.jsx` | 639 | 602 | **Low** | ✅ Done | `VadPanel` |
| `ControlsPanel.jsx` | 460 | — | **Low** | ⏭ Deferred | defer until clear reuse opportunity |
| Production pages × 3 | 470–523 | ~505 | **Low** | ✅ Done | shared `ConnectionDot` |

---

## Implementation order

1. **`panels/ServicePanel.jsx`** — most reuse potential (CCModal, CaptionsModal, AudioPanel).
2. **`panels/DetailsPanel.jsx` / `panels/VadPanel.jsx`** — small, test immediately.
3. **`dsk-editor/` + `lib/dsk*.js`** — large win for DskEditorPage testability.
4. **`hooks/useWebSpeech.js`** — AudioPanel complexity reduction.
5. **`broadcast/`** — remove third copy of RelayRow.
6. **`sidebar/`** — cosmetic but improves navigation/discoverability.
7. Production pages / ControlsPanel — as needed.

---

## Notes

- Each extraction **must not change observable behaviour**.
- Extract files should have their own `test/components/` file verifying the extracted
  component in isolation.
- Shared panels follow the convention: pure data props + `onChange`, no side-effects,
  no context access except `useLang`.
