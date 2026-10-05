# `packages/lcyt-compute` — ffmpeg runners and job dispatch (v0.1.0, private)

Shared compute library for `lcyt-backend` (and its plugins), `lcyt-worker-daemon` and, later, `lcyt-orchestrator` and Saarnavideo. Plain ESM, Node built-ins and `fffleet`: no Express, no DB. See `docs/plans/plan_compute_split.md` for where it is going (job contract v1, batch jobs, one dispatch client).

**Exports:**
- `lcyt-compute` / `lcyt-compute/ffmpeg` — `createFfmpegRunner({ runner, purpose, apiKey, ...opts })` (`spawn`|`local`|`docker`|`worker`|`fleet`, default `FFMPEG_RUNNER`), `LocalFfmpegRunner`, `DockerFfmpegRunner`, `WorkerFfmpegRunner`, `FleetFfmpegRunner` (fffleet client; `async `getFleet()`/`closeFleet()` share one client, fffleet loaded on first use), and the compute accounting hooks `setFfmpegAccountingSink()`, `reportFfmpegRun()`, `getRunningFfmpegCounts()`. The accounting sink is module-level state, so every consumer must resolve the same copy of this package (npm workspaces guarantee that).
- `lcyt-compute/ffmpeg/<file>` — any file in `src/ffmpeg/` by name, e.g. `lcyt-compute/ffmpeg/pipe-utils` (`makeFifo`, `isFifo`, `createFifoWriter`) or `lcyt-compute/ffmpeg/docker-runner`.

- `lcyt-compute/ffmpeg` also exports `spawnFfmpeg(args, { purpose, apiKey, stdio, runner })`: `child_process.spawn('ffmpeg')` normally, an fffleet job behind a ChildProcess look-alike (`stdin`/`stdout`/`stderr` streams, `kill()`, `exit`/`close` events) when the runner is `fleet`. Used where callers read ffmpeg's stdout or write its stdin themselves (STT, music analysis, PCM decode, DSK renderer). Needs fffleet >= 1.1 (`stdout: true`, `endStdin()`); fleet stderr is an empty stream.

**Source files (`src/ffmpeg/`):** `index.js` (factory + accounting), `local-runner.js`, `docker-runner.js`, `fleet-runner.js` (fffleet: stream jobs, stdin as a Writable, reports `close` when a job ends by itself, local fallback), `spawn.js` (`spawnFfmpeg`), `worker-runner.js` (direct worker or orchestrator dispatch, with `ORCHESTRATOR_FALLBACK`), `pipe-utils.js`, `README.md`.

**Compatibility:** `lcyt-backend/ffmpeg` and `lcyt-backend/ffmpeg/pipe-utils` re-export this package, so older imports keep working. New code imports `lcyt-compute/ffmpeg` directly.

**Tests:** `npm test -w packages/lcyt-compute` (node:test): runner, Docker spawn (mocked), worker runner (mocked fetch) and FIFO helper tests, moved from `lcyt-backend/test`. Docker integration tests still live in `lcyt-backend/test/integration/`. CI runs this package in the `standalone-tests` job.
