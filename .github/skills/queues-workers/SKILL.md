---
name: queues-workers
summary: |
  Queues & Workers skill: Redis-backed job queues (Bull/bee), idempotency,
  retries/backoff, and worker orchestration.
---

## Purpose
Design patterns for background jobs: caption delivery retries, ffmpeg restarts,
and long-running uploads.

## When to use
- Offloading retries, batching caption sends, or running slow tasks.

## Checklist
- Ensure jobs are idempotent and track requestId/sequence.
- Configure sensible backoff and dead-letter queues.
- Monitor job queue length and worker health.

## Commands
- Example: run worker locally with `NODE_ENV=development node worker.js`.

## Outputs
- Queue job schemas, retry strategies, and monitoring hooks.
