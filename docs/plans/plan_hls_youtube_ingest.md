---
id: plan/hls-youtube-ingest
title: "HLS ingestion to YouTube (research)"
status: draft
summary: "Research only: YouTube HLS ingest requirements, LCYT and fffleet fit, work estimate. Not scheduled; RTMP stays the default."
---

# HLS ingestion to YouTube for live-captions-yt (LCYT)

Date: 2026-10-19. Research only, no code changed. Requested by Juha in the project thread "The media stack will be tested completely on local Windows machine".

Status of claims: facts about YouTube come from Google's HLS ingestion guide (fetched 2026-10-19). Facts about LCYT and fffleet come from the code in the checked-out repos (`live-captions-yt` at `3e8a6eb`, `fffleet` at `31e5109`). Nothing was run against YouTube, MediaMTX or a fleet. Everything marked "unverified" needs a real test.

## 1. Short answer

- YouTube does accept HLS as an ingest path. The stream key is not a separate secret in this case: the ingest URL carries a `cid` parameter, and Creator Studio's HLS key is marked beta by Google.
- The benefits for LCYT are real but narrow: outbound HTTPS on port 443 instead of RTMP on 1935, segment-level retry instead of one long TCP connection, a backup host (`b.upload.youtube.com`) for redundancy, and an HEVC/HDR option. Captions keep working.
- The costs are latency, a `-c copy` that may stop being enough (closed GOP and AAC are required), a key inside a URL that ffmpeg and fffleet print, and a restart story that has to keep segment numbering unique.
- Fit with fffleet is good. An HLS push is a `kind: stream` job with an `rtsp:` input and an `https:` output. The contract already passes both through to ffmpeg, so no contract change is needed.
- Recommendation: do not change the default. Run a manual prototype first (section 6). Build the minimal path only if the prototype passes and the network case (section 4) is real for Juha's sites.

## 2. What YouTube's HLS ingest requires

Source: [Delivering Live YouTube Content via HLS](https://developers.google.com/youtube/v3/live/guides/hls-ingestion).

- Container and codecs: M2TS, one MPEG-2 program per segment. Video H.264 or HEVC, up to 60 fps, closed GOP only. Audio AAC, one track. Exactly one rendition (no ABR ladder).
- Embedded 608/708 captions work only with H.264.
- Segments 1–4 s recommended; hard limit 5 s.
- Media playlist only (master playlists are ignored). Filename ends in `.m3u8`. Sequence numbers start at 0 and only increase. Segment names must be unique across reboots and restarts, end in `.ts`, and match the playlist.
- At most five outstanding segments per playlist.
- Methods PUT or POST. DELETE is accepted but ignored. Keep one HTTPS connection alive.
- Encryption only as TLS. No `EXT-X-KEY`.
- URL: `https://a.upload.youtube.com/http_upload_hls?cid=<key>&copy=0&file=<name>`. Backup: `b.upload.youtube.com` with `copy=1`. The backup must use a different `copy` value from the primary.
- Captions: separate HTTP POST captions work for all HLS ingestion. Embedded 608/708 is the other option.
- Ingestion type is chosen when the liveStream resource is created: `cdn.ingestionType = "hls"`. The response carries `ingestionAddress` (the full URL, with the `cid`) and `backupIngestionAddress`.
- Not stated by Google: byte-range support, audio-only streams, resolution or bitrate caps, channel eligibility.

## 3. What LCYT does today

Verified in code:

- Relay targets are `targetUrl` + `targetName`. For YouTube the target is `rtmp://a.rtmp.youtube.com/live2` plus the key (`packages/lcyt-web/src/lib/relayConfig.js:314`). Slot count is not capped (`packages/plugins/lcyt-rtmp/src/db/relay.js:29`).
- Fan-out is one ffmpeg per API key with a tee muxer: `-f tee "[f=flv]rtmp://…|[f=flv]…"` (`packages/plugins/lcyt-rtmp/src/rtmp-manager.js:182-191`). Default `-c copy`. Per-slot transcode options exist (scale, fps, bitrate).
- Two run modes (`packages/plugins/lcyt-rtmp/src/fanout-supervisor.js` header): `hook` (MediaMTX `runOnPublish`, ffmpeg inside the MediaMTX container, the default according to project memory) and `runner` (ffmpeg started through the runner factory: local spawn or an fffleet worker, restarted with backoff).
- Captions have two modes, `http` and `cea708`:
  - `http` (default): `YoutubeLiveCaptionSender` POSTs to `upload.youtube.com/closedcaption` (`packages/lcyt/src/sender.js`). Works for HLS per Google's guide.
  - `cea708`: SRT cues go to ffmpeg stdin and are embedded as CEA-608 SEI in H.264 with `libx264` and `-c:s eia608` (`rtmp-manager.js` around lines 441–500). Forces a re-encode. H.264 is what HLS needs for embedded captions, so this path carries over.
- Broadcast creation in `packages/plugins/lcyt-platforms/src/adapters/youtube.js:316` hard-codes `ingestionType: 'rtmp'` and reads `ingestionInfo.streamName` plus `ingestionAddress` as an RTMP base (lines 332–333). An HLS target therefore needs a different read: the whole URL is the secret, there is no separate name.
- The stream key is already printed. ffmpeg's output header includes the output URL, and the RTMP key sits in it. fffleet returns `stderrTail` in job events without scrubbing (`packages/fffleet/src/job-manager.js:254, 285`). So the exposure is not new, but an HLS URL puts the key in a query string, where it is easier to miss in a scrubber.

## 4. Benefits

1. Network reach (judgement, unverified for Juha's sites). RTMP needs outbound TCP 1935. Some church, AV and venue networks block it; HTTPS on 443 usually goes through. `docs/FIREWALL.md` covers inbound 1935 only, so egress is not documented either way.
2. Segment-level retry. A failed PUT can be retried, where a dropped RTMP connection ends the stream and needs a reconnect. Whether YouTube tolerates a retried segment cleanly is unverified.
3. Backup host. `b.upload.youtube.com` with `copy=1` gives a second path. RTMP has a backup ingest address too, so this is comparable, not new.
4. Quality ceiling. HEVC and HDR are possible (10-bit, PQ or HLG). Captions are then sent by POST only, since embedded 608/708 is H.264-only. LCYT's current captions cannot combine with HEVC.
5. Captions carry over. The POST path works unchanged. The cea708 path works with H.264 and a re-encode, as now.

## 5. Costs and risks

1. Latency. Google says HLS is higher latency than RTMP. Segment buffering (2–4 s per segment, five outstanding) adds upstream delay. Captions are POSTed against the live clock, so a mismatch is likely. The cea708 path already has delay compensation (`CEA708_OFFSET_MS`, `cea708DelayMs`), which would need to be measured for HLS.
2. Closed GOP. `-c copy` keeps the encoder's GOP. Open-GOP sources would be rejected or misbehave. Checking needs a probe, or a transcode with `-x264-params` or `-g`/`-sc_threshold 0`. A transcode costs CPU and changes the fleet sizing.
3. Restart numbering. The FanoutSupervisor restarts ffmpeg with backoff. A restarted ffmpeg must not reuse segment names or sequence numbers. Needs `-start_number` from a value that increases across restarts (for example epoch-based) plus a per-run file prefix.
4. ffmpeg over HTTP. A failed segment PUT may end the ffmpeg process. If so, every upload hiccup is a restart. Unverified. Needs a test against a fake server that returns 500 and 202.
5. The key in URLs and logs. Scrub `cid=` in stderr, job events, logs and the DB rows that keep the URL. The current RTMP exposure should be fixed in the same change.
6. Eligibility. Google does not state channel requirements for HLS, and Creator Studio HLS keys are beta.
7. Single-run tee. The tee muxer is awkward with HLS sub-muxers and `|` separators. HLS needs its own ffmpeg process per target, which also isolates failures.
8. Hook mode. Hook mode runs ffmpeg in the MediaMTX container. HLS should be runner-only (spawn or fleet).

## 6. Fit with fffleet

Good fit, no contract change needed:

- An HLS push is `kind: "stream"`, `type: "ffmpeg"`, with an `rtsp:` input (passthrough) and an `https:` output. The contract says HTTP(S) outputs of a stream job "are handed to ffmpeg as they are" (`packages/fffleet/README.md`, contract section, and `contract.js` `PASSTHROUGH_SCHEMES`/`HTTP_SCHEMES`).
- The fleet tracks only process exit and `stderrTail`. Restart and segment logic stay in LCYT's FanoutSupervisor, which already does backoff restarts in runner mode.
- Stream workers are sized by cores. Copy mode is cheap. A transcode for closed GOP needs cores on a stream worker. Burst Hetzner workers with `kinds: [stream]` or `both` can take it.
- Worker ffmpeg must have the `hls` muxer and `https` protocol. Standard builds have both; the fleet image should be checked (unverified).

Gaps to close on the fffleet side (generic, so they stay out of LCYT):

- A spec-level redaction list (for example `redact: ["cid="]`) applied to `stderrTail` and events. This is a generic fffleet feature, not an LCYT one. It also fixes the RTMP key exposure.
- Nothing else is required for the minimal path.

## 7. Work estimate (judgement, not measured)

| Step | What | Rough effort |
|---|---|---|
| A. Manual prototype | One ffmpeg command from a local MediaMTX (Juha's Windows setup) to a test broadcast created with `ingestionType: hls`. Check segments accepted, captions appear, measure latency. No code. | 0.5–1 day |
| B. Minimal path | New relay target kind `hls` (full URL as secret, entered by hand), runner mode only, one ffmpeg per target, copy mode, closed-GOP probe, unique segment names and `-start_number`, `cid=` scrubbing, tests against a fake HTTP server (202, 500, 405). | 4–6 dev days |
| C. Full | B plus API broadcast creation with `ingestionType: hls` (platforms adapter and tests), backup URL on `b.` with `copy=1`, lcyt-web relay UI, transcode option for closed GOP, HLS caption timing, fleet capability routing, docs sync (`README.md`, `docs/`). | About 2–3 weeks |

These numbers assume a developer familiar with the code. They exclude the Windows and real-YouTube test time, which the repo's rules make manual.

## 8. Recommendation

1. Run step A on Juha's Windows test rig. Pass criteria: YouTube accepts the segments without a 4xx after five minutes; captions POSTed through the existing sender appear and line up within a few seconds; a forced PUT failure restarts cleanly with no duplicate segment name.
2. Ask whether the venues or AV networks have outbound 1935 problems. If not, the benefit is small and C is not worth building now.
3. If the prototype passes and the network case is real, build B first. Keep HLS opt-in per target. Do not flip the default.
4. Make the fffleet redaction change a separate, generic change in `fffleet` before B lands.

## 9. Open questions for Juha

- Are outbound 1935 blocks a real problem at the sites this will run from?
- Is HEVC or HDR wanted, or is H.264 enough?
- Is a 10–30 s extra delay acceptable for viewers, given that captions are timed against the live clock?

## Sources

- Google, [Delivering Live YouTube Content via HLS](https://developers.google.com/youtube/v3/live/guides/hls-ingestion)
- Google, [Live caption requirements](https://support.google.com/youtube/answer/3068031) (search summary only; embedded 608/708 needs one of YouTube's supported encoders)
- LCYT code: `packages/lcyt-web/src/lib/relayConfig.js`, `packages/plugins/lcyt-rtmp/src/rtmp-manager.js`, `packages/plugins/lcyt-rtmp/src/fanout-supervisor.js`, `packages/plugins/lcyt-platforms/src/adapters/youtube.js`, `packages/lcyt/src/sender.js`, `docs/FIREWALL.md`
- fffleet code: `packages/fffleet/src/contract.js`, `packages/fffleet/src/job-manager.js`, `packages/fffleet/README.md`
