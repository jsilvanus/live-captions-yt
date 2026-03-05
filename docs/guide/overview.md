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
| **RTMP relay** | Re-stream your audio/video to up to 4 destinations with embedded captions |
| **Dark & light mode** | Comfortable UI in any environment |
| **Mobile support** | Fully usable on phones and tablets with a dedicated mobile bar |

---

## Dashboard

The main dashboard is split into two panels side by side (or stacked on mobile):

- **Left panel** — Drop zone for script files, file tabs, the caption preview, and the microphone / audio meter
- **Right panel** — Log of all captions sent during the current session

The **status bar** at the top contains buttons to open every settings panel.  
The **input bar** at the bottom is where you type and send captions.

![LCYT dashboard (dark)](/screenshots/dashboard-landscape-dark.png)

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
- [Caption settings](caption-settings) — speech recognition and display options
- [Translation](translation) — automatic real-time translation
- [General settings](general-settings) — connect, theme, relay
- [Status & Actions](status-actions) — monitor your session
- [Keyboard shortcuts](keyboard-shortcuts) — full shortcut reference
