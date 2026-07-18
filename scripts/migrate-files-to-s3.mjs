#!/usr/bin/env node

/**
 * Local filesystem → S3 migration script for caption files.
 *
 * Migrates all caption files from local FILE_STORAGE to S3 while updating
 * the caption_files DB table with the new S3 object keys. This is a copy-only
 * operation — local files are NOT deleted. To complete the migration, set
 * FILE_STORAGE=s3 and restart the backend.
 *
 * Usage:
 *   node scripts/migrate-files-to-s3.mjs [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be migrated without actually uploading or
 *                updating the database (default: false)
 *
 * Env vars (same as lcyt-backend):
 *   FILES_DIR              Local storage base directory (default: /data/files)
 *   FILE_STORAGE           Must not be set to 's3' (we're migrating FROM local)
 *   S3_BUCKET              Required S3 bucket name
 *   S3_REGION              AWS region or 'auto' for R2 (default: auto)
 *   S3_ENDPOINT            Custom S3 endpoint (e.g. R2, MinIO, B2)
 *   S3_PREFIX              Object key prefix (default: captions)
 *   S3_ACCESS_KEY_ID       S3 access key (optional; uses AWS credential chain if absent)
 *   S3_SECRET_ACCESS_KEY   S3 secret key
 *   DB_PATH                Path to SQLite database (default: ./lcyt-backend.db)
 *
 * Exit codes:
 *   0  Success (all files migrated)
 *   1  Configuration error (missing env vars)
 *   2  File access / S3 error (some files failed)
 */

import * as fs from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { createS3Adapter } from '../packages/plugins/lcyt-files/src/adapters/s3.js';
import { keySegment } from '../packages/plugins/lcyt-files/src/adapters/key-segment.js';

const readFileAsync = promisify(fs.readFile);

// ─── CLI Arguments ───────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run');

// ─── Configuration ───────────────────────────────────────────────────────────

const filesDir = process.env.FILES_DIR || '/data/files';
const fileStorage = process.env.FILE_STORAGE || 'local';
const s3Bucket = process.env.S3_BUCKET;
const s3Region = process.env.S3_REGION || 'auto';
const s3Endpoint = process.env.S3_ENDPOINT || undefined;
const s3Prefix = process.env.S3_PREFIX || 'captions';
const s3AccessKey = process.env.S3_ACCESS_KEY_ID || undefined;
const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY || undefined;
const dbPath = process.env.DB_PATH || './lcyt-backend.db';

// ─── Validation ──────────────────────────────────────────────────────────────

if (fileStorage === 's3') {
  console.error('Error: FILE_STORAGE is already set to "s3". This script migrates FROM local TO S3.');
  console.error('Set FILE_STORAGE to "local" or unset it.');
  process.exit(1);
}

if (!s3Bucket) {
  console.error('Error: S3_BUCKET environment variable is required.');
  process.exit(1);
}

if (!fs.existsSync(filesDir)) {
  console.error(`Error: FILES_DIR directory does not exist: ${filesDir}`);
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Error: Database file does not exist: ${dbPath}`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively walk a directory and yield all files.
 * @param {string} dir
 * @yields {{ path: string, name: string, size: number }}
 */
async function* walkFiles(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Warning: could not read directory ${dir}:`, err.message);
    }
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.promises.stat(fullPath);
        yield { path: fullPath, name: entry.name, size: stat.size };
      } catch (err) {
        console.warn(`Warning: could not stat file ${fullPath}:`, err.message);
      }
    }
  }
}

/**
 * Extract the API key from the local directory structure.
 * LocalAdapter stores files under filesDir/{keySegment(apiKey)}/{filename}.
 * Scan the DB to find which key maps to each directory segment.
 *
 * @param {Database} db
 * @param {string} keySegmentStr
 * @returns {string|null}
 */
function findApiKeyBySegment(db, keySegmentStr) {
  // Load all unique api_keys from the caption_files table
  // and find the one whose keySegment matches the given segment.
  const stmt = db.prepare('SELECT DISTINCT api_key FROM caption_files');
  for (const row of stmt.all()) {
    if (keySegment(row.api_key) === keySegmentStr) {
      return row.api_key;
    }
  }
  return null;
}

/**
 * Build the S3 object key for a file under a key's prefix.
 * @param {string} apiKey
 * @param {string} filename  Local filename (bare, no directory component)
 * @returns {string}
 */
function buildS3ObjectKey(apiKey, filename) {
  return `${s3Prefix}/${keySegment(apiKey)}/${filename}`;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Local Filesystem → S3 Caption File Migration              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no uploads or database changes)' : 'LIVE'}`);
  console.log(`Local storage dir: ${filesDir}`);
  console.log(`Database: ${dbPath}`);
  console.log(`S3 bucket: ${s3Bucket}`);
  console.log(`S3 region: ${s3Region}`);
  console.log(`S3 endpoint: ${s3Endpoint || '(default AWS)'}`);
  console.log(`S3 prefix: ${s3Prefix}`);
  console.log();

  // Create S3 adapter
  let s3adapter;
  try {
    s3adapter = await createS3Adapter({
      bucket: s3Bucket,
      region: s3Region,
      endpoint: s3Endpoint,
      prefix: s3Prefix,
      credentials: s3AccessKey ? {
        accessKeyId: s3AccessKey,
        secretAccessKey: s3SecretKey || '',
      } : undefined,
    });
    console.log('✓ S3 adapter initialized');
  } catch (err) {
    console.error('✗ Failed to initialize S3 adapter:', err.message);
    process.exit(1);
  }

  // Open database
  let db;
  try {
    db = new Database(dbPath);
    console.log('✓ Database opened');
  } catch (err) {
    console.error('✗ Failed to open database:', err.message);
    process.exit(1);
  }

  // Load all caption_files records
  let allFiles;
  try {
    const stmt = db.prepare('SELECT id, api_key, filename, size_bytes FROM caption_files');
    allFiles = stmt.all();
    console.log(`✓ Loaded ${allFiles.length} caption file records from DB`);
  } catch (err) {
    console.error('✗ Failed to query caption_files:', err.message);
    db.close();
    process.exit(1);
  }

  console.log();

  // Categorize files by their current location
  const filesToMigrate = [];
  const skipped = [];

  for (const row of allFiles) {
    const { id, api_key: apiKey, filename: storedKey, size_bytes: storedSize } = row;

    // Check if this is a local file path or already an S3 key
    if (storedKey.startsWith(s3Prefix + '/')) {
      // Already migrated
      skipped.push({ id, apiKey, reason: 'already-s3', storedKey });
      continue;
    }

    // Assume it's a local file path
    if (!fs.existsSync(storedKey)) {
      skipped.push({ id, apiKey, reason: 'file-not-found', storedKey });
      continue;
    }

    filesToMigrate.push({ id, apiKey, localPath: storedKey, storedSize });
  }

  console.log(`→ To migrate: ${filesToMigrate.length}`);
  console.log(`→ To skip: ${skipped.length} (already S3 or not found locally)`);
  console.log();

  if (filesToMigrate.length === 0) {
    console.log('Nothing to migrate.');
    db.close();
    process.exit(0);
  }

  // Migrate files
  const stats = {
    migrated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const { id, apiKey, localPath, storedSize } of filesToMigrate) {
    try {
      // Read file from disk
      const fileBuffer = await readFileAsync(localPath);
      const actualSize = fileBuffer.length;

      // Compute S3 object key: use the relative path from the key's directory
      const keyDirSegment = keySegment(apiKey);
      const keyDirPath = join(filesDir, keyDirSegment);
      const relativeFromKeyDir = relative(keyDirPath, localPath).replace(/\\/g, '/');
      const s3ObjectKey = buildS3ObjectKey(apiKey, relativeFromKeyDir);

      if (isDryRun) {
        console.log(`  [DRY-RUN] Would upload: ${localPath}`);
        console.log(`             → S3 key: ${s3ObjectKey}`);
        console.log(`             → Size: ${actualSize} bytes`);
        stats.migrated++;
      } else {
        // Upload to S3
        await s3adapter.putObject(apiKey, relativeFromKeyDir, fileBuffer, 'text/plain');

        // Verify by listing and checking size
        let verified = false;
        for await (const obj of s3adapter.listObjects(apiKey, relativeFromKeyDir)) {
          if (obj.objectKey === relativeFromKeyDir && obj.size === actualSize) {
            verified = true;
            break;
          }
        }

        if (!verified) {
          stats.failed++;
          stats.errors.push(`${localPath}: verification failed (size mismatch after upload)`);
          console.log(`  ✗ FAILED: ${localPath}`);
          continue;
        }

        // Update DB
        const updateStmt = db.prepare('UPDATE caption_files SET filename = ? WHERE id = ?');
        updateStmt.run(s3ObjectKey, id);

        console.log(`  ✓ Migrated (${actualSize} bytes): ${localPath}`);
        console.log(`             → ${s3ObjectKey}`);
        stats.migrated++;
      }
    } catch (err) {
      stats.failed++;
      const msg = `${localPath}: ${err.message}`;
      stats.errors.push(msg);
      console.log(`  ✗ FAILED: ${msg}`);
    }
  }

  db.close();

  console.log();
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Summary                                                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`  Migrated:  ${stats.migrated}`);
  console.log(`  Skipped:   ${stats.skipped}`);
  console.log(`  Failed:    ${stats.failed}`);

  if (stats.errors.length > 0) {
    console.log();
    console.log('Errors:');
    for (const err of stats.errors) {
      console.log(`  • ${err}`);
    }
  }

  if (isDryRun) {
    console.log();
    console.log('DRY-RUN MODE: No files were uploaded and no database changes were made.');
    console.log('Remove --dry-run to perform the actual migration.');
  } else if (stats.failed === 0) {
    console.log();
    console.log('✓ All files successfully migrated to S3.');
    console.log('  Next step: Set FILE_STORAGE=s3 in your environment and restart lcyt-backend.');
  }

  console.log();
  process.exit(stats.failed > 0 ? 2 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
