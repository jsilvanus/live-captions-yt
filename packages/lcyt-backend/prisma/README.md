# Prisma Migration Guide for LCYT Backend (Phase 1)

This directory contains the Prisma ORM schema and migrations for LCYT Backend.

## Overview

LCYT Backend is transitioning from raw `better-sqlite3` SQL queries to **Prisma ORM**, allowing seamless support for both SQLite and PostgreSQL without code changes.

### Current Status (Phase 1)

- ✅ Prisma schema created (`schema.prisma`)
- ✅ Database abstraction layer (`src/db-factory.js`)
- 🟡 Gradual migration of route handlers (in progress)
- ⏳ Phase 2: PostgreSQL compose stack (future)
- ⏳ Phase 3: Production deployment (future)

## Setup

### Prerequisites

```bash
# Install Prisma
npm install -D prisma @prisma/client -w packages/lcyt-backend
```

### Environment Configuration

Create `packages/lcyt-backend/prisma/.env.local`:

```env
# SQLite (development, default)
DATABASE_URL="file:./lcyt.db"

# PostgreSQL (staging/production)
# DATABASE_URL="postgresql://user:password@localhost:5432/lcyt"
```

## Workflow

### Generate Prisma Client

After any schema changes:

```bash
cd packages/lcyt-backend
npx prisma generate
```

Or automatically during build:

```bash
npm run build
```

### Create a Migration

After modifying `schema.prisma`:

```bash
cd packages/lcyt-backend
npx prisma migrate dev --name <description>
```

Example:

```bash
npx prisma migrate dev --name add_translation_config
```

This:
1. Creates a migration file in `prisma/migrations/<timestamp>_<name>/`
2. Applies it to the development database
3. Regenerates the Prisma client

### Apply Migrations in Production

```bash
npx prisma migrate deploy
```

### Inspect the Database

Open Prisma Studio to visually inspect/edit data:

```bash
npx prisma studio
```

Access at `http://localhost:5555`

## Schema & Tables

The Prisma schema includes all 48+ LCYT tables:

- **Users & Auth:** `User`, `Organization`, `OrgMember`
- **Projects:** `ApiKey`, `ProjectFeature`, `ProjectMember`
- **Captions:** `CaptionTarget`, `CaptionUsage`, `CaptionError`
- **Streaming:** `Session`, `SessionStats`, `Broadcast`, `Video`
- **Files & Storage:** `CaptionFile`, `Icon`
- **Translations:** `TranslationVendorConfig`, `TranslationTarget`
- **Events & Audit:** `AuditLog`, `BusEvent`, `MCPToken`
- **Server Config:** `ServerSettings`

See [schema.prisma](./schema.prisma) for the complete definition.

## Migration Path

### Phase 1: ORM Integration (Weeks 1-2)

**Current phase.** Establish Prisma infrastructure:

- [x] Create `schema.prisma` by introspecting existing SQLite DB
- [x] Implement database abstraction layer (`DbClient`)
- [ ] Update 5-10 critical route handlers to use new abstraction
- [ ] Run test suite: all tests pass on SQLite
- [ ] Document ORM patterns in `packages/lcyt-backend/CLAUDE.md`

### Phase 2: PostgreSQL Testing (Weeks 2-3)

**Future.** Validate compatibility:

- Docker Compose stack with PostgreSQL
- Run same test suite against both SQLite and PostgreSQL
- All tests pass on both databases
- Performance benchmarks

### Phase 3: Production Readiness (Weeks 3-4)

**Future.** Connection pooling and deployment:

- PgBouncer sidecar configuration
- Multi-instance load testing
- Kubernetes manifests
- Deployment runbooks

## Usage in Code

### Old (raw SQL via better-sqlite3)

```javascript
// src/db/users.js
import Database from 'better-sqlite3';

export function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Route handler
const user = getUserById(db, 42);
```

### New (Prisma)

```javascript
// src/db/users.js
import { prisma } from '../db-factory.js';

export async function getUserById(id) {
  return prisma.user.findUnique({
    where: { id },
  });
}

// Route handler
const user = await getUserById(42);
```

### Hybrid (during transition)

```javascript
// src/db-factory.js DbClient abstraction
import { DbClient } from '../db-factory.js';

const db = await DbClient.create();

// Works on both SQLite and PostgreSQL
const user = db.get('SELECT * FROM users WHERE id = ?', 42);
const result = db.run('INSERT INTO users (...) VALUES (?, ...)', ...values);
const allUsers = db.all('SELECT * FROM users');
```

## Testing

### Run Tests (SQLite)

```bash
npm test -w packages/lcyt-backend
```

### Run Tests (PostgreSQL)

**Requires PostgreSQL running locally (Docker Compose setup coming in Phase 2)**

```bash
DATABASE_URL="postgresql://lcyt_user:password@localhost:5432/lcyt" \
npm test -w packages/lcyt-backend
```

## Troubleshooting

### "Cannot find module @prisma/client"

Install dependencies:

```bash
npm install -w packages/lcyt-backend
```

### Migration conflicts

Check the migrations directory:

```bash
ls -la prisma/migrations/
```

Reset the database (dev only):

```bash
npx prisma migrate reset
```

### Schema mismatch

Validate schema against database:

```bash
npx prisma validate
```

Introspect current database:

```bash
npx prisma db pull
```

## Next Steps

1. **Install Prisma** in the backend package
2. **Generate Prisma client:** `npx prisma generate`
3. **Migrate 5-10 critical modules** to use `DbClient` abstraction
4. **Run full test suite** to verify compatibility
5. **Document patterns** in `CLAUDE.md`
6. **Proceed to Phase 2** when Phase 1 is stable

## References

- [Prisma Documentation](https://www.prisma.io/docs/)
- [Prisma SQLite Guide](https://www.prisma.io/docs/reference/database-reference/connection-urls#sqlite)
- [Prisma PostgreSQL Guide](https://www.prisma.io/docs/reference/database-reference/connection-urls#postgresql)
- [LCYT DATABASE_ARCHITECTURE.md](../../../../DATABASE_ARCHITECTURE.md)
- [LCYT plan_postgres_migration.md](../../../../docs/plans/plan_postgres_migration.md)
