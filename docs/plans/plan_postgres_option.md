---
id: plan/postgres-option
title: "PostgreSQL as an Optional Backend"
status: draft
summary: "Add PostgreSQL as an optional backend for the Node.js backend and plugin-owned DB layers while preserving SQLite as the default."
---

# PostgreSQL as an Optional Backend

## Purpose

Provide a first-class PostgreSQL option for the Node.js backend and the plugin-owned database layers, while preserving the current SQLite path as the default and keeping the existing route/module structure intact as much as possible.

## Scope

This plan targets the Node.js backend stack first:

- `packages/lcyt-backend`
- the plugin-owned DB modules integrated by that backend
- the related migration, configuration, docs, and test paths

The Python backend remains out of scope for the initial rollout and can be revisited later if the Node path proves successful.

## Current state

The repository is currently SQLite-first across the Node backend and the plugin packages.

### Core backend

- The core backend schema and migrations are defined in `packages/lcyt-backend/src/db/schema.js`.
- The per-feature DB helpers live under `packages/lcyt-backend/src/db/` and are re-exported by `packages/lcyt-backend/src/db/index.js`.
- Current startup logic uses additive, SQLite-style migrations that inspect schema using `PRAGMA table_info(...)` and issue `ALTER TABLE ... ADD COLUMN` statements when needed.
- The current schema uses SQLite-specific constructs such as:
  - `AUTOINCREMENT`
  - `datetime('now')`
  - `strftime('%s','now')`
  - `ON CONFLICT ... DO UPDATE`
  - `PRAGMA`-based schema introspection
  - `ALTER TABLE ... RENAME TO` for destructive schema changes

### Plugins

The plugin packages each own their own DB migrations and helpers:

- `packages/plugins/lcyt-rtmp/src/db.js` and `packages/plugins/lcyt-rtmp/src/db/*.js`
- `packages/plugins/lcyt-dsk/src/db/*.js`
- `packages/plugins/lcyt-cues/src/db.js`
- `packages/plugins/lcyt-agent/src/db.js`
- `packages/plugins/lcyt-connectors/src/db.js`
- `packages/plugins/lcyt-production/src/db.js`
- `packages/plugins/lcyt-files/src/db.js`
- `packages/plugins/lcyt-music/src/db.js`

Most of these follow the same pattern as the core backend: create tables if missing, inspect columns with `PRAGMA`, and add missing columns incrementally.

## Design goals

1. Preserve SQLite as the default backend for local/dev and current deployments.
2. Add PostgreSQL as a supported option via configuration rather than a forked code path.
3. Keep the current repository structure and route patterns intact as much as possible.
4. Avoid introducing a heavy ORM; keep explicit SQL and add a thin compatibility layer instead.
5. Make the migration story explicit and testable for both engines.

## Proposed architecture

### 1. Introduce a database abstraction layer

Add a small DB facade that exposes the operations the current code expects:

- `prepare()` / `exec()`
- `run()` / `get()` / `all()`
- `transaction()`
- `close()`
- migration helpers such as `createTable`, `addColumnIfMissing`, and `ensureIndex`

This facade should hide the difference between:

- `better-sqlite3` for SQLite
- `pg` (or a thin wrapper around it) for PostgreSQL

The goal is not to replace every SQL statement with a generic query builder. Rather, the goal is to provide a minimal compatibility layer so existing DB modules continue to work with a small amount of dialect-specific glue.

### 2. Support engine selection through configuration

Make the backend selectable through the repository’s existing environment/config pattern, with Postgres enabled as an optional configuration path rather than a hard-coded fork:

- `DB_BACKEND=sqlite|postgres`
- `DB_URL` for PostgreSQL connection strings
- optional host/port/db/user/password overrides if needed
- support for configuration through the existing environment-file conventions used by the backend package so operators can opt in without changing code

SQLite should continue to be the default (`DB_BACKEND=sqlite`) and should keep using the existing `DB_PATH` semantics.

### 3. Replace startup-time SQLite migrations with an engine-aware migration runner

The current additive migration strategy is simple and works well for SQLite, but it does not map cleanly to PostgreSQL. The implementation should introduce a migration runner with these properties:

- versioned migrations rather than ad-hoc `PRAGMA`-based startup logic
- support for both SQLite and PostgreSQL
- idempotent application
- a stored migration history table

The first pass should focus on correctness and parity rather than on full migration history flexibility. The important point is to stop relying on `PRAGMA`-only logic as the primary migration path.

### 4. Centralize SQL dialect differences

Create a small compatibility layer for the common differences that appear throughout the codebase:

- timestamp defaults: `datetime('now')` vs `CURRENT_TIMESTAMP`
- epoch/time expressions: `strftime('%s','now')` vs `EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)`
- identity generation: SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` vs PostgreSQL `GENERATED ALWAYS AS IDENTITY`
- upsert syntax: SQLite `ON CONFLICT ... DO UPDATE` vs PostgreSQL `ON CONFLICT ... DO UPDATE`
- schema inspection: `PRAGMA table_info(...)` vs PostgreSQL metadata queries
- transaction semantics: synchronous SQLite transactions vs pooled PostgreSQL transactions

The implementation should prefer a small set of shared helpers over scattering `if (engine === 'postgres')` checks throughout every module.

## Phased implementation plan

### Phase 1 — DB abstraction and configuration

- Introduce the DB facade and wire it into the core backend bootstrap path.
- Add environment-based backend selection.
- Add a PostgreSQL driver dependency and a local development path for running Postgres.
- Document the new configuration surface in the backend package docs and the repo-level DB documentation.

### Phase 2 — Core backend schema and DB modules

- Refactor `packages/lcyt-backend/src/db/schema.js` to use the new migration runner.
- Port the core DB modules under `packages/lcyt-backend/src/db/` to the shared abstraction.
- Ensure core features work with PostgreSQL:
  - users and auth
  - API keys and project data
  - sessions and usage stats
  - caption targets and translation config
  - file metadata and related tables

### Phase 3 — Plugin DB modules

Apply the same abstraction to the plugin-owned DB helpers and schema:

- `lcyt-rtmp`
- `lcyt-dsk`
- `lcyt-cues`
- `lcyt-agent`
- `lcyt-connectors`
- `lcyt-production`
- `lcyt-files`
- `lcyt-music`

The initial rollout should preserve the current plugin behavior while ensuring each plugin can initialize and migrate with PostgreSQL.

### Phase 4 — Testing and development workflow

- Add a test matrix for SQLite and PostgreSQL.
- Add a local Postgres path for development (for example via Docker Compose or a simple script) so contributors can validate both backends locally.
- Add or update backend tests to cover the new adapter and migration path.
- Update operational docs for backup/restore, migrations, and deployment assumptions.

### Phase 5 — Rollout and follow-up

- Keep SQLite as the default for now.
- Document the supported Postgres deployment pattern and its operational caveats.
- Leave the Python backend for a later pass if the initial Node rollout is successful.

## Important implementation decisions

### Keep explicit SQL, do not introduce a full ORM

The repository already uses explicit SQL and module-local DB helpers. A full ORM would add a large amount of churn for limited gain. A thin adapter plus a migration runner is the lowest-risk path.

### Treat the first PostgreSQL pass as parity, not a redesign

The first goal is to make PostgreSQL a supported option without changing the higher-level feature behavior. This means preserving the existing data model and route-level semantics rather than re-architecting the system around Postgres-specific features.

### Expect some dialect-specific follow-up work

The codebase uses a mix of raw SQL, JSON payloads, timestamps, and additive migrations. The implementation will need to handle these carefully rather than assume a 1:1 rewrite of the SQLite SQL text.

## Risks and watchouts

- SQLite-specific DDL and migration logic will need explicit translation.
- The current code relies on several SQLite behaviors that are not identical in PostgreSQL.
- The current synchronous `better-sqlite3` pattern may require careful adaptation when moving to a pooled Postgres connection path.
- Some JSON and timestamp handling may benefit from a compatibility layer before wider schema changes are attempted.

## Definition of done

The plan is complete when:

- SQLite remains the default backend and existing behavior remains intact.
- The Node.js backend and the major plugin-backed DB modules can initialize and migrate against PostgreSQL.
- The repository has documentation for configuration, migration, and local development against PostgreSQL.
- Test coverage exists for both SQLite and PostgreSQL paths.
