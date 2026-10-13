# Plan: deprecate nginx-rtmp

**Status:** in-progress — phase 1 (deprecation notices) done; removal not started.

MediaMTX has replaced nginx-rtmp as the RTMP/HLS broker (`plan_mediamtx.md`; the deploy-media stack ships only MediaMTX). This plan retires the nginx-rtmp specific parts of LCYT. The plain nginx web server that serves the static frontend is **not** part of this plan and stays.

## Phase 1 — deprecate (this change)

- `POST /rtmp`, `/feed-rtmp[/on_publish|/on_publish_done]` and `/dsk-rtmp[/...]` (the nginx-rtmp `on_publish` / `on_publish_done` callbacks) answer with `Deprecation: true` and a `Link: <this plan>; rel="deprecation"` header, and log a warning (at most once per route per 10 minutes). Behaviour is unchanged.
- `/radio/on_publish[_done]` is **not** deprecated: it is also the documented MediaMTX `runOnPublish` hook target.
- Docs (`docs/api/rtmp-callbacks.md`), `CHANGELOG.md` and the startup message say so.

## Phase 2 — replacements to have in place before removal

| Today (nginx-rtmp) | Replacement |
|---|---|
| `on_publish` / `on_publish_done` tell the backend a key started or stopped publishing | MediaMTX `runOnReady` / `runOnNotReady` hooks post to `/internal/mediamtx/path` (kept off the public proxy). A slow reconcile poll of the MediaMTX API (`MediaMtxClient.getPath(name).ready`) is the safety net for missed hooks, not the primary trigger. Design: `reports/mediamtx-ffmpeg-fleet-plan-2026-10-13.md` (supervisor). |
| `relay_allowed` gate answered with 403 on `on_publish` | MediaMTX `authInternalUsers` / external auth against the backend, or reject on the first poll |
| `feed` camera keys (`prod_cameras.camera_key`) and `dsk` app | MediaMTX paths with the same names; resolved by the supervisor |
| `NginxManager` radio slug proxy (`/r/<slug>/` to `http://mediamtx:8080/<key>/`) | The backend HLS proxy `GET /radio/:key/*` already proxies to MediaMTX when `NGINX_RADIO_CONFIG_PATH` is unset. Add a slug route in the backend (`GET /r/:slug/*`, slug = sha256(key)[0:16]) so the key stays out of public URLs without nginx. |
| DSK renderer pushing to the nginx-rtmp `dsk` app (`renderer.js`) | Push to the MediaMTX path instead |

## Phase 3 — remove

Delete `routes/rtmp.js` callback handling, `routes/feed-rtmp.js`, `lcyt-dsk/src/routes/dsk-rtmp.js`, `nginx-manager.js` and its settings (`NGINX_RADIO_CONFIG_PATH`, `NGINX_TEST_CMD`, `NGINX_RELOAD_CMD`, `RTMP_APPLICATION`), `scripts/nginxbot.sh`, `scripts/golive-local` nginx parts, nginx-rtmp comments in `docker/mediamtx.yml` and `docker-compose.yml`, the k8s config map entries, and the docs. Release as a breaking change with a changelog note. Do this only once no deployment still points an nginx-rtmp at the callbacks.
