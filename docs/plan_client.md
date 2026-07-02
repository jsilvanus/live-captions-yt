# Web GUI Client Plan — `lcyt-web`

## Overview

A browser-based GUI client that mirrors the UX of `lcyt-cli` fullscreen mode. It connects to `lcyt-backend` via `BackendCaptionSender`, allows loading multiple text files as caption scripts, displays each file's lines with an active-line pointer, and provides a bottom input bar for sending captions. The client is a static single-page application (SPA) that can be served from any HTTP host, including alongside `lcyt-backend`.

---

## Core Concepts

### BackendCaptionSender Integration

`packages/lcyt/src/backend-sender.js` already exists and uses the Fetch API — it is browser-compatible out of the box. The web client imports it directly. The sender handles:

- `POST /live` — register a session (returns JWT)
- `POST /captions` — send captions
- `POST /sync` — NTP-style clock sync
- JWT storage and per-request `Authorization` header

### File Management Model

Each loaded file is tracked in an in-memory array. Per-file state:

```
{
  id: string,           // UUID generated on load
  name: string,         // filename
  lines: string[],      // array of non-empty trimmed lines
  pointer: number,      // current active line index (0-based)
}
```

Pointer positions are persisted to `localStorage` keyed by filename (best-effort; filename is not unique across directories, but sufficient for MVP).

### Session State

```
{
  backendUrl: string,
  apiKey: string,
  streamKey: string,
  token: string,        // JWT from POST /live
  sessionId: string,
  sequence: number,
  syncOffset: number,
  connected: boolean,
}
```

Persisted (except token) in `localStorage`.

---

## Architecture

### Package Location

```
packages/lcyt-web/
```

A new npm workspace package. Built with **Vite** (zero-config, ESM-native, excellent for vanilla JS or lightweight frameworks). The app is pure **vanilla JS + HTML/CSS** (no React/Vue/Svelte) — the UI state is simple enough that a framework adds more weight than benefit for MVP.

### Directory Structure

```
packages/lcyt-web/
├── index.html               # Single HTML entry point
├── package.json
├── vite.config.js
├── src/
│   ├── main.js              # App bootstrap
│   ├── session.js           # BackendCaptionSender wrapper + session state
│   ├── file-store.js        # File list, pointer management, localStorage sync
│   ├── sent-log.js          # In-memory sent captions ring buffer
│   ├── ui/
│   │   ├── app-shell.js     # Top-level layout manager
│   │   ├── drop-zone.js     # Drag-and-drop + file-picker component
│   │   ├── file-tabs.js     # Tab bar for loaded files
│   │   ├── caption-view.js  # Line list with active-line highlight + pointer
│   │   ├── sent-panel.js    # Right panel: sent captions log
│   │   ├── input-bar.js     # Bottom input bar + send button
│   │   ├── status-bar.js    # Sequence, connection state, sync
│   │   └── settings-modal.js # Stream key, API key, backend URL, sync
│   └── styles/
│       ├── reset.css
│       ├── layout.css
│       └── components.css
└── public/
    └── favicon.ico
```

### Runtime Dependencies

- `lcyt` (workspace: `../lcyt`) — for `BackendCaptionSender`
- Vite (dev + build)
- No UI framework dependencies in MVP

---

## Layout Design

```
┌─────────────────────────────────────────────────────────────────────┐
│  lcyt-web  [● Connected]  Seq: 42  [⚙ Settings]                    │  ← header/status-bar
├─────────────────────────┬───────────────────────────────────────────┤
│ [file1.txt] [file2.txt] │                                           │  ← file-tabs (left) | sent-panel (right)
├─────────────────────────┤  Sent Captions                           │
│ ╔══════════════════════╗│  ─────────────────────────────────────   │
│ ║  DROP FILES HERE     ║│  #42 [12:03:01] Hello world              │
│ ║  (or click to open)  ║│  #41 [12:02:58] Good morning             │
│ ╚══════════════════════╝│  #40 [12:02:51] Welcome to the stream    │
│                         │                                           │
│  caption-view           │                                           │
│  ─────────────────────  │                                           │
│    Line 1               │                                           │
│    Line 2               │                                           │
│  ► Line 3 (active)      │                                           │
│    Line 4               │                                           │
│    Line 5               │                                           │
│                         │                                           │
├─────────────────────────┴───────────────────────────────────────────┤
│  > [input box — Enter: send current line | type: send custom]  [▶] │  ← input-bar
└─────────────────────────────────────────────────────────────────────┘
```

When no file is loaded, the left panel shows the drop-zone prominently. Once files are loaded, the drop-zone collapses to a small "+" tab in the tab bar and the caption-view takes over.

---

## MVP Milestones

---

### Milestone 1 — Project Scaffold & Backend Connection

**Goal:** Runnable skeleton in the browser that can establish a session with `lcyt-backend`.

#### Steps

1. **Create `packages/lcyt-web/` workspace**
   - Add `package.json` with `name: "lcyt-web"`, declare `lcyt` as a workspace dependency
   - Add `lcyt-web` to root `package.json` workspaces array
   - Add `"web": "vite"` and `"build:web": "vite build"` scripts to root `package.json`

2. **Vite configuration**
   - `vite.config.js`: resolve `lcyt` from workspace, set `root: '.'`, `build.outDir: 'dist'`
   - Configure Vite dev server to proxy `/live`, `/captions`, `/sync` to backend (avoids CORS in dev)

3. **HTML skeleton**
   - `index.html`: basic semantic structure — `<header>`, `<main>`, `<footer>` placeholders
   - Link `src/main.js` as ES module

4. **CSS reset and layout grid**
   - `reset.css`: box-sizing, margin/padding normalization
   - `layout.css`: CSS grid — two-column main (60/40), fixed header, fixed footer input bar

5. **Session module (`src/session.js`)**
   - Wrap `BackendCaptionSender` from `lcyt`
   - `connect({ backendUrl, apiKey, streamKey })` — calls `sender.start()`, stores returned JWT/sessionId/sequence
   - `disconnect()` — calls `sender.end()` (DELETE /live)
   - `send(text)` / `sendBatch(captions)` — delegates to sender
   - `sync()` — delegates to sender
   - Persist `{ backendUrl, apiKey, streamKey }` to `localStorage`
   - Emit custom DOM events on state changes: `lcyt:connected`, `lcyt:disconnected`, `lcyt:sequence-updated`

6. **Settings modal (basic)**
   - Input fields: Backend URL, API Key, Stream Key
   - "Connect" button — calls `session.connect()`
   - "Disconnect" button
   - Load persisted values from `localStorage` on open
   - Show connection error messages inline

7. **Status bar**
   - Listen for `lcyt:connected` / `lcyt:disconnected` events
   - Display: connection status indicator (green dot / grey dot), sequence number, backend URL (truncated)
   - "Sync" button triggers `session.sync()` and updates `syncOffset` display
   - Settings gear icon opens settings modal

8. **Manual integration test**
   - Start `lcyt-backend`, open browser at dev server
   - Enter valid API key + stream key in settings
   - Confirm connection succeeds (status bar turns green, sequence shown)

---

### Milestone 2 — File Loading & Multi-File Management

**Goal:** Users can load text files, see their contents line by line, and navigate between files.

#### Steps

1. **File store (`src/file-store.js`)**
   - Internal array of file objects: `{ id, name, lines, pointer }`
   - `loadFile(file: File)` — reads via `FileReader`, splits on `\n`, filters blank lines, assigns UUID
   - `setActive(id)` — marks a file as active
   - `getActive()` — returns current active file object
   - `setPointer(id, lineIndex)` — updates pointer for a file
   - `advancePointer(id)` — increments pointer (wraps at end)
   - Pointer positions persisted to `localStorage` under key `lcyt-pointers` as `{ [filename]: lineIndex }`
   - On load, restore pointer from localStorage if filename matches
   - Emit `lcyt:files-changed` and `lcyt:active-changed` events

2. **Drop-zone component (`src/ui/drop-zone.js`)**
   - `<div class="drop-zone">` with drag-over / drag-leave / drop handlers
   - On `dragover`: `preventDefault()`, add CSS class `drop-zone--active`
   - On `drop`: extract `dataTransfer.files`, call `fileStore.loadFile()` for each `.txt` file, ignore others; show brief error if non-text file dropped
   - Click handler: programmatically trigger `<input type="file" accept=".txt" multiple>`
   - Show placeholder text "Drop text files here or click to browse" when no files loaded
   - Collapse to a small "+" add-file button once files are present (CSS class toggle)

3. **File tabs component (`src/ui/file-tabs.js`)**
   - Render one tab per loaded file showing filename (truncated to 20 chars)
   - Active tab is visually distinct
   - Click tab → `fileStore.setActive(id)`
   - "×" close button on each tab → remove file from store (confirm if file has pointer > 0)
   - "+" tab at end → triggers file picker (same as drop-zone click)
   - Listen to `lcyt:files-changed` to re-render

4. **Caption view component (`src/ui/caption-view.js`)**
   - Renders lines of active file as `<li>` elements inside a scrollable `<ul>`
   - Active line gets class `caption-line--active` with left arrow indicator `►`
   - Auto-scroll: keep active line visible (`scrollIntoView({ block: 'center' })`)
   - Click on any line → `fileStore.setPointer(activeId, clickedIndex)` (allows manual repositioning)
   - Listen to `lcyt:active-changed` and `lcyt:files-changed` to re-render
   - Performance: for files >1000 lines, use virtual scrolling (render only visible window + buffer)

5. **State wiring**
   - On `lcyt:active-changed`: caption-view re-renders for new active file
   - On `lcyt:files-changed`: tabs re-render; caption-view re-renders
   - When switching files, caption-view scrolls to that file's saved pointer

6. **Manual integration test**
   - Drag a `.txt` file — tabs appear, content displayed, pointer at line 0
   - Load second file — two tabs visible, switching between them restores pointer per file
   - Reload page — pointer positions restored from localStorage

---

### Milestone 3 — Caption Sending

**Goal:** Sending captions to YouTube via the backend, with the same UX logic as lcyt-cli.

#### Steps

1. **Input bar component (`src/ui/input-bar.js`)**
   - `<input type="text" placeholder="Enter: send current line | type text: send custom">` + `<button>▶</button>`
   - On Enter key or button click:
     - If input is empty → send-pointer mode (see step 3)
     - If input has text → send-custom mode (see step 4)
   - Up/Down arrow keys navigate pointer (prevent default page scroll when focused)
   - Input clears after successful send
   - Disable input and button when not connected

2. **Sent log (`src/sent-log.js`)**
   - Ring buffer of max 500 entries: `{ sequence, text, timestamp }` (ISO string, local)
   - `add(entry)` — push to buffer, emit `lcyt:sent-updated`
   - `getAll()` — return array newest-first

3. **Send-pointer mode**
   - Get active file's current pointer line
   - If no file loaded or file is empty: do nothing (flash input bar red briefly)
   - Call `session.send(lineText)` → on success:
     - `fileStore.advancePointer(activeId)` — caption-view scrolls to new active line
     - `sentLog.add({ sequence, text, timestamp })`
     - Emit `lcyt:sequence-updated`
   - On error: show inline error in status bar

4. **Send-custom mode**
   - Call `session.send(inputText)` with the typed text
   - On success: `sentLog.add(...)`, clear input; pointer does NOT advance
   - On error: show inline error in status bar

5. **Sent panel component (`src/ui/sent-panel.js`)**
   - Scrollable list of sent captions, newest at top
   - Each row: `#<seq>  [HH:MM:SS]  <text>` (truncated to one line)
   - Auto-scroll to top on new entry (newest-first)
   - Max height fills the right column
   - Listen to `lcyt:sent-updated` to re-render

6. **Sequence display**
   - Status bar shows `Seq: <number>` — updated on `lcyt:sequence-updated`

7. **Error handling**
   - Network errors: "Network error — retrying…" in status bar (no auto-retry in MVP)
   - HTTP 401: "Session expired — please reconnect" + auto-disconnect
   - HTTP 4xx/5xx from YouTube (passed through): show code + message in status bar

8. **Manual integration test**
   - Load file, connect, press Enter repeatedly — lines advance, sent panel fills, sequence increments
   - Type custom text, press Enter — sent panel shows it, pointer unchanged
   - Disconnect — input disables; reconnect — sending resumes

---

### Milestone 4 — Settings, Stream Key, and Persistence

**Goal:** Full settings panel, persistent configuration, and operational controls.

#### Steps

1. **Expand settings modal (`src/ui/settings-modal.js`)**
   - Sections:
     - **Connection**: Backend URL (default `http://localhost:3000`), API Key (masked), Stream Key (masked toggle)
     - **Status**: Connected/disconnected indicator, Session ID, Sync offset (ms)
     - **Actions**: Connect, Disconnect, Sync Now, Heartbeat test
   - Show last-connected time

2. **Stream key masking**
   - Stream key and API key fields show `●●●●●●●●●●●●` by default
   - Eye icon to reveal/hide
   - Values never logged to console

3. **Config persistence**
   - On successful connect: save `{ backendUrl, apiKey, streamKey }` to `localStorage`
   - On page load: restore settings fields from `localStorage`
   - "Clear saved config" button in settings (erases localStorage keys)

4. **Sync controls**
   - "Sync Now" button: calls `session.sync()`, shows updated syncOffset in modal
   - "Heartbeat" button: calls `POST /captions` with empty heartbeat; shows round-trip time

5. **Keyboard shortcut: open settings**
   - `Ctrl+,` or `⌘+,` opens settings modal
   - `Escape` closes modal

6. **Auto-reconnect on page load**
   - If persisted config exists and `autoConnect` flag is set, attempt `session.connect()` on startup
   - Show "Connecting…" in status bar during attempt
   - Opt-in checkbox in settings: "Auto-connect on startup"

7. **Manual integration test**
   - Reload page — config fields populated from localStorage
   - Auto-connect connects automatically
   - Sync Now updates syncOffset display

---

### Milestone 5 — Polish, Keyboard Navigation, and Packaging

**Goal:** Production-ready MVP suitable for actual use during a live stream.

#### Steps

1. **Keyboard navigation (when caption-view is focused)**
   - `↑` / `↓` — move pointer up/down one line
   - `Page Up` / `Page Down` — move pointer 10 lines
   - `Home` / `End` — jump to first/last line
   - `Tab` — cycle between loaded file tabs
   - Keyboard focus ring visible on caption-view (accessibility)

2. **Visual pointer indicator**
   - Active line has `►` in the left gutter, distinct background color, and bold text
   - Previous-active line gets a faint "sent" indicator for 2 seconds after sending

3. **Scroll behavior**
   - Auto-scroll caption-view to keep active line in center of visible area after pointer move
   - Input bar's send button animates briefly on send (flash or ripple)

4. **Dark/light theme**
   - Default: dark theme (matches terminal aesthetic of lcyt-cli)
   - `prefers-color-scheme` media query for automatic switching
   - Optional manual toggle in settings

5. **Responsive layout**
   - Below 768px: sent panel hides by default, toggle button reveals it as overlay
   - Minimum functional width: 480px

6. **Error UX**
   - Toast notification system for transient errors (auto-dismiss 5s)
   - Persistent error banner for critical failures (auth expired, backend unreachable)

7. **Empty/edge states**
   - No files loaded: drop-zone fills entire left panel, helpful instruction text
   - File with 0 lines after filtering: show message "No caption lines found in this file"
   - Pointer at last line: "End of file" indicator; Enter still sends but pointer stays

8. **Vite production build**
   - `vite build` output to `packages/lcyt-web/dist/`
   - Add `npm run build:web` to root scripts
   - Add `npm run preview:web` for local preview of built output
   - Output is a static directory deployable to any web host or served by `lcyt-backend`

9. **Serve from lcyt-backend (optional)**
   - Add optional static file serving in `packages/lcyt-backend/src/server.js`
   - If `STATIC_DIR` env var is set, serve it at `/`
   - This allows a single process to serve both API and web client

10. **End-to-end smoke test**
    - `npm run build:web`
    - Start backend, serve built client, connect, load file, send captions
    - Verify captions appear on YouTube live test stream

---

## Phase 2 — Browser Audio → Google STT → Captions

### Overview

Phase 2 adds a real-time speech-to-text pipeline: capture audio from a browser microphone, stream it to Google Cloud Speech-to-Text (STT), receive transcript text, and send it to `lcyt-backend` as captions automatically. This is a significant architectural addition requiring new backend routes for audio relay and new frontend audio capture/streaming code.

---

### New Components

#### Frontend
- **Audio source selector** — microphone enumeration via `MediaDevices.enumerateDevices()`
- **Audio capture** — `getUserMedia` → `AudioWorkletNode` (PCM extraction) → WebSocket/binary streaming
- **STT result panel** — live interim/final transcript display alongside caption-view
- **STT controls** — start/stop listening, language selector, confidence threshold slider

#### Backend additions
- **`POST /stt/start`** — create Google STT streaming session, return WebSocket URL or session token
- **`WS /stt/stream`** — WebSocket endpoint: receives binary PCM audio from client, relays to Google STT, emits transcript events back to client
- **`POST /stt/stop`** — close STT session

#### Python backend additions (mirror)
- Same `stt` Blueprint with identical API

---

### Phase 2 Milestones

---

### P2-Milestone 1 — Audio Source Selection UI

**Goal:** Users can enumerate audio sources and grant microphone permission.

#### Steps

1. Add "Audio" section to settings modal with a "Sources" sub-panel
2. On open, call `navigator.mediaDevices.enumerateDevices()` and filter to `audioinput`
3. Render a `<select>` of available microphones (label + deviceId)
4. "Request permission" button — calls `getUserMedia({ audio: { deviceId } })` and immediately stops tracks (permission prompt only)
5. Show permission status: Granted / Denied / Prompt
6. Persist selected `deviceId` to `localStorage`
7. Show audio level meter (live `AnalyserNode` visualization) when a source is selected and active

---

### P2-Milestone 2 — Browser Microphone Capture & PCM Pipeline

**Goal:** Capture microphone audio and convert to raw PCM suitable for Google STT.

#### Steps

1. Create `src/audio/capture.js`
   - `startCapture(deviceId)` — `getUserMedia` → `AudioContext` → `MediaStreamSourceNode`
   - Attach `AudioWorkletProcessor` (inline WASM or JS) to extract raw 16-bit PCM at 16kHz
   - PCM chunks emitted as `ArrayBuffer` events at ~100ms intervals
   - `stopCapture()` — stops tracks, closes AudioContext

2. Create `AudioWorklet` processor (`src/audio/pcm-processor.js`)
   - Input: float32 stereo/mono frames at device sample rate
   - Resample to 16kHz mono (linear interpolation sufficient for MVP)
   - Convert to Int16 PCM
   - Post message to main thread

3. Audio level meter component (`src/ui/audio-meter.js`)
   - `AnalyserNode` → `getByteTimeDomainData` → canvas bar render
   - Updates at 60fps via `requestAnimationFrame`
   - Show RMS level as colored bar (green → yellow → red)

4. Unit test: capture 1 second of silence, verify output is `Int16Array` at 16kHz

---

### P2-Milestone 3 — Google STT Backend Integration

**Goal:** Backend can open and manage a Google Cloud STT streaming session.

#### Steps

1. Add `@google-cloud/speech` (Node.js) or `google-cloud-speech` (Python) dependency to `lcyt-backend`
2. Add `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_API_KEY` env var support
3. Create `src/routes/stt.js` (Node.js) / `routes/stt.py` (Python):
   - `POST /stt/start` — validate JWT, create STT streaming client with config (language, encoding, sampleRate), return `{ sttSessionId }`
   - `WS /stt/stream/:sttSessionId` — WebSocket handler:
     - Validate JWT from query param or first message
     - On binary message: pipe PCM chunk to STT stream
     - On STT response: emit `{ type: 'interim'|'final', transcript, confidence }` as JSON text frame
   - `POST /stt/stop/:sttSessionId` — close STT stream, clean up

4. Add WebSocket support to backend server (`ws` library for Node.js, `flask-sock` for Python)
5. Session store: track active STT sessions alongside caption sessions, same TTL cleanup

6. Integration test: send known audio WAV as binary WebSocket frames, verify transcript returned

---

### P2-Milestone 4 — Frontend STT WebSocket Client

**Goal:** Browser connects to backend STT relay, streams audio, receives transcripts.

#### Steps

1. Create `src/audio/stt-client.js`
   - `connect(backendUrl, token)` — POST `/stt/start`, then open WebSocket to `/stt/stream/:id`
   - `sendChunk(pcmBuffer)` — send `ArrayBuffer` binary frame
   - Events: `interim`, `final`, `error`, `closed`
   - `disconnect()` — POST `/stt/stop`, close WebSocket

2. Wire capture pipeline to STT client:
   - `capture.on('pcm')` → `sttClient.sendChunk(pcmBuffer)`

3. STT result panel (`src/ui/stt-panel.js`)
   - Shows interim transcript in italic, greyed text (updates in place)
   - Final result appended as new line in distinct color
   - "Send to captions" button on each final result (manual confirm mode)
   - Auto-send mode toggle: final results automatically sent to `session.send()`

4. Auto-send pipeline:
   - When auto-send enabled: `sttClient.on('final')` → `session.send(transcript)` → `sentLog.add(...)`
   - Debounce: if another `final` arrives within 500ms, concatenate before sending (avoids choppy captions)

5. STT status indicator in status bar: 🎤 (listening) / — (idle)

---

### P2-Milestone 5 — STT Configuration & Quality Controls

**Goal:** Expose meaningful Google STT parameters in the UI.

#### Steps

1. Expand settings modal with "Speech Recognition" section:
   - Language code selector (type-to-filter from a curated list of common languages)
   - Punctuation: enable/disable automatic punctuation
   - Profanity filter: enable/disable
   - Model selector: `latest_long`, `latest_short`, `telephony`, `video` (Google STT model names)
   - Max alternatives slider (1–5)
   - Word confidence: show per-word confidence in STT panel if > 1 alternative

2. Confidence threshold slider (0.0–1.0, default 0.7)
   - Interim results below threshold shown in red; not auto-sent (see P2-Milestone 4, step 4)
   - Final results below threshold shown with warning indicator

3. Transcript chunking settings:
   - Max caption length (chars): split long final results into multiple `session.send()` calls
   - Sentence boundary detection: split on `.`, `!`, `?` before max-length cutoff

4. All STT config persisted to `localStorage` and sent in `POST /stt/start` request body

---

### P2-Milestone 6 — Audio Monitoring & Debug Panel

**Goal:** Operational visibility into the audio/STT pipeline for production use.

#### Steps

1. Expandable debug drawer (collapsed by default):
   - Raw STT response JSON viewer (last 20 responses)
   - Audio chunk send rate (chunks/sec)
   - STT latency per utterance (chunk-send to final-result time)
   - WebSocket connection uptime and reconnect count

2. STT latency display in status bar: `STT: 450ms`

3. Auto-reconnect for STT WebSocket:
   - On disconnect: exponential backoff reconnect (1s, 2s, 4s, max 30s)
   - Re-POST `/stt/start` to get new session, then reconnect WebSocket
   - Resume streaming without user intervention

4. Export transcript: "Save transcript" button exports the full `sttPanel` history as `.txt`

---

## Non-Goals (All Phases)

- Multi-user collaboration (one client per session)
- Caption editing/deletion after send
- YouTube API integration (stream status polling) — out of scope for web client MVP; may add in a patch
- Mobile app (PWA is fine as a side effect, not a primary target)
- Offline mode

---

## Open Technical Questions

1. **Vite proxy vs direct CORS**: For production, the web client and backend should share an origin or the backend must allow the client's origin. Simplest: serve `dist/` from `lcyt-backend` with `STATIC_DIR`. Document both options.

2. **API key distribution**: The web client needs an API key to call `POST /live`. In production, this should come from a config file or environment variable baked at build time (`VITE_API_KEY`), or entered manually by the operator in settings.

3. **AudioWorklet cross-origin isolation**: `AudioWorklet` requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. The backend must set these when serving the static client, or the workaround is to use `ScriptProcessorNode` (deprecated but works without COOP/COEP). Evaluate at P2-M2 time.

4. **Google STT billing**: Phase 2 requires a Google Cloud project with STT API enabled and billing configured. The backend handles credentials; the frontend only sends audio.
