# LCYT Project Status

*Rewritten 2026-10-06 on `main` (7c2e6f9 plus the 2026-10-06 fixes). Replaces the 2026-06-30 snapshot. This is a point-in-time summary; `docs/PLANS.md` is the plan index, `TODO.md` the open work, `CONSIDER.md` the skipped review findings.*

## Health

- CI on `main` green. 3,888 of 3,889 Node tests pass (1 skipped), 552 Vitest tests in `lcyt-web`. Per-package numbers: `docs/TEST_COVERAGE.md`.
- No open PRs or issues.

## What is built

Core library and CLI; Express relay backend with target-array delivery (YouTube, viewer, generic); web UI (sidebar app, setup wizard, assets, cues, production, admin); MCP servers (stdio, HTTP, in-backend); DSK graphics editor and renderer (local or as an fffleet job); RTMP relay, HLS, radio, previews and CEA-708 through MediaMTX; vertical crop with live repositioning over ffmpeg stdin; server-side STT (Google, Whisper, OpenAI, and the `auditor` provider where the liturgos-auditor service pulls the stream itself); cue engine (phrase, regex, fuzzy, semantic with line/window context, event, sound, track, composite) with backend action execution, arming and a per-project rate cap; named actions; API connectors and live variables (varfetch); music detection; AI roles, provider registry and local `deer` embeddings; person-detection perception with tracker, feed attribution, LLM hand-off and crop auto-follow; production control (cameras, mixers, bridge); YouTube platform sync; recording; metering, Prometheus and audit log; server settings in the UI; five-tier project roles; revoked project keys stop all tokens.

Compute: `lcyt-compute` runs ffmpeg locally, in Docker, or on an fffleet fleet (`FFMPEG_RUNNER=fleet`, `FFFLEET_URL`). The in-repo orchestrator and worker daemon are gone.

## What is not proven

Everything that talks to another machine or a third party has run against fakes only: fleet, auditor, MediaMTX, YouTube, perception on real footage, crop latency on real RTSP. See `TODO.md`.

## Deferred

Facebook Live adapter; `deer` chat provider kind.

## Deployment

`docker-compose.lcyt.yml` runs LCYT alone. `docker-compose.yml` adds MediaMTX. The fffleet orchestrator and workers and the auditor are separate deployments (see `docs/DEPLOY.md`).

