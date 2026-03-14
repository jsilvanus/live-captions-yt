---
title: Production Control
order: 10
---

# Production Control

The production control feature lets an operator trigger camera presets and switch video mixer sources directly from LCYT — the same tool used for live captions. It is designed for house-of-worship and event production environments where cameras are controlled via an AMX NetLinx controller and video switching is done on a Roland V-series mixer.

---

## Overview

| Page | URL | Purpose |
|---|---|---|
| Operator UI | `/production` | Live session control — trigger presets, switch mixer inputs |
| Camera config | `/production/cameras` | Add/edit cameras and their preset command lists |
| Mixer config | `/production/mixers` | Add/edit video mixers |
| Bridges | `/production/bridges` | Manage lcyt-bridge agent instances |

All configuration pages require an active backend connection with an admin key.

---

## How commands reach hardware

Depending on where the streaming computer lives on the network, commands can be delivered two ways:

**Direct TCP** — the LCYT backend server has a direct network route to the AMX master or Roland mixer. Commands are sent from the server process over TCP. No bridge is needed.

**Via lcyt-bridge** — the streaming computer (which has a route to the AV devices) runs `lcyt-bridge.exe`. It connects to the backend over SSE and relays commands to the devices locally over TCP. The backend's network can reach the streaming computer, but not the AV devices directly.

Most church and event setups need the bridge: the streaming computer sits on an isolated AV network alongside the cameras and mixer, with only internet access to the cloud backend.

---

## Setting up lcyt-bridge

lcyt-bridge is a small Windows app that runs on the streaming computer and relays production control commands to the AMX and Roland devices on your local AV network.

### 1. Add a bridge instance

Go to **Settings → Bridges** and click **Add bridge**.

- Enter a name (e.g. "Main church" or "Chapel"). The name is only shown in the UI when two or more bridges exist.
- Click **Create**.

### 2. Download the app and its config

After creation, two download buttons appear:

- **Download app** — `lcyt-bridge.exe` (Windows), `lcyt-bridge-mac`, or `lcyt-bridge-linux`
- **Download .env** — a pre-filled configuration file containing your backend URL and bridge authentication token

Place both files in the same folder. **Keep the `.env` file private** — it contains the bridge token.

> The token is shown only once, embedded in the `.env` download. If you lose the file, use **Download config** from the bridge instance row to regenerate it.

### 3. Launch the bridge

Double-click `lcyt-bridge.exe` (or run it from a terminal). A system tray icon appears:

| Tray icon state | Meaning |
|---|---|
| Green | Connected to backend, all configured TCP connections alive |
| Yellow | Connected to backend, one or more TCP connections degraded |
| Grey | Not connected to backend |

Right-click the tray icon for options:
- **Status** — small status window showing backend ✓/✗, AMX ✓/✗, Roland ✓/✗, and the timestamp of the last command received
- **Reconnect** — force-reconnect SSE and all TCP connections
- **Quit** — clean shutdown

### 4. Verify connectivity

Back in the web UI, the bridge row in **Settings → Bridges** shows a green dot when the bridge is online. If it stays grey, check that the streaming computer can reach the backend URL and that no firewall blocks outbound HTTPS.

---

## Configuring cameras

Go to `/production/cameras` (or from the operator UI, click the ⚙ gear icon).

### Add a camera

Click **Add camera** and fill in:

| Field | Description |
|---|---|
| **Name** | Displayed on the operator UI camera card (e.g. "Altar", "Pulpit") |
| **Mixer input** | Which input number on the mixer this camera feeds (1-based). Used for the LIVE badge and quick-cut. |
| **Sort order** | Display order in the operator UI. Lower numbers appear first. |
| **Control type** | `amx` — sends commands to an AMX NetLinx controller; `none` — mixer-only camera, no preset buttons shown |
| **Bridge** | Which bridge instance relays commands for this camera. Leave blank for direct TCP from the server. |

### AMX-specific settings

When control type is `amx`, two additional fields appear:

- **AMX host** — IP address of the AMX NetLinx master
- **AMX port** — TCP port (default 1319)

### Presets

Each camera can have any number of named presets. Click **Add preset** to add a row:

| Field | Description |
|---|---|
| **Preset name** | Shown as a button label in the operator UI (e.g. "Wide", "Close-up") |
| **AMX command** | Sent verbatim over TCP to the AMX master (e.g. `SEND_COMMAND dvCam,'PRESET-1'`) |

No command validation is performed. Copy the exact command strings from your AMX programmer or system documentation.

Click the **✕** on any row to remove a preset. Click **Save** to apply changes.

---

## Configuring mixers

Go to `/production/mixers`.

### Add a mixer

Click **Add mixer** and fill in:

| Field | Description |
|---|---|
| **Name** | e.g. "Main Roland" |
| **Type** | `roland` (Roland V-series) or `amx` (AMX-controlled switcher) |
| **Host** | IP address of the mixer |
| **Port** | TCP port — Roland default: 8023, AMX default: 1319 |
| **Bridge** | Bridge instance for relay, or blank for direct TCP |

#### AMX mixer inputs

When type is `amx`, each mixer input that you want to be switchable needs a command entry:

| Field | Description |
|---|---|
| **Input number** | Mixer input number (1-based) |
| **AMX command** | Command string sent verbatim to AMX (e.g. `SEND_COMMAND dvMixer,'INPUT-1'`) |

#### Test connection

Click **Test connection** to verify that the backend (or bridge) can reach the mixer over TCP. The result appears inline within a few seconds.

---

## Using the operator UI

Open `/production` in a browser on your operator tablet or laptop during a service.

### Camera cards

Each camera appears as a card showing:
- Camera name (and bridge instance name if two or more bridges exist)
- Preset buttons (one per preset configured)
- **LIVE** badge when this camera's mixer input is the active program source

Click a preset button to trigger that preset. The button shows:
- **Sending…** — command in flight
- ✓ (green) — success
- ✗ (red) — error (hover for the error message)

### Mixer status bar

At the bottom of the operator UI, a status bar shows:
- Mixer connection status (green dot = connected)
- Active PGM input number

### Quick-cut mode

Toggle **Quick cut** in the status bar.

- **Off (default)** — tapping a camera card triggers its presets only. Mixer switching is a separate action.
- **On** — tapping a camera card triggers the preset _and_ immediately switches the mixer to that camera's input.

---

## Bridges tab in Settings

The **Bridges** tab in the Settings modal shows bridge instances and their status. Its appearance adapts to how many bridges are configured:

| Bridge count | UI behaviour |
|---|---|
| 0 | Setup prompt and **Add bridge** button only |
| 1 | Connected/disconnected status and last seen time. No instance name shown (single bridge is implicit). |
| 2+ | Instance names visible on all rows, individual status per instance |

### Deleting a bridge

Click **Delete** on a bridge row. If cameras or mixers are assigned to it, a warning lists the number of affected devices. Confirm to remove the bridge and clear all device assignments (devices are not deleted, they just lose their bridge assignment).

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Bridge shows grey / disconnected | Streaming computer can reach backend URL? Firewall allowing outbound HTTPS? |
| Preset triggers return 503 | Bridge is offline. Check tray icon and reconnect. |
| Preset triggers return 400 | Preset ID not found — camera may have been edited after the page loaded. Refresh. |
| Mixer test fails | Mixer IP and port correct? Streaming computer on the right NIC for the AV network? |
| AMX command sent but camera doesn't move | Check the exact command string in the AMX programmer. The adapter sends it verbatim — any typo will fail silently on the AMX side. |
| LIVE badge doesn't update | Active source is tracked in memory on the backend. It resets on server restart and the first switch after restart will set it correctly. |
