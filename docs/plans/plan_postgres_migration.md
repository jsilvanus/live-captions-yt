# PostgreSQL Migration Plan for LCYT

**Status:** Draft  
**Priority:** Medium  
**Complexity:** High  
**Estimated Effort:** 3–4 weeks (full implementation)

---

## Executive Summary

LCYT currently uses **SQLite exclusively** (via `better-sqlite3` in Node.js and stdlib `sqlite3` in Python). While SQLite works well for small-scale deployments and local development, PostgreSQL is essential for:

- **High-concurrency scenarios** (many simultaneous users, rapid caption delivery)
- **Multi-instance deployments** (shared database across multiple backend replicas)
- **Production reliability** (ACID compliance, advanced transaction handling, replication)
- **Advanced features** (JSON columns, full-text search, window functions, etc.)

This plan proposes a **phased migration** with three major deployment modes:
1. **SQLite-only mode** (current; remains supported for local dev and single-instance deployments)
2. **PostgreSQL managed** (cloud-hosted, e.g., AWS RDS, DigitalOcean, Supabase)
3. **PostgreSQL + Docker Compose** (self-hosted, single-VM dev/staging/production)

---

## Current Database Status

### Node.js Backend (`packages/lcyt-backend`)

**ORM:** None — direct SQL via `better-sqlite3`  
**Migration approach:** Inline schema creation + additive column migrations  
**Connection:** Synchronous, single-threaded via `better-sqlite3`

**Schema location:** `packages/lcyt-backend/src/db/schema.js`  
**Initialization:** Called once at startup via `initDb()`

**Tables (48+):**
- Core: `users`, `api_keys`, `organizations`, `org_members`
- Feature policies: `site_feature_policies`, `org_feature_overrides`, `project_features`, `project_members`
- Caption delivery: `caption_targets`, `caption_usage`, `caption_errors`
- RTMP/streaming: `hls_session_metadata`, `preview_active`, `radio_active`
- DSK graphics: (plugin-owned in `lcyt-dsk`)
- Files: (plugin-owned in `lcyt-files`)
- Cues: (plugin-owned in `lcyt-cues`)
- Events & audit: `bus_events`, `audit_log`, `event_log`
- Stats: `session_stats`, `usage_rollups`, `server_settings`
- MCP tokens: `mcp_tokens`
- Translations, device roles, broadcasts, videos, viewer tokens, etc.

**Data access pattern:** Each domain module in `src/db/*.js` (e.g., `src/db/users.js`, `src/db/keys.js`, `src/db/targets.js`) contains thin query helpers. Routes remain thin and delegate to these modules.

### Python Backend (`python-packages/lcyt-backend`)

**ORM:** None — direct SQL via stdlib `sqlite3`  
**Schema:** Mirrors Node.js core tables (`users`, `api_keys`, `organizations`, etc.)  
**Connection:** Synchronous, single-threaded

---

## Database Overview by Layer

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                        │
│  (lcyt-web frontend, lcyt-backend routes, MCP servers, etc) │
└────────────────┬────────────────────────────────────────────┘
                 │
     ┌───────────┴─────────────────────────┐
     │                                     │
     v                                     v
┌─────────────────────────────────┐  ┌──────────────────────────┐
│   Node.js Backend               │  │   Python Backend         │
│  (Express, 48+ table queries)   │  │  (Flask, ~20 queries)    │
│   better-sqlite3 sync layer     │  │  sqlite3 sync layer      │
└────────────┬────────────────────┘  └──────────────┬───────────┘
             │                                      │
             └──────────────┬───────────────────────┘
                            │
                            v
            ┌───────────────────────────────┐
            │  SQLite Database (monolithic) │
            │  ./lcyt-backend.db (file)     │
            │                               │
            │  Tables (48+):                │
            │  - Users & auth               │
            │  - Organizations & teams      │
            │  - Projects & targets         │
            │  - Captions & streaming       │
            │  - Events & audit logs        │
            │  - Usage rollups & stats      │
            └───────────────────────────────┘
```

---

## Migration Phases

### Phase 1: ORM Selection & Database Abstraction (Weeks 1–2)

**Goal:** Introduce a database abstraction layer that can work with both SQLite and PostgreSQL.

#### Option A: Prisma (Recommended)

**Pros:**
- **Type-safe schema** with auto-generated client
- **Built-in migrations** with versioning
- **Database agnostic** (supports SQLite, PostgreSQL, MySQL, etc.)
- **Powerful query building** (filters, transactions, raw queries)
- **Development experience** (schema editor, migrations, introspection)
- **Active community** and mature ecosystem

**Cons:**
- **Learning curve** for team unfamiliar with Prisma
- **Runtime overhead** vs. raw SQL (minor, negligible for our scale)
- **Schema.prisma file** requires maintenance

**Migration Strategy:**
1. Install Prisma: `npm install -D prisma` (dev dependency)
2. Create `packages/lcyt-backend/prisma/schema.prisma` — introspect existing SQLite database
3. Run `npx prisma migrate init` — capture existing schema as migration
4. Create Prisma client generation in build pipeline
5. Gradually migrate route handlers to use Prisma client instead of raw SQL

**Example (before → after):**
```javascript
// Before: Raw better-sqlite3
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

// After: Prisma
const user = await prisma.user.findUnique({ where: { id: userId } });
```

#### Option B: TypeORM

**Pros:**
- Decorator-based schema definition
- Supports both sync and async patterns
- Active maintenance

**Cons:**
- Heavier dependency footprint
- More complex setup for Node.js v18+

#### Option C: Raw SQL with Migration Tool (Sqitch / Flyway)

**Pros:**
- Full control, minimal abstraction
- Lighter footprint than ORM

**Cons:**
- Manual SQL for each database type
- No type safety; more error-prone
- Not recommended for this scope

**Recommendation: Proceed with Prisma for Phase 1.**

### Phase 2: PostgreSQL Compose Stack & Local Development (Weeks 2–3)

**Goal:** Stand up a local PostgreSQL instance for development and testing.

#### Docker Compose Stack (`docker-compose.pg.yml`)

```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    container_name: lcyt-postgres
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_DB: lcyt
      POSTGRES_USER: lcyt_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-change-me-in-production}
      POSTGRES_INITDB_ARGS: "-E UTF8 --lc-collate=en_US.UTF-8 --lc-ctype=en_US.UTF-8"
    volumes:
      - lcyt-postgres-data:/var/lib/postgresql/data
      - ./ops/db-init/postgres-init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lcyt_user -d lcyt"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Optional: pgAdmin for development
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: lcyt-pgadmin
    restart: unless-stopped
    ports:
      - "127.0.0.1:5050:80"
    environment:
      PGADMIN_DEFAULT_EMAIL: ${PGADMIN_EMAIL:-admin@lcyt.local}
      PGADMIN_DEFAULT_PASSWORD: ${PGADMIN_PASSWORD:-admin}
    profiles:
      - admin

  # LCYT backend with PostgreSQL
  lcyt-backend:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      DATABASE_URL: postgresql://lcyt_user:${POSTGRES_PASSWORD:-change-me-in-production}@postgres:5432/lcyt
      NODE_ENV: development
      JWT_SECRET: ${JWT_SECRET:-dev-secret-only}
      ADMIN_KEY: ${ADMIN_KEY:-dev-key-only}
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - .:/app
      - /app/node_modules

volumes:
  lcyt-postgres-data: {}
```

#### Prisma Configuration

**`packages/lcyt-backend/prisma/.env.example`:**
```env
# Local SQLite (development)
DATABASE_URL="file:./lcyt.db"

# Local PostgreSQL (compose)
DATABASE_URL="postgresql://lcyt_user:change-me@localhost:5432/lcyt"

# Production (managed PostgreSQL)
DATABASE_URL="postgresql://user:pass@db.example.com:5432/lcyt"
```

**Connection handling:**
- Node.js backend detects `DATABASE_URL` format at startup
- If `postgresql://`, uses connection pool (via `@prisma/client` with `PrismaClient()`)
- If `file://` or relative path, falls back to SQLite (via `better-sqlite3`)

### Phase 3: Database Connection Pooling & Multi-Instance Readiness (Weeks 3–4)

**Goal:** Ensure the backend can safely run on multiple instances with a shared database.

#### Connection Pooling Strategy

For PostgreSQL, implement connection pooling using one of:

1. **PgBouncer** (Recommended for production)
   - Lightweight, C-based
   - Connection pooling at OS level
   - Transparent to application
   
   ```yaml
   pgbouncer:
     image: edoburu/pgbouncer:latest
     ports:
       - "127.0.0.1:6432:6432"
     environment:
       DATABASE_URL: "postgresql://lcyt_user:password@postgres:5432/lcyt"
       POOL_MODE: "transaction"
       MAX_CLIENT_CONN: 1000
       DEFAULT_POOL_SIZE: 25
   ```

2. **Prisma connection pooling** (built-in, managed)
   ```javascript
   const prisma = new PrismaClient({
     datasources: {
       db: {
         url: process.env.DATABASE_URL + "?schema=public"
       }
     }
   });
   ```

3. **Redis session store** (for distributed sessions)
   - Replace in-memory session store with Redis
   - Enables session sharing across backend instances

#### Deployment Architectures

**Single-instance (Docker Compose):**
```
nginx (reverse proxy on :80)
  ↓
lcyt-backend (container, :3000)
  ↓
PostgreSQL (container, :5432)
```

**Multi-instance (Kubernetes / managed cloud):**
```
Load Balancer (AWS ALB / Nginx)
  ↓
[lcyt-backend pod #1] ──┐
[lcyt-backend pod #2] ──┼─→ PostgreSQL (managed: RDS, CloudSQL, Azure DB)
[lcyt-backend pod #3] ──┘

Horizontal auto-scaling based on:
- CPU usage
- Memory pressure
- Request queue depth
```

---

## Implementation Checklist

### Phase 1: ORM & Abstraction

- [ ] Add Prisma to `packages/lcyt-backend` dependencies
- [ ] Create `prisma/schema.prisma` by introspecting current SQLite DB
- [ ] Add migration generation workflow (`prisma migrate dev`)
- [ ] Update build pipeline to generate Prisma client
- [ ] Create database factory function:
  ```javascript
  export function initializeDb() {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl?.startsWith('postgresql://')) {
      return new PrismaClient();
    } else {
      // Fallback: SQLite with better-sqlite3
      return initSqliteDb(dbUrl);
    }
  }
  ```
- [ ] Migrate `src/db/*.js` modules to use Prisma or SQLite client transparently
- [ ] Update 5–10 critical routes (user, auth, keys) to use new abstraction
- [ ] Run test suite, ensure existing behavior is preserved
- [ ] Document new ORM patterns in `packages/lcyt-backend/CLAUDE.md`

### Phase 2: Compose Stack & Testing

- [ ] Create `docker-compose.pg.yml` with PostgreSQL + PgBouncer
- [ ] Add PostgreSQL init script: `ops/db-init/postgres-init.sql`
- [ ] Update `.env.example` with `DATABASE_URL` examples
- [ ] Add CI test matrix: SQLite tests + PostgreSQL tests
- [ ] Document local dev setup for PostgreSQL mode
- [ ] Test migration workflow: fresh database creation, schema validation
- [ ] Integration test: same test suite runs against both SQLite and PostgreSQL

### Phase 3: Connection Pooling & Multi-Instance

- [ ] Implement PgBouncer sidecar in compose stack
- [ ] Add connection pool health checks to backend startup
- [ ] Replace in-memory session store with Redis (optional, Phase 3+)
- [ ] Load test: spin up 3–5 backend instances + shared PostgreSQL
- [ ] Document Kubernetes manifests for managed PostgreSQL deployment

---

## Configuration & Environment Variables

### Database URL Format

**SQLite:**
```env
DATABASE_URL="file:./lcyt.db"
DATABASE_URL="file:///data/lcyt.db"  # absolute path
```

**PostgreSQL (local):**
```env
DATABASE_URL="postgresql://lcyt_user:password@localhost:5432/lcyt"
```

**PostgreSQL (managed):**
```env
DATABASE_URL="postgresql://user:password@db-instance.example.com:5432/lcyt"
```

### Feature Flags (Temporary, during migration)

```env
# Use Prisma client (defaults to true after Phase 1)
USE_PRISMA_CLIENT=1

# Dual-write mode: write to both SQLite and PostgreSQL for verification
DUAL_WRITE_MODE=0

# Read from PostgreSQL, fall back to SQLite on errors
GRACEFUL_FALLBACK=1
```

---

## Risk Mitigation

### Data Integrity & Backup Strategy

1. **Pre-migration backup:**
   - Export current SQLite database as SQL dump
   - Verify all rows transferred to PostgreSQL
   - Run reconciliation queries to spot mismatches

2. **Migration cutover:**
   - Maintain SQLite as read-only snapshot for 48 hours
   - Dual-write during transition period
   - Gradual traffic shift (10% → 50% → 100%)

3. **Rollback plan:**
   - Keep SQLite read-only until 7 days post-cutover
   - Document manual recovery steps
   - Test rollback in staging first

### Testing Strategy

```bash
# Run all tests against both databases
npm test  # SQLite (current default)
npm test -- --pg  # PostgreSQL variant

# Load test with concurrent caption sends
npm run test:load -- --db sqlite
npm run test:load -- --db postgres

# Schema validation
npm run test:schema-compat
```

---

## Managed PostgreSQL Options

### Cloud Providers

| Provider | Service | Notes |
|---|---|---|
| **AWS** | RDS (PostgreSQL) | Industry standard, multi-AZ, automated backups, read replicas |
| **DigitalOcean** | Managed Databases | Simple pricing, good for small teams, built-in backups |
| **Supabase** | PostgreSQL (managed) | PostgreSQL + REST API + Auth layer; includes free tier |
| **Azure** | Azure Database for PostgreSQL | Enterprise, advanced disaster recovery, Microsoft ecosystem |
| **Heroku** | Postgres add-on | Simplest option for Heroku deployments; Eco plan available |
| **PlanetScale** | MySQL (not Postgres) | — N/A for this plan — |

**Recommendation for self-hosters:** DigitalOcean Managed DB (simplicity + cost) or roll your own with PostgreSQL + WAL archival.

---

## Phased Rollout Timeline

| Phase | Duration | Key Milestones |
|---|---|---|
| **Phase 1** | Week 1–2 | Prisma integration, basic tests passing |
| **Phase 2** | Week 2–3 | Compose stack stable, CI matrix running |
| **Phase 3** | Week 3–4 | Load testing, multi-instance docs, deployment runbook |
| **Pilot** | Week 5 | Early adopter canary (small customer base) |
| **Rollout** | Week 6–8 | Staged production cutover, monitoring |
| **Stabilization** | Week 9–10 | Post-launch issues, SQLite deprecation notice |

---

## Success Criteria

- ✅ All 48+ tables correctly migrated to PostgreSQL
- ✅ Zero data loss during migration
- ✅ Test suite passes for both SQLite and PostgreSQL
- ✅ Same performance (captions delivered in <100ms) on both databases
- ✅ Backend scales to 5+ concurrent instances with shared database
- ✅ Multi-user, multi-project workloads stable
- ✅ Backup/restore procedure documented and tested
- ✅ Rollback plan executed successfully in staging

---

## Dependencies & Tooling

### New npm packages

```json
{
  "devDependencies": {
    "prisma": "^5.0.0"
  },
  "dependencies": {
    "@prisma/client": "^5.0.0"
  }
}
```

### New system dependencies

```dockerfile
# In Node.js base image
RUN apt-get update && apt-get install -y \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*
```

### Docker Compose new services

- PostgreSQL 16 (alpine)
- PgBouncer (optional, production)
- pgAdmin 4 (optional, dev/staging)

---

## Documentation Updates

| Document | Change |
|---|---|
| `CLAUDE.md` (root) | Add database architecture diagram, PostgreSQL option note |
| `packages/lcyt-backend/CLAUDE.md` | Update schema reference, add `DATABASE_URL` examples |
| `.env.example` | Add `DATABASE_URL` examples (SQLite + PostgreSQL) |
| `ops/runbooks/` | Add PostgreSQL deployment, backup/restore, monitoring runbooks |
| `docs/plans/` | Link this plan; add `plan_postgres_deployment.md`, `plan_postgres_backup.md` |

---

## Open Questions / Decisions Needed

1. **ORM choice:** Stick with Prisma, or explore alternatives (TypeORM, Drizzle)?
2. **Managed vs. self-hosted:** Primary production deployment model?
3. **Multi-region:** Do we need cross-region replication (Phase 4+)?
4. **Search:** Do we need full-text search capabilities (PostgreSQL advantage)?
5. **Observability:** Add query logging/APM integration (pg_stat_statements)?
6. **Compliance:** GDPR implications for data retention with PostgreSQL (same as SQLite, but worth audit)?

---

## Appendix: Quick Reference

### Schema Introspection

```bash
cd packages/lcyt-backend
npx prisma init
npx prisma db pull  # Introspect existing SQLite DB
```

### Running Locally with PostgreSQL

```bash
# Start compose stack
docker compose -f docker-compose.pg.yml up -d

# Run migrations
npx prisma migrate deploy

# Start backend
npm run start:backend

# Access backend
curl http://localhost:3000/health
```

### Running Tests

```bash
# SQLite (fast, good for CI)
npm test -w packages/lcyt-backend

# PostgreSQL (with local compose stack running)
DATABASE_URL="postgresql://lcyt_user:password@localhost:5432/lcyt" npm test -w packages/lcyt-backend
```

---

## See Also

- [docs/PLANS.md](../PLANS.md) — Plan index
- [packages/lcyt-backend/CLAUDE.md](../../packages/lcyt-backend/CLAUDE.md) — Backend architecture
- [.env.example](../../.env.example) — Environment variables
- [docker-compose.yml](../../docker-compose.yml) — Current compose stack (SQLite)

