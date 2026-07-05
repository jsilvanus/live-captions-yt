# `packages/lcyt-orchestrator` — Compute Orchestrator (v0.0.1, private)

Stateless Express HTTP service that manages a pool of worker VMs and dispatches compute jobs (e.g. ffmpeg transcoding). Supports on-demand burst provisioning via the Hetzner Cloud API and optional Prometheus metrics exposition.

**Entry:** `src/index.js` (CommonJS, `node src/index.js`)
**Port:** `process.env.PORT` (default 4000)

**Source files (`src/`):**
- `index.js` — Express app. In-memory `workers` and `jobs` maps. Pending burst queue. Kicks off Hetzner burst VM creation when no warm capacity is available.
- `hetzner.js` — `createHetznerClient()`: REST client for Hetzner Cloud API with exponential-backoff retry and 429 rate-limit handling. `createBurstServer()`, `pollServerReady()`.
- `autoscaler.js` — `startAutoscaler()`: periodic tick that provisions burst VMs when queued jobs exceed `burstQueueLimit`. Runs only when `HETZNER_API_TOKEN` is set.
- `metrics.js` — Lightweight in-memory counter/gauge store used by `GET /metrics` (Prometheus text format).

**API routes:**
```
POST   /compute/workers/register  — worker self-registration { id, privateIp, maxJobs }
GET    /compute/workers           — list registered workers
POST   /compute/jobs              — dispatch job; returns workerId + workerUrl (or 202 queued / 503 retry)
DELETE /compute/jobs/:jobId       — release job from worker
POST   /compute/jobs/:jobId/caption — forward caption payload to assigned worker (stub)
GET    /compute/health            — worker/job counts
GET    /metrics                   — Prometheus counter text
```

**Env vars:**
| Variable | Purpose | Default |
|---|---|---|
| `HETZNER_API_TOKEN` | Enables burst VM provisioning | none (disables Hetzner) |
| `HETZNER_API_BASE_URL` | Override Hetzner API base (for mocks) | Hetzner default |
| `HETZNER_SNAPSHOT_ID` | Image/snapshot ID for burst VMs | none |
| `HETZNER_SERVER_TYPE_BURST` | Server type for burst VMs | `cx31` |
| `MAX_CONCURRENT_BURST_CREATES` | Max parallel burst VM provisions | `2` |
| `ORCHESTRATOR_MAX_PENDING_JOBS` | Max queued jobs before 503 | `50` |
| `ORCHESTRATOR_BACKOFF_MS` | Base backoff ms for Hetzner retries | `1000` |

**Tests:** `test/hetzner.mock.test.js` — Hetzner client with mock HTTP server.

## Test Coverage

~400 source LOC / ~200 test LOC — Moderate coverage, Low priority.

**Gaps:**
- `autoscaler.js` not covered.
- Full burst-provisioning E2E requires a Hetzner mock server (Top Priority #13 in `docs/TEST_COVERAGE.md`).
