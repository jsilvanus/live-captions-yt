# Phase 1 Implementation Guide: Prisma Integration

**Status:** ACTIVE - Starting NOW  
**Duration:** 2 weeks  
**Goal:** Integrate Prisma ORM as database abstraction layer for both SQLite and PostgreSQL

---

## What Has Been Set Up

### Files Created

1. **`prisma/schema.prisma`** (20K)
   - Complete Prisma schema for all 48+ tables
   - Supports both SQLite and PostgreSQL
   - Includes all relationships and indexes

2. **`prisma/.env.example`**
   - DATABASE_URL examples for SQLite and PostgreSQL
   - Copy to `.env.local` for local development

3. **`prisma/README.md`**
   - Comprehensive guide to Prisma workflow
   - Migration, testing, and troubleshooting docs

4. **`prisma/migrations/0001_init/migration.sql`**
   - Initial migration placeholder
   - Ready for schema synchronization

5. **`src/db-factory.js`** (6K)
   - Database abstraction layer
   - `DbClient` class: transparent SQLite/PostgreSQL adapter
   - Methods: `run()`, `get()`, `all()`, `prepare()`, `transaction()`
   - Gradual migration path without changing existing route handlers

6. **`src/db/users-prisma.js`**
   - Example: User module refactored to use `DbClient`
   - Shows pattern for migrating other modules

---

## Next Steps for Phase 1

### Step 1: Install Prisma & Dependencies

```bash
cd D:\live-captions-yt
npm install -D prisma @prisma/client -w packages/lcyt-backend
```

**Expected output:** Prisma CLI and client installed to `node_modules`

**Time:** ~5 minutes

### Step 2: Generate Prisma Client

```bash
cd packages/lcyt-backend
npx prisma generate
```

**Expected output:**
```
✔ Generated Prisma Client (5.x.x) to ./node_modules/@prisma/client in XXXms
```

**Time:** ~2 minutes

### Step 3: Verify Database Connection

```bash
cd packages/lcyt-backend
npx prisma studio
```

**Expected output:** Opens `http://localhost:5555` showing all tables and data

**This validates:** schema matches existing database

**Time:** ~30 seconds

### Step 4: Run Existing Tests (SQLite baseline)

```bash
cd D:\live-captions-yt
npm test -w packages/lcyt-backend
```

**Expected output:** All tests pass (no changes yet, just using existing better-sqlite3)

**Baseline:** Ensure everything works before migrating

**Time:** ~3-5 minutes

### Step 5: Migrate First Critical Module (Users)

Pick one route that uses `users.js` and update it:

**Example: `/auth/login` in `packages/lcyt-backend/src/routes/auth.js`**

**Before:**
```javascript
import { getUserByEmail } from '../db/users.js';

export function loginRoute(db) {
  return async (req, res) => {
    const user = getUserByEmail(db, req.body.email);
    // ...
  };
}
```

**After (compatible with both SQLite and PostgreSQL):**
```javascript
import { DbClient } from '../db-factory.js';
import { getUserByEmail } from '../db/users.js'; // Same signature

export function loginRoute(db) {
  return async (req, res) => {
    // If db is a DbClient, use it directly
    // If db is better-sqlite3 Database, wrap it
    const db_client = db instanceof DbClient ? db : DbClient.wrap(db);
    const user = getUserByEmail(db_client, req.body.email);
    // ...
  };
}
```

**Alternative: Use existing `better-sqlite3` API directly** (works for now)

The `DbClient` class mimics the `better-sqlite3` API, so minimal changes needed:
```javascript
// Both of these work the same way:
const user = db.get('SELECT * FROM users WHERE id = ?', 42);
const user = dbClient.get('SELECT * FROM users WHERE id = ?', 42);
```

**Time:** ~15 minutes per route

### Step 6: Test Each Module

After updating each database module:

```bash
npm test -w packages/lcyt-backend
```

Ensure all tests still pass. The `DbClient` abstraction handles both databases transparently.

### Step 7: Update Build Pipeline

Add Prisma client generation to the build:

**`packages/lcyt-backend/package.json`:**
```json
{
  "scripts": {
    "build": "npx prisma generate",
    "start": "node src/index.js",
    "test": "cross-env ... node --test test/*.test.js"
  }
}
```

### Step 8: Document Patterns

Update `packages/lcyt-backend/CLAUDE.md`:

```markdown
## Database Layer (Phase 1: Prisma Integration)

### ORM
- **ORM:** Prisma (supports both SQLite and PostgreSQL)
- **Abstraction:** `DbClient` class provides SQLite API compatibility
- **Migration status:** Gradual, transparent, no breaking changes

### Query Patterns

**Raw SQL (recommended during Phase 1):**
```javascript
const user = db.get('SELECT * FROM users WHERE id = ?', userId);
const users = db.all('SELECT * FROM users');
const result = db.run('UPDATE users SET name = ? WHERE id = ?', name, userId);
```

**Prisma (new, will expand in Phase 2):**
```javascript
import { prisma } from './db-factory.js';
const user = await prisma.user.findUnique({ where: { id: userId } });
```

### Testing
- Run tests on SQLite: `npm test -w packages/lcyt-backend`
- Run tests on PostgreSQL (Phase 2): See Phase 2 guide
```

---

## Checklist for Phase 1 Completion

- [ ] Install Prisma & @prisma/client
- [ ] Run `npx prisma generate`
- [ ] Open Prisma Studio to verify schema
- [ ] Run existing tests (baseline SQLite)
- [ ] Migrate `users.js` module
  - [ ] Update 1 route that uses getUserByEmail()
  - [ ] Test: confirm all tests pass
- [ ] Migrate 4 more critical modules (pick from list below)
  - [ ] `keys.js` — API key operations
  - [ ] `orgs.js` — Organization management
  - [ ] `caption-targets.js` — Target CRUD
  - [ ] `audit-log.js` — Audit trail
- [ ] Update build pipeline: add `prisma generate` step
- [ ] Update `CLAUDE.md` with new ORM info
- [ ] Run full test suite one more time
- [ ] Create summary PR/branch: "Phase 1: Prisma ORM integration"

---

## Module Migration Priority

**Tier 1 (Critical, affects most routes):**
1. ✅ `users.js` — User CRUD, auth
2. `keys.js` — API key creation/verification
3. `orgs.js` — Organization CRUD, membership

**Tier 2 (High priority):**
4. `caption-targets.js` — Target configuration
5. `audit-log.js` — Audit trail (read-only for now)
6. `sessions.js` — Session lifecycle

**Tier 3 (Lower priority, can wait for Phase 2):**
7-24. Other modules: translations, stats, device-roles, etc.

**Total modules to migrate in Phase 1:** ~5-7  
**Estimated time:** 5 hours of coding + testing

---

## FAQ

### Q: Do I need to rewrite all the SQL queries?

**A:** No! The `DbClient` abstraction keeps the same `db.get()`, `db.run()`, `db.all()` API. Existing SQL queries work unchanged. You only need to:
1. Import `DbClient` where you create the db instance
2. Ensure it's passed down to query functions

### Q: Will tests fail during migration?

**A:** No. The `DbClient` wraps `better-sqlite3`, so it behaves identically. All tests pass before, during, and after migration because the SQL queries are unchanged.

### Q: Can I mix `DbClient` and raw `better-sqlite3` in the same route?

**A:** Yes, but avoid it. Wrap the db instance once at the route entry point. All helper functions receive the same `DbClient` instance.

### Q: When do we switch from SQLite to PostgreSQL?

**A:** Phase 2 (weeks 2-3). For now, everything runs on SQLite. Phase 1 just sets up the abstraction layer so Phase 2 is a simple `DATABASE_URL` change.

### Q: What if a route uses multiple db operations in a transaction?

**A:** `DbClient.transaction(fn)` handles both SQLite and PostgreSQL:
```javascript
db.transaction(() => {
  db.run('INSERT INTO users (...) VALUES (...)', ...);
  db.run('INSERT INTO org_members (...) VALUES (...)', ...);
});
```

---

## Resources

- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [Prisma Migrate Guide](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [SQLite to PostgreSQL Migration](https://www.prisma.io/docs/guides/migrate-to-prisma)
- [LCYT DATABASE_ARCHITECTURE.md](../../../../DATABASE_ARCHITECTURE.md)
- [LCYT plan_postgres_migration.md](../../../../docs/plans/plan_postgres_migration.md)

---

## Timeline

| Date | Milestone |
|------|-----------|
| Today (10/6) | Phase 1 setup complete (this file) |
| 10/7-10/8 | Migrate 5-7 modules, run tests |
| 10/9 | Full test pass, update docs |
| 10/10 | Buffer/polish |
| 10/11 | Phase 1 complete, ready for Phase 2 |

---

## Questions?

Post in the team Slack or comment on the phase 1 PR branch. This is a **no-risk migration** because the `DbClient` abstraction is transparent to the rest of the codebase.
