/**
 * DSK plugin DB migrations.
 *
 * No-op: dsk_templates, dsk_viewports, dsk_thumbnails and the caption_files image columns
 * (shorthand, mime_type, settings_json) are part of lcyt-backend's schema
 * (prisma/sqlite/schema.sql for SQLite, prisma/postgres/migrations for PostgreSQL).
 * Kept so existing callers keep working.
 *
 * @param {object} [_db] Prisma client (unused)
 */
export async function runMigrations(_db) {}
