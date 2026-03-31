---
id: plan/translate-client
title: "Client-side Caption Translation Pipeline"
status: implemented
summary: "Client-side real-time translation of captions before sending: vendor abstraction, multi-target routing (YouTube captions, viewer SSE, backend files, local files), and per-language viewer display."
---

# Plan: Caption Translation Pipeline

## Summary

Captions can be translated into one or more target languages before delivery. Translation runs entirely on the client (browser or CLI) before the caption reaches the backend. The backend receives both the original text and the pre-computed translations, then routes them to the appropriate targets (YouTube, viewer SSE, generic webhooks, backend caption files).

---

## 1. Configuration

### 1.1 Translation Settings

`packages/lcyt-web/src/components/TranslationModal.jsx`

Accessed via Settings → CC → Translation tab. Each translation entry specifies:

| Field | Description |
|-------|-------------|
| `lang` | BCP-47 language code (e.g. `fi-FI`, `de-DE`, `es-ES`) |
| `target` | Delivery mode: `captions`, `backend-file`, or `file` |
| `format` | File format (only for `file`/`backend-file`): `youtube` or `vtt` |
| `enabled` | Toggle without deleting the entry |

**Target modes:**

| Mode | What it does |
|------|-------------|
| `captions` | Translation is embedded in the YouTube caption (composed with the original text). Only one translation target may use this mode at a time — it is the "caption language". |
| `backend-file` | Translation is stored in a server-side caption file (downloaded later via `GET /file/:id`). The original is always stored alongside it. |
| `file` | Translation is written to a local browser file in real time using the File System Access API. |

### 1.2 Translation Vendor

Shared vendor setting applies to all translations:

| Vendor | Auth | Notes |
|--------|------|-------|
| MyMemory | None (anonymous quota) | Default; free; rate-limited |
| Google Cloud Translation | API key | Paid; high quality; wide language support |
| DeepL | API key | Paid; high quality; fine-grained language codes |
| LibreTranslate | URL + optional key | Open-source; self-hosted or cloud |

### 1.3 Show Original

When `showOriginal` is true and a `captions`-mode translation exists, the YouTube caption displays:

```
Original text
Translated text
```

When false, only the translation is sent to YouTube.

### 1.4 localStorage Keys

| Key | Value |
|-----|-------|
| `lcyt-translations` | JSON array of translation config objects |
| `lcyt-translation-vendor` | Selected vendor string |
| `lcyt-translation-api-key` | API key for Google/DeepL |
| `lcyt-translation-libre-url` | LibreTranslate base URL |
| `lcyt-translation-show-original` | `"true"` or `"false"` |

---

## 2. Client-Side Translation Flow

`packages/lcyt-web/src/lib/translate.js` (inferred from AudioPanel and caption pipeline)

### 2.1 `translateAll(text, sourceLang, enabledTranslations)`

Called before every caption send when translations are configured.

```js
const { translationsMap, captionLang, localFileEntries } =
  await translateAll(text, sourceLang, enabledTranslations);
```

For each enabled translation entry:
1. If source language matches target language → use original text as translation (no API call).
2. Otherwise → call `translateText(text, sourceLang, targetLang)` via the configured vendor.
3. Route result based on `entry.target`:
   - `file` → push to `localFileEntries` for client-side file writing.
   - `captions` or `backend-file` → add to `translationsMap`; record `captionLang` if mode is `captions`.

All vendor calls are made in parallel (`Promise.allSettled`), so multiple translations do not add latency sequentially.

**Returns:**
```js
{
  translationsMap: { 'fi-FI': '…', 'de-DE': '…' },   // sent to backend
  captionLang: 'fi-FI',                                // the "captions" target language (or null)
  localFileEntries: [{ lang: 'sv-SE', text: '…', format: 'vtt' }]
}
```

### 2.2 Vendor Dispatch (`translateText`)

```js
switch (vendor) {
  case 'google':         return translateGoogle(text, sourceLang, targetLang);
  case 'deepl':          return translateDeepL(text, sourceLang, targetLang);
  case 'libretranslate': return translateLibre(text, sourceLang, targetLang);
  case 'mymemory':
  default:               return translateMyMemory(text, sourceLang, targetLang);
}
```

All functions return `Promise<string>` (the translated text). On failure they throw; `translateAll` uses `Promise.allSettled` so a single translation failure does not block others.

### 2.3 Language Code Matching

`isSameLanguage(sourceLang, targetLang)` performs a normalised comparison that treats `en` and `en-US` as the same language, preventing unnecessary API calls when source and target are effectively equal.

---

## 3. Sending Translations to the Backend

`packages/lcyt/src/backend-sender.js` — `send()` and `sendBatch()`

The `translationsMap` and related metadata are included in the caption payload:

```http
POST /captions
Authorization: Bearer <token>
Content-Type: application/json

{
  "captions": [
    {
      "text": "Hello, world!",
      "timestamp": "2026-03-23T12:00:00.000",
      "translations": { "fi-FI": "Hei, maailma!", "de-DE": "Hallo, Welt!" },
      "captionLang": "fi-FI",
      "showOriginal": true
    }
  ]
}
```

---

## 4. Backend Processing

`packages/lcyt-backend/src/routes/captions.js`

### 4.1 Caption Composition

`composeCaptionText(text, captionLang, translations, showOriginal)` — from `caption-files.js`:

| Scenario | YouTube caption |
|----------|----------------|
| No translations | `"Hello, world!"` |
| `captionLang = 'fi-FI'`, `showOriginal = true` | `"Hello, world!\nHei, maailma!"` |
| `captionLang = 'fi-FI'`, `showOriginal = false` | `"Hei, maailma!"` |

The composed text is what `YoutubeLiveCaptionSender` sends to YouTube. The raw `translations` map is forwarded separately to viewer and generic targets.

### 4.2 Backend Caption File Writing

When `backendFileEnabled` is set for an API key, the backend writes caption files to disk:

- **Original**: `<date>-<sessionid>-original.<ext>`
- **Each translation**: `<date>-<sessionid>-<lang>.<ext>`

Formats: `youtube` (plain text, one caption per line) or `vtt` (WebVTT with timestamps and cue IDs).

File handles remain open for the session lifetime to allow efficient appending. On session close, handles are flushed and registered in the DB. Users download files via `GET /file/:id`.

### 4.3 Viewer SSE Fan-Out

`packages/lcyt-backend/src/routes/viewer.js` — `broadcastToViewers()`

All viewer targets receive the full translation metadata, not just the composed text:

```json
{
  "text": "Hello, world!",
  "composedText": "Hello, world!\n<br>Hei, maailma!",
  "sequence": 42,
  "timestamp": "2026-03-23T12:00:00.000",
  "translations": {
    "fi-FI": "Hei, maailma!",
    "de-DE": "Hallo, Welt!"
  },
  "codes": { "section": "2", "speaker": "alice" }
}
```

This allows viewer pages to display any individual language or a multi-language layout without the backend needing to know in advance which language a viewer wants.

### 4.4 Generic Target Fan-Out

Generic webhook targets receive the same `translations` object in the `captions` array so downstream systems can process any language independently.

### 4.5 HLS Subtitle Sidecar

`packages/lcyt-backend/src/hls-subs-manager.js`

For each viewer target, the `HlsSubsManager` writes rolling WebVTT segments to disk. It maintains one segment file and playlist per language. The HLS player at `GET /video/:key` offers language-selectable subtitle tracks.

Segments roll on a configurable interval (`HLS_SUBS_SEGMENT_DURATION`, default 6 s). A fixed-size window (`HLS_SUBS_WINDOW_SIZE`, default 10 segments) prevents unbounded disk growth.

---

## 5. Viewer Display

`packages/lcyt-web/src/components/ViewerPage.jsx` and `viewerUtils.js`

Viewers subscribe to `GET /viewer/:viewerKey` and receive the full payload for every caption.

### 5.1 Language Selection via URL Parameter

| `?lang=` | Displayed text |
|----------|----------------|
| _(omitted)_ | `composedText` (backend-composed with translation if any) |
| `original` | Raw `text` only |
| `fi-FI` | `translations['fi-FI']`, falling back to `composedText` then `text` |
| `all` | Multi-column layout: one column per available language |

**Implementation (`resolveViewerText`):**
```js
export function resolveViewerText(data, lang) {
  if (!lang) return data.composedText ?? data.text ?? '';
  if (lang === 'original') return data.text ?? '';
  return data.translations?.[lang] ?? data.composedText ?? data.text ?? '';
}
```

### 5.2 Multi-Language Layout (`?lang=all`)

**Implementation (`collectLangTexts`):**
```js
export function collectLangTexts(data) {
  const map = { original: data.text || '' };
  if (data.translations) {
    for (const [l, t] of Object.entries(data.translations)) {
      if (t) map[l] = t;
    }
  }
  return map;
}
```

Viewer renders a column per language key in the map. Useful for sign-language or multi-audience displays.

### 5.3 `composedText` Rendering

The `<br>` string within `composedText` is split by the viewer into separate React `<span>` elements — no `dangerouslySetInnerHTML`. The original and translated lines appear stacked.

---

## 6. Android TV Viewer

`android/lcyt-tv/app/src/main/java/fi/lcyt/tv/`

The Android TV app subscribes to `GET /viewer/:key` via OkHttp SSE (`SseClient.kt`). It displays `composedText` by default, splitting on `<br>` to show original and translation on separate lines. No language selection is currently implemented; the viewer always shows the composed text.

---

## 7. Local File Writing (Client-Side)

For translation targets with `target: 'file'`:

1. On first caption, the browser prompts the user to choose a save location via the File System Access API (`showSaveFilePicker()`).
2. The file name is `captions-<lang>-<date>.<format>` (e.g. `captions-fi-FI-2026-03-23.vtt`).
3. The file handle is kept open for the session. Each caption appends immediately.
4. **Formats:**
   - `vtt` — WebVTT with cue IDs and timestamps.
   - `youtube` — Plain text, one caption per line.

Client-side files are useful for local archiving or post-production without needing a server.

---

## 8. Embed Widget Coordination

When captions are sent from any embed widget (`/embed/audio`, `/embed/input`, `/embed/file-drop`, `/embed/files`), the full caption payload (including `translations`) is broadcast on `BroadcastChannel('lcyt-embed')` as:

```js
{
  type: 'lcyt:caption',
  requestId: '…',
  text: 'Hello, world!',
  timestamp: '…'
}
```

The `/embed/sentlog` widget subscribes and shows delivery status. The `translations` field is not currently included in the BroadcastChannel message — only the primary sent text.

---

## 9. Data Flow Diagram

```
User input (text / STT)
        │
        ▼
┌──────────────────────┐
│   translateAll()      │  (client-side, parallel vendor calls)
│                       │
│  • MyMemory           │
│  • Google             │
│  • DeepL              │
│  • LibreTranslate     │
└──────────┬────────────┘
           │  translationsMap, captionLang, localFileEntries
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
Local files    POST /captions
(File API)     { text, translations, captionLang, showOriginal }
                   │
                   ▼
          ┌────────────────────────────────────────────┐
          │  captions.js — composeCaptionText()         │
          │  + backend file writing                     │
          └──────────────────────┬─────────────────────┘
                                 │
              ┌──────────────────┼────────────────────┐
              ▼                  ▼                     ▼
      YouTube targets     Viewer targets       Generic targets
      (composedText)      (full payload)       (full payload)
              │                  │
              │                  ▼
              │          /viewer/:key SSE
              │          (browser, Android TV,
              │           embedded iframes)
              │
              ▼
     SSE /events
     caption_result
```

---

## Files Referenced

| File | Role |
|------|------|
| `packages/lcyt-web/src/components/TranslationModal.jsx` | Translation settings UI |
| `packages/lcyt-web/src/lib/translate.js` | `translateAll()`, `translateText()`, vendor implementations |
| `packages/lcyt-web/src/components/AudioPanel.jsx` | STT → translation → send pipeline |
| `packages/lcyt-web/src/components/InputBar.jsx` | Manual text → translation → send |
| `packages/lcyt-web/src/components/ViewerPage.jsx` | SSE subscriber; language-selectable display |
| `packages/lcyt-web/src/components/EmbedViewerPage.jsx` | Embeddable viewer widget |
| `packages/lcyt-web/src/lib/viewerUtils.js` | `resolveViewerText()`, `collectLangTexts()` |
| `packages/lcyt/src/backend-sender.js` | Passes `translations` metadata to `POST /captions` |
| `packages/lcyt-backend/src/routes/captions.js` | Composition, file writing, fan-out |
| `packages/lcyt-backend/src/caption-files.js` | `composeCaptionText()`, VTT helpers |
| `packages/lcyt-backend/src/routes/viewer.js` | `broadcastToViewers()` — full payload SSE |
| `packages/lcyt-backend/src/hls-subs-manager.js` | Per-language WebVTT segment rolling writer |
| `packages/lcyt-backend/src/routes/video.js` | HLS subtitle playlist + segment serving |
| `android/lcyt-tv/app/src/main/java/fi/lcyt/tv/SseClient.kt` | Android TV SSE subscriber |
| `android/lcyt-tv/app/src/main/java/fi/lcyt/tv/MainActivity.kt` | Android TV display (`composedText`) |
