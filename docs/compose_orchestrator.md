# Running the orchestrator + worker (Phase 4 local dev)

This doc shows a minimal way to bring up the orchestrator, a backend placeholder, and a worker daemon locally using the provided docker-compose.orchestrator.yml.

Quick steps

1. Start the compose stack:

```bash
docker compose -f docker-compose.orchestrator.yml up --build
```

2. Register a worker (example):

```bash
curl -X POST http://localhost:4000/compute/workers/register \
  -H 'Content-Type: application/json' \
  -d '{"id":"worker-local-1","privateIp":"127.0.0.1","maxJobs":2}'
```

3. Create a job and have it assigned to a ready worker:

```bash
curl -X POST http://localhost:4000/compute/jobs \
  -H 'Content-Type: application/json' \
  -d '{"id":"job-1","type":"ffmpeg","apiKey":"demo"}'
```

Expected response when assigned:

```json
{ "workerId": "worker-local-1", "workerUrl": "http://127.0.0.1:3000" }
```

If no worker is available you will receive a 503 with retryAfterMs (5000ms):

```json
{ "retryAfterMs": 5000 }
```

Short test suggestion

- Start the compose stack, register one worker with `maxJobs: 1`, then POST two jobs. The first should be assigned; the second should return 503. Then DELETE the first job and retry the second POST — it should be assigned.

Troubleshooting

- The orchestrator is intentionally minimal and avoids external calls. The workerUrl returned is derived from the registered `privateIp` and port `3000`. In local dev you can run a simple HTTP server on port 3000 to simulate a worker endpoint if you want to test end-to-end caption POST flows.
