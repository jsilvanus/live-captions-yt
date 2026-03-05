---
title: Settings
order: 6
---

# Settings

Click **Settings** in the top status bar to open the Settings modal.

---

## Basic tab

The **Basic** tab contains all connection credentials and core preferences.

| Field | Description |
|-------|-------------|
| **Backend URL** | URL of the LCYT relay backend (default: `https://api.lcyt.fi`) |
| **API Key** | Your LCYT API key — get one at [lcyt.fi/app](https://lcyt.fi/app) |
| **Stream Key** | YouTube Live stream key from YouTube Studio |
| **Auto-connect** | Reconnect automatically the next time you open the app |
| **Theme** | Auto (system), Dark, or Light |
| **Language** | UI display language (English / Finnish / Swedish) |
| **Text size** | Font size in the caption preview area (10–24 px) |
| **Show advanced options** | Reveals the RTMP Relay tab here, and the Details tab in the CC modal |

All fields are saved to your browser automatically as you type — no explicit Save button is needed.

---

## RTMP Relay tab _(advanced mode only)_

> This tab is only visible when **Show advanced options** is enabled on the Basic tab.

The RTMP relay re-encodes your browser's audio and pushes it to up to **4 destinations** via RTMP with embedded CEA-608 captions.

### Relay active toggle

Enable **Active** to start relaying incoming audio to all configured slots. When inactive, the backend accepts the RTMP stream but does not forward it.

### Relay slots (1–4)

Configure each slot with:

| Field | Description |
|-------|-------------|
| **Target type** | `YouTube` (uses `rtmp://a.rtmp.youtube.com/live2`) or `Generic` (custom RTMP URL) |
| **YouTube stream key** | Your YouTube RTMP stream key |
| **RTMP URL** | Custom RTMP ingest URL for generic targets |
| **Stream name / key** | Optional stream name appended after the base URL |
| **Caption mode** | `HTTP POST` — captions delivered via HTTP (default) |

### Actions

| Button | Description |
|--------|-------------|
| **▶ Activate (Slot N)** | Start the relay for the selected slot |
| **■ Stop (Slot N)** | Stop the relay for the selected slot |
| **■ Stop all** | Stop all running slots |
| **🗑 Clear slot N** | Remove the configuration for the selected slot |

> Requires an active backend connection to activate or stop slots.

