---
title: Settings
order: 6
---

# Settings

Click **Settings** in the top status bar to open the Settings modal.

![Settings modal — Basic tab](/screenshots/modal-settings-light.png)

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

![Settings modal — RTMP Relay tab](/screenshots/modal-settings-rtmp-light.png)

The RTMP relay re-encodes your browser's audio and pushes it to up to **4 destinations** via RTMP with embedded CEA-608 captions.

### Relay active toggle

Enable **Active** to start relaying incoming audio to all configured destinations. When inactive, the backend accepts the RTMP stream but does not forward it.

### Relay destinations

Click **+ Add relay** to configure a new RTMP destination. Each entry supports:

| Type | Description |
|------|-------------|
| **YouTube** | Enter your YouTube RTMP stream key. The full URL (`rtmp://a.rtmp.youtube.com/live2/<key>`) is shown as a preview. |
| **Generic** | Enter a custom RTMP base URL and optional stream name / key. |

Click **✕** to remove a destination. You can configure up to 4 destinations.

> Requires an active backend connection to activate the relay.

