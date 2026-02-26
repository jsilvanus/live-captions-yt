# lcyt-web

Browser-based React UI for sending live captions to YouTube via the [lcyt-backend](../lcyt-backend) relay.

## Quick start

```bash
# From repo root
npm install
npm run web          # Vite dev server at http://localhost:5173
npm run build -w packages/lcyt-web   # Production build → dist/
```

---

## Using hooks and components in another project

The hooks and context providers are designed to be imported individually. You do not need the full app — pick what you need.

### Hooks (no React tree required)

Each hook manages its own state and accepts optional event callbacks:

```jsx
import { useSession }   from 'lcyt-web/src/hooks/useSession';
import { useFileStore } from 'lcyt-web/src/hooks/useFileStore';
import { useSentLog }   from 'lcyt-web/src/hooks/useSentLog';
import { useToast }     from 'lcyt-web/src/hooks/useToast';
```

### Context providers (for shared state across a component tree)

```jsx
import { SessionProvider, useSessionContext }   from 'lcyt-web/src/contexts/SessionContext';
import { FileProvider,    useFileContext }       from 'lcyt-web/src/contexts/FileContext';
import { SentLogProvider, useSentLogContext }    from 'lcyt-web/src/contexts/SentLogContext';
import { ToastProvider,   useToastContext }      from 'lcyt-web/src/contexts/ToastContext';
```

### Individual components

```jsx
import { CaptionView }   from 'lcyt-web/src/components/CaptionView';
import { InputBar }      from 'lcyt-web/src/components/InputBar';
import { SentPanel }     from 'lcyt-web/src/components/SentPanel';
import { StatusBar }     from 'lcyt-web/src/components/StatusBar';
import { SettingsModal } from 'lcyt-web/src/components/SettingsModal';
import { DropZone }      from 'lcyt-web/src/components/DropZone';
import { FileTabs }      from 'lcyt-web/src/components/FileTabs';
import { AudioPanel }    from 'lcyt-web/src/components/AudioPanel';
import { ToastContainer } from 'lcyt-web/src/components/ToastContainer';
```

---

## `useSession(opts?)`

Manages a `BackendCaptionSender` session: connect, send captions, handle SSE delivery results, sync clock.

```jsx
const session = useSession({
  // All callbacks are optional
  onConnected:     ({ sequence, syncOffset, backendUrl }) => void,
  onDisconnected:  () => void,
  onCaptionSent:   ({ requestId, text }) => void,       // fires on 202 response
  onCaptionResult: ({ requestId, sequence, serverTimestamp }) => void,  // SSE confirm
  onCaptionError:  ({ requestId, error, statusCode }) => void,          // SSE error
  onSyncUpdated:   ({ syncOffset, roundTripTime }) => void,
  onError:         (message: string) => void,
});
```

### Returned values

| Name | Type | Description |
|------|------|-------------|
| `connected` | `boolean` | Whether a session is active |
| `sequence` | `number` | Current YouTube caption sequence number |
| `syncOffset` | `number` | NTP clock offset in ms |
| `backendUrl` | `string` | Active backend URL |
| `apiKey` | `string` | Active API key |
| `streamKey` | `string` | Active stream key |
| `startedAt` | `number \| null` | Session start time (epoch ms) |
| `connect(cfg)` | `async fn` | Start session: `{ backendUrl, apiKey, streamKey }` |
| `disconnect()` | `async fn` | End session gracefully |
| `send(text)` | `async fn` | Send a single caption → `{ ok, requestId }` |
| `sendBatch(texts[])` | `async fn` | Send multiple captions → `{ ok, requestId }` |
| `sync()` | `async fn` | NTP clock sync → `{ syncOffset, roundTripTime, ... }` |
| `heartbeat()` | `async fn` | Check session liveness → `{ sequence, syncOffset, roundTripTime }` |
| `getPersistedConfig()` | `fn` | Read saved config from localStorage |
| `getAutoConnect()` | `fn` | Read auto-connect flag from localStorage |
| `setAutoConnect(bool)` | `fn` | Persist auto-connect flag |
| `clearPersistedConfig()` | `fn` | Remove saved config + auto-connect flag |

### Minimal example

```jsx
function CaptionSender() {
  const { connected, connect, disconnect, send } = useSession({
    onCaptionResult: (r) => console.log('Delivered:', r.sequence),
    onCaptionError:  (r) => console.error('Failed:', r.error),
  });

  return connected ? (
    <>
      <button onClick={() => send('Hello, YouTube!')}>Send</button>
      <button onClick={disconnect}>Disconnect</button>
    </>
  ) : (
    <button onClick={() => connect({ backendUrl: 'http://localhost:3000', apiKey: '...', streamKey: '...' })}>
      Connect
    </button>
  );
}
```

---

## `useFileStore(opts?)`

Manages loaded `.txt` caption files, active file selection, and per-file reading pointer (line position). Pointer positions are persisted to `localStorage`.

```jsx
const fileStore = useFileStore({
  onFileLoaded:     (file: { id, name, lines, pointer }) => void,
  onFileRemoved:    (fileId: string) => void,
  onActiveChanged:  ({ fileId, file }) => void,
  onPointerChanged: ({ fileId, fromIndex, toIndex, line }) => void,
});
```

### Returned values

| Name | Type | Description |
|------|------|-------------|
| `files` | `array` | All loaded files: `{ id, name, lines: string[], pointer: number }` |
| `activeId` | `string \| null` | ID of the currently active file |
| `activeFile` | `object \| null` | The active file object (computed) |
| `lastSentLine` | `{ fileId, lineIndex } \| null` | Set by `InputBar` to trigger flash animation in `CaptionView` |
| `setLastSentLine(val)` | `fn` | Set/clear the flash target |
| `loadFile(File)` | `async fn` | Read a browser `File` object → resolves with file entry |
| `removeFile(id)` | `fn` | Remove a file; auto-activates adjacent file |
| `setActive(id)` | `fn` | Make a file active |
| `cycleActive()` | `fn` | Rotate to the next file (used by Tab key) |
| `setPointer(id, index)` | `fn` | Move pointer to a specific line (clamped) |
| `advancePointer(id)` | `fn` | Move pointer forward one line (stops at end) |
| `clearPointers()` | `fn` | Remove all saved pointer positions from localStorage |

### Loading a file

```jsx
// From a file input
<input type="file" accept=".txt" onChange={e => loadFile(e.target.files[0])} />

// From drag-and-drop
function onDrop(e) {
  e.preventDefault();
  for (const file of e.dataTransfer.files) loadFile(file);
}
```

### Listening to pointer changes

```jsx
const fileStore = useFileStore({
  onPointerChanged: ({ fileId, fromIndex, toIndex, line }) => {
    console.log(`Line ${fromIndex} → ${toIndex}: "${line}"`);
  },
});
```

---

## `useSentLog()`

In-memory log of sent captions (newest-first, max 500 entries). Entries start as `pending` and transition to confirmed or error when SSE results arrive.

```jsx
const { entries, add, confirm, markError, updateRequestId, clear } = useSentLog();
```

### Entry shape

```ts
{
  requestId:       string,
  sequence:        number | undefined,   // undefined until SSE confirms
  text:            string,
  timestamp:       string,               // ISO 8601
  pending:         boolean,
  error:           boolean,
  serverTimestamp: string | undefined,   // from SSE confirmation
}
```

### Methods

| Name | Description |
|------|-------------|
| `add({ requestId, text, pending })` | Prepend a new entry |
| `confirm(requestId, { sequence, serverTimestamp })` | Mark entry (or batch) as delivered |
| `markError(requestId)` | Mark entry (or batch) as failed |
| `updateRequestId(oldId, newId)` | Remap temp batch IDs to real server ID after flush |
| `clear()` | Empty the log |

---

## `useToast()`

```jsx
const { toasts, showToast, dismissToast } = useToast();

showToast('Connected!', 'success', 3000);
// types: 'info' | 'success' | 'error' | 'warning'
// duration in ms; 0 = persistent until dismissed
```

---

## Using the full provider stack

For a complete app with all state wired together, wrap with `AppProviders`. This handles the `onCaptionResult`/`onCaptionError` wiring between `useSession` and `useSentLog` automatically:

```jsx
import { AppProviders } from 'lcyt-web/src/contexts/AppProviders';
import { useSessionContext } from 'lcyt-web/src/contexts/SessionContext';
import { useFileContext }    from 'lcyt-web/src/contexts/FileContext';

function MyApp() {
  return (
    <AppProviders>
      <MyLayout />
    </AppProviders>
  );
}

function MyLayout() {
  const { connected, send } = useSessionContext();
  const { activeFile }      = useFileContext();
  // ...
}
```

### Manual provider wiring (for custom setups)

If you need control over how the providers are ordered or wired:

```jsx
import { useSentLog }       from 'lcyt-web/src/hooks/useSentLog';
import { SentLogContext }   from 'lcyt-web/src/contexts/SentLogContext';
import { SessionProvider }  from 'lcyt-web/src/contexts/SessionContext';
import { FileProvider }     from 'lcyt-web/src/contexts/FileContext';
import { ToastProvider }    from 'lcyt-web/src/contexts/ToastContext';

function Providers({ children }) {
  const sentLog = useSentLog();
  return (
    <SentLogContext.Provider value={sentLog}>
      <SessionProvider
        onCaptionResult={sentLog.confirm}
        onCaptionError={sentLog.markError}
        onError={(msg) => console.error(msg)}
      >
        <FileProvider onPointerChanged={({ toIndex, line }) => console.log(toIndex, line)}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </FileProvider>
      </SessionProvider>
    </SentLogContext.Provider>
  );
}
```

---

## Component props reference

### `<StatusBar>`
```
onSettingsOpen?:      () => void
onToggleRightPanel?:  () => void
```
Reads from `SessionContext`. Displays connection status, sequence, and sync offset.

### `<SettingsModal>`
```
isOpen:   boolean
onClose:  () => void
```
Reads from `SessionContext` and `ToastContext`. Manages connection config, theme, and batch interval.

### `<DropZone>`
```
visible?:  boolean  (default: true)
```
Reads from `FileContext`. Calls `loadFile()` on drop or click.

### `<FileTabs>`
```
currentView:        'captions' | 'audio'
onViewChange:       (view: string) => void
dropZoneVisible:    boolean
onToggleDropZone:   () => void
```
Reads from `FileContext`.

### `<CaptionView>`
```
onLineSend?:  (text: string, fileId: string, lineIndex: number) => void
```
Reads from `FileContext`. Fires `onLineSend` on double-click; uses `lastSentLine` for flash animation.

### `<InputBar>` (forwardRef)
Exposes via ref:
```
ref.current.triggerSend()                            // send from active pointer
ref.current.sendText(text, fileId, lineIndex)        // send specific text + flash
ref.current.focus()
```
Reads from `SessionContext`, `FileContext`, `SentLogContext`, `ToastContext`.

### `<SentPanel>`
Reads from `SentLogContext`. No props.

### `<AudioPanel>`
```
visible:  boolean
```
Self-contained; dispatches `lcyt:audio-start` / `lcyt:audio-stop` custom events for future audio pipeline modules.

### `<ToastContainer>`
Reads from `ToastContext`. No props. Renders the floating toast stack.

---

## localStorage keys

| Key | Used by | Content |
|-----|---------|---------|
| `lcyt-config` | `useSession` | `{ backendUrl, apiKey, streamKey }` |
| `lcyt-autoconnect` | `useSession` | `"true"` or `"false"` |
| `lcyt-pointers` | `useFileStore` | `{ [filename]: lineIndex }` |
| `lcyt-theme` | `SettingsModal` | `"auto"` \| `"dark"` \| `"light"` |
| `lcyt-batch-interval` | `InputBar`, `SettingsModal` | Seconds as string, `"0"` = off |
| `lcyt-audio-device` | `AudioPanel` | deviceId string |
| `lcyt-stt-lang` | `AudioPanel` | BCP-47 language code e.g. `"en-US"` |
| `lcyt-stt-config` | `AudioPanel` | JSON: `{ model, punctuation, profanity, autosend, confidence, maxLen }` |
