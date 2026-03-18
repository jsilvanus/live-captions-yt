---
name: databases-migrations
summary: |
  Databases & Migrations skill: SQLite/Postgres patterns, better-sqlite3 usage,
  migration scripts and rollback guidance.
---

## Purpose
Schema design and migration best practices for this repo (SQLite primary, optional Postgres).

## When to use
- Adding new tables, indexes, or changing FK relationships.
- Creating migrations that must run on startup safely.

## Checklist
- Migrations must be additive where possible; provide idempotent guards.
- Backup DB before destructive migrations; provide `DELETE`/anonymise scripts for GDPR.
- Use parameterized queries and avoid dynamic SQL.

## Commands
- Run migration locally (package-specific): follow package README; usually `node ./migrate.js`.

## Outputs
- Migration templates, rollback suggestions, example `better-sqlite3` usage.
