---
title: Status & Actions
order: 7
---

# Status & Actions

The **Status** and **Actions** panels give you visibility into your current session and tools for diagnostics and maintenance.

---

## Status panel

Click **Status** in the top status bar to open the Status floating panel.

![Status panel](/screenshots/panel-status-light.png)

| Row | Description |
|-----|-------------|
| **Connection** | Green `Connected` or grey `Disconnected` |
| **Backend URL** | The relay backend the app is talking to |
| **Sequence** | Caption sequence number — increments with every caption sent |
| **Clock offset** | Difference (ms) between your browser clock and the server clock. Used for accurate caption timestamps |
| **Last connected** | Time of the most recent successful connection |

### Stats button

Click **View stats** to open the Usage Stats modal. It shows per-key caption counts, daily limits, and session history. Requires an active connection.

### Files button

Click **Files** to open the caption files modal. Lists files saved on the backend for your key, with download and delete options. Requires an active connection.

---

## Actions panel

Click **Actions** in the top status bar to open the Actions floating panel.

![Actions panel](/screenshots/panel-actions-light.png)

| Action | Description |
|--------|-------------|
| **Sync clock** | Runs an NTP-style clock sync with the backend to minimise timestamp drift. Run this if captions appear noticeably early or late |
| **Reset sequence** | Resets the caption sequence counter to 0. Use this if the YouTube stream shows duplicate or out-of-order captions |
| **Send heartbeat** | Sends a blank caption to verify the connection end-to-end without showing anything on stream |
| **Clear all config** | Removes all locally stored settings (API key, stream key, preferences). Does **not** affect server-side data |
