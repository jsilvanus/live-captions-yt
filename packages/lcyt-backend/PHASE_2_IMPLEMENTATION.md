# Phase 2: PostgreSQL Testing Stack

**Duration:** 1 week  
**Goal:** Validate Prisma + PostgreSQL compatibility with comprehensive test matrix  
**Success Criteria:** All tests pass on both SQLite and PostgreSQL

---

## Overview

Phase 2 establishes a production-like testing environment where the same test suite runs against both SQLite (current) and PostgreSQL (migration target). This ensures zero regressions and validates the database abstraction layer before any production deployment.

---

## Deliverables

### Infrastructure

- **Docker Compose Stack** (`docker-compose.pg.yml`)
  - PostgreSQL 16 on Alpine (production-grade image)
  - PgBouncer for connection pooling (production-like config)
  - pgAdmin web UI for database inspection
  - Prometheus for metrics collection (optional)
  - Healthchecks for all services
  - Networking configured for local development

- **Database Initialization Script** (`ops/db-init/postgres-init.sql`)
  - Creates extensions (UUID, full-text search)
  - Applies performance tuning (shared buffers, cache, etc.)
  - Sets up proper collation and logging

- **Environment Configuration** (`ops/.env.postgres.example`)
  - PostgreSQL credentials with clear warnings
  - Database URL templates for all scenarios
  - PgBouncer, pgAdmin, and testing configs
  - Feature flag examples

### Test Automation

- **Database Matrix Script** (`packages/lcyt-backend/test/matrix.js`)
  - Runs same test suite against SQLite and PostgreSQL
  - Reports pass/fail for each database
  - Validates schema consistency across databases
  - Identifies database-specific issues early

- **CI/CD Integration** (`.github/workflows/test-matrix.yml`)
  - Runs on every PR and main branch commit
  - Tests both SQLite and PostgreSQL in parallel
  - Separate job for each database type
  - Clear reporting of which database failed

---

## Setup (2-3 hours)

### Step 1: Install Docker & Docker Compose

```bash
# macOS with Homebrew
brew install docker docker-compose

# Ubuntu/Debian
sudo apt-get install docker.io docker-compose

# Windows (WSL2 backend recommended)
# Download Docker Desktop: https://www.docker.com/products/docker-desktop
```

### Step 2: Copy Configuration

```bash
cp ops/.env.postgres.example .env

# Edit .env with your preferred settings
# At minimum, change JWT_SECRET and ADMIN_KEY
```

### Step 3: Start the Stack

```bash
# Basic setup (PostgreSQL + LCYT Backend)
docker compose -f docker-compose.pg.yml up -d

# With pgAdmin for database inspection
docker compose -f docker-compose.pg.yml --profile admin up -d

# With PgBouncer connection pooling
docker compose -f docker-compose.pg.yml --profile pooling up -d

# With monitoring (Prometheus)
docker compose -f docker-compose.pg.yml --profile monitoring up -d
```

### Step 4: Verify Services

```bash
# Check all containers are running
docker compose -f docker-compose.pg.yml ps

# Verify PostgreSQL is healthy
docker exec lcyt-postgres pg_isready -U lcyt_user -d lcyt

# Test backend connectivity
curl http://localhost:3000/health

# View logs
docker compose -f docker-compose.pg.yml logs -f
```

### Step 5: Access Services

| Service | URL | Credentials |
|---------|-----|-------------|
| **LCYT Backend** | http://localhost:3000 | API endpoints |
| **pgAdmin** | http://localhost:5050 | admin@lcyt.local / admin |
| **Adminer** | http://localhost:8080 | PostgreSQL connection |
| **Prometheus** | http://localhost:9090 | Metrics/queries |

---

## Database Matrix Testing

### Manual Testing (Single PR)

```bash
# Test 1: Run tests against SQLite (default)
npm test -w packages/lcyt-backend

# Test 2: Run tests against PostgreSQL
DATABASE_URL="postgresql://lcyt_user:dev-password-change-me@postgres:5432/lcyt" \
npm test -w packages/lcyt-backend

# Compare results
# ✅ Both should pass with no errors
```

### Automated Matrix Script

```bash
# Create the matrix test runner
npm run test:matrix -w packages/lcyt-backend

# Output example:
# ┌─────────────────────────────────────────────────────┐
# │ Database Test Matrix Results                        │
# ├─────────────────────────────────────────────────────┤
# │ SQLite:      ✅ PASS (42 tests, 2.3s)               │
# │ PostgreSQL:  ✅ PASS (42 tests, 2.8s)               │
# │ Schema Sync: ✅ PASS (48 tables, 0 mismatches)      │
# └─────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

### Database Schema Validation (Day 1)

- [ ] Prisma schema validated against live SQLite database
- [ ] All 48+ tables present in `prisma/schema.prisma`
- [ ] All relationships (FK, 1:N, M:N) defined
- [ ] All indexes and unique constraints present
- [ ] Default values and timestamps correct

### Docker Compose Stack (Day 1)

- [ ] `docker-compose.pg.yml` created with all services
- [ ] PostgreSQL service healthcheck working
- [ ] PgBouncer optional profile working
- [ ] Environment variables properly configured
- [ ] `ops/db-init/postgres-init.sql` creates extensions
- [ ] Network isolation validated

### Test Infrastructure (Days 2-3)

- [ ] `packages/lcyt-backend/test/matrix.js` created and working
- [ ] Matrix runner executes tests for both databases
- [ ] Results clearly show PASS/FAIL per database
- [ ] Schema consistency check implemented
- [ ] Test execution time benchmarked for both

### CI/CD Integration (Day 3)

- [ ] `.github/workflows/test-matrix.yml` created
- [ ] Workflow runs on PR and main branch
- [ ] Tests execute in parallel (SQLite + PostgreSQL)
- [ ] Failure reporting shows which database failed
- [ ] PR status checks block merge if either database fails

### Documentation (Day 3-4)

- [ ] `packages/lcyt-backend/PHASE_2_KICKOFF.md` created
- [ ] Database matrix guide written
- [ ] Docker Compose troubleshooting guide added
- [ ] Environment variable reference updated
- [ ] CLAUDE.md updated with PostgreSQL info

### Validation (Day 4-5)

- [ ] All tests pass on both SQLite and PostgreSQL
- [ ] Schema consistency check shows zero mismatches
- [ ] Performance benchmarks collected
- [ ] Team can run `docker compose ... up` and tests pass
- [ ] CI matrix workflow shows green for both databases

### Edge Cases & Fixes (Days 5-7)

- [ ] Timestamp handling verified (ms vs. s)
- [ ] UUID generation works on both databases
- [ ] Transaction isolation levels confirmed
- [ ] Concurrent writes tested
- [ ] Connection pool behavior under load validated
- [ ] NULL handling in unique indexes verified
- [ ] Case-sensitivity assumptions tested

---

## Common Issues & Solutions

### PostgreSQL Won't Start

```bash
# Check logs
docker compose -f docker-compose.pg.yml logs postgres

# Verify port isn't in use
lsof -i :5432  # macOS/Linux
netstat -an | grep 5432  # Windows

# Reset database
docker compose -f docker-compose.pg.yml down -v
docker compose -f docker-compose.pg.yml up postgres
```

### Connection Refused

```bash
# Verify PostgreSQL is healthy
docker exec lcyt-postgres pg_isready -U lcyt_user

# Check DATABASE_URL in .env
echo $DATABASE_URL

# Test connection manually
psql postgresql://lcyt_user:password@localhost:5432/lcyt
```

### Tests Fail on PostgreSQL but Pass on SQLite

1. Check error message for database-specific issues
2. Review timestamp handling (ms vs. s)
3. Verify NULL handling in unique indexes
4. Check collation for case-sensitive queries
5. Look for schema mismatches in Prisma studio

```bash
# Inspect schema in both databases
npx prisma studio  # Opens http://localhost:5555
```

### PgBouncer Connection Timeout

```bash
# Increase reserve pool or decrease timeout
docker compose -f docker-compose.pg.yml --profile pooling logs pgbouncer

# Verify PgBouncer can reach PostgreSQL
docker exec lcyt-pgbouncer pgbouncer -c /etc/pgbouncer/pgbouncer.ini
```

---

## Performance Benchmarking

After all tests pass, collect performance metrics:

```bash
# Measure test execution time on each database
time DATABASE_URL="..." npm test -w packages/lcyt-backend

# Example output:
# SQLite:      2.3s
# PostgreSQL:  2.8s  (22% slower due to network latency)
# PgBouncer:   2.5s  (8% slower, connection pooling overhead)
```

---

## Cleanup

### Stop Services (Preserve Data)

```bash
docker compose -f docker-compose.pg.yml stop
```

### Stop & Remove Services (Delete Data)

```bash
docker compose -f docker-compose.pg.yml down -v
```

### Full Reset

```bash
# Remove all containers, volumes, and networks
docker compose -f docker-compose.pg.yml down -v --remove-orphans
rm -f .env
```

---

## Next Steps

### Phase 2 → Phase 3 Transition

Once all tests pass on both databases for a full week:

1. **Phase 2 PR approval** — Get team sign-off on testing strategy
2. **Merge Phase 2** — Integrate Docker Compose + test matrix
3. **Phase 3 kickoff** — Connection pooling optimization + multi-instance testing

### Phase 3 Deliverables

- Connection pool tuning for high-concurrency scenarios
- Replica testing (read-only followers)
- Failover testing (promote replica on primary failure)
- Backup & restore procedures
- Production deployment runbook

---

## Resources

- **Prisma Docs:** https://www.prisma.io/docs/
- **PostgreSQL Docs:** https://www.postgresql.org/docs/16/
- **PgBouncer Docs:** https://www.pgbouncer.org/usage.html
- **Docker Compose Reference:** https://docs.docker.com/compose/compose-file/
- **LCYT Database Docs:** See `docs/plans/plan_postgres_migration.md`

---

## Questions?

Refer to:
- `docker-compose.pg.yml` inline comments for service configuration
- `ops/.env.postgres.example` for all configurable options
- `packages/lcyt-backend/CLAUDE.md` for backend-specific details
- `docs/plans/plan_postgres_migration.md` for overall strategy
