# Plan: several MediaMTX servers (long term)

**Status:** draft, long term, not started (2026-10-12). Follows `plan_multi_instance.md` L4.

## Problem
L4 lets any backend instance own a relay, crop or STT key, but there is still one MediaMTX (and one nginx-rtmp) that takes every incoming stream. Ingest bandwidth, HLS output and the `runOnPublish` ffmpeg children all sit on that host. When one server is too small, or must not be a single point of failure, ingest has to spread over several.

## Idea
Each ingest key (stream key resolved by `resolveApiKeyFromIngestStreamKey`) is assigned to one MediaMTX server. The encoder publishes to that server; everything that reads the stream (relay tee, crop, HLS, preview, STT, auditor pull) uses the same server.

## Pieces
1. **Server registry.** Table `media_servers(id, rtmp_url, rtsp_url, api_url, hls_url, capacity, state)`; each MediaMTX registers or is listed by config. `MediaMtxClient` becomes one client per server.
2. **Assignment.** `ingest_assignments(api_key, server_id)`; chosen when the ingest key is shown or rotated (least loaded, or sticky by hash). The ingest status route returns the RTMP URL of the assigned server.
3. **Callbacks.** Each MediaMTX posts publish/unpublish to any backend instance (`/rtmp`, `/feed-rtmp`) with its server id; the L4 owner of the key then talks to that server's API.
4. **Readers.** Crop, preview, HLS proxy and STT pull URLs are built from the assigned server instead of `MEDIAMTX_*` globals. Public HLS and radio routes resolve the server per key.
5. **Failure.** A dead server means its keys are down until reassigned; reassignment is manual at first, automatic later. Not in scope: transparent stream failover.
6. **Single server.** One configured server is today's behaviour; no assignment table needed.

## Open questions
- Is one rtmp hostname with an L4 load balancer in front simpler than per-key assignment?
- Do viewers need one HLS hostname (reverse proxy per key) or can the player use per-server URLs?
- Autoscaling (Hetzner burst) for MediaMTX the way it is planned for fleet workers?

## Not before
Real MediaMTX and fleet runs of L4 on two hosts.

## Other managers (decided 2026-10-12)
Not wrapped by L4 on purpose; revisit together with this plan:
- **HLS, radio, preview:** served from the local MediaMTX of the key. They stay on the relay instance until keys are assigned to servers (step 2); then the owner of a key is the instance next to its server, and the public HLS/radio/preview routes resolve the server per key.
- **Perception and music detection:** run per stream on the instance that sees it. They need the same per-key lease and forwarding as relay/crop/STT (one more `withOwnership` spec); worth doing when more than one instance runs them.
- **DSK overlay images:** the forwarded call works, but the image files sit in `GRAPHICS_DIR` of the storing instance. Storing graphics in S3 (like caption files) would remove the shared-volume requirement.
