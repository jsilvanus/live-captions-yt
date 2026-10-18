# `packages/plugins/lcyt-tally` — Tally lights

Live-signal lights ("is the stream on", from YouTube) and camera tally (program/preview of a switcher input), shown on a lamp such as the Tally-MA Wi-Fi tally. The engine is **stream-light** (https://github.com/jsilvanus/stream-light, MIT), shared with its standalone program. Plan: `docs/plans/plan_tally.md`.

**Status:** tested with a fake YouTube API and a local UDP socket only. Not verified against the real YouTube live endpoints, a real Tally-MA lamp or a real ATEM.

## Source files
- `vendor/stream-light/` — copy of stream-light's core, YouTube/push sources and tally-ma/webhook/console outputs. **Do not edit by hand**: change stream-light, then `npm run sync:stream-light -w lcyt-tally -- <checkout>`. (Replace with the npm dependency once `@jsilvanus/stream-light` is published.) `VENDORED.md` records the commit.
- `src/db.js` — `tally_lights` CRUD (table in the core schema: `sqlite/schema.sql`, both `schema*.prisma`, `postgres/migrations/0005_tally_lights.sql`). `source_json`/`output_json`/`look_json` are validated JSON text.
- `src/validate.js` — `validateConfig` (stream-light's `validateLightConfig`, timing overrides dropped) and `clashError` (one lamp, one enabled light, per project).
- `src/manager.js` — `createTallyManager`, `resolveRunner`. Runs the lights this process owns.
- `src/routes/tally.js` — `/api/v1/tally/*` (`GET/POST /lights`, `PUT/DELETE /lights/:id`, `POST /lights/:id/test`, `GET /status`). Writes need the project's setup tier.
- `src/api.js` — `initTally(db, deps)`, `createTallyRouter`.

## Where a light runs (`runner`)
- `backend`: the server sends UDP/HTTP to the lamp itself. **Only in local install mode** (`LCYT_INSTALL_MODE=local`): a hosted server is not on the lamp's LAN and must not be a way to probe other networks. Outside local mode the light is stored but not run, with a note saying why.
- `bridge`: the backend polls YouTube and sends every reading to the bridge as a `light_set` command (the bridge enforces its IP rules and holds the deadman). Camera lights on a bridge are run by the bridge itself: it fetches them from `GET /api/v1/tally/bridge/lights?token=` (`createTallyBridgeRouter`, bridge-token auth, mounted before the project-scoped router) and is told to refetch with the SSE event `tally_updated` (`BridgeManager.broadcastTallyUpdated`). When a bridge live-signal light is deleted, disabled or moved to another lamp, the manager sends `light_set` with `release: true` so the lamp goes dark.
- `auto`: backend in local mode, else the named bridge; a camera light with a named bridge always uses it (the backend has no switcher feed yet).
- Outputs `console`/`web` only feed the status API and run anywhere.

## Fail-safe
A reading carries `ttlMs`; receivers compute their deadline from their own receipt time (clock skew). The light re-applies its state every `ttlMs/3`; outputs fall back to the UNKNOWN look when nothing arrives; two failed polls make the state UNKNOWN. `light_set` carries the looks of every state so the bridge can show UNKNOWN on its own.

## Config
- `TALLY_YOUTUBE_API_KEY` — Google API key for YouTube mode B (video id). Mode A uses the project's YouTube platform login (`lcyt-platforms`; `source.credentialId`, or the only YouTube credential).
- Single instance: with several backend instances every instance would poll YouTube and drive the lamps (see `CONSIDER.md`).

## Tests
`npm test -w lcyt-tally`: routes, runner choice, backend runner against a UDP socket, bridge `light_set`, vendored-copy checks. The bridge's IP check of `light_set` is tested in `lcyt-production/test/bridge-manager.test.js`.
