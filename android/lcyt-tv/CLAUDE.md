# `android/lcyt-tv` — Android TV Caption Viewer

Kotlin + Jetpack Compose for TV app. Subscribes to the public `GET /viewer/:key` SSE endpoint and displays captions full-screen on Android TV / Fire TV devices. No authentication required — uses the **viewer target** type configured in the web UI (CC → Targets tab).

**Min SDK:** API 21 (Android 5.0 / Fire TV Gen 1+)
**Build tool:** Gradle with version catalog (`gradle/libs.versions.toml`)

**Key source files (`app/src/main/java/fi/lcyt/tv/`):**
- `SseClient.kt` — OkHttp streaming SSE client; emits typed `SseEvent`s; exponential-backoff reconnect (1 s → 30 s max)
- `CaptionViewModel.kt` — `StateFlow`-driven state; persists `backendUrl` + `viewerKey` in `SharedPreferences`; default backend URL: `https://api.lcyt.fi`
- `SettingsScreen.kt` — D-pad-friendly settings screen; only the viewer key is required from the user
- `MainActivity.kt` — Compose entry point; full-screen viewer with large current caption, dimmed history list, status dot; Menu key opens settings

**SSE payload received** (from `GET /viewer/:key`):
```json
{ "text": "...", "composedText": "original<br>translation", "sequence": 42,
  "timestamp": "2026-03-10T12:00:00.000", "translations": { "fi-FI": "..." } }
```
`composedText` is displayed by default (mirrors `viewerUtils.js` behaviour). `<br>` splits original and translation onto separate lines.

**Configuration:**
- First launch → settings screen → enter viewer key (backend URL pre-filled)
- Settings persisted in `SharedPreferences`
- Deep-link: `lcyt-tv://viewer?server=https://api.lcyt.fi&key=myevent` (scannable QR from web UI)

**Build:**
```bash
cd android/lcyt-tv
./gradlew assembleDebug   # debug APK
./gradlew assembleRelease # release APK (requires signing config)
```

---

The `viewer` target type and its SSE payload shape are defined by `GET /viewer/:key` in `packages/lcyt-backend` — see the Caption Target Architecture convention in root `CLAUDE.md`.
