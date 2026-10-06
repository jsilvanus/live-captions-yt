# LCYT Database Architecture

## Current State (as of 2026-10-06)

### Overview

LCYT uses **SQLite exclusively** across all deployment modes:

| Component | Database | Library | Connection | Migrations |
|---|---|---|---|---|
| **Node.js Backend** (`packages/lcyt-backend`) | SQLite 3 | `better-sqlite3` (native) | Sync, single-threaded | Inline schema + additive columns |
| **Python Backend** (`python-packages/lcyt-backend`) | SQLite 3 | stdlib `sqlite3` | Sync, single-threaded | Same as Node (feature parity) |
| **Local Development** | SQLite 3 (file) | `better-sqlite3` | File-based | Auto-init at startup |
| **Docker Deployment** | SQLite 3 (volume) | `better-sqlite3` | File-based | Auto-init at container start |

### Storage

- **Node.js Backend:** Default path `./lcyt-backend.db` (configurable via `DB_PATH` env var)
- **Docker volume:** `lcyt-db` volume mounted at `/data/lcyt.sqlite`
- **File size:** Typically 10–500 MB depending on usage/retention policies
- **Backup:** Manual exports or volume-level snapshots

### Schema

**48+ tables** covering:
- **Users & Auth:** `users`, `api_keys`, `organizations`, `org_members`
- **Projects & Access:** `api_keys` (projects), `project_features`, `project_members`, `caption_targets`
- **Caption Flow:** `caption_usage`, `caption_errors`, `caption_targets`
- **Streaming:** `hls_session_metadata`, `preview_active`, `radio_active` (lcyt-rtmp plugin)
- **Graphics:** DSK plugin tables (lcyt-dsk)
- **File Storage:** File metadata tables (lcyt-files plugin)
- **Cues:** Cue matching tables (lcyt-cues plugin)
- **Events & Audit:** `bus_events`, `audit_log`, `event_log`, `mcp_tokens`
- **Metrics:** `session_stats`, `usage_rollups`, `usage_* (per-project)`, `server_settings`
- **Devices & Control:** Device role tables (lcyt-production plugin)

Full schema: [packages/lcyt-backend/src/db/schema.js](packages/lcyt-backend/src/db/schema.js)

### ORM / Query Layer

**No ORM currently used.** Data access follows a pattern:

```
Route handlers (src/routes/*.js)
    ↓
Domain data modules (src/db/*.js)
    ↓
better-sqlite3 / stdlib sqlite3
    ↓
SQLite database
```

Example: [packages/lcyt-backend/src/db/users.js](packages/lcyt-backend/src/db/users.js)

### Constraints & Limitations

| Limitation | Impact | Workaround |
|---|---|---|
| **Single-writer only** | Cannot run 2+ backend instances with same DB file | Docker: ok; Kubernetes/multi-host: not viable |
| **No connection pooling** | Each query uses a single connection; no concurrent queries | Not an issue for caption delivery rates, but limits scaling |
| **Limited ACID** | Transactions work, but no multi-version concurrency control (MVCC) | Fine for current usage; issues appear at 100+ concurrent users |
| **No replication** | No built-in HA or geographic distribution | Use external backup tools |
| **Synchronous I/O only** | Backend blocks during DB ops (negligible latency) | — |

**Current viability:** ✅ Good for single-instance deployments, small teams, local dev. ❌ Not suitable for multi-region, high-concurrency, or HA requirements.

---

## Why Migrate to PostgreSQL?

| Driver | Benefit | Timeline |
|---|---|---|
| **Multi-instance deployments** | Run backend on Kubernetes, ECS, Docker Swarm; all point to shared DB | Now (if scaling) |
| **High concurrency** | MVCC handles 100+ simultaneous users/sessions without contention | Medium term |
| **Connection pooling** | PgBouncer or managed pooling services (AWS RDS Proxy) | Now (if scaling) |
| **Replication & HA** | Synchronous/async replicas, failover, geographic distribution | Now (production) |
| **Advanced features** | JSONB columns, full-text search, window functions, array types | Later (if needed) |
| **Observability** | `pg_stat_statements`, detailed query logging, performance insights | Now (if monitoring) |
| **Industry standard** | Easier to hire ops engineers, more DevOps tooling maturity | Ongoing |

---

## Proposed Migration Path

See [docs/plans/plan_postgres_migration.md](docs/plans/plan_postgres_migration.md) for the full detailed plan.

### 30-second summary

1. **Phase 1 (2 weeks):** Introduce **Prisma ORM** as an abstraction layer
   - Prisma works with both SQLite and PostgreSQL
   - Gradual migration of route handlers to Prisma client

2. **Phase 2 (1 week):** Stand up **PostgreSQL in Docker Compose** for local dev
   - CI matrix: run same tests against both SQLite and PostgreSQL
   - Migration tool (Prisma) handles schema sync

3. **Phase 3 (1 week):** Connection pooling, multi-instance testing
   - PgBouncer for connection pooling
   - Horizontal scaling tests (3–5 backend instances)
   - Deployment documentation for managed PostgreSQL (AWS RDS, DigitalOcean, etc.)

### Timeline

- **Weeks 1–2:** ORM integration (Prisma)
- **Weeks 2–3:** Compose stack + testing
- **Weeks 3–4:** Pooling + production readiness
- **Week 5:** Pilot canary deployment
- **Weeks 6–8:** Staged production rollout

---

## Migration Decision Tree

```
Does LCYT need to scale beyond single-instance?
  ├─ NO → Stay on SQLite; no migration needed
  │
  └─ YES
      ├─ Is this a managed/cloud deployment?
      │   ├─ YES (AWS, DigitalOcean, etc.)
      │   │   └─ Use managed PostgreSQL (RDS, Digital Ocean DB, etc.)
      │   │       → Phase 1 + Phase 2 (skip self-hosted infra)
      │   │
      │   └─ NO (self-hosted, single-VM, on-prem)
      │       └─ Use PostgreSQL + Docker Compose
      │           → Full phases 1–3
      │
      └─ Timeline urgent?
          ├─ YES → Start Phase 1 immediately
          └─ NO → Plan for Q1 2027 after current features ship
```

---

## ORM Recommendation: Prisma

### Why Prisma?

| Aspect | Prisma | TypeORM | Raw SQL + Sqitch |
|---|---|---|---|
| **Type safety** | ✅ Full (generated client) | ✅ Decorators | ❌ Manual |
| **DB agnostic** | ✅ (SQLite, PG, MySQL, etc.) | ✅ | ❌ (DB-specific SQL) |
| **Migrations** | ✅ Built-in versioning | ✅ | ✅ Manual but explicit |
| **Learning curve** | 🟡 Moderate | 🔴 Steep | 🟢 Easy |
| **Dependency weight** | 🟢 Light | 🔴 Heavy | 🟢 Light |
| **Async/await** | ✅ Full async | ✅ | ✅ (with wrapper) |
| **Community** | ✅ Very active | ✅ Active | 🟡 Niche |

**Conclusion:** Prisma strikes the best balance of type safety, database agnosticism, and developer experience for LCYT's needs.

---

## Managed PostgreSQL Recommendations

| Provider | Best for | Pricing | Managed backups | Replicas |
|---|---|---|---|---|
| **AWS RDS** | Enterprise, multi-region | $$–$$$ | ✅ Yes | ✅ Auto failover |
| **DigitalOcean Managed DB** | Small teams, simplicity | $$ | ✅ Yes | ✅ Yes |
| **Supabase** | Fast prototyping, built-in REST | $ (free tier) | ✅ Yes | ✅ Paid |
| **Heroku Postgres** | Simple deployments | $$$ | ✅ Yes | ✅ Paid |
| **Azure Database for PostgreSQL** | Microsoft ecosystem | $$–$$$ | ✅ Yes | ✅ Auto-failover |
| **Self-hosted (DigitalOcean App Platform + PgBackRest)** | Full control | $$ | ✅ Custom | ✅ Manual |

**Recommendation for new deployments:** DigitalOcean Managed Database (simplicity) or AWS RDS (scale).

---

## Key Files & Modules

### Database Initialization

- **Node.js:** [packages/lcyt-backend/src/db/schema.js](packages/lcyt-backend/src/db/schema.js)
- **Python:** `python-packages/lcyt-backend/lcyt_backend/db.py`

### Data Access Modules

| Domain | Node.js | Purpose |
|---|---|---|
| Users & Auth | `src/db/users.js` | User creation, password verification, lookup |
| Organizations | `src/db/orgs.js` | Org CRUD, member management |
| API Keys & Projects | `src/db/keys.js` | Key creation, limits, project association |
| Caption Targets | `src/db/caption-targets.js` | Target CRUD (YouTube, viewer, generic) |
| Usage & Rollups | `src/db/usage-rollups.js` | Caption counts, billing metrics |
| Audit & Events | `src/db/audit-log.js`, `src/db/bus-events.js` | Audit trail, event streaming |
| Session Lifecycle | `src/db/sessions.js` | Session CRUD (related to in-memory store) |

### Configuration

- **Database path:** `DB_PATH` env var; default `./lcyt-backend.db`
- **Connection pool:** Single connection via `better-sqlite3` (no pooling currently)
- **Backups:** Manual; no built-in rotation

---

## Next Steps

1. **Review this document** with the team
2. **Decide:** SQLite-only vs. PostgreSQL migration?
3. **If migrating:**
   - Assign ownership for Phase 1 (Prisma integration)
   - Reserve 3–4 weeks for full migration cycle
   - Plan pilot canary deployment (small customer subset)
4. **If staying on SQLite:**
   - Document scale limits and HA workarounds
   - Consider SQLite-to-PostgreSQL migration trigger (if users request HA)

---

## See Also

- [docs/plans/plan_postgres_migration.md](docs/plans/plan_postgres_migration.md) — Full migration plan
- [.env.example](.env.example) — Configuration reference
- [packages/lcyt-backend/CLAUDE.md](packages/lcyt-backend/CLAUDE.md) — Backend architecture
- [packages/lcyt-backend/src/db/schema.js](packages/lcyt-backend/src/db/schema.js) — Full schema definition
