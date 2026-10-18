# Plan: Tally lights (stream-light)

**Status:** L1 (backend plugin) and L2 (bridge) implemented; L3 (web) follows.

A light that shows whether the stream is on (red when live; usable as an operator reminder or an entrance notice) and camera tally lights. Hardware: Tally-MA Wi-Fi tally lamp (ordered by Juha). The engine lives in https://github.com/jsilvanus/stream-light (MIT) and is shared by three homes: the standalone program, the LCYT backend (local install mode) and the LCYT bridge.

## Decisions
- Kinds: `live-signal` (LIVE, DEGRADED, STARTING, OFF, UNKNOWN) and `camera` (PGM, PRV, OFF, UNKNOWN). Several lights per project; one lamp is driven by one enabled light.
- YouTube is the source of truth. Mode A (project's YouTube login, finds the broadcast, ingest health) and mode B (video id + API key).
- The backend drives a lamp itself only in local install mode. Elsewhere the bridge does (backend polls and sends `light_set`).
- Fail-safe: `ttlMs` on every reading, receiver-side deadline, periodic re-apply, UNKNOWN look when readings stop.
- Setup Hub card "Tally" (L3). API prefix `/api/v1/tally`.
- stream-light is vendored under `lcyt-tally/vendor/stream-light` until it is on npm.

## Steps
- S1 stream-light (merged).
- L1 `lcyt-tally` plugin, schema, routes, backend runner, `light_set` IP check.
- L2 bridge: `light_set`, tally host with deadman, config fetch, ATEM events.
- L3 web: Setup Hub card, wizard, i18n.
- L4 OBS camera tally.

## Not verified
YouTube live endpoints, Tally-MA lamp behaviour (init packet, resend interval, interplay with its own server software) and ATEM events were written from documentation and tested against fakes only.


## Mixer camera tally (added)
Camera lights can follow LCYT's own software mixer (`source.type: lcyt`, stream-light #2): backend-fed from the production registry's program changes, PGM/OFF only. Setup Hub: "Camera source" → "LCYT software mixer".
