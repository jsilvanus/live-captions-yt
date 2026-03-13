---
title: Overview
order: 1
---

# LCYT — Live Captions for YouTube

**LCYT** (Live Captions for YouTube) lets you send real-time closed captions to a YouTube Live stream directly from your browser, using Google's official HTTP POST caption ingestion API.

It is especially useful for **non-English broadcasts** — you can send captions in any language to make your stream accessible to a global audience.

---

## What you can do with LCYT

| Feature | Description |
|---------|-------------|
| **Live captioning** | Type captions manually and send them with a single keystroke |
| **Speech-to-text** | Use your microphone with automatic speech recognition (browser API or Google Cloud STT) |
| **File playback** | Load a pre-written script and step through it line by line |
| **Translation** | Automatically translate captions to a second language |
| **Viewer page** | Broadcast captions to audience members via a public SSE-based viewer page (no YouTube account needed on the viewer's side) |
| **RTMP relay** | Re-stream your audio/video to up to 4 destinations simultaneously with embedded captions |
| **CEA-708 captions** | Embed captions directly in the RTMP video stream (requires ffmpeg with CEA-708 support) |
| **HLS streaming** | Serve a live HLS video+audio stream via the backend (embeddable in any web page) |
| **Radio HLS** | Serve a live audio-only HLS stream via the backend |
| **Stream preview** | See a live JPEG thumbnail of your incoming RTMP stream in the web UI |
| **DSK overlay** | Overlay PNG/WebP/SVG graphics on the relayed video using a downstream keyer (green screen) page |
| **Embed widgets** | Drop standalone `<iframe>` widgets into any site — audio, input bar, file player, full file UI, viewer, settings, or RTMP relay |
| **Dark & light mode** | Comfortable UI in any environment |
| **Mobile support** | Fully usable on phones and tablets with a dedicated mobile bar |

---

## Dashboard

![LCYT dashboard — dark mode](/screenshots/dashboard-landscape-dark.png)

The main dashboard is split into two panels side by side (or stacked on mobile):

- **Left panel** — Drop zone for script files, file tabs, the caption preview, and the microphone / audio meter
- **Right panel** — Log of all captions sent during the current session

The **status bar** at the top contains five buttons:

| Button | Purpose |
|--------|---------|
| **Connect / Disconnect** | Toggle the backend session (green = connected, red on hover = click to disconnect) |
| **Settings** | Configure connection credentials, theme, language, text size, and advanced options |
| **CC** | Configure speech recognition, caption targets (receivers), details, and translation |
| **Controls** | View session status and run diagnostic actions |
| **Privacy** | Review the privacy policy |

![Status bar](/screenshots/statusbar-dark.png)

The **input bar** at the bottom is where you type and send captions.

---

## Project components

| Component | Description |
|-----------|-------------|
| **lcyt-web** | Browser-based web app (this guide) |
| **lcyt-cli** | Command-line tool for sending captions from a terminal |
| **lcyt-backend** | Express.js relay backend (multi-user, API keys) |
| **lcyt** (npm) | Node.js library for direct YouTube caption ingestion |
| **lcyt** (PyPI) | Python library with the same API |
| **lcyt-mcp** | Model Context Protocol server — lets AI assistants send captions |

---

## Next steps

- [Getting started](getting-started) — set up your stream and API key
- [Sending captions](sending-captions) — all the ways to send captions
- [Caption settings](caption-settings) — the CC modal: receivers, speech recognition, details, and translation
- [General settings](general-settings) — the Settings modal: connection, theme, relay, and stream
- [Status & Actions](status-actions) — the Controls panel
- [Keyboard shortcuts](keyboard-shortcuts) — full shortcut reference
- [Embedding in another site](embed) — iframe widgets for integration into production tools and custom dashboards
