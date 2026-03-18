---
name: containers-orchestration
summary: |
  Containers & Orchestration skill: Dockerfile best practices, docker-compose,
  Helm charts, and local dev stacks for the monorepo.
---

## Purpose
Guidance for containerizing services and running local orchestration stacks.

## When to use
- Creating Docker images, composing services for local dev, or preparing Helm charts.

## Checklist
- Keep images small (node:20-slim base), use multi-stage builds for artifacts.
- Compose for local dev; ensure volumes for DBs and logs.
- Helm: parameterize secrets and use readiness/liveness probes.

## Commands
- Build image:

```bash
docker build -t lcyt-backend -f packages/lcyt-backend/Dockerfile .
```

## Outputs
- Dockerfile templates, docker-compose examples, Helm chart notes.
