---
title: Full-Screen UI
order: 1
---

# Full-Screen UI Mode

The full-screen UI is the default mode for the `lcyt` CLI. It provides a rich, multi-panel terminal interface for live captioning sessions.

---

## Starting Full-Screen Mode

```bash
lcyt          # opens full-screen UI automatically when no other flags are given
lcyt -f       # explicit flag
lcyt --fullscreen
```

On the very first run (no stream key configured), the CLI launches a short setup wizard instead of the full-screen UI. After entering your stream key, the full-screen UI starts.

---

## Panel Layout

The screen is divided into four panels:

| Panel | Location | Purpose |
|-------|----------|---------|
| **Text Preview** | Top-left | Shows the next line to be sent from a loaded file |
| **Log** | Bottom-left | Operational messages and caption send results |
| **Sent Captions** | Right | Rolling history of captions delivered to YouTube |
| **Input Field** | Bottom | Type captions or slash-commands here |

---

## Sending Captions

Type your caption text in the **Input Field** and press **Enter** to send it immediately. The caption is delivered to YouTube and logged in the Sent Captions panel.

---

## Loading a File

Use the `/load` command to load a plain-text script, then step through it line by line:

```
/load /path/to/script.txt
```

Once a file is loaded, the **Text Preview** panel shows the current line. Use the arrow keys to navigate and **Enter** to send the current line.

---

## Commands

Type a slash-command in the input field and press Enter:

| Command | Description |
|---------|-------------|
| `/load <path>` | Load a caption script from a file path or URL |
| `/batch` | Toggle batch mode — queue captions before sending |
| `/send` | Send the batch queue immediately |
| `/api <path>` | Load a Google API credentials JSON for YouTube status polling |
| `/stream <url-or-id>` | Set a YouTube video ID or URL to poll for live status |
| `/reset` | Reset the sequence counter to 0 |
| `/quit` | Exit the full-screen UI |

---

## Batch Mode

Batch mode lets you queue multiple captions and send them as a group:

1. Type `/batch` to enable batch mode.
2. Enter each caption and press Enter — lines are queued but not sent yet.
3. Type `/send` (or press the batch-send shortcut) to deliver the whole batch at once.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Enter** | Send current line or command |
| **↑ / ↓** | Navigate through loaded file lines |
| **Page Up / Page Down** | Scroll the Sent Captions panel |
| **Ctrl+C** | Exit |

---

## Options

All connection options can be set once and are saved to `~/.lcyt-config.json`:

```bash
lcyt --stream-key YOUR_KEY   # Set stream key (saved for future sessions)
lcyt --base-url URL          # Override ingestion URL
lcyt --region reg1           # Set region identifier
lcyt --verbose               # Enable verbose logging
```
