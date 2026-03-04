# Plan: CEA-708 Caption Embedding in the RTMP Relay

## Overview

This document describes how to embed CEA-708 closed captions directly into the RTMP video stream that `RtmpRelayManager` forwards via ffmpeg. This is the alternative to sending captions to YouTube over HTTP POST (`/captions`).

CEA-708 is the US ATSC standard for digital closed captions. YouTube, Twitch, and most professional broadcast chains support CEA-708 data embedded in the H.264 SEI NAL units of the video stream.

---

## How CEA-708 Works in a Video Stream

1. **Video SEI (Supplemental Enhancement Information) packets** carry CEA-708 user_data_registered_itu_t_35 payloads within the H.264/H.265 bitstream.
2. The caption payload is **PTS-anchored** — each packet is tied to a specific video frame's Presentation Timestamp, ensuring the text appears at exactly the right moment.
3. FLV/RTMP containers transmit H.264 video with SEI intact, so captions embedded in the stream are forwarded transparently by nginx-rtmp to the relay target.

---

## Why Batch Sending Must Be Disabled in CEA Mode

In HTTP caption mode, the relay backend applies its own NTP-synced clock to timestamp captions, and batching introduces predictable, compensatable latency.

In CEA mode:
- The caption timestamp must match the **video PTS at the moment the text is inserted** into the SEI NAL.
- If captions are accumulated in a batch buffer, the PTS of the video frame available when the batch is eventually flushed will be later than when the speech was recognised — the caption will appear late.
- Each caption segment must be injected immediately when it arrives, mapped to the current video PTS.

**Implementation requirement:** when `captionMode === 'cea708'`, disable the batch window (`lcyt-batch-interval = 0`) and bypass the batch buffer in `useSession.construct()`.

---

## Implementation Architecture

### Phase 1 — Soft overlay via `drawtext` ffmpeg filter (quickest path, visible only)

Not true CEA-708. Useful for testing. ffmpeg burns text into the video pixels.

```
ffmpeg -re -i <sourceUrl> \
  -vf "drawtext=text='<caption>':x=50:y=H-th-50:fontsize=32:fontcolor=white" \
  -c:v libx264 -c:a copy -f flv <targetUrl>
```

Drawbacks: requires re-encoding, degrades video quality, cannot be toggled off by the viewer.

---

### Phase 2 — Native CEA-708 embedding (correct approach)

#### 2a. Using `lavfi` + `cctoraw` / `eia608` filters (ffmpeg ≥ 5.0)

ffmpeg has experimental support for writing CC data via the `eia608` subtitle filter and the `a64` rawvideo encoder for testing, but **native CEA-708 injection in H.264 SEI is not yet supported directly by a stable ffmpeg filter chain**.

#### 2b. Recommended path — separate caption injector sidecar process

The most robust approach is a **sidecar** process that:

1. Reads the incoming RTMP stream from nginx (the same stream that ffmpeg currently relays).
2. Receives caption text + timestamp from the backend over a local socket/pipe.
3. Maps caption timestamps to video PTSes using the stream's clock.
4. Injects CEA-708 user data into H.264 SEI NAL units.
5. Writes the modified stream to the target RTMP URL.

Candidate tools (**require evaluation before adoption** — verify current maintenance status and ffmpeg/FLV compatibility before committing to any):
- **[caption-inspector](https://github.com/nickvdyck/caption-inspector)** — reads SCC/CEA-708 and can inject into streams.
- **[scte35-threefive](https://github.com/futzu/scte35-threefive)** — not directly applicable but shows the sidecar injection pattern.
- **Custom Node.js / Python sidecar** using a library like `node-flv` or `pyflv` to parse and modify FLV packets.

#### 2c. Recommended ffmpeg approach — `subtitles` + `movtext` (MP4/FLV subtitle track)

YouTube's ingestion pipeline can read CEA-608/708 from a closed caption text track embedded in the container rather than from SEI. Steps:

```
ffmpeg -re -i <sourceUrl> \
  -f data -i pipe:0 \               ← caption text fed via stdin/pipe
  -map 0:v -map 0:a -map 1 \
  -c:v copy -c:a copy \
  -c:s mov_text \                   ← embed as MP4 subtitle track
  -f flv <targetUrl>
```

YouTube requires the caption track to use the `mov_text` codec for RTMP delivery. This is **supported by ffmpeg 6+**.

---

## Backend Changes Required

### 1. `RtmpRelayManager`

Add a `cea708` spawn mode alongside the existing `copy` relay:

```js
spawnFfmpeg(apiKey, sourceUrl, targetUrl, captionMode) {
  if (captionMode === 'cea708') {
    // Open a stdin pipe for caption injection
    return spawn('ffmpeg', [
      '-re', '-i', sourceUrl,
      '-f', 'data', '-i', 'pipe:0',   // caption input
      '-map', '0:v', '-map', '0:a', '-map', '1',
      '-c:v', 'copy', '-c:a', 'copy',
      '-c:s', 'mov_text',
      '-f', 'flv', targetUrl,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
  }
  // default: stream copy
  return spawn('ffmpeg', ['-re', '-i', sourceUrl, '-c', 'copy', '-f', 'flv', targetUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
```

### 2. Caption injection

When `captionMode === 'cea708'`, the `POST /captions` route must write the caption text to the ffmpeg process's `stdin` pipe (via `relayManager.writeCaptionToStream(apiKey, text, timestamp)`).

The timestamp-to-PTS mapping is maintained by ffmpeg itself, since we feed captions with the real wall-clock timestamp and ffmpeg can derive PTS offset from the stream start time.

### 3. Batch enforcement

Add a guard in `/captions` route: if the relay is running with `cea708` mode, reject batch requests (return `400 Batch not supported in CEA-708 mode`).

---

## Frontend (lcyt-web) Changes Required

1. When `captionMode === 'cea708'` is active and the relay is running:
   - Force `lcyt-batch-interval` to `0`.
   - Bypass the `construct()` batch buffer; use `send()` directly.
   - Show a notice in the UI that batch sending is disabled.

2. The `GeneralModal.jsx` CEA-708 button is already shown as a disabled placeholder. Enable it once Phase 2 is ready.

---

## Synchronisation Notes

- **HTTP mode**: captions are timestamped by the client at the moment speech is finalised. The backend applies a sync offset to align with YouTube's ingest clock.
- **CEA-708 mode**: captions must be timestamped with the **video PTS** at the time the text is injected into the SEI NAL. This means the caption stream must track the live PTS of the relay stream. The safest implementation is to let ffmpeg assign PTS from the stream start time and provide captions relative to that start.
- The LCYT `syncOffset` mechanism does not apply to CEA-708 mode — PTS alignment is handled by ffmpeg's muxer.

---

## Risks and Open Questions

| Risk | Mitigation |
|------|-----------|
| ffmpeg version compatibility for `mov_text` in FLV/RTMP | Test with ffmpeg 6+ on Ubuntu 22.04 LTS |
| YouTube ingestion might strip subtitle tracks from FLV | Fallback to SEI NAL injection via sidecar |
| Caption latency from HTTP → stdin pipe | Use `stdin.write()` without buffering; monitor lag |
| Re-encoding cost if drawtext overlay is used in Phase 1 | Phase 1 is optional and clearly labelled as non-CEA |

---

## Milestone Checklist

- [ ] Phase 0 (current): CEA-708 mode is a placeholder in UI; caption delivery is HTTP POST only
- [ ] Phase 1: `drawtext` overlay for demo/testing (opt-in, warn user it re-encodes)
- [ ] Phase 2a: Prototype sidecar injector for CEA-708 SEI NAL injection
- [ ] Phase 2b: `mov_text` subtitle track via ffmpeg pipe — test with YouTube ingest
- [ ] Phase 3: Full integration — batch disable enforcement, PTS-accurate sync, UI enablement
- [ ] Phase 4: Wire `captions_sent` counter in `rtmp_stream_stats` from the `/captions` route (track captions delivered per active RTMP relay session)
