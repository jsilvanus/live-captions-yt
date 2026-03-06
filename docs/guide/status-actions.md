---
title: Controls Panel
order: 7
---

# Controls Panel

Click **Controls** in the top status bar to open the Controls floating panel.

The Controls panel combines the session status display and diagnostic actions in one convenient location.

---

## Status section

![Controls panel — status](/screenshots/panel-controls-light.png)

| Row | Description |
|-----|-------------|
| **Connection** | Green `● Connected` or grey `○ Disconnected` |
| **Backend URL** | The relay backend the app is talking to |
| **Sequence** | Caption sequence number — increments with every caption sent |
| **Clock offset** | Difference (ms) between your browser clock and the server clock. Used for accurate caption timestamps |
| **Last connected** | Time of the most recent successful connection |

### Stats button

Click **Stats** to open the Usage Stats modal. It shows per-key caption counts, daily limits, and session history. Requires an active connection.

### My Files button

Click **My Files** to list caption and translation files saved on the backend for your API key, with download and delete options. Requires an active connection.

---

## Actions section

| Action | Description |
|--------|-------------|
| **⟳ Sync Now** | Runs an NTP-style clock sync with the backend to minimise timestamp drift. Run this if captions appear noticeably early or late |
| **♥ Heartbeat** | Sends a blank caption to verify the connection end-to-end without showing anything on stream |
| **↺ Reset sequence** | Resets the caption sequence counter to 0. Use if the YouTube stream shows duplicate or out-of-order captions |
| **↗ Set sequence** | Manually set the sequence counter to a specific number |
| **🗑 Clear saved config** | Removes all locally stored settings (API key, stream key, preferences). Does **not** affect server-side data |

### Caption codes

Active metadata codes sent alongside every caption. Click a code button to toggle it:

| Code | Effect |
|------|--------|
| **lang** | Set the speaker language (overrides the input bar language picker) |
| **no-translate** | Prevent translation for captions with this code |
| **custom code** | Add any arbitrary `key: value` metadata pair |

File-level metadata (`<!-- lang: fi-FI -->`) overrides per-line codes.

### File actions

| Button | Description |
|--------|-------------|
| **✏ Edit File** | Switch the current file to raw text editor mode. Hold 2 seconds (or click without a file) to create a new file |
| **✕ Clear sent log** | Remove all entries from the sent captions log |

