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
| **Show advanced options** | Reveals the Stream tab here, and the Details tab in the CC modal |

All fields are saved to your browser automatically as you type — no explicit Save button is needed.

---

## Stream tab _(advanced mode only)_

> This tab is only visible when **Show advanced options** is enabled on the Basic tab.

The Stream tab controls the **RTMP relay** and its associated broadcast settings.

### Relay active toggle

Enable **Active** to start relaying your incoming RTMP stream to all configured destinations. When inactive, the backend accepts the stream but does not forward it. The toggle takes effect immediately — if your RTMP stream is already live when you enable the relay, fan-out starts without reconnecting.

### Relay destinations

Click **+ Add relay** to configure a new RTMP destination. Each entry supports:

| Type | Description |
|------|-------------|
| **YouTube** | Enter your YouTube RTMP stream key. The full ingest URL (`rtmp://a.rtmp.youtube.com/live2/<key>`) is shown as a preview. |
| **Generic** | Enter a custom RTMP base URL and optional stream name / key. |

Click **✕** to remove a destination. You can configure up to 4 destinations.

### Per-slot advanced options _(⚙ gear button)_

Each relay slot has an optional advanced settings panel (click the ⚙ gear icon):

| Option | Description |
|--------|-------------|
| **Caption mode** | `http` (default) — send captions via YouTube's HTTP ingestion API. `cea708` — embed captions directly in the RTMP video stream (requires CEA-708 capable ffmpeg on the server). |
| **Scale** | Output video resolution, e.g. `1280x720`. Enable the **Use original** checkbox to pass the original resolution through unchanged. |
| **FPS** | Output frame rate (integer). Enable **Use original** to keep the source frame rate. |
| **Video bitrate** | e.g. `3000k` or `6M`. Leave blank or check **Use original** to keep the source bitrate. |
| **Audio bitrate** | e.g. `128k`. Leave blank or check **Use original** to keep the source audio bitrate. |

> Transcoding (scale / FPS / bitrate) and CEA-708 caption mode cannot be combined on the same key — CEA-708 takes priority.

### RTMP ingest address

When the relay is enabled on the server, the ingest address is shown at the bottom of the Stream tab:

```
rtmp://<server>/stream/<your-api-key>
```

Configure your broadcasting software (e.g. OBS) to push to this address. The stream key is your **API key**.

### DSK RTMP ingest address

If the server supports DSK (Downstream Keyer) RTMP ingest, an additional address is shown:

```
rtmp://<server>/dsk/<your-api-key>
```

Push a second RTMP stream (e.g. a green-screen graphics feed) to this address to composite it on top of the main stream.

> Requires an active backend connection and `relay_allowed` permission on your API key.

