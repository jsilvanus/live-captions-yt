# Quick workflows: ideas for later

Status: ideas only (2026-10-20). Built so far: `/quick` with "Send captions to YouTube" and "Send broadcast to multiple targets" (PR #411). Each flow is one page where setup and action share a small pop-out window, built on existing endpoints.

Basis: what Restream and StreamYard offer (multistreaming, stream health, scheduling, combined chat, cloud recording, clips, backup-stream failover; captions mostly an extra). Vendor pages and comparison blogs, so plan limits are approximate.

## Suggested order

1. **Stream check**: is the stream arriving, bitrate and frame rate, is each output running, last relay exit. Data: `GET /ingestion/config`, `GET /ingestion/streams`, `GET /stream` (runningSlots, stderrTail).
2. **Schedule a broadcast**: create the YouTube event, title, thumbnail, go-live checklist. Data: `lcyt-platforms` (YouTube scheduling, thumbnails, stats).
3. **Record and hand over to Saarnavideo**: record the service, send it on when it ends. Data: feed recording and the Saarnavideo handoff (LCYT #358, Saarnavideo `/api/imports/lcyt`). Best fit for church use.
4. **Translated captions**: pick languages, send to the viewer page or on screen. Data: translation targets, viewer targets, DSK.
5. **Backup stream**: a second ingest that takes over when the main one drops. Needs a design first (feeds, relay slots).

## Also considered

- **Sunday service in one click**: a preset that combines captions, restream and recording.
- **Lower thirds / graphics**: quick DSK cues without opening the DSK editor.
- **Combined chat**: skipped for now, there is no chat source.
- **Clips from the live stream**: later, after recording exists.

## Open design points

- One shared "Audio from" component for the auditor feed choice (the quick page and the microphone window each have their own picker).
- Locking outputs to one ffmpeg process is a separate design thread, not part of the quick pages.
- Nothing here has run against real YouTube, the auditor service or a real relay.
