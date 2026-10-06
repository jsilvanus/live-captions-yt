# Phase 2 Kickoff: PostgreSQL Testing Stack

**Timeline:** Week 2 (5 business days)  
**Status:** 🔵 Queued (waiting for Phase 1 merge)  
**Deliverables:** Docker Compose stack + test matrix + CI integration  
**Success:** All tests pass on both SQLite and PostgreSQL

---

## Executive Summary

Phase 2 builds on Phase 1's Prisma foundation by validating multi-database compatibility **in real infrastructure**. We deploy PostgreSQL via Docker Compose (same as production), run the test suite against both databases, and integrate automated matrix testing into CI/CD.

**Key outcome:** By end of Phase 2, any pull request automatically proves that changes work on both SQLite (current) and PostgreSQL (migration target).

---

## Phase 1 → Phase 2 Handoff

### Phase 1 Outputs (Required for Phase 2)

- ✅ `packages/lcyt-backend/prisma/schema.prisma` — Complete Prisma schema (all 48+ tables)
- ✅ `packages/lcyt-backend/src/db-factory.js` — DbClient abstraction layer
- ✅ `packages/lcyt-backend/src/db-compat.js` — Gradual migration wrapper
- ✅ Prisma client generated and working
- ✅ All existing tests pass on SQLite

### Phase 2 Inputs → Outputs

| Input | Output | Responsible |
|-------|--------|-------------|
| Prisma schema | PostgreSQL Docker container | Infrastructure |
| DbClient (Phase 1) | Test matrix script | Testing |
| Working tests | CI matrix workflow | DevOps |
| - | Phase 2 documentation | Docs |

---

## What Gets Built

### 1. Docker Compose Stack (`docker-compose.pg.yml`)

A complete, batteries-included PostgreSQL development environment:

```
┌─────────────────────────────────────────┐
│ docker-compose.pg.yml                   │
├─────────────────────────────────────────┤
│ • PostgreSQL 16 on Alpine               │  Production-ready database
│ • PgBouncer (optional)                  │  Connection pooling
│ • pgAdmin (optional)                    │  Web UI for inspection
│ • LCYT Backend container                │  Ready to run tests
│ • Prometheus (optional)                 │  Metrics collection
│ • Healthchecks                          │  Service reliability
│ • Docker networking                     │  Isolated environment
└─────────────────────────────────────────┘
```

**Three profiles for different workflows:**

- **Default:** PostgreSQL + Backend (compact, dev-friendly)
- **`--profile admin`:** Add pgAdmin + Adminer (inspect data)
- **`--profile pooling`:** Add PgBouncer (production-like testing)
- **`--profile monitoring`:** Add Prometheus (performance metrics)

### 2. Database Initialization (`ops/db-init/postgres-init.sql`)

Runs once when PostgreSQL container starts:

- Creates extensions (UUID, full-text search)
- Applies performance tuning (shared buffers, cache)
- Sets collation and logging
- Ready for Prisma migrations

### 3. Test Matrix Runner (`packages/lcyt-backend/test/matrix.js`)

Node.js script that runs the same test suite twice:

```bash
$ npm run test:matrix

╔════════════════════════════════════════════╗
║ LCYT Database Test Matrix                  ║
╚════════════════════════════════════════════╝

⏱️  Running tests...

  1️⃣  SQLite...
      ✓ Complete in 2.3s
  
  2️⃣  PostgreSQL...
      ✓ Complete in 2.8s

┌────────────────────────────────────────────┐
│ SQLite:      ✅ PASS (42 tests, 2.3s)      │
│ PostgreSQL:  ✅ PASS (42 tests, 2.8s)      │
│ Summary:     ✅ All databases passed       │
└────────────────────────────────────────────┘
```

**Output:** Exit code 0 (success) or 1 (failure) for CI integration.

### 4. CI/CD Integration (`.github/workflows/test-matrix.yml`)

Automated testing on every PR and main branch commit:

```yaml
jobs:
  test-matrix:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v3
      - run: npm install
      - run: npm run test:matrix  # Tests both SQLite + PostgreSQL
```

**PR Status Check:** Shows ✅ or ❌ for each database independently.

### 5. Environment Configuration (`ops/.env.postgres.example`)

Templated `.env` file with clear warnings:

```env
# PostgreSQL credentials (change in production!)
POSTGRES_USER=lcyt_user
POSTGRES_PASSWORD=dev-password-change-me

# Database URL (copy for testing)
DATABASE_URL=postgresql://lcyt_user:dev-password-change-me@postgres:5432/lcyt

# Testing: run tests against both databases
TEST_DATABASE_URL=postgresql://lcyt_user:dev-password-change-me@postgres:5432/lcyt_test
```

### 6. Documentation (`packages/lcyt-backend/PHASE_2_IMPLEMENTATION.md`)

Complete guide covering:

- **Setup:** 5-step Docker Compose getting started
- **Testing:** Manual + automated matrix testing
- **Troubleshooting:** Common issues & solutions
- **Performance:** Benchmarking both databases
- **Cleanup:** Proper shutdown and reset procedures

---

## Implementation Timeline

### Day 1: Infrastructure

- [ ] Create `docker-compose.pg.yml` with all services
- [ ] Write `ops/db-init/postgres-init.sql` for initialization
- [ ] Create `ops/.env.postgres.example` template
- [ ] Test stack locally: `docker compose -f docker-compose.pg.yml up`
- [ ] Verify all services healthy and interconnected

### Day 2: Test Matrix

- [ ] Create `packages/lcyt-backend/test/matrix.js` runner
- [ ] Integrate with npm scripts (`npm run test:matrix`)
- [ ] Test manually against both databases
- [ ] Verify accurate pass/fail reporting

### Day 3: CI/CD Integration

- [ ] Create `.github/workflows/test-matrix.yml`
- [ ] Set up PostgreSQL service container in CI
- [ ] Run workflow on test PR
- [ ] Validate both database results appear in PR check

### Day 4: Documentation & Edge Cases

- [ ] Write `PHASE_2_IMPLEMENTATION.md`
- [ ] Document troubleshooting for common issues
- [ ] Test timestamp handling across databases
- [ ] Verify NULL handling in unique indexes
- [ ] Check case-sensitivity assumptions

### Day 5: Validation & Refinement

- [ ] All tests pass on both databases (100%)
- [ ] Team can spin up stack in 5 minutes
- [ ] CI matrix workflow runs reliably
- [ ] Performance benchmarks collected
- [ ] Phase 2 PR review & merge

---

## Success Criteria

| Criterion | Verification |
|-----------|-------------|
| **Docker stack works** | `docker compose ps` shows all healthy |
| **Tests pass on SQLite** | `npm test` shows 100% pass rate |
| **Tests pass on PostgreSQL** | `DATABASE_URL="postgresql://..." npm test` shows 100% pass rate |
| **Matrix runner works** | `npm run test:matrix` outputs both results |
| **CI integration works** | PR shows test-matrix workflow ✅ |
| **Documentation complete** | PHASE_2_IMPLEMENTATION.md covers all scenarios |
| **Team can reproduce** | Any team member can `docker compose up` and run tests |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **PostgreSQL doesn't start in Docker** | 🟠 HIGH | Pre-tested Dockerfile + init script; docs troubleshooting section |
| **Tests fail on PostgreSQL but not SQLite** | 🟠 HIGH | Matrix script identifies database; debug patterns in docs |
| **Timestamp or collation incompatibilities** | 🟡 MEDIUM | Phase 2 explicitly tests these edge cases |
| **CI workflow takes too long** | 🟡 MEDIUM | Optimize test suite; parallelize if needed in Phase 3 |
| **Team unfamiliar with Docker Compose** | 🟡 MEDIUM | Clear 5-step setup guide; example commands provided |

---

## Resource Allocation

| Role | Effort | Details |
|------|--------|---------|
| **Backend Engineer** | 2 days | Docker Compose stack + test matrix |
| **DevOps / Platform** | 1.5 days | CI/CD workflow + Prometheus setup |
| **QA / Testing** | 1 day | Edge case validation + troubleshooting |
| **Docs** | 0.5 day | PHASE_2_IMPLEMENTATION.md |
| **Total** | ~5 days | One person part-time, or full-time to complete early |

---

## Deployment Checklist

Before marking Phase 2 complete:

- [ ] All files created (docker-compose.pg.yml, test matrix, CI workflow)
- [ ] Docker stack tested locally and all services healthy
- [ ] Test matrix runner works and outputs both databases
- [ ] CI workflow created and passes on test PR
- [ ] All tests pass on both SQLite and PostgreSQL
- [ ] Documentation complete with no TODOs
- [ ] Phase 2 PR reviewed and approved
- [ ] Phase 2 PR merged to main

---

## Next: Phase 3

Once Phase 2 is approved and merged:

1. **Connection Pool Tuning** — PgBouncer optimization + benchmarking
2. **Replica Testing** — Read-only followers (warm standby)
3. **Failover Testing** — Promote replica on primary failure
4. **Backup & Restore** — pg_dump + recovery procedures
5. **Production Deployment** — Migration runbook + cutover plan

**Phase 3 Timeline:** 1 week (concurrent with Phase 2 if desired)

---

## Key Files

### Phase 2 Deliverables

| File | Size | Purpose |
|------|------|---------|
| `docker-compose.pg.yml` | 8 KB | PostgreSQL stack definition |
| `ops/db-init/postgres-init.sql` | 1.5 KB | Database initialization |
| `ops/.env.postgres.example` | 4 KB | Configuration template |
| `packages/lcyt-backend/test/matrix.js` | 6 KB | Test matrix runner |
| `.github/workflows/test-matrix.yml` | 2 KB | CI/CD workflow |
| `packages/lcyt-backend/PHASE_2_IMPLEMENTATION.md` | 10 KB | Complete guide |
| **Total** | **31 KB** | **Complete Phase 2 implementation** |

---

## Questions Before Starting?

1. **Should we run tests in parallel (SQLite + PostgreSQL at same time)?**
   - Phase 2: Sequential (simpler debugging)
   - Phase 3: Parallel (faster CI feedback)

2. **Should we test against both read replicas and primary?**
   - Phase 2: Primary only (replica testing in Phase 3)
   - Phase 3: Full replica testing + failover

3. **Should we include performance benchmarking in Phase 2?**
   - Yes: Collect baseline metrics for Phase 3 optimization

4. **Should PgBouncer be enabled by default or optional?**
   - Optional (`--profile pooling`)
   - Easier to debug in dev mode without pooling

---

## Resources

- **Docker Docs:** https://docs.docker.com/compose/
- **PostgreSQL 16:** https://www.postgresql.org/docs/16/
- **Prisma Studio:** Built-in browser UI for data inspection
- **GitHub Actions:** https://docs.github.com/en/actions

---

## Approval & Sign-Off

**Phase 2 Ready to Start?** Approve above and execute the 5-day plan.

| Approver | Status | Notes |
|----------|--------|-------|
| Backend Team | ⏳ Pending | Ready to execute |
| DevOps | ⏳ Pending | Resource allocation confirmed |
| Project Lead | ⏳ Pending | Timeline acceptable |
