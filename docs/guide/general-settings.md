---
title: General Settings
order: 6
---

# General Settings

Click **General** in the top status bar to open the General Settings modal.

---

## Connection

![General settings modal](/screenshots/modal-general-light.png)

| Field | Description |
|-------|-------------|
| **API Key** | Your LCYT API key — get one at [lcyt.fi/app](https://lcyt.fi/app) |
| **Stream Key** | YouTube Live stream key from YouTube Studio |
| **Backend URL** | URL of the LCYT relay backend (default: `https://api.lcyt.fi`) |
| **Auto-connect** | Reconnect automatically the next time you open the app |

Click **Connect** to start a session. Click **Disconnect** to end it cleanly.

---

## Relay mode

The **Relay mode** toggle switches between two caption delivery modes:

### Caption relay (default)

Captions are sent through the LCYT backend to the YouTube HTTP POST caption API. This is the standard mode.

### RTMP relay

![General settings — RTMP relay](/screenshots/modal-general-rtmp-light.png)

The RTMP relay re-encodes your browser's audio stream and pushes it to up to **4 destinations** via RTMP with embedded CEA-608 captions.

Configure each slot with:

| Field | Description |
|-------|-------------|
| **Target type** | `YouTube` (uses `rtmp://a.rtmp.youtube.com/live2`) or `Generic` (custom RTMP URL) |
| **YouTube stream key** | Your YouTube RTMP stream key |
| **RTMP URL** | Custom RTMP ingest URL for generic targets |
| **Stream name / key** | Optional stream name appended after the base URL |
| **Caption mode** | `HTTP` — captions via HTTP POST (default); `CEA-708` — embedded in the video stream |

Use the **Activate / Stop** buttons to start or stop individual slots. **Stop all** tears down all running slots at once.

---

## Theme

| Option | Description |
|--------|-------------|
| **Auto** | Follows the operating system preference (dark or light) |
| **Dark** | Always use the dark theme |
| **Light** | Always use the light theme |

---

## Language

Select the UI display language. Currently available: **English**, **Finnish**, **Swedish**.
