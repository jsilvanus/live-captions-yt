---
title: Single Caption
order: 3
---

# Single Caption Mode

Single caption mode sends one caption (or a batch of captions) and exits immediately. It requires no interactive input and is the simplest way to send a caption from the command line or a script.

---

## Sending a Caption

Pass the caption text as a positional argument:

```bash
lcyt "Hello, world!"
lcyt "Welcome to the stream!"
```

The caption is sent once and the process exits with code `0` on success or `1` on failure.

---

## Setting the Stream Key

If you have not configured a stream key yet, set it with `--stream-key`. The key is saved to `~/.lcyt-config.json` for future use:

```bash
lcyt --stream-key YOUR_KEY "First caption with key"
```

After the key is saved you can omit it in subsequent calls:

```bash
lcyt "Second caption"
```

---

## Timestamp Override

By default the current time is used. Supply an explicit ISO timestamp with `-t`:

```bash
lcyt -t "2024-06-01T10:00:00.000" "Caption with a custom timestamp"
```

---

## Batch Mode

Queue multiple captions across separate invocations and send them all at once:

```bash
# Queue captions (stored in ~/.lcyt-config.json)
lcyt -b "Line one"
lcyt -b "Line two" -t "2024-06-01T10:00:05.000"
lcyt -b "Line three"

# Send the queue in a single request
lcyt --send
```

The `--send` flag delivers all queued captions and clears the queue.

---

## Heartbeat / Connection Test

Send a heartbeat to verify that the connection and stream key are working without sending a real caption:

```bash
lcyt --heartbeat
```

A successful heartbeat prints a confirmation and exits with code `0`.

---

## All Options

| Flag | Short | Description |
|------|-------|-------------|
| `--stream-key KEY` | `-k` | YouTube stream key |
| `--base-url URL` | `-u` | Override ingestion URL |
| `--region ID` | `-r` | Region identifier (default: `reg1`) |
| `--cue ID` | | Cue identifier (default: `cue1`) |
| `--timestamp ISO` | `-t` | Manual timestamp override |
| `--batch` | `-b` | Queue caption instead of sending immediately |
| `--send` | | Send all queued batch captions |
| `--heartbeat` | | Send heartbeat and exit |
| `--reset` | | Reset sequence counter to 0 |
| `--show-config` | | Print current configuration |
| `--verbose` | `-v` | Enable verbose logging |
| `--log-stderr` | | Route logs to stderr |
| `--config PATH` | `-c` | Use a custom config file path |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Caption sent successfully |
| `1` | Error (network failure, invalid key, etc.) |
