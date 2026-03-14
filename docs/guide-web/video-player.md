---
title: Multilingual Video Player
order: 9
---

# Multilingual Video Player

When you configure a **viewer target** in the CC → Targets tab, the backend automatically generates an embeddable video player at:

```
https://api.example.com/video/<viewer-key>
```

This player combines your live video stream with real-time subtitle tracks in every language you have configured under CC → Translation. Viewers can select their preferred language using their browser's **built-in CC (closed captions) button** — no custom controls are needed.

---

## What you need

1. **HLS video stream** — the RTMP stream you send to the server must have `hls_enabled = true` on your API key (set by an admin). The video and subtitle tracks share the same key.
2. **Viewer target** — configure a viewer target in CC → Targets with the same key you use for the HLS stream. Every caption you send is automatically transcribed into subtitle segments.
3. **Translations** _(optional)_ — add one or more translation languages in CC → Translation. Each language appears as a separate subtitle track in the player.

---

## Setting up

### 1. Configure a viewer target

Open **CC** → **Targets** tab and add a target:

| Field | Value |
|-------|-------|
| Type | Viewer |
| Viewer key | A short, unique identifier for your event (e.g. `my-event-2026`) |

Use the same key for the HLS video stream (the stream key configured in nginx-rtmp must match).

### 2. Add translation languages _(optional)_

Open **CC** → **Translation** tab and add any languages you want as subtitle tracks. Each enabled language will appear in the player's CC menu as a selectable track.

The original caption text is always included as the **Original** track regardless of whether any translations are configured.

### 3. Share the player URL

The player is available at:

```
https://api.example.com/video/<viewer-key>
```

Replace `api.example.com` with your backend URL and `<viewer-key>` with the key you set in step 1.

---

## Embedding the player

The player page is iframe-embeddable on any website:

```html
<iframe
  src="https://api.example.com/video/my-event-2026"
  width="960" height="540"
  frameborder="0"
  allow="autoplay"
  allowfullscreen>
</iframe>
```

### Theme

Add `?theme=light` for a light background:

```html
<iframe src="https://api.example.com/video/my-event-2026?theme=light" ...></iframe>
```

---

## Subtitle language selection

The player exposes all active subtitle tracks through the browser's **native CC button** in the standard video controls:

- **Chrome / Edge / Firefox** — click the CC (⧉) button in the video controls to open the language menu.
- **Safari (macOS / iOS)** — click the CC button or the subtitles option in AirPlay / fullscreen controls.
- **Android Chrome** — tap the CC button in the controls.

Tracks appear as soon as the first captions arrive for that language — you do not need to reload the player.

---

## How subtitles are generated

Each time a caption is sent, the backend:

1. Writes the original text and each translation into rolling 6-second **WebVTT segment files** (one set per language).
2. Updates an **HLS subtitle playlist** per language, using `EXT-X-PROGRAM-DATE-TIME` headers so the player can align subtitle cues to the video by wall clock.
3. Serves a **master HLS manifest** that references both the video stream and all subtitle playlists.

Because the subtitle system uses the same viewer key as the SSE viewer endpoint (`/viewer/:key`), there is no extra configuration — any key that receives captions automatically gets a subtitle sidecar.

---

## Subtitle track reference

| Track label in player | Source |
|-----------------------|--------|
| Original | The raw text typed or captured via speech recognition |
| Finnish / Suomi | Translation to Finnish, if configured |
| German / Deutsch | Translation to German, if configured |
| _(other languages)_ | Determined by which languages are enabled in CC → Translation |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| "Stream not live" message | The HLS video stream is not running (`hls_enabled` must be set for the key) |
| No CC button visible | No captions have been sent yet; the button appears once the first subtitle track is active |
| Subtitle track names show BCP-47 codes instead of language names | The language tag is not in the built-in name map; the tag itself is used as a fallback |
| Subtitles appear late or are offset from speech | Normal for live transcription; the backend writes segments every 6 seconds |

---

## Technical details

For the full API reference, including manifest format, WebVTT segment format, and environment variables, see [API: /video](../api/video.md).
