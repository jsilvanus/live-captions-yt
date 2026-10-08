---
id: plan/ui
title: "Frontend & UI Plans"
status: in-progress
summary: "Three iterations of frontend UI planning: v1 (two-column layout, superseded), v2 (sidebar navigation + dashboard; core, command palette, keyboard shortcuts help, virtual scrolling, onboarding auto-trigger, localStorage quota monitoring, and the DSK metacode autocomplete helper all implemented; context-aware layout modes reassessed and closed 2026-07-21 â€” its premise was superseded by the routing model, its one real gap (Production caption input) fixed with a new pane type; detachable panels shipped 2026-07-21 for the Sent Captions panel, generalizable to others later; mobile-first redesign's core functional gap (no free-text caption input on mobile) closed 2026-07-21, remaining swipeable-card/bottom-sheet polish optional; only workflow presets still outstanding), v3 (component split, completed)."
---

# Frontend & UI Plans â€” `packages/lcyt-web`

This document combines three iterations of frontend UI planning for `packages/lcyt-web`, presented chronologically with the latest version last.

---
---

## v1 â€” UI Reorganisation (Two-Column Layout)

**Date:** 2026-03-17 (pre-sidebar era)
**Status:** Draft â€” largely superseded by v2 (sidebar navigation)

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

### Desktop / Landscape (â‰¥ 768 px)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  lcyt-web  â— Connected  Seq: 42  Offset: 0ms   [âŸ³] [Privacy] [âš™] â”‚  â† header
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  â”Œâ”€â”€ Drop Zone â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚                              â”‚
â”‚  â”‚  ðŸ“„ Drop text files here    â”‚ â”‚  SENT CAPTIONS               â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚  #1 âœ“âœ“ 12:30:01 Hello       â”‚
â”‚  [file.txt Ã—] [+]  [space] [â‡©]  â”‚  #2 âœ“  12:30:02 World       â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚  ...                        â”‚
â”‚  Line 1                           â”‚                              â”‚
â”‚  Line 2  â—„  active (bold, border) â”‚                              â”‚
â”‚  Line 3                           â”‚                              â”‚
â”‚  ...  (flex: 1, scrollable)       â”‚                              â”‚
â”‚                                   â”‚                              â”‚
â”‚  â”€â”€ Audio panel (when ðŸŽµ open) â”€â”€ â”‚                              â”‚
â”‚  [ðŸŽ™ Click to Caption]  [======]  â”‚                              â”‚
â”‚  [interim text / hint / errorâ€¦]   â”‚                              â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  [Caption input fieldâ€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦â€¦][â–¶]  [ðŸŽµ]        â”‚  â† footer
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

Key points:
- Privacy button is now in the **status bar** (right of âš™).
- The **audio tab** in FileTabs is removed; audio is opened by `ðŸŽµ` in the
  footer instead.
- The audio panel expands at the **bottom of the left column** (border-top,
  auto height â€” no resize handle needed).
- Desktop audio panel shows: toggle button + level meter + live-text box
  (interim in muted colour, placeholder when waiting).
- Caption view and audio panel coexist; caption view takes `flex: 1`.
- Right panel (Sent Captions) is always visible at 40 % width.

### Mobile / Portrait (< 768 px)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  lcyt-web  â— Connected     â”‚  â† status info row
â”‚  [âŸ³ Sync] [Privacy] [âš™]   â”‚  â† actions row (wraps at < 480 px, already done)
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  ðŸ“„ Drop text files here   â”‚  â† Drop Zone (collapsible)
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  [file.txt Ã—] [+]  [â‡©]    â”‚  â† File Tabs (no audio tab)
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Line 1                    â”‚  â† Caption View (max-height: 30vh, scrollable)
â”‚  Line 2  â—„ active          â”‚
â”‚  Line 3                    â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  SENT CAPTIONS             â”‚  â† Sent Panel (flex: 1, scrollable)
â”‚  #1 âœ“âœ“ 12:30:01 Hello      â”‚
â”‚  ...                       â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  â† fixed bottom bar (replaces desktop footer)
â”‚  [ðŸŽµ Audio]                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                          [â–º]  â† FAB "send current line"
                               only visible when a file is loaded
                               bottom-right by default; side toggleable in Settings

Audio panel (slides up above the fixed bar when ðŸŽµ is pressed):
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ [ðŸŽ™ Click to Caption] [==] â”‚  â† button + meter only (no live-text box)
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  [ðŸŽµ Audio]                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
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
- The `â–¦` "toggle sent panel" button in the status bar is **removed** â€” the
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
- `useSession.js` â€” `CLIENT_ID`, `micHolder`, `claimMic`, `releaseMic`, SSE
  listeners for `connected` and `mic_state`.
- `AudioPanel.jsx` â€” `iHaveMic`/`otherHasMic` derived state, auto-stop
  effect, `toggle()` with claim/release, `onHoldStart`/`onHoldEnd`
  hold-to-steal (2 s), locked button render path.
- `components.css` â€” `.audio-caption-btn--locked`,
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
- Remove the `<button className="privacy-btn">` â€” Privacy moves to StatusBar.
- Add an audio toggle `<button>` after `<InputBar>`:
  ```jsx
  <button
    className={`footer__audio-btn${audioOpen ? ' footer__audio-btn--active' : ''}`}
    onClick={() => setAudioOpen(v => !v)}
    title="Toggle microphone / STT"
  >ðŸŽµ</button>
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
      >â–º</button>
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
  the âŸ³ Sync button and the âš™ Settings button:
  ```jsx
  <button className="status-bar__btn" onClick={onPrivacyOpen} title="Privacy">
    Privacy
  </button>
  ```
- Remove the mobile-only `â–¦` "toggle sent panel" button (no longer needed;
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
- The live-text box (`audio-caption-live`) â€” CSS will hide it on mobile.

**New compact layout structure**

Replace the current `<div className="audio-panel__scroll"><section â€¦>` tree
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
        {isHolding ? 'ðŸŽ™ Holdâ€¦' : 'ðŸ”’ Another mic is active'}
      </button>
    ) : (
      <button
        className={`btn audio-caption-btn${listening ? ' audio-caption-btn--active' : ' btn--primary'}`}
        disabled={!canStart}
        onClick={toggle}
      >
        {listening ? 'â¹ Stop' : 'ðŸŽ™ Caption'}
      </button>
    )}

    {/* Level meter â€” always visible when panel is open */}
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

  {/* Live transcription box â€” hidden on mobile via CSS */}
  {listening && (
    <div className="audio-caption-live audio-caption-live--compact">
      {interimText
        ? <span className="audio-caption-interim">{interimText}</span>
        : <span className="audio-caption-placeholder">
            {isWebkit ? 'Listeningâ€¦' : 'Sending to Google Cloud STTâ€¦'}
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

**Add to Advanced tab** (or Captions tab) â€” FAB side setting:

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

/* FAB â€” visible only on mobile */
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

**Preserve mic lock styles** â€” the existing blocks below must remain untouched:

```css
.audio-caption-btn--locked { â€¦ }
.audio-caption-btn--holding { â€¦ }
@keyframes mic-hold-fill { â€¦ }
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
2. `SettingsModal.jsx` â€” add mic device selector + FAB side toggle.
3. `StatusBar.jsx` â€” add Privacy button, remove â–¦ toggle button.
4. `FileTabs.jsx` â€” remove audio tab and window-event toggle logic.
5. `AudioPanel.jsx` â€” compact layout, remove inline mic selector/engine badge.
6. `layout.css` â€” desktop audio panel docking, full mobile restructure.
7. `components.css` â€” compact audio panel styles, footer button, FAB, mobile bar.
8. `App.jsx` â€” wire everything together: `audioOpen` state, FAB, mobile bar,
   updated prop passing, Privacy in StatusBar.
9. Smoke-test desktop and mobile layouts, verify mic lock button states still
   render correctly.
10. Commit and push to `claude/reorganize-ui-layout-jE7Rv`.

---
---

## v2 â€” Frontend Flow Improvement (Sidebar Navigation + Dashboard)

**Date:** 2026-03-17
**Status:** In progress â€” core sidebar, dashboard, settings page, route restructuring, auto-reconnect, unsaved-work protection, command palette, keyboard shortcuts help, and SentPanel virtual scrolling are all implemented (re-audited 2026-07-20, see Implementation Status below). Onboarding auto-trigger, localStorage quota monitoring, the DSK metacode autocomplete helper, context-aware layout modes, detachable panels, and the mobile-first caption flow's core functional gap all shipped 2026-07-21. Only workflow presets remains.

---

## Executive Summary

The lcyt-web frontend has grown organically from a simple captioning tool into a full production platform (captioning + RTMP relay + DSK graphics + production control + user accounts). The UI still reflects its captioning-first heritage: a flat two-panel layout with features stacked into modals. As the product scope expanded, several structural issues have emerged that make the tool harder to learn, harder to navigate, and harder to maintain.

This document identifies concrete problems and proposes targeted improvements grouped into themes, followed by a detailed sidebar navigation specification.

---

## 1. Sidebar Navigation â€” Detailed Specification

### Design Decisions

- **Responsive default:** Expanded (icon + label, 200px) on desktop (>1024px), collapsed (icon-only, 48px) on mobile/tablet. User can toggle either way; preference persisted in localStorage.
- **All sections always visible:** No progressive disclosure â€” every section is shown regardless of connection state. Disconnected features show inline hints ("Connect to use this feature") rather than being hidden. This avoids confusion about where features went.
- **Hybrid settings approach:** Settings becomes a full routed page (`/settings`). Quick actions (connect/disconnect, sync, heartbeat) stay as a popover accessible from the header.

### Layout Structure

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  [â‰¡]  LCYT                           â— [Sync] [Connect] âš¡  â”‚  â† Top bar (48px)
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                â”‚                                             â”‚
â”‚  ðŸ  Dashboard  â”‚                                             â”‚
â”‚                â”‚                                             â”‚
â”‚  âœ Captions    â”‚                                             â”‚
â”‚                â”‚                                             â”‚
â”‚  ðŸŽ¤ Audio      â”‚          (page content area)                â”‚
â”‚                â”‚                                             â”‚
â”‚  ðŸ“¡ Broadcast  â”‚                                             â”‚
â”‚                â”‚                                             â”‚
â”‚  ðŸ–¼ Graphics   â”‚                                             â”‚
â”‚    â”œ Editor    â”‚                                             â”‚
â”‚    â”œ Control   â”‚                                             â”‚
â”‚    â”” Viewports â”‚                                             â”‚
â”‚                â”‚                                             â”‚
â”‚  ðŸŽ¬ Production â”‚                                             â”‚
â”‚    â”œ Operator  â”‚                                             â”‚
â”‚    â”œ Cameras   â”‚                                             â”‚
â”‚    â”œ Mixers    â”‚                                             â”‚
â”‚    â”” Bridges   â”‚                                             â”‚
â”‚                â”‚                                             â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚                                             â”‚
â”‚  ðŸ“ Projects   â”‚                                             â”‚
â”‚  ðŸ‘¤ Account    â”‚                                             â”‚
â”‚  âš™ Settings    â”‚                                             â”‚
â”‚                â”‚                                             â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
     200px (expanded)          remaining width
      48px (collapsed)
```

### Collapsed State (48px, icon-only)

```
â”Œâ”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â‰¡   â”‚  LCYT                    â— [Connect] âš¡   â”‚
â”œâ”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  ðŸ    â”‚                                           â”‚
â”‚  âœ   â”‚                                           â”‚
â”‚  ðŸŽ¤   â”‚                                           â”‚
â”‚  ðŸ“¡   â”‚                                           â”‚
â”‚  ðŸ–¼   â”‚          (page content)                   â”‚
â”‚  ðŸŽ¬   â”‚                                           â”‚
â”‚ â”€â”€â”€â”€ â”‚                                           â”‚
â”‚  ðŸ“   â”‚                                           â”‚
â”‚  ðŸ‘¤   â”‚                                           â”‚
â”‚  âš™   â”‚                                           â”‚
â””â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
 48px
```

- Hover on a collapsed icon shows a tooltip with the section name
- Click navigates to that section's default route
- Sections with sub-pages (Graphics, Production): click goes to default sub-page; no expand in collapsed mode

### Mobile (<768px)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  [â‰¡]  LCYT                   â— [Connect] âš¡  â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                              â”‚
â”‚           (page content, full width)         â”‚
â”‚                                              â”‚
â”‚                                              â”‚
â”‚                                              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

Hamburger [â‰¡] opens a slide-over drawer:
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  â”‚                           â”‚
â”‚  ðŸ  Dashboard    â”‚    (dimmed page behind)   â”‚
â”‚  âœ Captions      â”‚                           â”‚
â”‚  ðŸŽ¤ Audio        â”‚                           â”‚
â”‚  ðŸ“¡ Broadcast    â”‚                           â”‚
â”‚  ðŸ–¼ Graphics â–¾   â”‚                           â”‚
â”‚    â”œ Editor      â”‚                           â”‚
â”‚    â”œ Control     â”‚                           â”‚
â”‚    â”” Viewports   â”‚                           â”‚
â”‚  ðŸŽ¬ Production â–¾ â”‚                           â”‚
â”‚    â”œ Operator    â”‚                           â”‚
â”‚    â”œ Cameras     â”‚                           â”‚
â”‚    â”œ Mixers      â”‚                           â”‚
â”‚    â”” Bridges     â”‚                           â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€    â”‚                           â”‚
â”‚  ðŸ“ Projects     â”‚                           â”‚
â”‚  ðŸ‘¤ Account      â”‚                           â”‚
â”‚  âš™ Settings      â”‚                           â”‚
â”‚                  â”‚                           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
      280px              backdrop (click to close)
```

Drawer auto-closes on navigation. Swipe-left to dismiss.

### Route Map

All sidebar routes share a common layout shell (`SidebarLayout`) with the top bar + sidebar. Public/embed routes remain standalone.

#### Sidebar routes (inside `SidebarLayout`)

| Sidebar item | Route | Component | Notes |
|---|---|---|---|
| **Dashboard** | `/` | `DashboardPage` | Dockable mini-panel grid (see Section 1b) |
| **Captions** | `/api/v1/captions` | `CaptionsPage` | Current `App.jsx` two-panel layout (files + input + sent log) |
| **Audio** | `/audio` | `AudioPage` | Current `AudioPanel` promoted to full page; STT engine picker, mic controls, waveform, language |
| **Broadcast** | `/broadcast` | `BroadcastPage` | Current `BroadcastModal` content (Encoder / YouTube / Stream tabs) as a full page |
| **Graphics â†’ Editor** | `/graphics/editor` | `DskEditorPage` | Existing component, now inside sidebar shell |
| **Graphics â†’ Control** | `/graphics/control` | `DskControlPage` | Existing component; `:key` from session context instead of URL |
| **Graphics â†’ Viewports** | `/graphics/viewports` | `DskViewportsPage` | Existing component, now inside sidebar shell |
| **Production â†’ Operator** | `/api/v1/production` | `ProductionOperatorPage` | Existing component, now inside sidebar shell |
| **Production â†’ Cameras** | `/api/v1/production/api/v1/cameras` | `ProductionCamerasPage` | Existing component, now inside sidebar shell |
| **Production â†’ Mixers** | `/api/v1/production/api/v1/mixers` | `ProductionMixersPage` | Existing component, now inside sidebar shell |
| **Production â†’ Bridges** | `/api/v1/production/api/v1/bridges` | `ProductionBridgesPage` | Existing component, now inside sidebar shell |
| **Projects** | `/projects` | `ProjectsPage` | Each project = one API key = the session; projects can be shared across multiple users and/or teams. Shows the user's own projects when logged in; prompts login/register when anonymous. |
| **Account** | `/account` | `AccountPage` | Login/Register (if anonymous) or user profile/password when logged in |
| **Settings** | `/settings` | `SettingsPage` | Unified settings â€” all tabs (see Section 3) |

#### Standalone routes (NO sidebar, full-screen)

| Route | Component | Reason |
|---|---|---|
| `/view/:key` | `ViewerPage` | Public viewer â€” needs full screen, no chrome |
| `/api/v1/dsk/api/v1/:key` | `DskPage` | Public green-screen overlay â€” no chrome, transparent bg |
| `/embed/*` | `Embed*Page` | Iframe widgets â€” must be minimal, no sidebar |
| `/mcp/:sessionId` | `SpeechCapturePage` | AI-driven session â€” standalone |
| `/login` | `LoginPage` | Kept as standalone for direct-link access (also accessible via `/account`) |
| `/register` | `RegisterPage` | Kept as standalone for direct-link access (also accessible via `/account`) |

### Top Bar

The top bar (48px) is shared across all sidebar routes:

```
[â‰¡]  LCYT              â— health    [âš¡ Quick Actions â–¾]    [Connect / Disconnect]
```

| Element | Behavior |
|---------|----------|
| **[â‰¡] Hamburger** | Toggle sidebar expanded/collapsed (desktop); open drawer (mobile) |
| **LCYT** | Brand text; click â†’ navigate to `/` (Dashboard) |
| **â— Health dot** | Green = connected + healthy; Yellow = connected + high latency; Red = disconnected. Hover shows tooltip: "Connected to api.lcyt.fi Â· 42ms latency Â· seq #127" |
| **[âš¡ Quick Actions]** | Dropdown/popover with: Sync clock, Heartbeat, Reset sequence, Set sequence, Caption codes. These are the current `ControlsPanel` actions â€” too transient for a full page |
| **[Connect / Disconnect]** | Primary action button; same behavior as current `StatusBar` connect button |

### Sidebar Component Architecture

```
SidebarLayout
â”œâ”€â”€ TopBar
â”‚   â”œâ”€â”€ HamburgerButton
â”‚   â”œâ”€â”€ BrandLink
â”‚   â”œâ”€â”€ HealthDot
â”‚   â”œâ”€â”€ QuickActionsPopover     â† replaces ControlsPanel modal
â”‚   â””â”€â”€ ConnectButton
â”œâ”€â”€ Sidebar
â”‚   â”œâ”€â”€ SidebarItem (Dashboard)      â†’ "/"
â”‚   â”œâ”€â”€ SidebarItem (Captions)       â†’ "/api/v1/captions"
â”‚   â”œâ”€â”€ SidebarItem (Audio)          â†’ "/audio"
â”‚   â”œâ”€â”€ SidebarItem (Broadcast)      â†’ "/broadcast"
â”‚   â”œâ”€â”€ SidebarGroup (Graphics)
â”‚   â”‚   â”œâ”€â”€ SidebarItem (Editor)     â†’ "/graphics/editor"
â”‚   â”‚   â”œâ”€â”€ SidebarItem (Control)    â†’ "/graphics/control"
â”‚   â”‚   â””â”€â”€ SidebarItem (Viewports)  â†’ "/graphics/viewports"
â”‚   â”œâ”€â”€ SidebarGroup (Production)
â”‚   â”‚   â”œâ”€â”€ SidebarItem (Operator)   â†’ "/api/v1/production"
â”‚   â”‚   â”œâ”€â”€ SidebarItem (Cameras)    â†’ "/api/v1/production/api/v1/cameras"
â”‚   â”‚   â”œâ”€â”€ SidebarItem (Mixers)     â†’ "/api/v1/production/api/v1/mixers"
â”‚   â”‚   â””â”€â”€ SidebarItem (Bridges)    â†’ "/api/v1/production/api/v1/bridges"
â”‚   â”œâ”€â”€ SidebarDivider
â”‚   â”œâ”€â”€ SidebarItem (Projects)       â†’ "/projects"      â† each project = one API key = the session
â”‚   â”œâ”€â”€ SidebarItem (Account)        â†’ "/account"
â”‚   â””â”€â”€ SidebarItem (Settings)       â†’ "/settings"
â””â”€â”€ PageContent                       â† router outlet
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
- Prefix match: `SidebarItem` for `/api/v1/production/api/v1/cameras` highlights on that path
- Group auto-open: navigating to `/graphics/editor` auto-expands the Graphics group
- Active item: bold text + left accent border (4px, `var(--color-accent)`)

### Disconnected Hints

When not connected, pages that require a session show an inline banner at the top of the page content:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ âš  Not connected. Connect to a backend to use    â”‚
â”‚ this feature.                     [Connect now]  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

The page content still renders (read-only / skeleton state) so users can explore what's available.

### Migration Path (from current UI)

1. **Phase 1:** Add `wouter` router + `SidebarLayout` shell. Mount current `App.jsx` at `/api/v1/captions` inside the shell. Create `DashboardPage` at `/api/v1/`. All other sidebar routes initially render placeholder "Coming soon" or redirect.
2. **Phase 2:** Move `BroadcastModal` content â†’ `/broadcast` page. Move `AudioPanel` â†’ `/audio` page. Mount existing DSK/Production pages inside sidebar shell.
3. **Phase 3:** Create `/settings` page (merge SettingsModal + CCModal). Replace `ControlsPanel` with `QuickActionsPopover` in top bar.
4. **Phase 4:** Move `ProjectsPage` into the sidebar shell at `/projects` (above Account). Create `/account` page for user profile and password management. Projects are the primary entry point â€” each project is an API key that doubles as the session credential and can be shared by multiple users and/or teams. Remove old standalone `/login` and `/register` (or redirect to `/account`).

---

### 1b. Dashboard Page (`/`) â€” Dockable Panel Grid

The Dashboard is the landing page. It shows a configurable grid of mini-panels â€” lightweight, read-mostly versions of the main pages. Users can add, remove, rearrange, and resize panels.

#### Grid Library

Use **`react-grid-layout`** (~40KB) for drag-to-reorder and resize. It provides:
- Drag handles on panel headers
- Responsive breakpoints (lg/md/sm/xs)
- Persisted layouts (serialize to localStorage)
- Collision detection and auto-compaction

Install: `npm install react-grid-layout -w packages/lcyt-web`

#### Dashboard Layout

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Dashboard                                          [+ Add]  â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                              â”‚
â”‚  â”Œâ”€ Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€ Sent Log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚
â”‚  â”‚ â— Connected       â”‚  â”‚ âœ“âœ“ Hello world        12:01   â”‚   â”‚
â”‚  â”‚ api.lcyt.fi       â”‚  â”‚ âœ“  Testing 123        12:02   â”‚   â”‚
â”‚  â”‚ Seq: 127          â”‚  â”‚ â³ New caption...      12:03   â”‚   â”‚
â”‚  â”‚ Targets: 2 YT     â”‚  â”‚                               â”‚   â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚
â”‚                                                              â”‚
â”‚  â”Œâ”€ Quick Send â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚
â”‚  â”‚ [Type a caption...                        ] [Send]    â”‚   â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚
â”‚                                                              â”‚
â”‚  â”Œâ”€ File Preview â”€â”€â”€â”€â”  â”Œâ”€ Broadcast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚
â”‚  â”‚ sermon.txt  L42   â”‚  â”‚ Encoder: â— idle               â”‚   â”‚
â”‚  â”‚   41: ...         â”‚  â”‚ Relay: 2/3 slots active       â”‚   â”‚
â”‚  â”‚ > 42: Current ln  â”‚  â”‚ RTMP: receiving               â”‚   â”‚
â”‚  â”‚   43: ...         â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                                       â”‚
â”‚                                                              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
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
â”Œâ”€ Title â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ [_] [âœ•] â”€â”
â”‚                                       â”‚  â† drag handle (header)
â”‚  (widget content)                     â”‚
â”‚                                       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ â—¢ resize â”˜
```

- **Header:** title text (left), collapse `[_]` and remove `[âœ•]` buttons (right). Header is the drag handle.
- **Body:** widget content. Hidden when collapsed.
- **Resize handle:** bottom-right corner (provided by react-grid-layout).
- **Collapsed state:** header-only, 1 grid row height.

#### Panel Picker (`[+ Add]` button)

Clicking `[+ Add]` in the dashboard header opens a dropdown/popover:

```
â”Œâ”€ Add panels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ â˜‘ Status                     â”‚
â”‚ â˜‘ Sent Log                   â”‚
â”‚ â˜‘ Quick Send                 â”‚
â”‚ â˜ File Preview               â”‚
â”‚ â˜ Audio                      â”‚
â”‚ â˜ Viewer                     â”‚
â”‚ â˜ Broadcast                  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

Checked = currently on dashboard. Toggle to add/remove.

#### "Pin to Dashboard" from Main Pages

Each main page header (when sidebar navigation is implemented) gets a small pin icon:

```
Captions                              [ðŸ“Œ]
```

- Unpinned (outline): click â†’ adds the corresponding widget(s) to dashboard
- Pinned (filled): click â†’ removes from dashboard
- Mapping: Captions â†’ `file-preview` + `input`, Audio â†’ `audio-meter`, Broadcast â†’ `broadcast`

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

All widgets share the existing context tree â€” no separate sessions or connections:

```
AppProviders (SessionContext, FileContext, SentLogContext, ToastContext)
â””â”€â”€ SidebarLayout
    â””â”€â”€ DashboardPage
        â””â”€â”€ ResponsiveGridLayout (react-grid-layout)
            â”œâ”€â”€ DashboardCard key="status"
            â”‚   â””â”€â”€ StatusWidget        â†’ reads SessionContext
            â”œâ”€â”€ DashboardCard key="sent-log"
            â”‚   â””â”€â”€ SentLogWidget       â†’ reads SentLogContext
            â”œâ”€â”€ DashboardCard key="input"
            â”‚   â””â”€â”€ InputWidget         â†’ reads/writes SessionContext
            â”œâ”€â”€ DashboardCard key="file-preview"
            â”‚   â””â”€â”€ FilePreviewWidget   â†’ reads FileContext
            â”œâ”€â”€ DashboardCard key="audio-meter"
            â”‚   â””â”€â”€ AudioMeterWidget    â†’ Web Audio API + SessionContext
            â”œâ”€â”€ DashboardCard key="viewer"
            â”‚   â””â”€â”€ ViewerWidget        â†’ independent EventSource
            â””â”€â”€ DashboardCard key="broadcast"
                â””â”€â”€ BroadcastWidget     â†’ reads SessionContext
```

Exception: `ViewerWidget` creates its own `EventSource` to `/viewer/:key` (same pattern as `ViewerPage`). The viewer key comes from the target config in `SessionContext`.

#### Empty Dashboard

When no panels are configured:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                              â”‚
â”‚  Welcome to LCYT                             â”‚
â”‚                                              â”‚
â”‚  Add panels to build your dashboard.         â”‚
â”‚                                              â”‚
â”‚  [+ Add panels]       [Go to Captions â†’]     â”‚
â”‚                                              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
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

**2a. Guided setup flow for new users â€” implemented 2026-07-21, adapted to the codebase that grew since this proposal was written.** The literal sketch above (a blocking full-screen Server/Auth/Target/Test wizard gating the raw UI) predates `/setup/wizard`, which already exists today as a real, more thorough guided flow (feature selection â†’ per-feature config panels â†’ review). Rebuilding a second, narrower wizard would duplicate it. Instead: `OnboardingBanner.jsx` (mounted in `RootRoute.jsx`, above a connected project's summary) checks `GET /targets` and shows a dismissible nudge â€” "This project isn't configured yet. Run the setup wizardâ€¦" â€” when a project has zero caption targets configured, backed by a per-project `lcyt.onboarded.<apiKey>` flag (`lib/onboarding.js`, the `lcyt:onboarded` flag this proposal specced, scoped per-project since a user can own several). The flag is set either by dismissing the banner or by finishing the wizard (`setup-wizard/hooks/useWizardState.js`'s `handleFinish`), so a returning user never sees it again for that project. Deliberately non-blocking (a dismissible nudge, not a forced gate) â€” a project connecting via API key only (no `login` feature, e.g. an embedded device) never needs a full onboarding flow at all, and gating the whole UI behind it would break that path.

**2b. Empty-state guidance** in the main view. When no file is loaded and no session is active, show contextual cards:
- "Drop a caption file here or create a new one"
- "Connect to start sending captions" (with a Connect button inline)
- Links to documentation / embed setup / DSK editor

**2c. Inline tooltips / help text** on first use of each feature. Use a `lcyt:hints-dismissed` set in localStorage to avoid repeating.

---

## 3. Settings & Configuration Architecture

### Problem

Configuration is split across multiple modals and localStorage keys with no central registry:
- **SettingsModal** â€” backend URL, API key, theme, text size, advanced mode
- **CCModal** â€” targets, STT engine, translations, file downloads
- **ControlsPanel** â€” sequence control, sync, caption codes, file actions, clear config
- **BroadcastModal** â€” encoder, YouTube OAuth, RTMP relay
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

Keep a quick-access "Connect/Disconnect" button in the header â€” but move all configuration to a single location.

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

**4a. Context-aware layout modes â€” reassessed 2026-07-21: the original premise no longer applies; the one real gap it named is fixed.** This proposal predates the v2 sidebar migration below it in this same document â€” it describes a *single shared two-panel shell* whose left/api/v1/right content should swap based on an active "mode." That shell (`App.jsx`'s legacy two-panel layout) has since been superseded: Caption (file), Caption (audio), Broadcast, and Graphics are now each their own dedicated route/api/v1/page (`/api/v1/captions`, `/api/v1/audio`, `/api/v1/broadcast`, `/api/v1/graphics/api/v1/editor`) with a layout purpose-built for that content â€” exactly what this proposal was asking for, just delivered via routing instead of a mode switch inside one shell. Re-auditing the table above against today's actual pages: four of five rows are already true. The one row that wasn't â€” **Production: operator surface + caption input (mini)** â€” is now fixed: a new `captionInput` pane type (`production/api/v1/workspace/api/v1/panes/api/v1/index.jsx`'s `CaptionInputPane`, a direct `CaptionContext.send()` line-sender, deliberately not `InputBar.jsx`'s full file/api/v1/metacode/api/v1/batch/api/v1/translation pipeline) is part of the built-in "Captions" workspace view's left column (stacked under `general`/api/v1/Controls) and available to any custom view via the pane-type picker â€” the Production operator console already has the pluggable multi-pane architecture this proposal wanted, it just didn't have a caption-input pane type until now. Rebuilding a mode-switching single-shell layout on top of the routing model that already solves the same problem would be net-negative, not a gap to close.

This avoids showing irrelevant panels and gives each mode the space it needs.

**4b. Detachable panels â€” implemented 2026-07-21 for the panel this proposal named, generalizable to more later.** `PopOutButton.jsx` (`window.open('/embed/:page', '_blank', 'width=â€¦,height=â€¦')`) is the reusable "pop out" trigger; `main.jsx`'s `SidebarApp` now passes `embed` to its own `<AppProviders>` (previously only the `/embed/*` widget pages did), so the main app also broadcasts its session token and sent captions over `BroadcastChannel('lcyt-embed')` â€” the exact mechanism this proposal pointed at, just not turned on for the main app before. `SentPanel.jsx`'s header wires a `PopOutButton` to `/embed/sentlog`; the popped-out window needs no URL params since `EmbedSentLogPage` already requests the session over the channel on mount. Scoped to the one panel named explicitly (Sent Captions) and the one panel that already had a matching `/embed/*` page to pop into â€” most other in-app panels (file viewer, audio meter, DSK properties, Production workspace panes) have no embed-page counterpart today, so `PopOutButton` isn't wired to them yet; extending this is now "give the panel an `/embed/*` route + one `<PopOutButton>` call," not new infrastructure.

**4c. Mobile-first redesign for the caption flow â€” scoped to the one real functional gap, 2026-07-21.** Re-audited: the file viewer is *not* actually hidden on mobile (both the file/caption panel and the sent log are visible, stacked top/bottom in a manually-resizable split â€” `App.jsx`'s `.panel--left`/`.panel--right`, `layout.css`'s mobile media query) â€” this proposal's premise was stale even before this pass. What genuinely was true: `#footer`/`InputBar` (the only *free-text* caption input) was unconditionally `display:none` below 768px, replaced entirely by `MobileAudioBar` â€” voice input and stepping through a loaded file's lines, with no way to type and send arbitrary custom text at all. Fixed with the smallest correct change rather than the sketched swipeable-card/bottom-sheet/FAB rebuild: `MobileAudioBar.jsx` gained a âŒ¨ toggle button (`textInputOpen`/`onToggleTextInput`) that reveals the *same* `#footer`/`InputBar` instance â€” not a duplicate input, so `handleSend()`/`triggerSend()`/metacode autocomplete (Â§5d) all behave identically â€” as a `#footer.footer--mobile-open` bar docked directly above the fixed mobile bar, auto-focusing on open. The swipeable-card layout and bottom sheet for file tabs remain unbuilt but are no longer blocking anything â€” the concrete "can't type a caption on mobile" gap is closed; those two are now purely a layout-polish upgrade over an already-functional mobile flow, not a functional requirement.

---

## 5. Feature Discovery & Workflow Integration

### Problem

Power features are hidden:
- **Caption codes** (language override, no-translate, custom metadata) â€” buried in Controls panel
- **Batch mode** â€” a checkbox in CC modal with no visual indication until you notice the badge
- **DSK metacodes** (`<!-- graphics:... -->`) â€” only documented, no UI assistance
- **Embed widgets** â€” no mention in the main app unless you open Broadcast modal
- **Viewer target** â€” configured in CC targets but the viewer URL isn't shown prominently
- **Keyboard shortcuts** â€” not documented anywhere in the UI
- **File pointer semantics** (arrow keys navigate, Enter sends current line) â€” discovered by accident

### Proposals

**5a. Command palette** (Ctrl/Cmd+K). A searchable command list that surfaces all actions:
- "Send heartbeat", "Sync clock", "Reset sequence"
- "Open DSK editor", "Switch to production mode"
- "Set language to Finnish", "Toggle batch mode"
- "Show keyboard shortcuts"

This is the standard power-user discoverability pattern (VS Code, Figma, Linear).

**5b. Keyboard shortcuts help** â€” a `?` shortcut (or Ctrl+/) that shows a shortcuts overlay. Current shortcuts (arrows, Enter, Tab, Ctrl+1..9, Ctrl+,) should all be listed.

**5c. Status bar enrichment.** The current status bar only shows connect state. Add:
- Active target count (e.g. "2 targets")
- Current language override indicator
- Batch queue badge
- Mic status (claimed/unclaimed for collaborative sessions)
- A subtle "what's new" indicator when features are added

**5d. Inline DSK metacode helper â€” implemented 2026-07-21, "template names" corrected to image shorthand names.** When the cursor sits inside an unclosed `<!-- ... -->` in `InputBar.jsx`'s caption field, `lib/metacodeAutocomplete.js`'s pure `getMetacodeContext()`/`getMetacodeOptions()` detect which of three stages is being typed and `MetacodeAutocompleteDropdown.jsx` offers completions: the bare keyword stage suggests `graphics: ` / `graphics[`; the bracket stage suggests viewport names (`hooks/useDskMetacodeSources.js`'s `GET /dsk/:apikey/viewports`) plus the built-in `landscape`/`default`/`main` aliases; the value stage (after `graphics:`, including delta-mode `+`/`-` prefixes) suggests image shorthand names (`GET /images`) â€” corrected from this proposal's original "template names" wording, since `graphics:`'s values actually resolve against `getImageByShorthand()` in `lcyt-dsk`'s `caption-processor.js`, which never addresses graphics by DSK template name. Arrow keys/Enter/Tab navigate and select (intercepted ahead of `InputBar`'s existing Enter-to-send/ArrowUp-ArrowDown-pointer-navigation bindings, only while the dropdown is open); Escape or blur dismisses it.

**5e. Workflow presets.** Let users save and restore named workflow configurations:
- "Sunday service" â€” specific API key, file loaded, viewer target, Finnish language
- "Conference" â€” multiple YouTube targets, English + Finnish translations, batch mode
- "Testing" â€” localhost backend, viewer target only

Store as JSON in localStorage (and optionally sync to backend per user account).

---

## 6. Error Handling & Resilience

### Problem

- Network errors show a toast and retry silently every 30 seconds. There is no visible indication that the connection is degraded.
- 401 errors auto-disconnect with a toast â€” but if the user was mid-broadcast, this is catastrophic. No auto-reconnect is attempted.
- File operations (load, save, raw edit) can fail silently on localStorage quota exceeded.
- Batch mode queues captions in memory â€” a page reload or accidental close loses them.
- The BroadcastChannel coordination for embed pages fails silently cross-origin.

### Proposals

**6a. Connection health indicator** in the header â€” a colored dot (green/yellow/red) with hover tooltip showing latency and last successful send time. Yellow for degraded (high latency or retries), red for disconnected.

**6b. Auto-reconnect with backoff** on session expiry or network drop. Show a "Reconnecting..." banner with a manual "Reconnect now" button. Preserve the target configuration so the user doesn't have to reconfigure after a reconnect.

**6c. Unsaved work protection.** Before unload (`beforeunload`), check for:
- Pending batch queue items
- Unsaved raw-edit changes
- Active STT session

Show a browser confirmation dialog if any are detected.

**6d. localStorage quota monitoring â€” implemented 2026-07-21, adapted from "before writing" to periodic.** There is no browser API to intercept an individual `localStorage.setItem()` call before it lands, and `navigator.storage.estimate()` reports origin-wide storage (localStorage + IndexedDB + caches combined), not localStorage in isolation â€” so `lib/storageQuota.js`'s `getStorageEstimate()` is checked periodically instead (`components/StorageQuotaMonitor.jsx`, mounted once in `SidebarLayout.jsx`: on mount + every 5 minutes) rather than gated per-write. When usage crosses `WARN_RATIO` (0.8), it shows a persistent toast â€” "Browser storage is N% full â€” clear old sent logs or remove unused files to free space" â€” debounced to once per tab session via a `sessionStorage` flag so it doesn't repeat every 5 minutes while still over threshold, but does warn again in a fresh tab.

---

## 7. Performance

### Problem

- CaptionView already has virtual scrolling for 500+ lines, but sent log (SentPanel) doesn't â€” it renders all entries and relies on CSS overflow.
- All contexts re-render on any state change (no `useMemo` or selector pattern).
- The full App component tree mounts even when most panels are hidden.

### Proposals

**7a. Virtual scrolling for SentPanel** when entries exceed 100 items (same pattern as CaptionView).

**7b. Context splitting.** Split `SessionContext` (623 lines) into smaller, focused contexts:
- `ConnectionContext` â€” connected state, health, connect/disconnect
- `CaptionContext` â€” send, sendBatch, sequence, syncOffset
- `SessionApiContext` â€” stats, files, RTMP, YouTube config

This prevents caption-send re-renders from triggering settings UI re-renders.

**7c. Lazy-load heavy pages.** Use `React.lazy()` + `Suspense` for:
- DskEditorPage (large canvas + template logic)
- ProductionOperatorPage (camera/mixer grid)
- BroadcastModal (encoder control, YouTube API)

---

## Implementation Status & Priority

> **Last audited: 2026-07-20** (previous audit: 2026-03-27 â€” several P2/P3 items
> below were incorrectly marked pending at that time and have been moved to
> Done; see notes on 5a/5b/7a/7c)

### âœ… Done

| Item | Notes |
|------|-------|
| **1 Phase 1** â€” `wouter` router + `SidebarLayout` shell + Dashboard at `/` | `SidebarLayout.jsx` implemented with `HealthDot`, `QuickActionsPopover`, `StatusPopover`, hamburger, connect button, collapse persistence (`lcyt.ui.sidebarExpanded`) |
| **1b** â€” Dashboard dockable panel grid | `DashboardPage.jsx` + `dashboard/` folder: `DashboardCard`, `StatusWidget`, `SentLogWidget`, `InputWidget`, `FileWidget`, `AudioWidget`, `BroadcastWidget`, `ViewerWidget`, `ViewportsWidget`, `PanelPicker` |
| **1 Phase 2** â€” All pages moved into sidebar shell | `/api/v1/captions`, `/api/v1/audio` (`AudioPage`), `/api/v1/broadcast` (`BroadcastPage`), `/api/v1/graphics/api/v1/editor`, `/api/v1/graphics/api/v1/control`, `/api/v1/graphics/api/v1/viewports`, `/api/v1/production`, `/api/v1/production/api/v1/cameras`, `/api/v1/production/api/v1/mixers`, `/api/v1/production/api/v1/bridges` all mounted inside `SidebarLayout` |
| **1 Phase 3** â€” `/settings` page + `QuickActionsPopover` | `SettingsPage.jsx` with General / CC / I/O tabs. `QuickActionsPopover` in top bar replaces old ControlsPanel modal |
| **1 Phase 4** â€” `/projects` sidebar entry + `/account` profile | `ProjectsPage` at `/projects`; `AccountPage` at `/account` (login prompt or profile + change-password) |
| **3b** â€” Settings export/import | `settingsIO.js` + I/O tab in `SettingsPage` (`downloadSettings` / `importSettings`) |
| **3c** â€” Normalize localStorage keys | `storageKeys.js` â€” all keys under `lcyt.{category}.{key}` convention |
| **6a** â€” Connection health dot in top bar | `HealthDot` + `StatusPopover` in `SidebarLayout` (latency, seq, targets, uptime) |
| **6b. Auto-reconnect with backoff** | Exponential backoff (2s â†’ 30s max), "Reconnectingâ€¦" banner, preserves target config, `reconnectNow()` for manual retry |
| **6c. Unsaved work protection** | `beforeunload` guard when batch queue has pending items |
| **7b. Context splitting** | `SessionContext` split into `ConnectionContext` / `CaptionContext` / `SessionApiContext` â€” reduces re-renders |
| **8a. Two-phase login** | `LoginPage` rewritten: backend preset selector (Normal/Minimal/Custom) â†’ probe `/health` â†’ feature-aware auth (login form for full backends, API key for minimal) |
| **8b. Feature-based sidebar** | Sidebar nav items and groups annotated with `feature` property; filtered by `backendFeatures` from `ConnectionContext`. Minimal backends hide Broadcast, Graphics, Production, Projects, Account |
| **5a. Command palette** (Ctrl/Cmd+K) | `CommandPalette.jsx` â€” searchable flattened nav list from `NAV_ITEMS`/`NAV_GROUPS`/`NAV_BOTTOM`, arrow-key navigation, Enter to navigate, Escape to close; wired via `SidebarLayout.jsx` and the top-bar button in `sidebar/Sidebar.jsx`. Was miscategorized as P2/not-done in the 2026-03-27 audit â€” confirmed fully implemented 2026-07-20 |
| **5b. Keyboard shortcuts help** (`?` overlay) | `KeyboardShortcutsHelp.jsx` â€” sectioned shortcut list (Navigation, Caption file, App shortcuts, Input shortcuts) incl. `?` itself; wired via `SidebarLayout.jsx`. Was miscategorized as P2/not-done in the 2026-03-27 audit â€” confirmed fully implemented 2026-07-20 |
| **7a. Virtual scrolling SentPanel** | `SentPanel.jsx` â€” `VIRTUAL_THRESHOLD = 100`, windowed slice rendering (`ITEM_HEIGHT`, `OVERSCAN`, scroll-driven start/end index, padding divs). Was miscategorized as P3/not-done in the 2026-03-27 audit â€” confirmed fully implemented 2026-07-20 |
| **7c. Lazy-load heavy pages (mostly done)** | `DskEditorPage` and `ProductionOperatorPage` are lazy-loaded via `lazyImport()` in `main.jsx`. `BroadcastModal.jsx` is no longer routed/imported anywhere active â€” superseded by `BroadcastPage.jsx`/`broadcast/*` â€” so lazy-loading it is moot rather than outstanding |

### ðŸŸ  P1 â€” Next up

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| **P1** | **2a. Guided setup flow** â€” *partial*: `SetupWizardPage` (feature selection â†’ target/translation/relay/CEA/embed/STT config â†’ review) is fully implemented and routed at `/setup/wizard` (see `plan_setup_wizard.md`, status: implemented), reachable from the `/setup` hub via "Run setup wizard." What's still missing is the auto-trigger: no `lcyt:onboarded` flag exists anywhere in the codebase, and nothing redirects a new/unconfigured user into the wizard automatically â€” it remains purely opt-in via nav | High â€” unblocks new users | Low (trigger only; the wizard itself is done) |
| **P1** | **2b. Empty-state guidance** â€” *partial*: `broadcast/LiveTab.jsx` (the `/` console) has a real empty-state card (icon/title/description + actions) when no panels are configured. `CaptionView.jsx` and `dashboard/FileWidget.jsx` only show plain "No file loaded" text, not contextual cards, and none of these key off "no session active" specifically as the original proposal described | Medium â€” reduces confusion for new users | Low |

### ðŸŸ¡ P2 â€” Nice to have

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| ~~**P2**~~ | ~~**4a. Context-aware layout modes**~~ â€” **reassessed and closed 2026-07-21**, see Â§4a above: the routing model already delivers 4 of 5 rows; the 5th (Production caption input) shipped as a new `captionInput` pane type | â€” | â€” |

### ðŸ”µ P3 â€” Backlog

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| ~~**P3**~~ | ~~**4b. Detachable panels**~~ â€” **done 2026-07-21 for Sent Captions**, see Â§4b above (`PopOutButton.jsx`, `SentPanel.jsx`, `main.jsx`'s `embed`-enabled `SidebarApp`); other panels need their own `/embed/*` page first | â€” | â€” |
| **P3** | **4c. Mobile-first redesign** â€” **core functional gap closed 2026-07-21** (see Â§4c above: `MobileAudioBar.jsx`'s âŒ¨ toggle reveals the real `#footer`/`InputBar` on mobile â€” typing custom text was previously impossible there). Remaining as pure layout polish, not a functional requirement: a swipeable card layout and a bottom-sheet file-tab picker (`SwipeablePages.jsx` exists but is used by `PlannerPage.jsx`/`DskEditorPage.jsx`, not wired to the captions flow) | Low â€” cosmetic upgrade over an already-functional flow | Medium |
| **P3** | **5e. Workflow presets** â€” named localStorage configs (e.g. "Sunday service"). Confirmed not done â€” `LiveTab.jsx`'s `PresetPicker`/`applyPreset` only covers dashboard *panel layout* presets, a narrower feature, not named save/restore of full workflow configs | Low â€” convenience | Medium |
| ~~**P3**~~ | ~~**5d. DSK metacode helper**~~ â€” **done 2026-07-21**, see Â§5d above (`lib/metacodeAutocomplete.js` + `hooks/useDskMetacodeSources.js` + `MetacodeAutocompleteDropdown.jsx`, wired into `InputBar.jsx`) | â€” | â€” |
| **P3** | **2c. Inline hints on first use** â€” `lcyt:hints-dismissed` set, tooltips on feature first touch. Confirmed not done | Low â€” nice to have | Low |
| ~~**P3**~~ | ~~**6d. localStorage quota monitoring**~~ â€” **done 2026-07-21**, see Â§6d above (`lib/storageQuota.js` + `components/StorageQuotaMonitor.jsx`) | â€” | â€” |

---

## Summary

The frontend has solid foundations: clean context-based state management, a flexible embed system, and strong keyboard support.

**As of 2026-07-20, the structural foundation, feature-based UI, and most power-user features are complete.** The two-phase login (backend preset selection â†’ `/health` probe â†’ feature-aware login/API-key flow) gates the entire UI. Backend features (`backendFeatures` from `ConnectionContext`) drive sidebar navigation visibility: minimal backends (Python) show only Dashboard, Captions, Audio, and Settings; full-featured backends (Node.js) show the complete sidebar including Broadcast, Graphics, Production, Projects, and Account. Auto-reconnect with exponential backoff, unsaved-work protection, context splitting, the command palette, keyboard shortcuts help, and SentPanel virtual scrolling are all shipped â€” the last three were incorrectly still marked P2/P3-pending as of the 2026-03-27 audit. Onboarding automation (Â§2a), localStorage quota monitoring (Â§6d), the DSK metacode autocomplete helper (Â§5d), context-aware layout modes (Â§4a â€” reassessed rather than literally rebuilt, since the routing model already delivers most of it), detachable/pop-out panels (Â§4b, for the Sent Captions panel), and the mobile-first caption flow's core functional gap (Â§4c â€” mobile could not send free-text captions at all until now) shipped 2026-07-21. The one remaining genuine gap is workflow presets.

---
---

## v3 â€” Component Split

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

## 1. `CCModal.jsx` â€” 1 400 lines â†’ ~600 lines  âš¡ High

CCModal has already been migrated to use shared panels for the Targets and Translation tabs.
Two more sections can be extracted.

### 1a. Service tab â†’ `panels/ServicePanel.jsx` (~280 lines)

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

### 1b. Details tab â†’ `panels/DetailsPanel.jsx` (~80 lines)

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

## 2. `DskEditorPage.jsx` â€” 1 755 lines â†’ ~350 lines  âš¡ High

The DSK visual editor is the largest file in the codebase. Most of its bulk is in
helper functions and sub-components that can live in their own files.

### 2a. Geometry helpers â†’ `lib/dskEditorGeometry.js`

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

### 2b. Preset templates â†’ `lib/dskEditorPresets.js`

The `PRESETS` array (lines 131â€“185, ~55 lines) is constant data. Move to a module.

**Extract:**
```
lib/dskEditorPresets.js
```

### 2c. `TemplatePreview` â†’ `dsk-editor/TemplatePreview.jsx`

The `TemplatePreview` component (~245 lines, lines 252â€“476) renders the live
canvas preview of a template (drag+drop, resize handles, selection, snap lines).
It has its own `useEffect`/`useCallback` hooks and is logically self-contained.

**Extract:**
```
components/dsk-editor/TemplatePreview.jsx
```

Props: `template, selectedIds, onSelect, onLayerUpdate, selectedViewport,
serverUrl, onAddTextLayer` (derive from current usage).

### 2d. `AnimationEditor` â†’ `dsk-editor/AnimationEditor.jsx`

Animation editor sub-component (~65 lines, lines 543â€“606) with its helper
`parseAnimation`/`buildAnimation` functions.

**Extract:**
```
components/dsk-editor/AnimationEditor.jsx
lib/dskEditorAnimation.js   (parseAnimation, buildAnimation)
```

### 2e. `LayerPropertyEditor` â†’ `dsk-editor/LayerPropertyEditor.jsx`

The property editor panel (~130 lines, lines 657â€“780) reads and writes individual
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

## 3. `AudioPanel.jsx` â€” 1 071 lines â†’ ~350 lines  âš¡ High

A single 1 071-line component with 58 hook calls â€” the highest hook density in the
codebase. All logic and rendering live in one `export function AudioPanel`.

### 3a. Audio level meter â†’ `audio/AudioLevelMeter.jsx`

The animated audio level bar and peak hold logic. Currently inline; used only inside
`AudioPanel`.

### 3b. STT engine selection UI â†’ reuse `panels/ServicePanel.jsx`

Once `ServicePanel` is extracted from `CCModal` (item 1a), the STT engine picker,
mic selector, language selector, and advanced options can be composed from the same
panel inside the AudioPanel inline settings popover rather than duplicated.

### 3c. WebSpeech recognition state machine â†’ `hooks/useWebSpeech.js`

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

## 4. `BroadcastModal.jsx` â€” 833 lines  ðŸ“Œ Medium

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

## 5. `SidebarLayout.jsx` â€” 709 lines  ðŸ“Œ Medium

Already has internal sub-functions but all live in one file. The component
handles both the navigation shell and several complex popovers.

### 5a. `StatusPopover` â†’ `sidebar/StatusPopover.jsx` (~70 lines)

The session-status popover (connection info, API key/URL, disconnect button).

### 5b. `QuickActionsPopover` â†’ `sidebar/QuickActionsPopover.jsx` (~200 lines)

The Quick Actions popover (send commands, file ops, etc.) is large enough to
warrant its own file and test.

### 5c. `TopBar` â†’ `sidebar/TopBar.jsx` (~30 lines)

The horizontal top bar (hamburger menu, logo, popover buttons).

### 5d. `Sidebar` + `SidebarGroup` + `SidebarItem` â†’ `sidebar/Sidebar.jsx`

The navigation list with group collapsing. Includes nav config constant
(move to `sidebar/navConfig.js`).

### 5e. Resulting `SidebarLayout.jsx` (~150 lines)

Retains: layout grid, mobile state, drawer, reconnect banner, composition.

---

## 6. `DskViewportsPage.jsx` â€” 862 lines  ðŸ“Œ Medium

Already has sub-components defined at the bottom of the file. Extract them:

### 6a. `TextLayersEditor` â†’ `dsk-viewports/TextLayersEditor.jsx` (~130 lines)

The editor for per-viewport static text overlay layers, with its helper
`TextLayerMiniPreview`.

### 6b. `ImageSettingsTable` â†’ `dsk-viewports/ImageSettingsTable.jsx` (~45 lines)

Per-image settings table (z-index, animation, etc.).

### 6c. `ImageRow` â†’ `dsk-viewports/ImageRow.jsx` (~50 lines)

Single image accordion row.

### 6d. Resulting `DskViewportsPage.jsx` (~600 lines)

Retains: viewport CRUD, SSE connection, API calls, composition of extracted
sub-components.

---

## 7. `CaptionsModal.jsx` â€” 639 lines  ðŸ”µ Low

Three tabs: **Model** (STT cloud config), **VAD** (voice activity detection), **Other**
(caption post-processing). Can be split once `ServicePanel` exists.

### 7a. Model tab content

The Model tab overlaps significantly with the cloud section of `ServicePanel` (item 1a).
After `ServicePanel` is extracted, `CaptionsModal`'s Model tab can be refactored to
compose from `ServicePanel` rather than duplicating.

### 7b. VAD tab â†’ `panels/VadPanel.jsx` (~70 lines)

VAD settings (enable, silence duration, energy threshold) are already similar to the
Details tab VAD section in CCModal. Extract to a shared panel.

---

## 8. `ControlsPanel.jsx` â€” 460 lines  ðŸ”µ Low

A single export containing playback controls, file navigation, send controls, and
settings shortcuts. Could be split by function group once patterns emerge, but current
size is borderline. Defer unless a clear reuse opportunity arises.

---

## 9. Production pages â€” 470â€“523 lines each  ðŸ”µ Low

`ProductionCamerasPage`, `ProductionMixersPage`, `ProductionBridgesPage` all follow a
consistent pattern (Form + Row + Page). Already reasonably structured. Main candidate:

### 9a. Shared `ConnectionDot` â†’ `production/ConnectionDot.jsx`

`ConnectionDot` is defined identically in both `ProductionMixersPage` and
`ProductionBridgesPage`. Extract to a shared component.

### 9b. Forms to own files (optional)

`CameraForm` (225 lines), `MixerForm` (255 lines), `AddBridgeForm` / `SendCommandModal`
are large enough to benefit from extraction but are used only once each. Low priority.

---

## Summary table

| File | Before | After | Priority | Status | Key extractions |
|---|---|---|---|---|---|
| `CCModal.jsx` | 1 400 | 468 | **High** | âœ… Done | `ServicePanel`, `DetailsPanel`, `TargetsPanel`, `TranslationPanel` |
| `DskEditorPage.jsx` | 1 755 | 1 350 | **High** | âœ… Done | geometry lib, presets lib, `TemplatePreview`, `AnimationEditor`, `LayerPropertyEditor` |
| `AudioPanel.jsx` | 1 071 | 1 040 | **High** | âœ… Done | `AudioLevelMeter`, `useWebSpeech` |
| `BroadcastModal.jsx` | 833 | 55 | **Medium** | âœ… Done | `EncoderTab`, `StreamTab` (uses `RelayPanel`), `YouTubeTab` |
| `SidebarLayout.jsx` | 709 | 95 | **Medium** | âœ… Done | `StatusPopover`, `QuickActionsPopover`, `TopBar`, `Sidebar`, `navConfig.js` |
| `DskViewportsPage.jsx` | 862 | 493 | **Medium** | âœ… Done | `TextLayersEditor`, `ImageSettingsTable`, `ImageRow`, `styles.js` |
| `CaptionsModal.jsx` | 639 | 602 | **Low** | âœ… Done | `VadPanel` |
| `ControlsPanel.jsx` | 460 | â€” | **Low** | â­ Deferred | defer until clear reuse opportunity |
| Production pages Ã— 3 | 470â€“523 | ~505 | **Low** | âœ… Done | shared `ConnectionDot` |

---

## Implementation order

1. **`panels/ServicePanel.jsx`** â€” most reuse potential (CCModal, CaptionsModal, AudioPanel).
2. **`panels/DetailsPanel.jsx` / `panels/VadPanel.jsx`** â€” small, test immediately.
3. **`dsk-editor/` + `lib/dsk*.js`** â€” large win for DskEditorPage testability.
4. **`hooks/useWebSpeech.js`** â€” AudioPanel complexity reduction.
5. **`broadcast/`** â€” remove third copy of RelayRow.
6. **`sidebar/`** â€” cosmetic but improves navigation/discoverability.
7. Production pages / ControlsPanel â€” as needed.

---

## Notes

- Each extraction **must not change observable behaviour**.
- Extract files should have their own `test/components/` file verifying the extracted
  component in isolation.
- Shared panels follow the convention: pure data props + `onChange`, no side-effects,
  no context access except `useLang`.

