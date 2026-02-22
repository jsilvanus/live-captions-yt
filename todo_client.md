# Web GUI Client — TODO List

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped/deferred

---

## MVP

---

### Milestone 1 — Project Scaffold & Backend Connection

**Deliverable:** Browser skeleton that can connect to `lcyt-backend` and show session state.

- [x] M1-1: Add `packages/lcyt-web/` to root `package.json` workspaces array
- [x] M1-2: Create `packages/lcyt-web/package.json`
  - name: `lcyt-web`, private: true
  - devDependencies: `vite`
  - dependencies: `lcyt` (workspace)
  - scripts: `dev`, `build`, `preview`
- [x] M1-3: Create `packages/lcyt-web/vite.config.js`
  - Resolve `lcyt` from workspace (`../lcyt`)
  - Dev server proxy: `/live`, `/captions`, `/sync` → `http://localhost:3000`
- [x] M1-4: Create `packages/lcyt-web/index.html`
  - Semantic structure: `<header>`, `<main>`, `<footer>`, `<div id="app">`
  - `<script type="module" src="/src/main.js">`
- [x] M1-5: Create `src/styles/reset.css` (box-sizing, normalize)
- [x] M1-6: Create `src/styles/layout.css`
  - CSS grid: header fixed top, footer fixed bottom, main fills rest
  - Main splits into two columns (60% left, 40% right)
- [x] M1-7: Create `src/styles/components.css` (placeholder, fill out per milestone)
- [x] M1-8: Create `src/session.js`
  - Import `BackendCaptionSender` from `lcyt`
  - Export `connect({ backendUrl, apiKey, streamKey })` — calls `sender.start()`
  - Export `disconnect()` — calls `sender.end()`
  - Export `send(text)`, `sync()`
  - Dispatch `lcyt:connected`, `lcyt:disconnected`, `lcyt:sequence-updated` on `window`
  - Persist `{ backendUrl, apiKey, streamKey }` to localStorage on connect
  - Load persisted config via `getPersistedConfig()`
- [x] M1-9: Create `src/ui/settings-modal.js`
  - Render `<dialog>` with fields: Backend URL, API Key (password input), Stream Key (password input)
  - Connect / Disconnect buttons
  - Show error message on connect failure
  - Load values from `session.getPersistedConfig()` on open
  - `open()` / `close()` methods
- [x] M1-10: Create `src/ui/status-bar.js`
  - Connection dot: green (connected) / grey (disconnected)
  - Sequence number display: `Seq: —` until connected
  - Sync offset display: `Offset: —ms`
  - Settings button (⚙) → opens settings-modal
  - Sync button → calls `session.sync()`, updates offset display
  - Listen to `lcyt:connected`, `lcyt:disconnected`, `lcyt:sequence-updated`
- [x] M1-11: Create `src/main.js` — bootstrap: import styles, instantiate components, wire together
- [x] M1-12: Add `"web": "npm run dev -w packages/lcyt-web"` and `"build:web": "npm run build -w packages/lcyt-web"` to root `package.json` scripts
- [ ] M1-13: Manual test: `npm run web`, connect with valid API key + stream key, status bar shows green + sequence

---

### Milestone 2 — File Loading & Multi-File Management

**Deliverable:** Users can load text files, see lines, and switch between files with per-file pointer.

- [x] M2-1: Create `src/file-store.js`
  - Internal `files: Array<{ id, name, lines, pointer }>`, `activeId: string|null`
  - `loadFile(file: File)` — FileReader → split → filter blank → assign `crypto.randomUUID()`
  - Restore pointer from localStorage key `lcyt-pointers` by filename
  - `setActive(id)` — update `activeId`, dispatch `lcyt:active-changed`
  - `getActive()` — return active file object or null
  - `setPointer(id, idx)` — update pointer, persist to localStorage, dispatch `lcyt:pointer-changed`
  - `advancePointer(id)` — increment pointer (clamp at last line), persist, dispatch
  - `removeFile(id)` — remove file, update activeId if needed, dispatch `lcyt:files-changed`
  - `getAll()` — return all file objects
  - Dispatch `lcyt:files-changed` on load, remove
- [x] M2-2: Create `src/ui/drop-zone.js`
  - Render `<div class="drop-zone">` with instruction text
  - `dragover` handler: `preventDefault()`, add `.drop-zone--active` class
  - `dragleave` handler: remove `.drop-zone--active`
  - `drop` handler: iterate `dataTransfer.files`, filter `.txt` / `text/plain`, call `fileStore.loadFile()` for each
  - Show brief inline error for non-text files ("Only .txt files supported")
  - Click handler: trigger hidden `<input type="file" accept=".txt" multiple>`
  - `onFilesLoaded` callback after all files processed
  - Hide self and show caption-view when `fileStore.getAll().length > 0`; listen to `lcyt:files-changed`
- [x] M2-3: Create `src/ui/file-tabs.js`
  - Render tab bar above caption-view
  - One `<button class="file-tab">` per file: filename (max 20 chars, ellipsis)
  - Active tab gets `.file-tab--active` class
  - Click tab → `fileStore.setActive(id)`
  - "×" on each tab → `fileStore.removeFile(id)`
  - "+" tab at end → trigger file picker (same as drop-zone click)
  - Re-render on `lcyt:files-changed` and `lcyt:active-changed`
  - Show `(end)` badge on tab if pointer is at last line
- [x] M2-4: Create `src/ui/caption-view.js`
  - Scrollable `<ul class="caption-lines">` inside a `<div class="caption-view">`
  - Render `<li>` per line; active line gets `.caption-line--active` class with `►` gutter
  - Click on line → `fileStore.setPointer(activeId, index)`
  - After pointer change: `el.scrollIntoView({ block: 'center', behavior: 'smooth' })`
  - Listen to `lcyt:active-changed`, `lcyt:files-changed`, `lcyt:pointer-changed`
  - Show empty state message if no file loaded or file has no lines
  - Virtual scrolling: if `lines.length > 500`, render only visible window ± 50 lines; reuse DOM nodes
- [x] M2-5: Wire drop-zone and caption-view into `main.js`
  - Left column: drop-zone (visible when no files) + file-tabs + caption-view
  - Right column: placeholder "Sent Captions" heading (filled in M3)
- [x] M2-6: Add styles for drop-zone, file-tabs, caption-view to `components.css`
  - Drop zone: dashed border, centered content, hover state
  - File tabs: horizontal scrollable bar, active tab underline/background
  - Caption lines: monospace font, line height, gutter for `►`, active line highlight color
- [ ] M2-7: Manual test: drag two .txt files, switch tabs, click lines to move pointer, reload and confirm pointers restored

---

### Milestone 3 — Caption Sending

**Deliverable:** Captions sent to YouTube via backend; sent log visible.

- [x] M3-1: Create `src/sent-log.js`
  - Ring buffer array max 500: `{ sequence, text, timestamp }` (ISO string)
  - `add({ sequence, text })` — push entry with `new Date().toISOString()`, shift if at capacity
  - `getAll()` — return copy newest-first
  - Dispatch `lcyt:sent-updated` on add
- [x] M3-2: Create `src/ui/input-bar.js`
  - `<div class="input-bar">` with `<input type="text">` and `<button class="send-btn">▶</button>`
  - Enter key or button click → call `handleSend()`
  - `handleSend()`:
    - If session not connected: flash red, do nothing
    - If input empty: send-pointer mode → get active file pointer line → `session.send(line)` → `fileStore.advancePointer()` → `sentLog.add()`
    - If input has text: send-custom mode → `session.send(inputText)` → `sentLog.add()` → clear input
  - Up/Down arrow keys: `fileStore.advancePointer()` / move pointer backwards (call `setPointer(id, ptr - 1)`)
  - Disable input + button when not connected; listen to `lcyt:connected`, `lcyt:disconnected`
  - On send error: dispatch `lcyt:error` event with message
- [x] M3-3: Create `src/ui/sent-panel.js`
  - Scrollable `<ul class="sent-list">` in right column
  - Each row: `<span class="seq">#42</span> <span class="time">12:03:01</span> <span class="text">...</span>`
  - Prepend new entries (newest-first)
  - Scroll to top on new entry
  - Max 500 rendered rows (remove oldest from DOM when capacity exceeded)
  - Listen to `lcyt:sent-updated`
- [x] M3-4: Wire sequence update in `status-bar.js`
  - Listen to `lcyt:sequence-updated`, update `Seq: <n>` display
- [x] M3-5: Add error display to `status-bar.js`
  - Listen to `lcyt:error`; show error text in status bar for 5 seconds, then clear
  - HTTP 401: auto-call `session.disconnect()`, show "Session expired — reconnect required"
- [x] M3-6: Sent-panel empty state: "No captions sent yet" placeholder
- [x] M3-7: Style input-bar: full-width, fixed at bottom, input fills available space, button on right
- [x] M3-8: Style sent-panel: monospace font, seq column fixed width, time column fixed width, text wraps
- [ ] M3-9: Manual test: connect, load file, send 5 pointer-lines (verify advance), send 2 custom captions (verify no advance), confirm sequence in status bar

---

### Milestone 4 — Settings, Stream Key, and Persistence

**Deliverable:** Full settings modal, persistent config, operational controls.

- [x] M4-1: Expand `src/ui/settings-modal.js` to `<dialog>` with tabbed sections
  - Tab "Connection": Backend URL, API Key, Stream Key (password inputs with eye-toggle)
  - Tab "Status": Session ID (readonly), Sync Offset, Last connected time, Active file count
  - Tab "Actions": Connect, Disconnect, Sync Now, Heartbeat, Clear saved config
- [x] M4-2: Eye-toggle for API Key and Stream Key fields
  - Button next to input: toggle `type="password"` / `type="text"`
  - Icon: 👁 / 👁‍🗨 (or SVG equivalent)
- [x] M4-3: Implement "Sync Now" in settings
  - Call `session.sync()`, update syncOffset display in modal and status bar
- [x] M4-4: Implement "Heartbeat" in settings
  - Call backend POST /captions with a single empty heartbeat payload (or GET /live)
  - Show round-trip time in ms in settings modal
- [x] M4-5: Implement "Clear saved config" button
  - Remove localStorage keys: `lcyt-config`, `lcyt-pointers`
  - Reload fields in settings to blank
- [x] M4-6: Auto-connect on startup
  - Add "Auto-connect on startup" checkbox in Connection tab
  - Persist as `lcyt-autoconnect` in localStorage
  - On page load in `main.js`: if flag set and config exists → call `session.connect()` with persisted config
  - Show "Connecting…" in status bar during attempt; show error if fails
- [x] M4-7: Keyboard shortcut: `Ctrl+,` / `Cmd+,` → open settings modal
- [x] M4-8: `Escape` key closes settings modal (native `<dialog>` cancel event)
- [ ] M4-9: Manual test: configure, connect, reload — settings auto-populated, auto-connect works

---

### Milestone 5 — Polish, Keyboard Navigation, and Packaging

**Deliverable:** Production-ready MVP, buildable static bundle.

- [x] M5-1: Keyboard navigation in caption-view (when input not focused)
  - `↑` → `fileStore.setPointer(id, ptr - 1)` (clamp at 0)
  - `↓` → `fileStore.advancePointer(id)`
  - `Page Up` → `setPointer(id, ptr - 10)` (clamp)
  - `Page Down` → `setPointer(id, ptr + 10)` (clamp)
  - `Home` → `setPointer(id, 0)`
  - `End` → `setPointer(id, lines.length - 1)`
  - `Tab` → cycle `fileStore.setActive()` through files in order
  - Key events on `document`; do NOT intercept when `<input>` or `<dialog>` is focused
- [x] M5-2: "Sent" flash animation on active line after sending
  - After pointer advances: add `.caption-line--sent` class to previous line for 1500ms, then remove
  - CSS: brief background flash via keyframe animation
- [x] M5-3: Dark theme as default
  - CSS custom properties: `--color-bg`, `--color-surface`, `--color-accent`, `--color-text`, `--color-text-dim`
  - Dark values set in `:root`; light values in `@media (prefers-color-scheme: light)` override
  - Manual toggle button in settings (stores `lcyt-theme: 'light'|'dark'|'auto'` in localStorage)
  - Apply theme class to `<html>` element
- [x] M5-4: Responsive layout below 768px
  - Sent panel hidden by default; toggle button in status bar reveals it as overlay (`position: fixed`)
  - Caption-view takes full width on small screens
- [x] M5-5: Toast notification system
  - `src/ui/toast.js`: `showToast(message, type='info', duration=5000)`
  - Renders `<div class="toast toast--<type>">` appended to `<body>`, auto-removed after duration
  - Types: `info`, `success`, `error`, `warning`
  - Wire all `lcyt:error` events to `showToast(message, 'error')`
  - Wire successful connect to `showToast('Connected', 'success')`
- [x] M5-6: End-of-file indicator
  - When pointer is at last line: show "End of file" badge on file tab and in caption-view footer
  - Pressing Enter/send still sends that line but pointer stays; show toast "End of file reached"
- [x] M5-7: Empty file message
  - If loaded file has 0 lines after filtering: show "No caption lines found in this file" in caption-view
  - File tab shows `(empty)` badge
- [x] M5-8: `vite build` configuration
  - Output to `packages/lcyt-web/dist/`
  - Add `"build:web"` to root `package.json`
  - Add `"preview:web"` to root `package.json`
  - Confirm build produces no console errors
- [x] M5-9: Serve from `lcyt-backend` (optional, low-effort)
  - In `packages/lcyt-backend/src/server.js`: if `process.env.STATIC_DIR` is set, add `express.static(STATIC_DIR)` middleware before routes
  - Document: `STATIC_DIR=../lcyt-web/dist node src/server.js`
- [ ] M5-10: End-to-end smoke test
  - `npm run build:web`
  - Start `lcyt-backend` with `STATIC_DIR=packages/lcyt-web/dist`
  - Open browser, connect with test API key + stream key
  - Drag test.txt, send 10 captions, verify sequence, verify sent panel
  - Reload page, confirm auto-reconnect, pointer restored

---

## Phase 2 — Browser Audio → STT → Captions

---

### P2-Milestone 1 — Audio Source Selection UI

**Deliverable:** Users can enumerate microphones and grant permission.

- [x] P2-M1-1: Add "Audio" tab to left panel (implemented as a dedicated panel instead of settings modal tab)
- [x] P2-M1-2: Enumerate audio devices via `navigator.mediaDevices.enumerateDevices()`
  - Filter to `audioinput` devices
  - Populate `<select>` with device labels + deviceIds
- [x] P2-M1-3: "Request Microphone Permission" button
  - Call `getUserMedia({ audio: true })`, stop tracks immediately after
  - Update permission status display: Granted / Denied / Prompt
- [x] P2-M1-4: Persist selected `deviceId` to `localStorage` as `lcyt-audio-device`
- [~] P2-M1-5: Live audio level meter component (`src/ui/audio-meter.js`)
  - Canvas placeholder rendered in audio panel — idle state drawn (text label)
  - `AnalyserNode` → `getByteTimeDomainData()` → canvas bar render at 60fps: **not yet wired** (requires P2-M2 capture)
  - Color: green (low) → yellow (medium) → red (clipping): **not yet wired**
- [x] P2-M1-6: Handle `devicechange` event — refresh device list without page reload

---

### P2-Milestone 2 — Browser Microphone Capture & PCM Pipeline

**Deliverable:** Raw 16-bit PCM at 16kHz available for streaming.

- [ ] P2-M2-1: Create `src/audio/capture.js`
  - `startCapture(deviceId)` → `getUserMedia` → `AudioContext` → `MediaStreamSourceNode`
  - Connect to `AudioWorkletNode` for PCM extraction
  - Emit `pcm` events with `ArrayBuffer` chunks (~100ms each)
  - `stopCapture()` — stop tracks, suspend AudioContext
- [ ] P2-M2-2: Create `src/audio/pcm-processor.worklet.js`
  - `AudioWorkletProcessor` subclass
  - Input: float32 frames at device sample rate
  - Linear resample to 16kHz mono
  - Convert to Int16 PCM
  - `postMessage` to main thread every 100ms (4096 samples at 16kHz)
  - Handle `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` requirement
- [ ] P2-M2-3: Fallback: if `AudioWorklet` unavailable, use deprecated `ScriptProcessorNode`
  - Same resampling + PCM conversion logic
  - Log deprecation warning to console
- [ ] P2-M2-4: Unit test (Vitest): mock `AudioContext`, verify PCM output format (Int16Array, 16kHz)
- [ ] P2-M2-5: Wire `lcyt:audio-start` / `lcyt:audio-stop` events (already dispatched by audio-panel) to `capture.startCapture()` / `capture.stopCapture()`
- [ ] P2-M2-6: Wire capture output to audio level meter canvas in audio panel (AnalyserNode → canvas animation)

---

### P2-Milestone 3 — Google STT Backend Integration

**Deliverable:** Backend opens and relays a Google Cloud STT streaming session.

- [ ] P2-M3-1: Node.js backend: add `@google-cloud/speech` dependency to `packages/lcyt-backend`
- [ ] P2-M3-2: Python backend: add `google-cloud-speech` dependency to `python-packages/lcyt-backend/requirements.txt`
- [ ] P2-M3-3: Add `GOOGLE_APPLICATION_CREDENTIALS` env var support to both backends
- [ ] P2-M3-4: Create `packages/lcyt-backend/src/routes/stt.js`
  - `POST /stt/start` (JWT required): validate session, create STT stream config, return `{ sttSessionId }`
  - STT config: encoding=LINEAR16, sampleRateHertz=16000, languageCode from request body
  - `POST /stt/stop/:sttSessionId` (JWT required): close STT stream, remove from store
- [ ] P2-M3-5: Add WebSocket support to `packages/lcyt-backend/src/server.js`
  - Add `ws` library
  - Upgrade HTTP server to handle WebSocket connections at `/stt/stream/:sttSessionId`
  - Validate JWT from query param `?token=<jwt>` on upgrade
  - Pipe binary frames to STT stream; emit transcript JSON text frames
- [ ] P2-M3-6: Create `python-packages/lcyt-backend/lcyt_backend/routes/stt.py`
  - Mirror Node.js implementation using `flask-sock` for WebSocket
- [ ] P2-M3-7: Add STT session tracking to `store.js` / `store.py`
  - `createSttSession(sttSessionId, sttStream, sessionId)`
  - `getSttSession(sttSessionId)`, `removeSttSession(sttSessionId)`
  - Include STT sessions in TTL cleanup
- [ ] P2-M3-8: Integration test: send known PCM audio (pre-recorded WAV) as binary WebSocket frames, verify transcript event received

---

### P2-Milestone 4 — Frontend STT WebSocket Client

**Deliverable:** Browser streams audio to backend, receives and displays transcripts, auto-sends captions.

- [ ] P2-M4-1: Create `src/audio/stt-client.js`
  - `connect(backendUrl, token, sttConfig)` → POST `/stt/start`, open WebSocket to `/stt/stream/:id?token=<jwt>`
  - `sendChunk(pcmBuffer: ArrayBuffer)` → send binary WebSocket frame
  - Emit events: `interim`, `final`, `error`, `closed`
  - `disconnect()` → POST `/stt/stop`, close WebSocket
- [ ] P2-M4-2: Wire audio pipeline to STT client in `capture.js`
  - `capture.on('pcm')` → `sttClient.sendChunk(chunk)` when STT session active
- [ ] P2-M4-3: Create `src/ui/stt-panel.js`
  - Add as a third panel or collapsible section in left column below caption-view
  - Interim transcript: italic, greyed, updates in place
  - Final transcript: each result appended as new `<p>` in distinct color
  - "Send" button on each final result → `session.send(transcript)` (manual mode)
  - "Send all pending" button
- [ ] P2-M4-4: Auto-send mode
  - Toggle in STT panel: "Auto-send final results"
  - `sttClient.on('final')` → debounce 500ms → concatenate pending finals → `session.send()`
  - Persist auto-send preference to localStorage
- [ ] P2-M4-5: Confidence threshold filtering
  - Skip auto-send if confidence < threshold (configurable, see P2-M5)
  - Show low-confidence results in red in STT panel; still allow manual send
- [ ] P2-M4-6: STT status indicator in status bar
  - Show 🎤 (recording) when capture active, — when idle
  - Show `STT: 450ms` latency (time from last binary send to last final result)
- [~] P2-M4-7: Start/stop STT session controls
  - "Start Listening" / "Stop Listening" buttons exist in audio panel; dispatch `lcyt:audio-start` / `lcyt:audio-stop`
  - Full wiring to `capture.startCapture()` + `sttClient.connect()`: **not yet** (requires P2-M2 + P2-M4-1)
  - Disable if session not connected: **not yet wired**

---

### P2-Milestone 5 — STT Configuration & Quality Controls

**Deliverable:** Configurable STT parameters exposed in UI.

- [x] P2-M5-1: Expand audio settings tab with STT configuration section (implemented in `src/ui/audio-panel.js`)
- [x] P2-M5-2: Language code selector
  - Type-to-filter `<input>` over curated list of ~30 common language codes with display names
  - Persist to localStorage as `lcyt-stt-lang`
- [x] P2-M5-3: Enable automatic punctuation checkbox (default: on)
- [x] P2-M5-4: Profanity filter checkbox (default: off)
- [x] P2-M5-5: STT model selector: `latest_long`, `latest_short`, `telephony`, `video`, `medical_dictation`
- [x] P2-M5-6: Confidence threshold slider (0.0–1.0, step 0.05, default 0.7)
  - Visual indicator showing current threshold value
  - Apply to auto-send filtering (see P2-M4-5)
- [~] P2-M5-7: Max caption length input (default 80 chars)
  - UI input exists and persists to localStorage
  - Split logic (sentence boundary + char limit + 200ms delay between chunks): **not yet** (requires P2-M4)
- [ ] P2-M5-8: All STT config serialized into `POST /stt/start` request body; backend passes to Google STT `StreamingRecognitionConfig`

---

### P2-Milestone 6 — Audio Monitoring & Debug Panel

**Deliverable:** Operational visibility tools for production use.

- [ ] P2-M6-1: Expandable debug drawer (collapsed by default)
  - Toggle button in status bar: "Debug ▾"
  - Slides up from bottom, above input-bar
- [ ] P2-M6-2: Raw STT response viewer
  - Last 20 STT response JSON objects, pretty-printed
  - Clear button
- [ ] P2-M6-3: Audio pipeline metrics
  - Chunks sent per second (rolling 5s average)
  - Bytes sent total
  - STT latency per utterance (chunk-send timestamp to final-result timestamp)
  - Display as simple text table in debug drawer
- [ ] P2-M6-4: STT latency in status bar: `STT: 450ms` (rolling average of last 5 utterances)
- [ ] P2-M6-5: Auto-reconnect for STT WebSocket
  - On `close` event (non-intentional): exponential backoff reconnect (1s, 2s, 4s, 8s, max 30s)
  - Re-POST `/stt/start` to get new sttSessionId, then reconnect WebSocket
  - Show reconnect attempt count in status bar during backoff
  - Stop retrying after 5 consecutive failures; show error toast
- [ ] P2-M6-6: WebSocket uptime and reconnect counter in debug drawer
- [ ] P2-M6-7: Export transcript button
  - Dump entire `sttPanel` final-result history as plaintext `.txt` file
  - Browser `<a download>` trick with `URL.createObjectURL(blob)`
