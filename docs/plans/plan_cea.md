---
id: plan/cea
title: "CEA-708 SEI NAL Caption Embedding in RTMP Relay"
status: draft
summary: "Embed closed captions as H.264 SEI NAL units in the RTMP relay stream using ffmpeg tee muxer with PTS-anchored payloads."
---

# Plan: CEA-708 SEI NAL Caption Embedding in the RTMP Relay

## Overview

This document describes how to embed CEA-708 closed captions as **H.264 SEI NAL units** into
the RTMP video stream that `RtmpRelayManager` forwards via ffmpeg. This is the alternative to
sending captions to YouTube over HTTP POST (`/captions`).

CEA-708 is the US ATSC standard for digital closed captions. YouTube, Twitch, and most
professional broadcast chains support CEA-708 data embedded in the H.264 SEI NAL units of the
video stream.

---

## How CEA-708 Works in a Video Stream

1. **Video SEI (Supplemental Enhancement Information) packets** carry CEA-708
   `user_data_registered_itu_t_35` payloads within the H.264/H.265 bitstream.
2. The caption payload is **PTS-anchored** — each packet is tied to a specific video frame's
   Presentation Timestamp, ensuring the text appears at exactly the right moment.
3. FLV/RTMP containers transmit H.264 video with SEI NAL units intact, so captions embedded
   in the stream are forwarded transparently by nginx-rtmp to the relay target.

---

## Architecture: One ffmpeg Process Per API Key (tee muxer)

Instead of spawning one ffmpeg process **per relay slot**, a single ffmpeg process is spawned
**per API key**. All relay targets (slots 1–4) are expressed as a single ffmpeg **tee muxer**
output. This reduces system overhead, simplifies caption injection, and ensures a consistent
video/audio timeline across all relay destinations.

```
nginx-rtmp publisher (per API key)
         │ RTMP source
         ▼
     ffmpeg (one process per API key)
       ├── stdin pipe ← SubRip (SRT/subrip) captions (CEA-708 mode only)
       ├── re-encodes H.264 with CEA-608/708 SEI NALs embedded
       └── tee muxer → slot 1 (rtmp://target1/live/key)
                     → slot 2 (rtmp://target2/live/key2)
                     → slot N …
```

### ffmpeg command — CEA-708 mode (re-encode)

```bash
ffmpeg \
  -re -i rtmp://<rtmp-host>/stream/<apiKey> \
  -f subrip -i pipe:0 \                           # SubRip (SRT) captions via stdin
  -map 0:v -map 0:a -map 1 \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -c:a copy \
  -c:s eia608 \                                # CEA-608/708 subtitle encoder
  -f tee \
    "[f=flv]rtmp://target1/live/key1|[f=flv]rtmp://target2/live/key2"
```

The `eia608` subtitle codec encodes plain text (from the SRT input) as CEA-608 closed caption
byte pairs and instructs `libx264` to embed them in the H.264 stream as `cc_data` SEI NAL
units (SEI type 4, `user_data_registered_itu_t_35`). No separate subtitle track is created in
the FLV container — the CC data lives inside the video NAL units.

### ffmpeg command — HTTP caption mode (stream copy, no re-encode)

```bash
ffmpeg \
  -re -i rtmp://<rtmp-host>/stream/<apiKey> \
  -c copy \
  -f tee \
    "[f=flv]rtmp://target1/live/key1|[f=flv]rtmp://target2/live/key2"
```

`captionMode` is chosen **per relay slot** in the DB. If any slot has `captionMode='cea708'`,
the entire ffmpeg process uses the CEA-708 pipeline (re-encode + stdin pipe). Slots with
`captionMode='http'` in the same fan-out still receive the re-encoded stream, but their caption
delivery remains via HTTP POST to YouTube directly.

---

## Timing: Start-of-Utterance Offset

Speech recognition finalises text **after** the utterance ends. Without correction, captions
appear seconds after speech started — too late to feel natural.

### Client-side: `speechStart` timestamp

The web client (or CLI) sends an optional `speechStart` field with each caption:

```json
{
  "captions": [{
    "text": "Hello world",
    "timestamp": "2026-03-04T19:35:50.000Z",
    "speechStart": "2026-03-04T19:35:47.200Z"
  }]
}
```

`speechStart` is the wall-clock time when the VAD (Voice Activity Detection) triggered for this
utterance — i.e. when speech actually began.

### Backend: mapping to video PTS

When writing a SubRip (SRT) cue to ffmpeg stdin, the start time is computed as:

```
cueStartMs = speechStart - ffmpegStartedAt
```

Where `ffmpegStartedAt` is when the ffmpeg process was spawned (stored in `_meta`). This maps
the real-world speech-start instant to the corresponding video PTS offset.

If `speechStart` is not provided (older clients), a configurable default offset is subtracted:

```
cueStartMs = (captionTimestamp - CEA708_OFFSET_MS) - ffmpegStartedAt
```

`CEA708_OFFSET_MS` defaults to **2000 ms**, shifting captions approximately 2 seconds earlier.
It can be tuned per-deployment via the `CEA708_OFFSET_MS` environment variable.

The cue end time defaults to `cueStartMs + CEA708_DURATION_MS` (default **3000 ms**).

### SubRip (SRT) cue format written to ffmpeg stdin

```
1
00:00:47,200 --> 00:00:50,200
Hello world

```

(blank line terminates each cue; SRT sequence numbers increment per API key process)

---

## Why Batch Sending Must Be Disabled in CEA-708 Mode

- Batch delay causes the first caption in a batch to have a PTS **older than the video frame
  available at flush time** — captions appear late.
- Each caption segment must arrive individually so it can be injected at the correct PTS.

**Implementation requirement:** when `captionMode === 'cea708'`, the frontend forces
`lcyt-batch-interval = 0` and the backend rejects batch requests (HTTP 400).

---

## Backend Changes

### 1. `RtmpRelayManager` (refactored)

| Old API | New API |
|---------|---------|
| `start(apiKey, slot, targetUrl, opts)` — one proc per slot | `start(apiKey, relays)` — one proc for all slots via tee |
| `startAll(apiKey, relays)` | `startAll(apiKey, relays)` → delegates to `start()` |
| `stop(apiKey, slot)` — kills slot process | `stop(apiKey)` — kills the single API-key process |
| `stopKey(apiKey)` | `stopKey(apiKey)` → delegates to `stop()` |
| _(none)_ | `writeCaption(apiKey, srtChunk)` — writes SRT cue to ffmpeg stdin |
| `isSlotRunning(apiKey, slot)` | same (checks `_meta` slot list) |
| `runningSlots(apiKey)` | same (reads `_meta` slot list) |

Key behavioural differences:

- When a slot is added/removed (`PUT /stream/:slot`, `DELETE /stream/:slot`) while ffmpeg is
  running, the route stops and restarts the process with the new target list.
- The `onStreamStarted` callback fires once per slot when the process starts.
- The `onStreamEnded` callback fires once per slot when the process exits.

### 2. `POST /captions` route

In CEA-708 mode (relay running with at least one `cea708` slot), the route:

1. Looks up the session's API key.
2. Resolves `speechStart` → SRT cue start time (relative to ffmpeg start).
3. Calls `relayManager.writeCaption(apiKey, srtChunk)`.
4. Continues to send the caption via HTTP POST to YouTube (or not, depending on
   `sender` configuration — a future flag can disable HTTP when CEA mode is active).

### 3. `DELETE /stream/:slot` route

With the tee muxer, removing one slot requires restarting ffmpeg with the remaining targets:

```
DELETE /stream/:slot
  1. deleteRelaySlot(db, apiKey, slot)   — remove from DB
  2. remaining = getRelays(db, apiKey)
  3. if (remaining.length > 0 && relayManager.isRunning(apiKey))
       → relayManager.start(apiKey, remaining)   // restart with updated targets
     else
       → relayManager.stop(apiKey)               // no targets left
```

---

## Frontend (lcyt-web) Changes Required

1. Pass `speechStart` (VAD onset timestamp) in caption payloads when CEA-708 relay is active.
2. Force `lcyt-batch-interval = 0` when `captionMode === 'cea708'`.
3. Show a notice that batch sending is disabled in CEA-708 mode.
4. Enable the CEA-708 toggle in `GeneralModal.jsx` once backend integration is wired.

---

## ffmpeg Version Requirements

| Feature | Minimum ffmpeg version |
|---------|----------------------|
| `eia608` subtitle encoder | 4.4+ |
| Tee muxer | 2.2+ |
| `libx264` with CEA cc_data SEI | 4.4+ |

**Recommended:** ffmpeg 6+ on Ubuntu 22.04 LTS or later.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `eia608` encoder availability on server | Check at startup; warn if not available; fall back to http mode |
| Re-encoding CPU overhead | `libx264 -preset veryfast -tune zerolatency` is low-latency and efficient |
| YouTube ingestion strips `cc_data` SEI from FLV | Test on a live stream; compare with OBS CEA output as reference |
| `speechStart` not provided by older clients | Fall back to `timestamp - CEA708_OFFSET_MS` |
| Caption timestamps too far in the past (behind video PTS) | Clamp `cueStartMs` to `max(0, streamElapsedMs - 5000)` |
| Process restart interrupts stream on slot change | Brief gap accepted; document as expected behaviour |

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CEA708_OFFSET_MS` | `2000` | Milliseconds to shift caption start time earlier when `speechStart` is absent |
| `CEA708_DURATION_MS` | `3000` | Duration of each CEA-708 cue in milliseconds |
| `CEA708_MAX_BACKTRACK_MS` | `5000` | Maximum ms a cue may be shifted behind current stream PTS; prevents captions on stale frames |
| `RTMP_HOST` | `rtmp.lcyt.fi` | Hostname of the nginx-rtmp server |
| `RTMP_APP` | `stream` | nginx-rtmp application name |

---

## Milestone Checklist

- [x] Architecture: one ffmpeg process per API key, tee muxer fan-out
- [x] `RtmpRelayManager` refactored: `start(apiKey, relays)`, `stop(apiKey)`, `writeCaption()`
- [x] `POST /captions` writes SRT cue to ffmpeg stdin in CEA-708 mode; applies utterance-start offset
- [x] `DELETE /stream/:slot` restarts relay with remaining targets
- [ ] Frontend: pass `speechStart` in caption payloads
- [ ] Frontend: force batch-interval = 0 in CEA-708 mode; show notice
- [ ] Test CEA-708 output on YouTube Live — confirm `cc_data` SEI NAL appears in stream
- [ ] Tune `CEA708_OFFSET_MS` per utterance length distribution in production
- [ ] Wire `captions_sent` counter in `rtmp_stream_stats` from the `/captions` route
