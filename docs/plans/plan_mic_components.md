# Microphone components for lcyt-web (top-bar mic + Production "Listen" pane)

Status: draft (plan only, no code). Written 2026-10-19. Scope: `packages/lcyt-web`. All calls go through `/api/v1`.

## 1. What Juha asked for

Two components that share one listener:

1. **Top-bar mic** — always visible in the top status bar. Because it is always mounted, it is the thing that provides the actual in-browser listening and speech-to-text.
2. **Production "Listen" pane** — for the `/production` operator console: a blue/red Listen pane, a quick language switcher, and an attach/detach button.

Follow-up from Juha (same day): the WebSpeech API should have two modes, **prefer local** (on-device) and **normal** (cloud). He also hit `Explicit project admin/owner access required` when trying to select WebSpeech in the STT settings (section 3).

> **Revision 3 (Juha, 2026-10-19, latest):** decisions and the real cause of the 403 are in section 12; it takes precedence over sections 3, 4.5 (language), 11.1 (window content) and 11.4.

> **Revision 2 (Juha, 2026-10-19, later):** attach/detach and "Audio from" are redefined in section 11, which takes precedence over 4.3 and the attach/detach parts of 4.5 and 10.1.

> **Revision 2026-10-19 (Juha):** the Listen pane is a start/stop **STT** action, not only a browser mic. Which STT it starts (browser or server) follows the STT card setting, and server STT must name a **feed** as its audio source. This changes sections 4.3 and 4.5; see section 10, which takes precedence where they differ.

## 2. Inventory: everything involved in frontend STT / WebSpeech today

All paths under `packages/lcyt-web/src`.

| Piece | File | What it does |
|---|---|---|
| Recognizer hook | `hooks/useWebSpeech.js` (105 lines) | Wraps `SpeechRecognition`. `start/stop`, auto-restart in `onend` (100 ms), ignores `no-speech`, status `idle/listening/error`. |
| The engine | `components/AudioPanel.jsx` (1076 lines) | Everything else: three engines (`webkit`, Google Cloud `MediaRecorder` chunks, `server`), mic soft lock (`claimMic/releaseMic`, hold-to-steal, hold-to-speak), utterance start/end button and timer, optional client VAD, level meter, translation (`translateAll`), local caption files, batching, send via `session.send/construct`, server-STT SSE transcript log. Exposes `toggle/holdStart/holdEnd/holdSpeakStart/holdSpeakEnd/utteranceEndClick` through `useImperativeHandle`. |
| Always-mounted host | `contexts/AudioContext.jsx` | `AudioProvider` mounts a hidden `<AudioPanel visible={false}>` for the whole sidebar app (`main.jsx` `SidebarApp`, outside the router, so listening survives navigation). Publishes `listening, interimText, utterance*, toggle, utteranceEndClick, analyserRef, music`. `useAudioContext()` has a no-op fallback outside the provider. |
| Settings storage | `lib/sttConfig.js` | `lcyt-stt-engine`, `lcyt-stt-lang`, `lcyt-stt-config`, `lcyt-stt-local`; `COMMON_LANGUAGES`, `STT_MODELS`. Only `engine` change dispatches `lcyt:stt-config-changed`; lang does not. |
| Settings UI | `components/CCModal.jsx`, `components/CaptionsModal.jsx` | Engine, language, cloud config, "local processing" toggle with `SpeechRecognition.available/install`. Two near-identical copies. `CCModal` is the live one (`/settings?tab=cc`, `EmbedSettingsPage`, legacy `App`); `CaptionsModal` is not imported anywhere except by itself. |
| Server STT config UI | `components/panels/SttPanel.jsx`, `components/setup-hub/SttSection.jsx`, setup wizard | Per-project server provider (`webspeech`, `google`, `whisper_http`, `openai`, `auditor`), `GET/PUT /api/v1/stt/config`. |
| Source languages | `hooks/useSourceLanguages.js` | `GET /api/v1/stt/source-languages` (project list). Used only by the language `<select>` inside `AudioPanel`. |
| Other mic faces | `components/AudioPage.jsx` (`/audio`), `components/dashboard/AudioWidget.jsx`, `components/MobileAudioBar.jsx` (legacy `App`), `components/EmbedAudioPage.jsx` (`/embed/audio`, mounts a visible `AudioPanel`) | Each draws its own button and calls `useAudioContext()` or the `AudioPanel` ref. |
| Level meter | `components/audio/AudioLevelMeter.jsx` | rAF canvas over `analyserRef`. |
| Music detection | `hooks/useMusic.js`, `useMusicDetector.js`, `components/MusicChip.jsx` | Reads the same analyser. `MusicChip` is only in the legacy `StatusBar`, not in the new `TopBar`. |
| Stand-alone copy | `components/SpeechCapturePage.jsx` (`/mcp/:sessionId`) | Self-contained re-implementation of the webkit loop for MCP speech sessions. Intentionally context-free. |
| Triggers | `lib/metacode-runtime.js`, `components/InputBar.jsx` | `<!-- audio: start/stop -->` dispatches `lcyt:audio-capture`, handled in `AudioPanel`. |
| Top bar | `components/sidebar/Sidebar.jsx` `TopBar` | Brand, context, badges, ingest chip, jobs, quick actions. No mic or STT indicator. (The older `components/StatusBar.jsx`, used only by `/legacy`, has the server-STT chip and `MusicChip`.) |
| Production console | `components/production/workspace/` (`layout.js`, `paneTypes.js`, `panes/index.jsx`) | Pane registry; `captionInput` is the model for a small pane. |
| Backend, for reference | `lcyt-backend/src/routes/mic.js` (`POST /mic` claim/release, `session.mic_state` SSE), `routes/stt.js` | Soft mic lock; server STT config and `/start,/stop,/status,/events`. |

Not related: `CameraStreamPage.jsx` (`getUserMedia` for camera streaming).

### Problems found while reading (from code, not reproduced)

1. **"Prefer local" is stored but never applied.** `lcyt-stt-local` is written by `CCModal` and read nowhere else; neither `useWebSpeech` nor `AudioPanel` sets `recognition.processLocally`.
2. **Language change does not take effect.** `AudioPanel` calls `webkitSpeech.setLanguage?.()`, which the hook does not define. The hook's effect sets `recognition.lang`, but Chrome applies it only on the next `start()`. `getSttLang()` is also read on render and is not reactive.
3. **Stale closures.** Recognition handlers are bound at `start()`, so `pushFinalTranscript`/`sendTranscript` keep the `session` (and its `connected`) from the render that started listening.
4. **Meter is empty by default in webkit mode.** `attachMeter` runs only when a specific device id is stored, because `SpeechRecognition` exposes no audio.
5. **Two different "languages".** `/audio` and `AudioWidget` change the *caption/input* language (`inputLang`); `AudioPanel`'s select changes the *recognition* language (`sttConfig`). A quick switcher must say which one it changes.
6. **Context churn.** `AudioContext`'s value is a new object each render and includes `interimText`, so every consumer re-renders on every interim result.
7. All `AudioPanel` strings are hard-coded English.

## 3. The "Explicit project admin/owner access required" error

`PUT /api/v1/stt/config` is guarded by `requireProjectRole(db, 'setup')` (`lcyt-backend/src/routes/stt.js:184`; the message comes from `middleware/project-access.js:323`). That route stores the **server-side** STT config of the project, and the Setup Hub "STT service" card offers `webspeech` as a provider there. So:

- Picking WebSpeech in that card needs an **explicit** project admin or owner. A viewer/operator, an org member without a project role, or an API-key session (no `userId`) gets the 403. I cannot tell from here which of these Juha's account is; to be checked on the running instance (`GET /api/v1/keys` role for the user).
- More importantly, WebSpeech is a **browser** engine. It should not need a project-level setup permission at all. The browser-side choice (`lcyt-stt-engine`, `lcyt-stt-lang`, `lcyt-stt-local`) lives in `localStorage` and is changed in the CC settings tab or `AudioPanel`; it needs no backend write.

Decision proposed: WebSpeech engine and its two modes become a **per-browser** setting with no role gate (section 6). The server `webspeech` provider value stays valid for old rows but is hidden from the Setup Hub list (it never ran anything server-side; the browser does the recognition). The Setup Hub card shows a one-line pointer to the browser setting instead.

## 4. Design

### 4.1 One listener, several faces

Extract the recognizer/transport logic out of `AudioPanel` into a hook `hooks/useMicListener.js` (no JSX). `AudioProvider` calls it once, so the engine exists app-wide regardless of which page or top-bar variant is shown. `AudioPanel` shrinks to a presentational component (still used by `/embed/audio`, where there is no provider) built on the same hook.

Deviation from the literal wording, flagged: Juha described the top-bar component as the one providing the listening. I keep the engine in the provider and make the top-bar component its permanent face, because the top bar is not rendered on stand-alone pages (`/embed/*`, `/mcp/*`, kiosk pages) and the Listen pane must also work if the bar is hidden. Effect for the user is identical: the top-bar mic is always there and is the primary control. If Juha prefers the engine literally inside `TopBarMic`, the hook moves one level down with no API change.

### 4.2 Shared state shape (new `AudioContext` value)

Split into two contexts so interim text does not re-render everything:

- `AudioStateContext` (low frequency): `status` (`idle | starting | listening | error | unsupported | locked | needs-credential`), `engine` (`webkit | cloud | server`), `lang`, `setLang(code)`, `speechMode` (`local | normal`), `setSpeechMode`, `effectiveSpeechMode` (what the browser actually used), `attached`, `attach()`, `detach()`, `start()`, `stop()`, `toggle()`, `error`, `micHolder`, `analyserRef`, `music`, utterance fields as today.
- `AudioTranscriptContext` (high frequency): `interimText`, `lastFinal`. Subscribed to only by panes that show text.

`useAudioContext()` keeps returning the old shape (merged) so `AudioPage`, `AudioWidget`, `MusicChip` keep working unchanged; new code uses the two narrow hooks. Pure state derivation (`deriveMicStatus`) goes in `lib/micState.js` and is tested with `node:test`.

### 4.3 Attach / detach — proposed meaning

Juha's message does not define it, so this is my reading and the first open question. The mic already has a soft lock across clients (`claimMic/releaseMic`, `micHolder`). Proposed:

- **Attached** (default): this browser is the caption source. Starting claims the mic lock; final transcripts go through the normal pipeline (translation, batching, send).
- **Detached**: this browser does not feed captions. It releases the lock and discards transcripts. The recognizer may still run so the operator can *monitor* level and interim text (useful for checking the mic before going on air); the pane shows it clearly as "not sending".

Another client that holds the mic shows the pane as `locked` with the existing hold-to-steal gesture.

### 4.4 Component A — `TopBarMic` (top bar)

`components/mic/TopBarMic.jsx`, mounted in `TopBar` (`sidebar/Sidebar.jsx`) between the badges and the spacer (always rendered, also while disconnected; disabled with a tooltip until a project is connected, since sending needs a session).

- Round mic button (click = `toggle`, long press = hold-to-speak when that setting is on) with a status dot, plus a 40 px level meter (hidden under 480 px).
- Tooltip/popover on click-and-hold or chevron: engine, language, mode (local/normal), device, mic holder, error text. Language and mode are the same controls as in the pane (`MicLangSwitch`, `SpeechModeSwitch`).
- Colours from the existing `--color-*` tokens: idle neutral, listening red pulse, detached outlined, locked amber, error red outline.
- Keyboard: focusable, `aria-pressed`, an `aria-live="polite"` region announces start/stop and errors. Optional shortcut registered in the existing shortcuts dialog.
- Optional later: show `MusicChip` beside it (it is missing from the new top bar today).

### 4.5 Component B — `ListenPane` (Production console)

`components/mic/ListenPane.jsx`, registered as pane type `listen` ("Listen") in `paneTypes.js` (`TYPE_OPTIONS`, `PANE_META`) and `panes/index.jsx` (one `case`).

- A big blue/red button filling the pane: **blue** = ready/idle, **red** = listening and sending. Detached and monitor-only: blue outline with a "not sending" label; locked: amber.
- Level meter, interim text (small, one line), last sent final.
- Quick language switcher (`MicLangSwitch`): up to 4 pinned languages as chips plus a "more" dropdown. Source list = `useSourceLanguages()` (project list) with `COMMON_LANGUAGES` fallback; pinned set stored per browser. Changing language restarts the recognizer immediately (section 4.6). The switcher changes the **recognition** language and, with a checkbox "also caption language" (default on), `inputLang` too, so the two stop drifting.
- Attach/detach toggle (4.3).
- Speech mode toggle: local / normal (section 6).
- Added to the pane picker only. Built-in views are not changed (see 5.2).

### 4.6 Hook fixes the work depends on (Phase 0)

- Handlers via a "latest ref" so callbacks never see stale `session`.
- `restart({ lang, mode })`: set the new values, then `recognition.stop()` and let `onend` restart (the hook's own restart path), with a guard against rapid cycles; `stop()` stays a full stop.
- `lang` read from a small store (`sttConfig.js` gains `subscribeSttConfig`, and `setSttLang`/`setSttLocalProcessing` dispatch `lcyt:stt-config-changed`) instead of on every render.
- Always open a `getUserMedia` stream for the meter while listening (not only when a device id is set), reuse it for client VAD, stop it on stop.
- Map errors to user text: `not-allowed`, `service-not-allowed`, `language-not-supported`, `network`, `audio-capture`.

## 5. Where it plugs in

1. `Sidebar.jsx` `TopBar`: one element, `<TopBarMic />`.
2. `AudioContext.jsx`: provider calls `useMicListener`; two contexts; compat wrapper.
3. `production/workspace/paneTypes.js`, `panes/index.jsx`: `listen` pane. **Layout caveat:** `layout.js` persists the built-in views in `localStorage` (`STORAGE_VERSION` 4) and `initialLayoutState` returns the stored built-ins as-is, so adding `listen` to a built-in view by editing `defaultViews()` would not reach existing users, and bumping the version would wipe their custom views. Proposal: keep built-ins out of the first PR; then (optional, Phase 3) refresh `kind: 'builtin'` views from `defaultViews()` on load while keeping stored custom views, with a test in `test/production-layout.test.js`. Needs checking that nothing relies on built-ins being editable.
4. `AudioPage`, `AudioWidget`, `MobileAudioBar` later reuse `MicToggle`/`MicLangSwitch` (Phase 3) to remove duplicated button logic.
5. `CCModal`: speech mode radio replaces the single "local processing" checkbox; `CaptionsModal` (unused) deleted in the same PR as a separate commit.
6. i18n: new `mic.*` keys in `locales/{en,fi,sv}.js`; `test/i18n.test.js` guards parity.

## 6. WebSpeech modes: prefer local / normal

Setting `lcyt-stt-speech-mode`: `normal` (default; browser decides, usually Google cloud in Chrome) or `local` (prefer on-device). Migration: `lcyt-stt-local === '1'` maps to `local`.

- `local` behaviour is **prefer**, not require: before start, `SpeechRecognition.available({ langs: [lang], processLocally: true })`:
  - `available` → set `recognition.processLocally = true`.
  - `downloadable`/`downloading` → offer "Install language pack" (`SpeechRecognition.install`) in the popover/CCModal, and run in `normal` meanwhile; switch to local on the next restart once installed.
  - `unavailable`, or the API missing (Firefox/Safari, older Chrome) → run `normal`, show "on-device not available for fi-FI, using cloud".
  - A `language-not-supported` error while `processLocally` is true → fall back to `normal` once and remember per language for the session.
- `effectiveSpeechMode` is shown on the button tooltip so the operator can see whether audio left the machine (relevant for the data-protection position of the congregation; this should be stated in the CC tab help text).
- Mode change restarts the recognizer like a language change.
- Per-browser, no backend write, no role gate. The server `PUT /stt/config` and its `setup` tier are untouched by this.

Open: whether `processLocally` can be set after construction on all supporting Chrome versions — verify against the current spec and a Chrome 139+ build before coding; the plan assumes it can.

## 7. Phases (each its own small PR, docs/tests included)

- **Phase 0 — hook and settings fixes** (no visual change): `useMicListener` extraction, latest-ref handlers, `restart`, reactive STT config store, always-on meter, error mapping, `processLocally` applied. Tests with a fake `SpeechRecognition` (`test/helpers/fakeSpeechRecognition.js`): start/stop, auto-restart, lang change restarts, mode fallback order, no stale `connected`.
- **Phase 1 — context split + `TopBarMic`.** Component tests for each status.
- **Phase 2 — `ListenPane`, `MicLangSwitch`, attach/detach.** Pane registered in the picker only.
- **Phase 3 — polish:** CCModal mode radio and Setup Hub pointer (plus hide the server `webspeech` provider), optional builtin-view refresh, reuse in `AudioPage`/`AudioWidget`/`MobileAudioBar`, delete `CaptionsModal.jsx`, `MusicChip` in the top bar, optional auto-resume after reload when permission is already granted.

Docs to update with each PR: `packages/lcyt-web/CLAUDE.md` (hooks, contexts, pane list, test list), `docs/PLANS.md`.

## 8. Risks

- Web Speech API availability: Chrome/Edge/Safari only, Firefox none; `processLocally` and `available/install` are Chrome-recent. Everything degrades to `normal` or "unsupported".
- Continuous recognition can stop silently after long silence or network loss; the existing auto-restart handles most cases but needs a backoff and a visible "reconnecting" state.
- Two simultaneous `getUserMedia` streams (meter + recognizer) work in Chrome but can change echo-cancellation behaviour; test with a USB mic and the laptop mic.
- Not verified against a real service or real hardware; the code was read, not run.

## 9. Open questions for Juha

1. Attach/detach: is "attached = this browser is the caption source; detached = monitor only, not sent" what you meant? (Alternative: attach = bind the pane to a mic on another machine.)
2. Quick language switcher: change recognition language only, or also the caption language by default? I proposed both, with a checkbox.
3. Engine in the provider (recommended) or literally inside the top-bar component?
4. Are you an explicit admin/owner on the project, or logged in through an API key? That decides whether the 403 also affects other Setup Hub cards for you.

## 10. Revision: Listen = start/stop of the configured STT, with a feed as audio source

### 10.1 One button, two backends

The Listen pane (and the top-bar mic) calls a single `startStt()/stopStt()` on the shared listener. What runs is chosen by the **STT card setting** (Setup Hub "STT service" card, plus the per-browser engine in the CC tab):

| Card setting | `startStt()` does | Audio comes from | Status source |
|---|---|---|---|
| Browser (`webkit`, WebSpeech, mode local/normal) | `useMicListener` starts `SpeechRecognition` and claims the mic lock | this browser's microphone | local recognizer |
| Browser cloud (`cloud`, Google via `MediaRecorder`) | same hook, chunk upload | this browser's microphone | local |
| Server (`provider` = `google`, `whisper_http`, `openai`, `auditor`) | `POST /api/v1/stt/start` (what `AudioPanel.toggleServerStt` does today via `session.startStt`) | the **selected feed** | `GET /stt/status` + `/stt/events` SSE (`stt_started`, `stt_stopped`, `transcript`) |

The card setting needs one new field to decide this, because today the choice is split: `lcyt-stt-engine` is per browser (`webkit | cloud | server`) while the server provider is per project. Proposal: keep `lcyt-stt-engine` as the switch ("this browser" vs "server"), and show the effective choice on the pane ("Browser, fi-FI, on-device" / "Server: Whisper, feed Camera 1"). If the project config says `auditor` or another server provider and the browser engine is `server`, Listen starts the server STT.

The pane's attach/detach (4.3) applies to the browser engines only. For server STT it becomes "show / hide this operator's view of the transcript stream"; the server session is project-wide and not tied to a browser, so detaching must not stop it. Stop always stops the project's server STT (with a confirm when someone else started it, using `stt_started` info).

State derivation (`deriveMicStatus`) gets the server case: `idle | starting | listening | error | no-feed | feed-offline | needs-credential | locked`. The mic soft lock (`/mic`) is not used for server STT (`AudioPanel` skips it today).

### 10.2 Feed as the STT audio source

Today server STT has `audioSource` (`hls | rtmp | whep`, the transport) and a free-text `streamKey` (a MediaMTX path; `SttManager.start` falls back to the **api key**, i.e. the main stream). With feeds (`/api/v1/feeds`, plan feeds-and-devices) that free text is the wrong notion: the operator should pick a feed.

Proposal:

- STT config gains `feedId` (nullable). `streamKey` stays only as a legacy fallback. Resolution on start (backend, in `routes/stt.js` before `sttManager.start`): `feedId` → feed row → its `feedKey` and app; else legacy `streamKey`; else the project's **main (primary) feed**. A deleted feed makes start fail with a clear 409 "STT feed no longer exists" (no silent fallback to another feed, since transcribing the wrong camera is worse than not starting).
- `PUT /stt/config` and `POST /stt/start` accept `feedId`; GET returns it with the feed's name so the UI can show it. Stored in the existing per-key STT config table (one nullable column / JSON field; migration in both the SQLite and Postgres Prisma schemas).
- UI, Setup Hub STT card (`SttPanel.jsx`): replace the free-text stream key by a **feed picker** fed by `GET /feeds` (same data as `FeedsSection` / the egress `RelaySlotRow`: named feeds, the main feed marked "Main", DSK entry never offered, live dot per feed, linked device name). Transport (`hls/rtmp/whep`) stays as an advanced option.
- Quick override on the Listen pane: a small feed dropdown ("Audio from: Main / Camera 1 / Mixer out ...") that applies to the next start (or restarts a running server STT), so an operator can switch the audio feed without opening the Setup Hub. This is an operate action (like `/config/source-language`, which the backend deliberately leaves ungated), so it does **not** need the Setup tier: `POST /stt/start` already accepts the audio source per call. Saving it as the project default stays Setup tier.
- For the `auditor` provider (which pulls the stream itself) the feed supplies the stream key / source URL the auditor is given; `AuditorLiveAdapter` already takes `streamKey` and `sourceUrl`.
- Feed liveness: before start the pane reads the feed's `live` flag; if the feed is not publishing it shows "feed offline" and starts anyway only on a second click (HLS can lag at stream start).
- Browser engines ignore the feed (they listen to the microphone). Optionally later: let the browser STT take a **feed's audio** (WHEP in the browser into `MediaStream`; SpeechRecognition cannot take a stream, so this is not possible with WebSpeech; only the cloud engine could). Out of scope.

### 10.3 Things to verify before coding (not checked yet)

1. Which MediaMTX path and app a non-primary feed publishes to, versus what `SttManager` reads: it builds `HLS_RTMP_APP` (`live`) + key for rtmp and `hlsBase` + key for HLS, while feeds use the `feed` app and the primary feed uses the video app (`routes/feeds.js`). The feed -> STT path mapping (and whether MediaMTX exposes audio-only HLS for feed paths) must be confirmed against `FEED_RTMP_APP`, `mediamtx.yml` and `hls-segment-fetcher.js`.
2. Whether `getSttConfig/setSttConfig` and the `stt_config` table can take `feedId` without a destructive migration on both databases.
3. Multi-instance ownership: STT is per api key; the multi-instance work routes STT to an owner instance (L4). Starting with a feed must go through the same owner check.
4. Cache: `GET /stt/config` is cached client-side for 300 s (`Cache-Control: private, max-age=300`); a changed `feedId` must evict `/stt/config` in the web `api.js` cache, as other config writers do.

### 10.4 Effect on the phases

- Phase 0: unchanged (browser hook fixes).
- Phase 1: context gets `sttBackend` (`browser | server`), `feed`, `setFeed`, server status via the existing SSE; `TopBarMic` shows the backend and feed in its popover.
- Phase 2: `ListenPane` = Start/Stop STT + backend line + feed dropdown + language switcher (language applies to the active backend: browser `recognition.lang`, or `POST /stt/start { language }` for server) + attach/detach (browser only).
- New Phase 2b (backend, separate PR): `feedId` in STT config and start, feed resolution, tests in `routes/stt` and `stt-manager`, `docs/api` update.
- Phase 3: Setup Hub STT card feed picker; hide the server `webspeech` provider (see section 3).

### 10.5 Decisions (Juha, 2026-10-19)

- Exactly one STT runs at a time, chosen by the card. Listen never starts browser and server STT together.
- One STT session per project, for now. No per-feed or per-language parallel sessions.

## 11. Revision 2: attach/detach = floating always-on-top listener window; "Audio from"

### 11.1 Attach / detach (replaces 4.3)

Juha's intent: the operator can play it safe by keeping a small window on top of everything that guarantees the front-end listener stays mounted and alive. So:

- **Attach** opens a small always-on-top **Listener window** (mic/Listen button, level meter, status, language, "Audio from", interim text). **Detach** closes it. Nothing about the caption pipeline or the mic lock changes: attach/detach no longer means "send or don't send".
- The window is rendered by the same React app through a portal, so it shares the one `useMicListener` instance (no second recognizer, no state sync over `BroadcastChannel`). It only hosts the controls; the engine stays in `AudioProvider`.
- Mechanism, in order of preference: (1) **Document Picture-in-Picture** (`documentPictureInPicture.requestWindow({ width, height })`, Chromium 116+): a real always-on-top window that survives switching tabs/apps and keeps the opener page foreground-like; (2) fallback `window.open` popup (`PopOutButton.jsx` pattern; not always-on-top, user can pin it with the OS) with the same portal; (3) no window support: in-page floating mini bar fixed above everything (`position: fixed; z-index` top layer via the Popover API) that stays on every route. The Listen pane shows which mode attach used.
- Why it helps: browsers throttle or stop speech recognition and timers in hidden/background tabs, and a stray tab close or navigation to a standalone page unmounts the provider. A visible PiP window counts as visible content for the page, and its presence is a visible warning that the listener is live. **To verify in a real Chrome**: whether an open Document PiP window really prevents background-tab throttling and recognition stop when the main tab is hidden; this is the main assumption of the feature and has not been tested.
- Guards: `beforeunload` confirm while listening and attached; if the main page navigates to a route outside `SidebarApp` (embed/kiosk pages) the window closes; closing the window is detach (listening continues in the main tab unless the user also stops it); reopen state is remembered per browser (`lcyt.mic.attached`), and since opening a PiP window requires a user gesture the app shows a one-click "Re-attach" chip after a reload instead of opening it automatically.
- The top-bar mic gets the same attach/detach button (the pane and bar share `useMicWindow()`), so the window can be opened from anywhere.
- Server STT: the window then shows the server session (status, transcript, feed), but the server session runs without any window; detaching never stops it.

### 11.2 "Audio from" (replaces the language-only popover as the first control)

One dropdown in the Listen pane, the floating window and the bar popover. Its contents depend on the STT backend chosen by the card (10.1):

| Backend | "Audio from" lists | Stored as |
|---|---|---|
| Browser (WebSpeech / cloud) | **Audio inputs** of this machine from `navigator.mediaDevices.enumerateDevices()` (`audioinput`), plus "System default"; refreshed on `devicechange`; labels need a granted permission, so before the first grant the list shows generic names and a "Allow microphone to see names" item | existing `lcyt.audio.deviceId` (`KEYS.audio.deviceId`) |
| Server | **Feeds** from `GET /feeds`: video feeds and audio-only feeds (a video feed's audio is used), each with live dot, kind and linked device name; main feed marked | `feedId` (10.2) as the project default; the quick pick is per start |

Notes:
- WebSpeech limitation, to state in the UI: `SpeechRecognition` cannot be told to use a given device; it uses the browser's default input. Today `AudioPanel` only opens the chosen device for the **level meter** and hopes the recognizer shares it, which is not guaranteed. Plan: for the browser engine, the selection sets the meter/`MediaRecorder` (cloud engine) input exactly, and for WebSpeech shows a hint "browser default input is used for recognition; change it in Chrome settings" with the device name that `enumerateDevices` reports as default, unless a later check shows Chrome honours the constraint. To verify against current Chrome before claiming otherwise.
- A feed that is not publishing is shown greyed with "offline" and can still be selected.
- Changing "Audio from" while listening restarts the active backend (browser: re-open stream and recognizer; server: stop and start with the new feed, with a confirm because it interrupts the project-wide session).
- Feeds that carry no audio are not distinguishable from `GET /feeds` today; needs a backend flag or a probe. Open: does the feed row know whether it has audio?

### 11.3 Effect on phases

- Phase 1: `useMicWindow()` (Document PiP / popup / in-page fallback) and a `MicControls` component reused by the bar popover, the Listen pane and the floating window.
- Phase 2: `AudioFromSelect` (device list for browser, feed list for server), attach/detach button, the PiP verification test run on a real Chrome.
- Component tests with a fake `documentPictureInPicture`; the throttling question is a manual check on Juha's Windows machine, not a unit test.

### 11.4 Open questions

7. Is the always-on-top window what you meant by "hover small screen"? (Alternative: only an in-page floating bar.)
8. Should closing the floating window also stop browser listening, or leave it running? I assumed it keeps running.

## 12. Revision 3: decisions, window content, language, and the 403 root cause

### 12.1 Decisions (Juha, 2026-10-19)

- Engine stays in the hidden provider component; the top-bar mic is its visible control (section 4.1 confirmed; Juha prefers it to a top-bar-hosted engine).
- The floating window is **always-on-top**, with a **toggle in the window** for that. Document Picture-in-Picture windows are always on top by nature, so the toggle only applies to the popup fallback, where the browser offers no real "always on top": there the toggle can only re-raise the window (`window.focus()`) on a timer or on events, and the UI says plainly that a normal popup cannot be forced on top (OS pin needed). In PiP mode the toggle turns into "keep open / close when I leave the app". To verify.
- Closing the floating window keeps listening (question 8 answered yes).
- Floating window content (replaces 11.1's list): **STT start/stop button** (with backend, language and "Audio from"), a **sent captions list** (the `SentLogContext` entries, same data as `SentPanel`/`MiniSentLog`) and a **caption input box** (direct `CaptionContext.send`, like the existing `captionInput` pane, not the full `InputBar`). Level meter and interim text sit above the list. The same three blocks are reusable as one `ListenerConsole` component, which the Listen pane can also embed.

### 12.2 Language: recognition only (replaces the checkbox in 4.5)

Caption language is not one global value. The Caption Targets setup card defines, per target, the target language and whether the original, the translation, or both (original + translation) go to that target (`caption_targets`, `translationConfig.js`, `translateAll`). So the Listen pane's quick switcher changes the **recognition (source) language only**. It does not write `inputLang` and the "also caption language" checkbox is dropped. The pane may show, read-only, a line such as "Targets: YouTube fi + en, Viewer fi" taken from the targets list so the operator sees what the language change feeds. The `inputLang` badge in the top bar (a separate older notion) is out of scope; whether it should be retired in favour of the targets summary is a later question.

### 12.3 Section 3 corrected: the 403 comes from the token, not (only) the role

Juha uses **local mode** (`LCYT_INSTALL_MODE=local`), where the local user owns every project, yet gets "Explicit project admin/owner access required" when saving STT settings. Reading the code explains it:

- `SttSection.jsx` sends the **session token** (`session.getSessionToken()`), the JWT from `POST /live` which only contains `{ sessionId, apiKey }` (`routes/live.js`).
- `middleware/project-access.js` classifies that as kind `session` and authenticates it with `userId: null` (branch `kind === 'session'`).
- `requireProjectRole(db, 'setup')` calls `hasProjectRole(db, 'setup', apiKey, req.user?.userId)`, which returns `false` when `userId` is missing (`!userId`), so every Setup-tier write sent with a session token gets the 403, whoever the person is. Local mode does not help: its middleware only injects the local-owner token into requests that carry **no** credentials, and the web app does send one.
- The same pattern is used by other Setup Hub cards that write with the session token (Storage, Egress, Tally, WebRadio, Devices read `getSessionToken`); only `ViewportsSection` and `useSession` hold a `projectAccessToken`. Which of these writes are also gated needs a check, but the bug class is the same: **Setup-tier gates cannot pass for session-token callers.**

Status: derived from reading the code; not reproduced. A quick confirmation is one `PUT /api/v1/stt/config` with the session token versus the project/user token on Juha's local stack.

Proposed fix (separate small PR, before the mic work, since it blocks saving STT settings at all):

1. **Web (recommended, smallest):** Setup Hub cards that write Setup-tier config send the **project access token** (`session.projectAccessToken`, a user-kind token that carries `userId` and `projectRole`) for write calls, via one shared helper `setupAuthHeader(session)`; reads keep using whichever token they use today. Fall back to the session token (with the 403 surfaced as a readable "log in with a user account to change setup") when no project token exists.
2. **Backend (alternative/addition):** let a session token resolve its project owner for gating, i.e. `kind === 'session'` looks up the connecting user (store `userId` in the `POST /live` session when the request came with a user/project token, and put it in the session JWT). This also fixes API/CLI clients, but changes what a session token may do and needs a security review; so not recommended as the first step.
3. In local mode, additionally treat the injected local owner as satisfying every tier for any token on the same project (`ensureLocalIdentity` already makes the local user owner of all projects); optional because (1) covers the web.
4. Add a regression test: `PUT /stt/config` with a session token returns 403 (documents the gate) and with a project token of an owner returns 200.

The earlier proposal to hide the server `webspeech` provider from the Setup Hub list stays as a separate, smaller cleanup, but it is no longer presented as the cause of Juha's 403. Whether the browser-side WebSpeech setting needs no backend write at all (section 6) is unchanged and still the plan.

### 12.4 Open questions that remain

- Window toggle behaviour in the popup fallback (12.1) is a best effort; acceptable?
- Should the "targets summary" line on the pane link to the Caption Targets card?
- Fix 1 vs 2 for the 403 (my recommendation: 1 now, 2 only if API/CLI clients hit it).

## 13. Per-target "original + translation" checkbox (Juha, 2026-10-19)

Request: on the Caption Targets setup card each target gets a checkbox "original language + target language". If both languages are the same, show only one; otherwise show both.

What exists (read from `lcyt-backend/prisma/schema.prisma` and `caption-files.js`, UI side not checked):
- `caption_targets` rows (youtube / viewer / generic) have **no language column**.
- `translation_targets` rows already carry `lang`, `target`, `format`, `caption_target_id` (link to a caption target) and a per-row `show_original`.
- There is also a project-wide `translation_vendor_config.show_original`, and the browser keeps a global "Show original text" switch (`lcyt.translation.showOriginal`, sent as `showOriginal` with each caption). The send path still passes one global `showOriginal` and one `captionLang`.
- `composeCaptionText` returns the original when the translation equals it (same language, no-op), `original<br>translation` when `showOriginal`, else the translation only.

Proposal (a separate feature from the mic work, tracked here because the Listen pane shows the targets summary):
1. Caption Targets card: per target, a **language** selector (default "same as speech", i.e. no translation) and a checkbox **"Show original + translation"**. Stored on the existing `translation_targets` row linked by `caption_target_id` (`lang`, `show_original`), so no new column; a target with no linked row sends the original unchanged.
2. Delivery (`fanOutToTargets` / sender): compose per target, not once per caption: `composeCaptionText(text, target.lang, translations, target.showOriginal)`. When the target language equals the recognition language, the original is sent once regardless of the checkbox (the "if the same, drop either" rule). Mixed-language targets then receive different texts from the same final transcript.
3. The global "Show original text" switch and `translation_vendor_config.show_original` become the default for newly created targets only, then are deprecated; migration copies the global value into existing rows that have none.
4. The Listen pane shows the read-only summary "Targets: YouTube fi, Viewer fi + en" from these rows (section 12.2).
5. Tests: `caption-files` compose cases (same language, original+translation, translation only), per-target fan-out with two targets of different languages, card test for the checkbox.

Open: confirm that the current Caption Targets UI and the send path really only use the global switch (I read the schema and the compose helper, not every call site), and whether the translation vendor call should be made once per distinct language, not per target (yes, proposed).
