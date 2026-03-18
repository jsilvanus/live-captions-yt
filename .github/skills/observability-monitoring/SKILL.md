---
name: observability-monitoring
summary: |
  Observability & Monitoring skill: logging, Prometheus metrics, OpenTelemetry
  tracing, dashboards and alerting.
---

## Purpose
Runbook for adding metrics, traces and logs to backend and worker processes.

## When to use
- Instrumenting latency-sensitive code, background workers, or ffmpeg jobs.

## Checklist
- Structured logs with levels and request IDs.
- Expose Prometheus metrics endpoint for critical subsystems.
- Add OpenTelemetry traces around important flows (caption send, ffmpeg spawn).
- Configure Sentry for uncaught exceptions.

## Commands
- Example: run Prometheus locally and point to service metrics endpoint.

## Outputs
- Metrics definitions, tracing spans, dashboard suggestions, alert rules.
