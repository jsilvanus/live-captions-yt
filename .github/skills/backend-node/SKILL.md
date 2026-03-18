---
name: backend-node
summary: |
  Backend (Node.js) skill: Express, CORS, SSE/RTMP/HLS ingestion, JWT/OAuth,
  API design, schema & migrations, performance tuning and DB patterns.
---

## Purpose
Practical guidance and runnable snippets for building, testing and maintaining
Node.js backend services in this monorepo (packages/lcyt-backend, plugins).

## When to use
- Implementing or reviewing Express routes, SSE endpoints, HLS/RTMP integrations.
- Designing session JWTs, admin X-Admin-Key flows, or DSK editor API keys.
- Writing or updating DB migrations (SQLite / Postgres), performance tuning.

## Quick checklist
- API contracts: define request/response shapes, status codes, and idempotency.
- Auth: session JWTs for sessions, user JWTs for accounts, constant-time admin key check.
- CORS: dynamic origin check per-session domain; admin routes never exposed.
- SSE: keep event stream heartbeats, reconnect/backoff; include sequence numbers.
- ffmpeg/RTMP: spawn management, health checks, safe args, and temp-dir isolation.
- Migrations: writable migration files with rollback where possible; test on copy DB.
- Tests: unit for pure logic, integration for routes using in-memory DB.

## Useful commands
- Run package tests:

```bash
npm test -w packages/lcyt-backend
```

- Start dev server:

```bash
PORT=3000 npm run start:backend -w packages/lcyt-backend
```

## Common fixes
- Sequence monotonicity bugs: centralise sequence increment in `store`.
- ffmpeg path issues: probe ffmpeg on startup and mock in tests.
- Cross-platform temp paths: use `os.tmpdir()` or test `tmpdir()` helpers.

## Outputs this skill can produce
- Migration templates, route stubs, SSE helpers, perf tuning notes, test scaffolds.
