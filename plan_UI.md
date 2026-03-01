# UI Reorganisation Plan — lcyt-web

> Target branch: `claude/reorganize-ui-layout-jE7Rv`
> Base: merge `origin/copilot/sub-pr-36` (mic lock + multi-mic) onto the
> feature branch before starting, so all changes build on the latest code.

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
