-- ───────────────────────────────────────────────────────────────────────────
-- PostgreSQL Initial Setup for LCYT
-- 
-- This script runs once when the PostgreSQL container starts.
-- It creates extensions and ensures the database is ready for Prisma migrations.
-- ───────────────────────────────────────────────────────────────────────────

-- Create extensions for UUID and full-text search
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For text search optimization

-- Create schema for LCYT tables (optional, can also use public schema)
CREATE SCHEMA IF NOT EXISTS lcyt;

-- Ensure proper collation for case-insensitive text fields
ALTER DATABASE lcyt SET lc_collate = 'en_US.UTF-8';
ALTER DATABASE lcyt SET lc_ctype = 'en_US.UTF-8';

-- Performance tuning for development
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '512MB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET random_page_cost = 1.1;  -- Good for SSD

-- Enable query logging for debugging (optional, uncomment if needed)
-- ALTER SYSTEM SET log_statement = 'all';
-- ALTER SYSTEM SET log_duration = 'on';
-- ALTER SYSTEM SET log_min_duration_statement = 0;

-- Comment to document this initialization
COMMENT ON DATABASE lcyt IS 'LCYT (Live Captions for YouTube) - PostgreSQL database';
COMMENT ON SCHEMA lcyt IS 'LCYT application schema';
