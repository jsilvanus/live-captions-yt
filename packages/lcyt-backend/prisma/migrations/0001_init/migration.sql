/*
  Warnings:

  - You are about to drop the `admin_audit_log` table. If the table has data, this will be lost.

*/
-- This is an initial migration for Prisma. It captures the existing SQLite schema.
-- For PostgreSQL, Prisma will auto-create all tables based on schema.prisma.
-- For SQLite, this migration is mostly documentation; the actual schema
-- initialization happens in src/db/schema.js at startup (idempotent CREATE TABLE IF NOT EXISTS).

DROP TABLE IF EXISTS "admin_audit_log";
