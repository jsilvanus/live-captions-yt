# lcyt-orchestrator — Compute Orchestrator

Stateless Express HTTP service that manages a pool of worker VMs and dispatches compute jobs (e.g., ffmpeg transcoding). Supports on-demand burst provisioning via the Hetzner Cloud API and optional Prometheus metrics exposition.

**Version:** 0.0.1 (private)  
**License:** MIT  
**Author:** Juha Itäleino <jsilvanus@gmail.com>

## Overview

The orchestrator is designed to:
- Register and track worker VMs
- Dispatch compute jobs to available workers
- Queue jobs when capacity is exhausted
- Provision new VMs on burst via Hetzner Cloud API
- Auto-scale down when demand decreases
- Expose Prometheus metrics for monitoring

## Installation & Setup

```bash
npm install -w packages/lcyt-orchestrator
```

### Quick Start

```bash
cd packages/lcyt-orchestrator
node src/index.js
```

**Port:** Default `3000` (override with `PORT` env var)

## Architecture

**Main components:**

| File | Purpose |
|------|---------|
| `src/index.js` | Express app; worker registry; job dispatch; burst queue |
| `src/hetzner.js` | REST client for Hetzner Cloud API; server provisioning; polling |
| `src/autoscaler.js` | Periodic tick; provisions burst VMs based on queue pressure |
| `src/metrics.js` | In-memory counters; Prometheus text format endpoint |

**Flow:**

```
Worker registers → Orchestrator.workers map
Job dispatched → Find available worker OR queue
Queue pressure → Autoscaler provisions Hetzner VM
VM ready → Moves from queue to assignment
Job completes → Worker reports; job released
```

## API Routes

```
POST   /compute/workers/register
       Register a worker VM
       Body: { id, privateIp, maxJobs }
       Response: 200 { ok: true }

GET    /compute/workers
       List all registered workers
       Response: [{ id, privateIp, maxJobs, activeJobs }]

POST   /compute/jobs
       Dispatch a new job
       Body: { jobType, payload }
       Response: 202 { workerId, workerUrl } OR 202 { queued: true } OR 503 { retry: true }

DELETE /compute/jobs/:jobId
       Release/cancel a job
       Response: 200

POST   /compute/jobs/:jobId/caption
       Forward caption payload to assigned worker (stub)
       Body: { text, ... }
       Response: 202

GET    /compute/health
       Worker and job statistics
       Response: { workers, activeJobs, queuedJobs }

GET    /metrics
       Prometheus text-format metrics
       Response: text/plain
```

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 4000 | HTTP server port |
| `HETZNER_API_TOKEN` | — | Enable Hetzner burst provisioning |
| `HETZNER_API_BASE_URL` | (Hetzner default) | API base URL (override for mocks) |
| `HETZNER_SNAPSHOT_ID` | — | Image/snapshot ID for burst VMs |
| `HETZNER_SERVER_TYPE_BURST` | `cx31` | VM size for burst instances |
| `MAX_CONCURRENT_BURST_CREATES` | 2 | Max parallel VM creations |
| `ORCHESTRATOR_MAX_PENDING_JOBS` | 50 | Max queued jobs before 503 |
| `ORCHESTRATOR_BACKOFF_MS` | 1000 | Base backoff for retries |

### Hetzner Setup

To enable burst provisioning:

1. Create a Hetzner Cloud account
2. Generate an API token
3. Create a VM snapshot of your worker environment
4. Set `HETZNER_API_TOKEN`, `HETZNER_SNAPSHOT_ID`, and `HETZNER_SERVER_TYPE_BURST`

**VM snapshot should include:**
- Node.js runtime
- ffmpeg (if transcoding)
- lcyt-worker-daemon service
- Environment file with orchestrator URL

## Scaling Strategy

**Warm pool:** Keep 0-N idle workers running continuously  
**Burst provisioning:** When queue depth exceeds threshold, provision new VMs  
**Scale-down:** Remove burst VMs after idle period

**Configuration:**

```bash
# Allow up to 2 concurrent VM creations
MAX_CONCURRENT_BURST_CREATES=2

# Trigger burst when pending > 50
ORCHESTRATOR_MAX_PENDING_JOBS=50

# Use small VMs for burst (cost-efficient)
HETZNER_SERVER_TYPE_BURST=cx31
```

## Monitoring

View real-time metrics:

```bash
curl http://localhost:4000/metrics
```

Sample Prometheus output:

```
# HELP worker_count Active registered workers
# TYPE worker_count gauge
worker_count 3

# HELP job_queue_length Pending jobs
# TYPE job_queue_length gauge
job_queue_length 0

# HELP burst_vm_count Active burst VMs
# TYPE burst_vm_count gauge
burst_vm_count 1
```

## Integration with LCYT Backend

The backend can dispatch jobs to the orchestrator:

```javascript
const orchestratorUrl = 'http://localhost:4000';

// Register orchestrator with backend
const response = await fetch(`${orchestratorUrl}/compute/jobs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jobType: 'transcode',
    payload: { streamKey, bitrate, format }
  })
});

const { workerId, workerUrl } = await response.json();
// Forward additional payloads to worker at workerUrl
```

## Docker Deployment

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY packages/lcyt-orchestrator .
RUN npm install --production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "src/index.js"]
```

## Testing

```bash
npm test -w packages/lcyt-orchestrator
```

Tests include:
- Worker registration and listing
- Job dispatch and queueing
- Hetzner client (with mock HTTP server)
- Prometheus metrics formatting

## Troubleshooting

**Workers not registering:**
- Check worker can reach orchestrator URL
- Verify network/firewall allows connections

**Jobs stuck in queue:**
- Check `HETZNER_API_TOKEN` is valid (if burst enabled)
- Monitor `/compute/health` for queue depth
- Check logs for Hetzner API errors

**Burst VMs not provisioning:**
- Verify `HETZNER_SNAPSHOT_ID` exists
- Check Hetzner account has sufficient quota
- Monitor `ORCHESTRATOR_MAX_PENDING_JOBS` threshold

**See also:**
- [Worker daemon documentation](../lcyt-worker-daemon/README.md)
- [Deployment guide](../../docs/DEPLOY.md)
- [Hetzner setup guide](../../docs/hetzner_snapshot.md)
- [Plan: Orchestration & Scaling](../../docs/plans/plan_cloudfleet.md)
